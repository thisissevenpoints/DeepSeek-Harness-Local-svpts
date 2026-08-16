/**
 * DeepSeek Harness 托盘应用（看门狗 + 桌面壳，单一进程，2026-08-16 深夜重构）
 * - 常驻系统托盘：后台 dsh 服务由本进程唯一托管（健康巡检/子进程存活判定/崩溃重启）
 * - 托盘左键或菜单"打开 DeepSeek Harness"：打开/聚焦应用窗口（关窗回到托盘，后台不停）
 * - 托盘菜单"退出（停止后台服务）"或停止脚本：显式退出才停后台
 * - 启动脚本双击时若已在运行：通过 second-instance 事件直接唤起窗口
 * - 3080 已有外部实例：仅监控不接管也不杀；外部实例退出后自动拉起自己的实例
 * - 停止信号：desktop\watchdog.stop 文件出现 → 清理自己拉起的实例 → 退出（停止脚本兼容）
 * - watchdog.pid：本进程 pid（停止脚本兜底清理用）
 * - 测试钩子：DSH_DESKTOP_SMOKE=1（烟测后停后台退出）、DSH_DESKTOP_AUTOQUIT=1（加载后仅退出、不停后台）
 * - 日志：desktop\watchdog.log（看门狗）、desktop\shell.log（壳）；dsh 输出：desktop\dsh-web.log
 */
const { app, BrowserWindow, Tray, Menu, dialog } = require('electron')

// 防御：ELECTRON_RUN_AS_NODE 被设为 1 或空串都会进入纯 Node 模式（app 为 undefined）。
// 启动脚本已用 $env:VAR=$null 彻底删除该变量，此处兜底给出明确错误。
if (!app) {
  try {
    fs.appendFileSync(path.join(__dirname, 'shell.log'),
      `[${new Date().toISOString()}] FATAL: electron running in node mode (ELECTRON_RUN_AS_NODE set). Remove the env var and retry.\n`)
  } catch { /* ignore */ }
  process.exit(1)
}
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

// 路径基于脚本位置推导（项目根 = desktop 的上级），支持任意部署位置；
// DSH_REPO_DIR / DSH_HOME 环境变量可覆盖
const ROOT_DIR = path.resolve(__dirname, '..')
const REPO_DIR = process.env.DSH_REPO_DIR || path.join(ROOT_DIR, 'deepseek-harness')
const DSH_HOME_DIR = process.env.DSH_HOME || path.join(ROOT_DIR, 'dsh-home')
const WEB_URL = 'http://127.0.0.1:3080'
const DIR = __dirname
const PID_FILE = path.join(DIR, 'watchdog.pid')
const STOP_FILE = path.join(DIR, 'watchdog.stop')
const WATCHDOG_LOG = path.join(DIR, 'watchdog.log')
const SHELL_LOG = path.join(DIR, 'shell.log')
const TRAY_ICON = path.join(DIR, 'tray.png')
const APP_ICON = path.join(DIR, 'app.ico') // 窗口/任务栏图标（与托盘同源生成）
const HEALTH_INTERVAL_MS = 5000
const BOOT_TIMEOUT_MS = 180000 // 子进程存活但迟迟不监听的兜底上限（3 分钟）
const MAX_CONSECUTIVE_FAILURES = 4
const SYS32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const SMOKE = process.env.DSH_DESKTOP_SMOKE === '1'
const AUTOQUIT = process.env.DSH_DESKTOP_AUTOQUIT === '1'

function wlog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { fs.appendFileSync(WATCHDOG_LOG, line) } catch { /* 日志尽力而为 */ }
}
function slog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { fs.appendFileSync(SHELL_LOG, line) } catch { /* 日志尽力而为 */ }
}

// —— 单实例：userData 隔离到本目录，避免与其它未打包 Electron 应用共用锁 ——
// DSH_DESKTOP_USERDATA 为测试钩子：允许并行测试实例拥有独立锁，不打扰正在运行的会话
app.setPath('userData', process.env.DSH_DESKTOP_USERDATA || path.join(DIR, 'electron-userdata'))
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => { openShellWindow() })
  app.whenReady().then(main).catch((err) => {
    wlog(`startup failed: ${err && err.stack ? err.stack : err}`)
    app.exit(1)
  })
}

// ================= 看门狗逻辑 =================
let dshChild = null
let owned = false
let lastSpawnAt = 0
let failures = 0

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function listenerPidOn3080() {
  try {
    const out = spawnSync(path.join(SYS32, 'netstat.exe'), ['-ano'], { encoding: 'utf8' }).stdout || ''
    const line = out.split(/\r?\n/).find((l) => l.includes(':3080') && /LISTENING/i.test(l))
    if (!line) return null
    const pid = parseInt(line.trim().split(/\s+/).pop(), 10)
    return Number.isInteger(pid) ? pid : null
  } catch {
    return null
  }
}

function killPid(pid) {
  if (!pid || !Number.isInteger(pid) || pid === process.pid) return
  try { spawnSync(path.join(SYS32, 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 尽力而为 */ }
}

function killOwnedBackend() {
  // 双保险：先杀自己拉起的进程树，再按端口清掉可能漏网的孙进程（只清理自己拉起的）
  if (owned && dshChild && dshChild.pid) {
    wlog(`stopping dsh tree (pid ${dshChild.pid})`)
    killPid(dshChild.pid)
  }
  if (owned) {
    const lp = listenerPidOn3080()
    if (lp && lp !== (dshChild && dshChild.pid)) {
      wlog(`port fallback: killing leftover listener (pid ${lp})`)
      killPid(lp)
    }
  }
  dshChild = null
  owned = false
}

function startDsh() {
  const out = fs.openSync(path.join(DIR, 'dsh-web.log'), 'a')
  dshChild = spawn('cmd', ['/c', 'pnpm dsh web'], {
    cwd: REPO_DIR,
    env: { ...process.env, DSH_HOME: DSH_HOME_DIR },
    windowsHide: true,
    stdio: ['ignore', out, out],
  })
  dshChild.on('exit', (code) => wlog(`dsh child exited (code ${code})`))
  owned = true
  lastSpawnAt = Date.now()
  wlog(`spawned dsh (pid ${dshChild.pid})`)
}

async function probeWeb() {
  // 任何 HTTP 响应（含 404 等启动期状态码）都证明服务进程活着
  try {
    const res = await fetch(WEB_URL, { signal: AbortSignal.timeout(3000) })
    return { up: true, detail: 'HTTP ' + res.status }
  } catch (e) {
    const detail = e && e.cause && e.cause.code ? e.cause.code : String((e && e.message) || e)
    return { up: false, detail: detail.slice(0, 80) }
  }
}

let givingUp = false
let lastGiveUpLogAt = 0
let quitting = false // 退出竞态防护：任何退出路径先置位，tick 立即静默

async function watchdogTick() {
  if (quitting) return
  // 1) 停止信号优先
  if (fs.existsSync(STOP_FILE)) {
    wlog('stop signal received, shutting down')
    quitting = true
    killOwnedBackend()
    fs.rmSync(STOP_FILE, { force: true })
    app.quit()
    return
  }
  // 2) 健康巡检
  const probe = await probeWeb()
  if (probe.up) {
    if (failures > 0 || givingUp) {
      wlog('backend healthy again, resetting failure counter')
      failures = 0
      givingUp = false
    }
    return
  }
  // 3) 宕机判定以"子进程是否存活"为准：进程活着就是还在启动/运行，绝不误杀。
  //    dsh 冷启动时长随机器负载波动（实测 10-30 秒），用固定宽限期必然有撞车窗口。
  const childAlive = owned && dshChild && dshChild.pid && pidAlive(dshChild.pid)
  if (childAlive && Date.now() - lastSpawnAt < BOOT_TIMEOUT_MS) return
  if (childAlive) {
    wlog('boot timeout: child alive but not listening for 3min, force restarting')
  }
  // 4) 已放弃自动重启：继续监测，后台恢复后自动复位；否则每 60 秒提示一次
  if (givingUp) {
    if (Date.now() - lastGiveUpLogAt > 60000) {
      lastGiveUpLogAt = Date.now()
      wlog(`backend still down (${probe.detail}), auto-restart disabled (recover via 停止+启动脚本)`)
    }
    return
  }
  failures += 1
  if (failures > MAX_CONSECUTIVE_FAILURES) {
    wlog(`backend unreachable ${failures - 1} times in a row, giving up on auto-restart (will keep monitoring)`)
    givingUp = true
    lastGiveUpLogAt = Date.now()
    killOwnedBackend()
    return
  }
  wlog(`backend unreachable (${failures}/${MAX_CONSECUTIVE_FAILURES}, ${probe.detail}), restarting...`)
  killOwnedBackend()
  startDsh()
}

// ================= 壳窗口逻辑 =================
let win = null
let tray = null // 必须保持模块级引用，否则 Tray 会被 GC、图标消失

async function isWebUp() {
  try {
    const res = await fetch(WEB_URL, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

const WebSocket = require('ws')
function isApiUp() {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => {
      if (settled) return
      settled = true
      try { ws.terminate() } catch { /* 已关闭 */ }
      resolve(v)
    }
    const ws = new WebSocket(WEB_URL.replace('http://', 'ws://') + '/api/events.mux')
    ws.on('open', () => done(true))
    ws.on('unexpected-response', (_req, res) => done(res.statusCode === 426))
    ws.on('error', () => done(false))
    setTimeout(() => done(false), 2500)
  })
}

async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

// —— UI 右上角"完全退出"按钮（壳注入，不改动 DSH 前端本体）——
// 双通道通知壳：console.log 标记（一定送达 console-message 事件）+ 自定义协议导航
// （will-navigate 拦截）。Chromium 可能拦截未知协议的导航导致单一通道失效，故双保险。
const QUIT_PROTOCOL_URL = 'dsh-desktop://quit'
const QUIT_CONSOLE_MARKER = 'DSH_DESKTOP_QUIT'
const QUIT_BTN_INJECT = `(() => {
  if (document.getElementById('dsh-desktop-quit')) return
  const btn = document.createElement('button')
  btn.id = 'dsh-desktop-quit'
  btn.title = '完全退出（停止前端与后台）'
  btn.textContent = '\\u23FB'
  btn.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483647;width:30px;height:30px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:rgba(17,24,39,.75);color:#e5e7eb;font-family:"Segoe UI Symbol",sans-serif;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s'
  btn.onmouseenter = () => { btn.style.background = 'rgba(220,38,38,.85)' }
  btn.onmouseleave = () => { btn.style.background = 'rgba(17,24,39,.75)' }
  btn.onclick = () => {
    console.log('${QUIT_CONSOLE_MARKER}')
    try { location.href = '${QUIT_PROTOCOL_URL}' } catch (e) { /* 双通道之一失效时另一通道兜底 */ }
  }
  document.body.appendChild(btn)
})()`

function injectQuitButton(w) {
  if (!w || w.isDestroyed()) return
  const url = w.webContents.getURL()
  if (!url.startsWith('http')) return // loading/错误页（data:）不注入
  w.webContents.executeJavaScript(QUIT_BTN_INJECT).catch(() => { /* 注入尽力而为 */ })
}

let quitRequested = false
async function requestQuitFromUi() {
  if (quitRequested) return // 双通道可能同时触发，去重
  quitRequested = true
  if (process.env.DSH_DESKTOP_NOQUITCONFIRM !== '1') {
    const { response } = await dialog.showMessageBox(
      win && !win.isDestroyed() ? win : undefined,
      {
        type: 'warning',
        buttons: ['完全退出', '取消'],
        defaultId: 1,
        cancelId: 1,
        title: 'DeepSeek Harness',
        message: '完全退出 DeepSeek Harness？',
        detail: '将关闭窗口并停止后台服务（会话记录保留，下次启动可继续）。',
      },
    )
    if (response !== 0) {
      quitRequested = false // 用户取消，允许再次点击
      return
    }
  }
  wlog('full quit requested from UI button')
  quitApp(true)
}

async function pageBootFailed(w) {
  try {
    const text = await w.webContents.executeJavaScript(
      'document.body ? document.body.innerText : ""',
    )
    return text.includes('Failed to load plugins')
  } catch {
    return false
  }
}

const LOADING_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>DeepSeek Harness</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111827;color:#e5e7eb}
.box{text-align:center}.spin{width:32px;height:32px;border:3px solid #374151;border-top-color:#2563eb;border-radius:50%;animation:s 1s linear infinite;margin:0 auto 16px}
@keyframes s{to{transform:rotate(360deg)}}</style></head>
<body><div class="box"><div class="spin"></div><div>正在启动 DeepSeek Harness 后台……</div>
<div style="font-size:12px;color:#9ca3af;margin-top:8px">首次冷启动约需 10-30 秒，请稍候</div></div></body></html>`

const ERROR_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>DeepSeek Harness</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111827;color:#e5e7eb}
.box{max-width:420px;text-align:center;line-height:1.7}
code{background:#1f2937;padding:2px 6px;border-radius:4px;font-size:12px}</style></head>
<body><div class="box"><h2>后台服务启动失败</h2>
<p>90 秒内未就绪。请查看 <code>desktop\\watchdog.log</code> 与 <code>desktop\\dsh-web.log</code>。</p>
<p>可双击 <code>停止DeepSeek-Harness.bat</code> 清理后，再双击 <code>启动DeepSeek-Harness.bat</code> 重试。</p></div></body></html>`

async function bootWindowInto(w) {
  const up = await waitFor(isWebUp, 90000)
  slog(`bootWindow: waitWebUp=${up}`)
  if (!up) {
    slog('bootWindow: TIMEOUT — 90s 内后台未就绪')
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(ERROR_HTML))
    return false
  }
  const apiOk = await waitFor(isApiUp, 30000)
  slog(`bootWindow: waitApiUp=${apiOk}`)
  if (!apiOk) {
    slog('bootWindow: TIMEOUT — /api 路由 30s 内未就绪')
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(ERROR_HTML))
    return false
  }
  slog('bootWindow: loading URL')
  await w.loadURL(WEB_URL)
  slog('bootWindow: loaded')
  // 宿主刚启动时 /api 路由与前端插件树可能尚未完全就绪：失败则等待并重载（最多 7 次）
  for (let attempt = 0; attempt < 7; attempt++) {
    await new Promise(r => setTimeout(r, 5000))
    if (!(await pageBootFailed(w))) break
    slog(`bootWindow: frontend boot failed, waiting for api then reloading (${attempt + 1}/7)`)
    await waitFor(isApiUp, 10000)
    await w.loadURL(WEB_URL)
  }
  return true
}

async function openShellWindow() {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'DeepSeek Harness',
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('console-message', (_e, level, message) => {
    if (typeof message === 'string' && message.trim() === QUIT_CONSOLE_MARKER) {
      requestQuitFromUi()
      return
    }
    slog(`console[${level}]: ${message}`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    slog(`did-fail-load: ${code} ${desc} ${url}`)
  })
  // UI 右上角完全退出按钮：每次页面加载完成后注入（重载循环后同样生效）
  win.webContents.on('did-finish-load', () => injectQuitButton(win))
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(QUIT_PROTOCOL_URL)) {
      e.preventDefault()
      requestQuitFromUi()
    }
  })
  win.on('closed', () => { win = null })
  // 立即显示 loading 页（即时反馈），后台就绪后切入真实 UI
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML))
  const ok = await bootWindowInto(win)
  if (!ok) return

  if (process.env.DSH_DESKTOP_CLOSEWIN === '1') {
    slog('closewin (test hook): closing window, staying in tray')
    win.close()
    return
  }
  if (process.env.DSH_DESKTOP_AUTOCLICKQUIT === '1') {
    await new Promise(r => setTimeout(r, 3000))
    slog('autoclickquit (test hook): clicking injected quit button')
    await win.webContents.executeJavaScript(`document.getElementById('dsh-desktop-quit')?.click()`)
    return
  }
  if (SMOKE) {
    await new Promise(r => setTimeout(r, 4000))
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(DIR, 'smoke.png'), img.toPNG())
    const diag = await win.webContents.executeJavaScript(`(async () => {
      const out = { title: document.title, url: location.href, ua: navigator.userAgent.slice(0, 80) }
      out.quitBtn = !!document.getElementById('dsh-desktop-quit')
      out.bodyText = document.body ? document.body.innerText.slice(0, 300) : '(no body)'
      try {
        const r = await fetch('/api/events.mux', { headers: { Upgrade: 'websocket' } })
        out.fetchMux = 'status ' + r.status
      } catch (e) { out.fetchMux = 'ERROR: ' + String(e).slice(0, 120) }
      try {
        out.ws = await new Promise((resolve) => {
          let settled = false
          const done = (x) => { if (!settled) { settled = true; resolve(x) } }
          const ws = new WebSocket('ws://127.0.0.1:3080/api/events.mux')
          ws.onopen = () => done('OPEN')
          ws.onerror = (e) => done('ERROR')
          ws.onclose = (e) => done('CLOSE ' + e.code)
          setTimeout(() => done('TIMEOUT'), 5000)
        })
      } catch (e) { out.ws = 'THREW: ' + String(e).slice(0, 120) }
      return JSON.stringify(out)
    })()`)
    fs.writeFileSync(path.join(DIR, 'smoke.txt'), diag)
    slog('smoke diagnostics saved, stopping backend and quitting')
    quitting = true
    killOwnedBackend()
    app.quit()
    return
  }
  if (AUTOQUIT) {
    slog('autoquit (test hook), quitting without stopping backend')
    quitting = true
    app.quit()
  }
}

function quitApp(stopBackend) {
  quitting = true
  if (stopBackend) {
    wlog('tray menu quit: stopping backend')
    killOwnedBackend()
  }
  app.quit()
}

// ================= 主流程 =================
function main() {
  // 未打包应用设置 AUMID：任务栏图标正确跟随窗口 icon，分组与任务栏行为更稳定
  app.setAppUserModelId('com.svpts.deepseek-harness-local')
  fs.writeFileSync(PID_FILE, String(process.pid))
  fs.rmSync(STOP_FILE, { force: true }) // 清掉可能残留的停止标记
  wlog(`tray app started (pid ${process.pid})${SMOKE ? ' (smoke)' : ''}${AUTOQUIT ? ' (autoquit)' : ''}`)

  tray = new Tray(TRAY_ICON)
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 DeepSeek Harness', click: () => openShellWindow() },
    { type: 'separator' },
    { label: '退出（停止后台服务）', click: () => quitApp(true) },
  ]))
  tray.on('click', () => openShellWindow())

  setInterval(() => {
    watchdogTick().catch((e) => wlog(`tick error: ${e && e.stack ? e.stack : e}`))
  }, HEALTH_INTERVAL_MS)
  watchdogTick()

  openShellWindow() // 启动即开窗（首次冷启动约 10-30 秒出真实 UI，期间显示 loading 页）
}

process.on('uncaughtException', (err) => {
  wlog(`uncaughtException: ${err && err.stack ? err.stack : err}`)
})
process.on('unhandledRejection', (err) => {
  wlog(`unhandledRejection: ${err && err.stack ? err.stack : err}`)
})
process.on('exit', () => {
  try { fs.rmSync(PID_FILE, { force: true }) } catch { /* ignore */ }
})
// 关键：必须订阅 window-all-closed，否则 Electron 默认行为是关窗即退出应用（托盘会消失）。
// 关窗只回到托盘，后台继续运行；显式退出仅经托盘菜单/停止信号/测试钩子。
app.on('window-all-closed', () => { /* 保持托盘驻留，不退出 */ })
