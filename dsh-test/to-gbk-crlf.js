// 将指定 UTF-8 源文件转为 GBK(CP936) + CRLF，供 Windows cmd 正确解析中文。
// 用法：node dsh-test/to-gbk-crlf.js <file...>
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('用法: node dsh-test/to-gbk-crlf.js <file...>')
  process.exit(1)
}

for (const file of files) {
  const utf8 = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const gbk = execFileSync('iconv', ['-f', 'UTF-8', '-t', 'CP936'], {
    input: Buffer.from(utf8, 'utf8'),
  })
  const crlf = gbk.toString('latin1').replace(/\n/g, '\r\n')
  fs.writeFileSync(file, crlf, 'latin1')
  // 回读校验：确认可无损还原（无乱码、无 '?' 替换）
  const back = execFileSync('iconv', ['-f', 'CP936', '-t', 'UTF-8'], {
    input: fs.readFileSync(file),
  }).toString('utf8')
  const ok = back.replace(/\r\n/g, '\n') === utf8
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${file}`)
  if (!ok) process.exitCode = 1
}
