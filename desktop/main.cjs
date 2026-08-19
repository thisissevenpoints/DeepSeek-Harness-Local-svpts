/**
 * DeepSeek Harness 托盘应用（看门狗 + 桌面壳，单一进程，2026-08-16 深夜重构）
 * - 常驻系统托盘：后台 dsh 服务由本进程唯一托管（健康巡检/子进程存活判定/崩溃重启）
 * - 托盘左键或菜单"打开 DeepSeek Harness"：打开/聚焦应用窗口（关窗回到托盘，后台不停）
 * - 托盘菜单"退出（停止后台服务）"或停止脚本：显式退出才停后台
 * - 启动脚本双击时若已在运行：通过 second-instance 事件直接唤起窗口
 * - 3180 已有外部实例：仅监控不接管也不杀；外部实例退出后自动拉起自己的实例
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
// DSH_REPO_DIR / DSH_HOME 环境变量可覆盖；HOME_LOC_FILE 记录迁移后的工作区位置
const ROOT_DIR = path.resolve(__dirname, '..')
const REPO_DIR = process.env.DSH_REPO_DIR || path.join(ROOT_DIR, 'deepseek-harness')
const HOME_LOC_FILE = path.join(__dirname, 'home-location.json')
let DSH_HOME_DIR = process.env.DSH_HOME || path.join(ROOT_DIR, 'dsh-home')
try {
  const loc = JSON.parse(fs.readFileSync(HOME_LOC_FILE, 'utf8'))
  if (loc && loc.home) DSH_HOME_DIR = loc.home // 迁移后的工作区位置
} catch { /* 无迁移记录，用默认位置 */ }
const WEB_URL = 'http://127.0.0.1:3180'
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
const IS_WIN = process.platform === 'win32'
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

function listenerPidOnWebPort() {
  try {
    if (IS_WIN) {
      const out = spawnSync(path.join(SYS32, 'netstat.exe'), ['-ano'], { encoding: 'utf8' }).stdout || ''
      const line = out.split(/\r?\n/).find((l) => l.includes(':3180') && /LISTENING/i.test(l))
      if (!line) return null
      const pid = parseInt(line.trim().split(/\s+/).pop(), 10)
      return Number.isInteger(pid) ? pid : null
    }
    // POSIX: lsof -t -i :3180
    const out = spawnSync('lsof', ['-t', '-i', ':3180'], { encoding: 'utf8' }).stdout || ''
    const pid = parseInt(out.trim().split(/\r?\n/)[0], 10)
    return Number.isInteger(pid) ? pid : null
  } catch {
    return null
  }
}

function killPid(pid) {
  if (!pid || !Number.isInteger(pid) || pid === process.pid) return
  if (IS_WIN) {
    try { spawnSync(path.join(SYS32, 'taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 尽力而为 */ }
  } else {
    try { process.kill(pid, 'SIGTERM') } catch { /* 尽力而为 */ }
  }
}

function killOwnedBackend() {
  // 双保险：先杀自己拉起的进程树，再按端口清掉可能漏网的孙进程（只清理自己拉起的）
  if (owned && dshChild && dshChild.pid) {
    wlog(`stopping dsh tree (pid ${dshChild.pid})`)
    killPid(dshChild.pid)
  }
  if (owned) {
    const lp = listenerPidOnWebPort()
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
  if (IS_WIN) {
    dshChild = spawn('cmd', ['/c', 'pnpm dsh web --port 3180'], {
      cwd: REPO_DIR,
      env: { ...process.env, DSH_HOME: DSH_HOME_DIR },
      windowsHide: true,
      stdio: ['ignore', out, out],
    })
  } else {
    // POSIX: 直接 spawn pnpm（detached 独立进程组，便于整组终止）
    dshChild = spawn('pnpm', ['dsh', 'web', '--port', '3180'], {
      cwd: REPO_DIR,
      env: { ...process.env, DSH_HOME: DSH_HOME_DIR },
      detached: true,
      stdio: ['ignore', out, out],
    })
  }
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

// —— 自绘顶栏 + 功能按钮区（壳注入，不改动 DSH 前端本体）——
// 无边框窗口（frame:false）需要自绘标题栏：顶栏即可拖拽区域 + 四按钮
// （完全退出/最小化/最大化/关闭窗口，顺序自右向左），下方为预备功能按钮区。
// 通知通道：console.log 标记（console-message 事件必然送达）+ 自定义协议导航兜底（去重）。
const QUIT_PROTOCOL_URL = 'dsh-desktop://quit'
const CONSOLE_MARKERS = {
  QUIT: 'DSH_DESKTOP_QUIT',
  MINIMIZE: 'DSH_DESKTOP_MINIMIZE',
  MAXIMIZE: 'DSH_DESKTOP_MAXIMIZE',
  CLOSE_WINDOW: 'DSH_DESKTOP_CLOSE_WINDOW',
  OPEN_SESSIONS: 'DSH_DESKTOP_OPEN_SESSIONS',
  BACKUP: 'DSH_DESKTOP_BACKUP',
  UPDATE: 'DSH_DESKTOP_UPDATE', // 备份更新：合并进既有备份
  MIGRATE: 'DSH_DESKTOP_MIGRATE', // 迁移：工作区换位置并搬文件
  RESTORE: 'DSH_DESKTOP_RESTORE',
}
const OVERLAY_INJECT = `(() => {
  if (document.getElementById('dsh-desktop-overlay')) return
  const style = document.createElement('style')
  style.textContent = '#dsh-desktop-overlay{position:fixed;top:0;left:0;right:0;z-index:2147483647;font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;user-select:none}'
  style.textContent += '#dsh-desktop-titlebar{display:flex;align-items:center;height:36px;background:rgba(17,24,39,.88);color:#e5e7eb;-webkit-app-region:drag;border-bottom:1px solid rgba(255,255,255,.08)}'
  style.textContent += '#dsh-desktop-title{flex:1;padding-left:12px;font-size:12px;letter-spacing:.5px;opacity:.85;white-space:nowrap;overflow:hidden}'
  style.textContent += '.dsh-dt-btn{width:38px;height:36px;border:none;background:transparent;color:#e5e7eb;font-size:14px;cursor:pointer;-webkit-app-region:no-drag;display:flex;align-items:center;justify-content:center;transition:background .15s}'
  style.textContent += '.dsh-dt-btn:hover{background:rgba(255,255,255,.12)}'
  style.textContent += '#dsh-desktop-quit:hover{background:rgba(220,38,38,.85)}'
  style.textContent += '#dsh-desktop-toolbar{display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(17,24,39,.72);border-bottom:1px solid rgba(255,255,255,.08)}'
  style.textContent += '.dsh-tool-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid rgba(255,255,255,.22);border-radius:6px;background:rgba(255,255,255,.06);color:#e5e7eb;font-size:12px;cursor:pointer;transition:background .15s}'
  style.textContent += '.dsh-tool-btn:hover{background:rgba(255,255,255,.16)}'
  style.textContent += '#dsh-desktop-statusbar{position:fixed;bottom:0;left:0;right:0;height:28px;z-index:2147483646;display:flex;align-items:center;gap:16px;padding:0 12px;background:rgba(17,24,39,.88);color:#9ca3af;font-size:11px;border-top:1px solid rgba(255,255,255,.08);font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif}'
  style.textContent += '#dsh-desktop-statusbar b{color:#d1d5db;font-weight:600}'
  style.textContent += '#dsh-desktop-statusbar .st-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;margin-right:5px;vertical-align:1px}'
  style.textContent += '#dsh-desktop-statusbar .st-dot.off{background:#ef4444}'
  style.textContent += '#dsh-desktop-statusbar .st-spacer{flex:1}'
  // 弹层避让：dsh 前端弹层类名为 CSS-in-JS 生成（如 YngKKa_overlay），通用规则让其让出顶栏高度
  style.textContent += '[class*="_overlay"]{top:var(--dsh-overlay-h,83px)!important}'
  document.head.appendChild(style)
  const overlay = document.createElement('div')
  overlay.id = 'dsh-desktop-overlay'
  const bar = document.createElement('div')
  bar.id = 'dsh-desktop-titlebar'
  const title = document.createElement('div')
  title.id = 'dsh-desktop-title'
  title.textContent = 'DeepSeek Harness'
  const mkBtn = (id, titleText, glyph) => {
    const b = document.createElement('button')
    b.id = id
    b.className = 'dsh-dt-btn'
    b.title = titleText
    b.textContent = glyph
    b.onclick = () => console.log('DSH_DESKTOP_' + id.replace('dsh-desktop-', '').toUpperCase().replace(/-/g, '_'))
    return b
  }
  bar.appendChild(title)
  // 自右向左：完全退出 / 最小化 / 最大化-还原 / 关闭窗口
  bar.appendChild(mkBtn('dsh-desktop-quit', '完全退出（停止前端与后台）', '\\u23FB'))
  bar.appendChild(mkBtn('dsh-desktop-minimize', '最小化', '\\u2500'))
  bar.appendChild(mkBtn('dsh-desktop-maximize', '最大化 / 还原', '\\u2750'))
  bar.appendChild(mkBtn('dsh-desktop-close-window', '关闭窗口（回到托盘）', '\\u2715'))
  overlay.appendChild(bar)
  // 预备功能按钮区
  const toolbar = document.createElement('div')
  toolbar.id = 'dsh-desktop-toolbar'
  const mkTool = (id, titleText, html) => {
    const b = document.createElement('button')
    b.id = id
    b.className = 'dsh-tool-btn'
    b.title = titleText
    b.innerHTML = html
    b.onclick = () => console.log('DSH_DESKTOP_' + id.replace('dsh-desktop-', '').toUpperCase().replace(/-/g, '_'))
    return b
  }
  toolbar.appendChild(mkTool('dsh-desktop-open-sessions', '打开对话存档文件夹（dsh-home\\sessions）', '<span style="font-size:14px">\\uD83D\\uDCC1</span> 打开会话存档'))
  toolbar.appendChild(mkTool('dsh-desktop-backup', '将对话存档打包为 zip（可选保存位置）', '<span style="font-size:14px">\\uD83D\\uDCBE</span> 备份'))
  toolbar.appendChild(mkTool('dsh-desktop-migrate', '工作区迁移：选择新位置并把整个工作区（dsh-home）搬过去', '<span style="font-size:14px">\\uD83D\\uDCE4</span> 迁移'))
  toolbar.appendChild(mkTool('dsh-desktop-update', '备份更新：将当前对话存档合并进既有备份 zip', '<span style="font-size:14px">\\uD83D\\uDD04</span> 备份更新'))
  toolbar.appendChild(mkTool('dsh-desktop-restore', '从备份 zip 还原对话存档（当前会话自动留底可回退）', '<span style="font-size:14px">\\uD83D\\uDCE5</span> 恢复'))
  overlay.appendChild(toolbar)
  document.body.appendChild(overlay)
  // 底部状态栏：后端在线状态（页面内轮询）/ 端口 / 工作区路径 / 版本
  // 全部用 textContent 赋值，避免 HTML/JS 字符串转义问题（路径含反斜杠）
  const statusbar = document.createElement('div')
  statusbar.id = 'dsh-desktop-statusbar'
  const mkSpan = (text) => { const s = document.createElement('span'); s.textContent = text; return s }
  const st = document.createElement('span')
  const dot = document.createElement('span'); dot.className = 'st-dot'
  const backendText = document.createElement('span'); backendText.className = 'st-backend'; backendText.textContent = '检测中…'
  st.appendChild(dot); st.appendChild(backendText)
  statusbar.appendChild(st)
  const portSpan = document.createElement('span')
  portSpan.append('端口 '); const portB = document.createElement('b'); portB.textContent = '__WEB_PORT__'; portSpan.appendChild(portB)
  statusbar.appendChild(portSpan)
  const homeSpan = document.createElement('span')
  homeSpan.append('工作区 '); const homeB = document.createElement('b'); homeB.className = 'st-home'; homeB.textContent = '…'; homeSpan.appendChild(homeB)
  statusbar.appendChild(homeSpan)
  const spacer = document.createElement('span'); spacer.className = 'st-spacer'
  statusbar.appendChild(spacer)
  statusbar.appendChild(mkSpan('v__APP_VERSION__'))
  document.body.appendChild(statusbar)
  const checkBackend = async () => {
    const ok = await fetch('http://127.0.0.1:__WEB_PORT__').then(() => true).catch(() => false)
    const dot = statusbar.querySelector('.st-dot')
    dot.className = 'st-dot' + (ok ? '' : ' off')
    statusbar.querySelector('.st-backend').textContent = ok ? '后端在线' : '后端离线'
  }
  checkBackend()
  setInterval(checkBackend, 5000)
  // 让出空间而非覆盖：给页面内容加等量 padding，两栏悬于顶部、状态栏贴底，均不遮挡内容
  const h = overlay.offsetHeight
  const sb = statusbar.offsetHeight
  overlay.style.setProperty('--dsh-overlay-h', h + 'px')
  document.body.style.paddingTop = h + 'px'
  document.body.style.paddingBottom = sb + 'px'
  document.body.style.boxSizing = 'border-box'
  document.body.dataset.dshOverlayH = String(h)
})()`

const WEB_PORT = new URL(WEB_URL).port
const APP_VERSION = '0.1.0' // 与 desktop/package.json 同步

function injectOverlay(w) {
  if (!w || w.isDestroyed()) return
  const url = w.webContents.getURL()
  if (!url.startsWith('http')) return // loading/错误页（data:）不注入
  const script = OVERLAY_INJECT
    .replaceAll('__WEB_PORT__', WEB_PORT)
    .replaceAll('__APP_VERSION__', APP_VERSION)
  w.webContents.executeJavaScript(script)
    .then(() => w.webContents.executeJavaScript(
      // JSON.stringify 生成合法 JS 字符串字面量（自动转义反斜杠），标准传值方式
      `document.querySelector('#dsh-desktop-statusbar .st-home')?.replaceChildren(document.createTextNode(${JSON.stringify(DSH_HOME_DIR)}))`,
    ))
    .catch(() => { /* 注入尽力而为 */ })
}

function requestQuitFromUi() {
  wlog('full quit requested from UI button')
  quitApp(true)
}

// 打开对话存档文件夹（dsh-home\sessions，不存在则创建）
function openSessionsFolder() {
  const dir = path.join(DSH_HOME_DIR, 'sessions')
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* 忽略 */ }
  const { shell } = require('electron')
  shell.openPath(dir).then((err) => {
    if (err) wlog(`openSessionsFolder failed: ${err}`)
    else slog(`opened sessions folder: ${dir}`)
  })
}

// —— 工作区备份/迁移/恢复（图形化选路径 + 复用 backup-restore.ps1）——
const BACKUP_PS1 = path.join(ROOT_DIR, 'backup-restore.ps1')

function defaultBackupName() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `dsh-sessions-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`
}

async function pickZipPath(action) {
  // 测试钩子：预设路径跳过对话框
  if (process.env.DSH_DESKTOP_TEST_ZIP) return { path: process.env.DSH_DESKTOP_TEST_ZIP, canceled: false }
  const parent = win && !win.isDestroyed() ? win : undefined
  if (action === 'backup') {
    const r = await dialog.showSaveDialog(parent, {
      title: '选择备份文件保存位置',
      defaultPath: path.join(app.getPath('documents'), defaultBackupName()),
      filters: [{ name: 'Zip 备份', extensions: ['zip'] }],
    })
    return { path: r.filePath || '', canceled: r.canceled }
  }
  const r = await dialog.showOpenDialog(parent, {
    title: action === 'restore' ? '选择要恢复的备份 zip' : '选择要更新的既有备份 zip',
    filters: [{ name: 'Zip 备份', extensions: ['zip'] }],
    properties: ['openFile'],
  })
  return { path: r.filePaths[0] || '', canceled: r.canceled }
}

function runBackupTool(action, zip) {
  // 异步执行（不阻塞主进程）：spawnSync 会阻塞事件循环，导致渲染进程 console 消息
  // 积压后批量乱序派发（曾引发重复执行与留底 rename 冲突）
  return new Promise((resolve) => {
    let out = ''
    try {
      const ps = spawn(
        path.join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', BACKUP_PS1, '-Action', action, '-ZipPath', zip],
        { windowsHide: true },
      )
      ps.stdout.on('data', (d) => { out += d })
      ps.stderr.on('data', (d) => { out += d })
      ps.on('close', (code) => {
        const lines = out.trim().split(/\r?\n/)
        resolve({ ok: code === 0, out: lines[lines.length - 1] || '完成' })
      })
      ps.on('error', (e) => resolve({ ok: false, out: String(e && e.message || e) }))
    } catch (e) {
      resolve({ ok: false, out: String(e && e.message || e) })
    }
  })
}

let backupBusy = false // 全局互斥：任一备份操作进行中，其他操作直接忽略（防并发冲突）
async function handleBackupAction(action) {
  if (backupBusy) return
  if (!IS_WIN) {
    // 备份工具（PowerShell ps1）当前为 Windows 专属；POSIX 用系统 zip/tar 手动备份
    await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: 'info', title: '备份工具',
      message: '备份/恢复工具当前支持 Windows',
      detail: 'Linux/macOS 请用系统 zip/tar 手动备份 dsh-home 目录。',
    })
    return
  }
  backupBusy = true
  try {
    const { path: zip, canceled } = await pickZipPath(action)
    if (canceled || !zip) return
    slog(`backup action ${action} → ${zip}`)
    const res = await runBackupTool(action, zip)
    wlog(`backup action ${action} ${res.ok ? 'OK' : 'FAIL'}: ${res.out}`)
    if (process.env.DSH_DESKTOP_TEST_ZIP) return // 测试模式不弹结果框
    await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: res.ok ? 'info' : 'error',
      title: 'DeepSeek Harness',
      message: res.ok ? '操作完成' : '操作失败',
      detail: res.out,
    })
  } finally {
    backupBusy = false
  }
}

// —— 工作区迁移：选择新位置，把整个工作区（dsh-home）搬过去 ——
async function migrateWorkspace() {
  let target = process.env.DSH_DESKTOP_TEST_MIGRATE_TO || '' // 测试钩子：预设路径跳过对话框
  slog(`migrateWorkspace: test_target=[${target}]`)
  if (!target) {
    const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
      title: '选择工作区迁移目标目录（需为空目录）',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled) return
    target = r.filePaths[0] || ''
  }
  if (!target) return
  // 校验目标为空目录
  try {
    const entries = fs.readdirSync(target)
    if (entries.length > 0) {
      if (!process.env.DSH_DESKTOP_TEST_MIGRATE_TO) {
        await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
          type: 'error', title: '迁移失败', message: '目标目录非空', detail: '请选择空目录作为迁移目标。',
        })
      }
      return
    }
  } catch {
    return
  }
  // 停后台（避免会话写入中的不一致），再搬移
  wlog(`migrate: stopping backend before move`)
  killOwnedBackend()
  try {
    fs.cpSync(DSH_HOME_DIR, target, { recursive: true })
    fs.rmSync(DSH_HOME_DIR, { recursive: true, force: true })
  } catch (e) {
    wlog(`migrate failed: ${e && e.message || e}`)
    if (!process.env.DSH_DESKTOP_TEST_MIGRATE_TO) {
      await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: 'error', title: '迁移失败', message: '搬移工作区失败', detail: String(e && e.message || e),
      })
    }
    return
  }
  // 记录新位置（下次启动生效）
  try {
    fs.writeFileSync(HOME_LOC_FILE, JSON.stringify({ home: target }, null, 2))
  } catch (e) {
    wlog(`migrate: failed to write home-location.json: ${e && e.message || e}`)
  }
  DSH_HOME_DIR = target
  wlog(`workspace migrated to ${target}`)
  slog(`workspace migrated to ${target}`)
  if (!process.env.DSH_DESKTOP_TEST_MIGRATE_TO) {
    await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: 'info', title: '迁移完成',
      message: '工作区已迁移',
      detail: `新位置：${target}\n后台已停止，请重启应用使新位置生效。`,
    })
  }
}

function dispatchUiMessage(marker) {
  slog(`dispatch marker received: ${marker}`)
  switch (marker) {
    case CONSOLE_MARKERS.QUIT:
      requestQuitFromUi()
      break
    case CONSOLE_MARKERS.MINIMIZE:
      if (win && !win.isDestroyed()) win.minimize()
      break
    case CONSOLE_MARKERS.MAXIMIZE:
      if (win && !win.isDestroyed()) {
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
      }
      break
    case CONSOLE_MARKERS.CLOSE_WINDOW:
      if (win && !win.isDestroyed()) win.close() // 关窗回托盘
      break
    case CONSOLE_MARKERS.OPEN_SESSIONS:
      openSessionsFolder()
      break
    case CONSOLE_MARKERS.BACKUP:
      handleBackupAction('backup')
      break
    case CONSOLE_MARKERS.UPDATE:
      handleBackupAction('update')
      break
    case CONSOLE_MARKERS.MIGRATE:
      migrateWorkspace()
      break
    case CONSOLE_MARKERS.RESTORE:
      handleBackupAction('restore')
      break
  }
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
    frame: false, // 无边框：自绘顶栏（拖拽 + 完全退出/最小化/最大化/关闭窗口）
    icon: APP_ICON,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('console-message', (_e, level, message) => {
    if (typeof message === 'string') {
      const marker = message.trim()
      if (Object.values(CONSOLE_MARKERS).includes(marker)) {
        dispatchUiMessage(marker)
        return
      }
    }
    slog(`console[${level}]: ${message}`)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    slog(`did-fail-load: ${code} ${desc} ${url}`)
  })
  // 自绘顶栏 + 功能按钮区：每次页面加载完成后注入（重载循环后同样生效）
  win.webContents.on('did-finish-load', () => injectOverlay(win))
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
  if (process.env.DSH_DESKTOP_AUTOCLICKOPEN === '1') {
    await new Promise(r => setTimeout(r, 3000))
    slog('autoclickopen (test hook): clicking open-sessions button')
    await win.webContents.executeJavaScript(`document.getElementById('dsh-desktop-open-sessions')?.click()`)
    await new Promise(r => setTimeout(r, 3000))
    slog('autoclickopen done, quitting')
    quitting = true
    app.quit()
  }
  if (process.env.DSH_DESKTOP_AUTOBACKUPTEST === '1') {
    // 串行点击 备份→备份更新→恢复（配合 DSH_DESKTOP_TEST_ZIP 跳过对话框）
    await new Promise(r => setTimeout(r, 3000))
    for (const id of ['dsh-desktop-backup', 'dsh-desktop-update', 'dsh-desktop-restore']) {
      slog(`autobackuptest: clicking ${id}`)
      await win.webContents.executeJavaScript(`document.getElementById('${id}')?.click()`)
      await new Promise(r => setTimeout(r, 12000)) // 等待压缩/解压完成（console 消息可能延迟派发）
    }
    slog('autobackuptest done, quitting')
    quitting = true
    app.quit()
  }
  if (process.env.DSH_DESKTOP_PROBESETTINGS === '1') {
    // 诊断钩子：点击"设置"并收集弹层 DOM 类名（用于修复弹层被顶栏遮挡）
    await new Promise(r => setTimeout(r, 3000))
    slog('probesettings: clicking settings')
    await win.webContents.executeJavaScript(`(() => {
      const els = [...document.querySelectorAll('*')].filter(e => e.textContent && e.textContent.trim() === '设置' && e.children.length === 0)
      if (els[0]) els[0].click()
      return els.length
    })()`)
    await new Promise(r => setTimeout(r, 2500))
    const probes = await win.webContents.executeJavaScript(`(() => {
      const out = []
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el)
        if (s.position === 'fixed' && el.offsetWidth > 100 && el.offsetHeight > 50) {
          out.push((el.className || el.id || el.tagName).toString().slice(0, 80))
        }
      }
      return JSON.stringify(out.slice(0, 12))
    })()`)
    slog(`probesettings: fixed layers = ${probes}`)
    quitting = true
    app.quit()
  }
  if (process.env.DSH_DESKTOP_AUTOMIGRATETEST === '1') {
    // 点击迁移按钮（配合 DSH_DESKTOP_TEST_MIGRATE_TO 预设目标目录跳过对话框）
    await new Promise(r => setTimeout(r, 3000))
    slog('automigratetest: clicking migrate button')
    await win.webContents.executeJavaScript(`document.getElementById('dsh-desktop-migrate')?.click()`)
    await new Promise(r => setTimeout(r, 6000))
    slog('automigratetest done, quitting')
    quitting = true
    app.quit()
  }
  if (SMOKE) {
    await new Promise(r => setTimeout(r, 4000))
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(DIR, 'smoke.png'), img.toPNG())
    const diag = await win.webContents.executeJavaScript(`(async () => {
      const out = { title: document.title, url: location.href, ua: navigator.userAgent.slice(0, 80) }
      out.overlay = !!document.getElementById('dsh-desktop-overlay')
      out.titlebarBtns = ['quit', 'minimize', 'maximize', 'close-window']
        .map((n) => 'dsh-desktop-' + n)
        .filter((id) => !!document.getElementById(id)).length
      out.titlebarOrder = [...(document.getElementById('dsh-desktop-titlebar')?.children || [])]
        .filter((el) => el.classList.contains('dsh-dt-btn'))
        .map((el) => el.id.replace('dsh-desktop-', ''))
        .join(',')
      out.openSessionsBtn = !!document.getElementById('dsh-desktop-open-sessions')
      out.backupBtns = ['backup', 'migrate', 'update', 'restore']
        .map((n) => 'dsh-desktop-' + n)
        .filter((id) => !!document.getElementById(id)).length
      out.statusbar = !!document.getElementById('dsh-desktop-statusbar')
      out.homeFromMain = ${JSON.stringify(DSH_HOME_DIR)}
      out.homeFromDom = document.querySelector('#dsh-desktop-statusbar .st-home')?.textContent || ''
      out.statusText = document.getElementById('dsh-desktop-statusbar')?.textContent.slice(0, 120) || ''
      out.bodyPaddingBottom = document.body.style.paddingBottom
      out.overlayHeight = document.body.dataset.dshOverlayH || '0'
      out.bodyPaddingTop = document.body.style.paddingTop
      out.geometry = (() => {
        const ov = document.getElementById('dsh-desktop-overlay')
        if (!ov) return 'NO_OVERLAY'
        const ovBottom = ov.getBoundingClientRect().bottom
        const topEl = [...document.querySelectorAll('body *')]
          .filter((el) => {
            if (el.closest('#dsh-desktop-overlay')) return false
            const r = el.getBoundingClientRect()
            return r.height > 4 && r.width > 4
          })
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
        const t = topEl ? topEl.getBoundingClientRect().top : -1
        return JSON.stringify({ overlayBottom: Math.round(ovBottom), topContentTop: Math.round(t), overlap: t < ovBottom })
      })()
      out.bodyText = document.body ? document.body.innerText.slice(0, 300) : '(no body)'
      try {
        const r = await fetch('/api/events.mux', { headers: { Upgrade: 'websocket' } })
        out.fetchMux = 'status ' + r.status
      } catch (e) { out.fetchMux = 'ERROR: ' + String(e).slice(0, 120) }
      try {
        out.ws = await new Promise((resolve) => {
          let settled = false
          const done = (x) => { if (!settled) { settled = true; resolve(x) } }
          const ws = new WebSocket('ws://127.0.0.1:3180/api/events.mux')
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
  // 未打包应用设置 AUMID（仅 Windows）：任务栏图标正确跟随窗口 icon，分组与任务栏行为更稳定
  if (IS_WIN) app.setAppUserModelId('com.svpts.deepseek-harness-local')
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
