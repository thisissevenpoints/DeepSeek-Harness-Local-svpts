// 临时测试工具：探测 dsh 宿主 /api/events.mux 就绪状态（open 或 426 均视为就绪，同壳逻辑）
// 用法：node probe-ws.cjs  （复用 desktop 项目的 ws 依赖）
const { createRequire } = require('node:module')
const req = createRequire('D:/alpha/DeepSeek-Harness-Local/desktop/package.json')
const WebSocket = req('ws')
const ws = new WebSocket('ws://127.0.0.1:3180/api/events.mux')
const t = setTimeout(() => { console.log('RESULT=TIMEOUT'); process.exit(3) }, 10000)
ws.on('open', () => { clearTimeout(t); console.log('RESULT=OPEN'); process.exit(0) })
ws.on('unexpected-response', (_r, res) => { clearTimeout(t); console.log('RESULT=HTTP_' + res.statusCode); process.exit(res.statusCode === 426 ? 0 : 1) })
ws.on('error', (e) => { clearTimeout(t); console.log('RESULT=ERROR_' + e.message); process.exit(2) })
