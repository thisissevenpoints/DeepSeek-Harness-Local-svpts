// 升级时清理 submodule 构建产物与孤儿包目录（等效 `pnpm run clean` 的核心目的，但保留 node_modules）。
//
// 背景一：上游 scripts/clean.ts 因 tsconfig.desktop-keyboard-tests.json 的 outDir
//   （lib/desktop-keyboard-test-types，不以 /types 结尾）在校验阶段抛错，整个 clean 无法运行
//   （上游跟踪文件，按本项目"不修改上游"原则不动它）。
// 背景二：上游频繁重排包结构（0.2.0 删掉 runtime-diagnostics 组、0.2.1 把 10 个包移入
//   experimental/），旧位置的目录只剩 lib/ + node_modules 成为孤儿；其陈旧 lib/ 会被
//   rolldown 读到并触发 MISSING_EXPORT，必须先删除。
//
// 安全约束：只删除 `git ls-files` 为空（无跟踪文件）的路径，绝不碰任何入库内容。
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const REPO = path.join(ROOT, 'deepseek-harness')
// --dry-run：只报告将删除的内容，不实际删除（用于升级前后核对与回归验证）
const DRY_RUN = process.argv.includes('--dry-run')

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' })
}

/** 该路径下是否有 git 跟踪文件（有则一律不动）。 */
function trackedCount(rel) {
  return git(['ls-files', '--', rel]).split(/\r?\n/).filter(Boolean).length
}

/** 构建产物判定：从 git clean 预览的忽略项中挑选 build output 模式。 */
function isBuildOutput(rel) {
  const p = rel.replace(/\\/g, '/').replace(/\/$/, '')
  return p.endsWith('.tsbuildinfo')
    || p.endsWith('/.dsh-build')
    || p.endsWith('/.typecheck')
    || p.endsWith('/lib')
    || p.endsWith('/lib/types')
    || p.endsWith('/dist')
}

/** 列出忽略项（git clean 的 dry-run 预览）。 */
function ignoredEntries() {
  return git(['clean', '-xdn']).split(/\r?\n/).filter(Boolean)
    .map((line) => line.replace(/^Would remove /, '').trim())
}

// ---------- 1) 构建产物 ----------
function cleanBuildOutputs() {
  const targets = ignoredEntries().filter(isBuildOutput)
  let removed = 0
  for (const rel of targets) {
    if (DRY_RUN) { removed++; continue }
    try {
      fs.rmSync(path.join(REPO, rel), { recursive: true, force: true })
      removed++
    } catch (e) {
      console.log(`  ! 删除失败 ${rel}: ${e.message}`)
    }
  }
  const left = DRY_RUN ? [] : ignoredEntries().filter(isBuildOutput)
  console.log(`[1/3] 构建产物：${DRY_RUN ? '将删除' : '删除'} ${removed}/${targets.length}，剩余 ${left.length}`)
  return left.length === 0
}

// ---------- 2) 孤儿包目录 ----------
// 判据：位于包位（packages/<组>/<包>、apps/<应用>、native/<模块>）但既无 package.json，
// 又无 git 跟踪文件 —— 即上游已移动/删除、本地只剩 lib + node_modules 的残骸。
function orphanDirs() {
  const found = []
  const groups = fs.readdirSync(path.join(REPO, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
  const candidates = []
  for (const g of groups) {
    for (const p of fs.readdirSync(path.join(REPO, 'packages', g.name), { withFileTypes: true })) {
      if (p.isDirectory()) candidates.push(`packages/${g.name}/${p.name}`)
    }
  }
  for (const top of ['apps', 'native']) {
    for (const p of fs.readdirSync(path.join(REPO, top), { withFileTypes: true })) {
      if (p.isDirectory()) candidates.push(`${top}/${p.name}`)
    }
  }
  for (const rel of candidates) {
    const abs = path.join(REPO, rel)
    if (fs.existsSync(path.join(abs, 'package.json'))) continue
    if (trackedCount(rel) > 0) continue // 有跟踪文件：不是孤儿，绝不删
    found.push(rel)
  }
  return found
}

function cleanOrphans() {
  const orphans = orphanDirs()
  for (const rel of orphans) {
    const shows = fs.readdirSync(path.join(REPO, rel)).join(' ')
    if (!DRY_RUN) fs.rmSync(path.join(REPO, rel), { recursive: true, force: true })
    console.log(`  - ${DRY_RUN ? '将删除' : '删除'}孤儿 ${rel}（原含: ${shows}）`)
  }
  console.log(`[2/3] 孤儿包目录：${DRY_RUN ? '将删除' : '删除'} ${orphans.length} 个`)
  return orphans.length
}

// ---------- 3) 空组目录 ----------
// 组内包全部迁走后，packages/<组> 会变成空壳（git 不跟踪空目录），一并清掉。
function cleanEmptyGroups() {
  let removed = 0
  const packagesDir = path.join(REPO, 'packages')
  for (const g of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!g.isDirectory()) continue
    const rel = `packages/${g.name}`
    const entries = fs.readdirSync(path.join(packagesDir, g.name))
    if (entries.length === 0 && trackedCount(rel) === 0) {
      if (!DRY_RUN) fs.rmdirSync(path.join(packagesDir, g.name))
      console.log(`  - ${DRY_RUN ? '将删除' : '删除'}空组目录 ${rel}`)
      removed++
    }
  }
  console.log(`[3/3] 空组目录：${DRY_RUN ? '将删除' : '删除'} ${removed} 个`)
  return removed
}

console.log(`仓库: ${REPO}${DRY_RUN ? '  [dry-run 仅报告]' : ''}`)
const buildOk = cleanBuildOutputs()
cleanOrphans()
cleanEmptyGroups()
if (DRY_RUN) console.log('完成（dry-run，未删除任何内容）。')
else console.log(buildOk ? '完成：构建产物已清空。' : '警告：仍有构建产物残留，请检查上方输出。')
