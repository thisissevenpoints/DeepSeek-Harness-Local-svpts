// 外科式清理 submodule 构建产物：等效 `pnpm run clean` 的核心目的（清除旧版本 lib/dist/tsbuildinfo），
// 但保留 node_modules（避免全量重装）。
// 背景：上游 0.1.7-rc.2 的 scripts/clean.ts 会因新配置 tsconfig.desktop-keyboard-tests.json 的
// outDir（lib/desktop-keyboard-test-types，不以 /types 结尾）在校验阶段抛错，导致 clean 完全无法运行；
// 该文件为上游跟踪文件，按本项目"不修改上游"原则不作改动，故改用等效清理。
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPO = 'D:/alpha/DeepSeek-Harness-Local/deepseek-harness'

// 构建产物判定：git clean 预览出的忽略项中，只保留这些模式
function isBuildOutput(rel) {
  const p = rel.replace(/\\/g, '/').replace(/\/$/, '')
  if (p.endsWith('.tsbuildinfo')) return true
  if (p.endsWith('/.dsh-build')) return true
  if (p.endsWith('/.typecheck')) return true
  if (p.endsWith('/lib')) return true
  if (p.endsWith('/lib/types')) return true
  if (p.endsWith('/dist')) return true
  return false
}

const preview = execFileSync('git', ['clean', '-xdn'], { cwd: REPO, encoding: 'utf8' })
const all = preview.split(/\r?\n/).filter(Boolean)
const targets = all
  .map((line) => line.replace(/^Would remove /, '').trim())
  .filter(isBuildOutput)

console.log(`忽略项总数 ${all.length}，其中构建产物 ${targets.length} 项`)

let removed = 0
for (const rel of targets) {
  const abs = path.join(REPO, rel)
  try {
    fs.rmSync(abs, { recursive: true, force: true })
    removed++
  } catch (e) {
    console.log(`删除失败 ${rel}: ${e.message}`)
  }
}
console.log(`已删除 ${removed}/${targets.length}`)

// 校验：构建产物应已清空，node_modules 保留
const after = execFileSync('git', ['clean', '-xdn'], { cwd: REPO, encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean)
  .map((l) => l.replace(/^Would remove /, '').trim())
const leftover = after.filter(isBuildOutput)
console.log(`剩余构建产物 ${leftover.length} 项`)
if (leftover.length) console.log(leftover.slice(0, 10).join('\n'))
