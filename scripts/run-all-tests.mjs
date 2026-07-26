/**
 * 聚合测试入口。
 *
 * 自动发现 scripts/*-tests.mjs，逐个在子进程里跑，不因单个失败中断，最后汇总。
 * 用自动发现而非手写清单，是因为此前有 9 个测试脚本从未接进 package.json，
 * 长期无人执行。
 */
import { readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const selfPath = fileURLToPath(import.meta.url)
const selfName = basename(selfPath)
const scriptsDir = dirname(selfPath)
const repoRoot = resolve(scriptsDir, '..')

/** 需要外部服务或人工介入、不适合进 CI 的脚本。 */
const EXCLUDED = new Set([
  // research-eval 依赖真实 LLM 调用与历史索引，属评测而非回归测试
  'research-eval.mjs',
  // 排除自身：本文件名同样匹配 *-tests.mjs，否则会无限递归自我调用
  selfName,
])

const onlyFilter = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))

const entries = (await readdir(scriptsDir))
  .filter((name) => /-tests\.mjs$/.test(name))
  .filter((name) => !EXCLUDED.has(name))
  .filter((name) => onlyFilter.length === 0 || onlyFilter.some((f) => name.includes(f)))
  .sort()

if (entries.length === 0) {
  console.error('未找到任何测试脚本')
  process.exit(1)
}

function runOne(name) {
  return new Promise((resolvePromise) => {
    const started = Date.now()
    const child = spawn(process.execPath, [join(scriptsDir, name)], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      resolvePromise({ name, code: 1, ms: Date.now() - started, stdout, stderr: String(error) })
    })
    child.on('close', (code) => {
      resolvePromise({ name, code: code ?? 1, ms: Date.now() - started, stdout, stderr })
    })
  })
}

const results = []
for (const name of entries) {
  const result = await runOne(name)
  results.push(result)
  const label = result.code === 0 ? 'PASS' : 'FAIL'
  console.log(`${label}  ${name}  (${result.ms}ms)`)
}

const failed = results.filter((r) => r.code !== 0)

if (failed.length > 0) {
  console.log(`\n${'='.repeat(72)}\n${failed.length} 个测试脚本失败\n${'='.repeat(72)}`)
  for (const result of failed) {
    console.log(`\n--- ${result.name} ---`)
    const output = `${result.stdout}${result.stderr}`.trimEnd()
    console.log(output || '(无输出)')
  }
}

console.log(
  `\n合计 ${results.length} 个脚本：${results.length - failed.length} 通过，${failed.length} 失败`,
)
process.exit(failed.length > 0 ? 1 : 0)
