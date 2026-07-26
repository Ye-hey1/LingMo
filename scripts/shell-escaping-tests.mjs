/**
 * Skills shell 拼接的行为测试。
 *
 * 这里不做源码正则匹配：断言的是转义函数的实际输出，并把生成的命令交给真实
 * bash 求值，确认注入载荷不会被执行。转义逻辑一旦被改坏，正则测试往往照样
 * 通过，只有真实求值能挡住。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(join(repoRoot, '.tmp'), { recursive: true })
const tempDir = await mkdtemp(join(repoRoot, '.tmp', 'lingmo-shell-escaping-'))
const require = createRequire(import.meta.url)

/**
 * 把单个 TS 文件转成 CommonJS 并加载。
 * path-utils.ts 依赖 @tauri-apps/api 与 @/lib/workspace，测试只用其纯函数部分，
 * 因此把这些 import 剥掉，避免在 Node 下解析失败。
 */
async function loadPathUtils() {
  const sourcePath = join(repoRoot, 'src/lib/skills/path-utils.ts')
  const raw = await readFile(sourcePath, 'utf8')
  const stripped = raw
    .split('\n')
    .filter((line) => !/^import\s/.test(line))
    .join('\n')
    // resolveSkillDirectory 用到被剥掉的依赖，测试不覆盖它，直接摘除函数体外的引用
    .replace(/export async function resolveSkillDirectory[\s\S]*?\n}\n/, '')

  const output = ts.transpileModule(stripped, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText

  const outPath = join(tempDir, 'path-utils.cjs')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, output, 'utf8')
  return require(outPath)
}

const { escapeShellArg, escapeShellPath, escapeShellEnvAssignment, buildShellCommand } =
  await loadPathUtils()

let bashAvailable = true
try {
  execFileSync('bash', ['-c', 'true'], { stdio: 'ignore' })
} catch {
  bashAvailable = false
}

/** 用真实 bash 求值一段命令，返回 stdout。 */
function evalInBash(command) {
  return execFileSync('bash', ['-c', command], { encoding: 'utf8' })
}

// --- escapeShellArg 基础行为 ---
assert.equal(escapeShellArg('plain'), 'plain', '安全字符不应被包裹')
assert.equal(escapeShellArg('/usr/bin/node'), '/usr/bin/node', '普通路径不应被包裹')
assert.equal(escapeShellArg('with space'), `'with space'`, '空格必须被单引号包裹')
assert.equal(
  escapeShellArg("it's"),
  `'it'"'"'s'`,
  '内部单引号必须用 POSIX 的 \'"\'"\' 形式转义',
)

// --- 注入载荷不得逃出引号 ---
const payloads = [
  '$(echo INJECTED)',
  '`echo INJECTED`',
  '${IFS}INJECTED',
  '; echo INJECTED',
  '&& echo INJECTED',
  '| echo INJECTED',
  "'; echo INJECTED; '",
  '\n echo INJECTED',
]

if (bashAvailable) {
  for (const payload of payloads) {
    const command = `printf '%s' ${escapeShellArg(payload)}`
    const stdout = evalInBash(command)
    assert.equal(stdout, payload, `载荷应原样输出而非被求值: ${JSON.stringify(payload)}`)
    assert.ok(
      !stdout.includes('INJECTED\n'),
      `载荷被 shell 求值了: ${JSON.stringify(payload)}`,
    )
  }
}

// --- escapeShellEnvAssignment ---
assert.equal(
  escapeShellEnvAssignment('SKILL_ROOT_DIR', '/tmp/a b'),
  `SKILL_ROOT_DIR='/tmp/a b'`,
  '环境变量值必须转义',
)
assert.throws(
  () => escapeShellEnvAssignment('BAD-NAME', 'x'),
  /非法环境变量名/,
  '非法变量名必须抛错而非静默拼接',
)
assert.throws(
  () => escapeShellEnvAssignment('X; rm -rf /', 'x'),
  /非法环境变量名/,
  '变量名里的注入必须被拒绝',
)

if (bashAvailable) {
  const assignment = escapeShellEnvAssignment('PROBE', '$(echo INJECTED)')
  const stdout = evalInBash(`${assignment} bash -c 'printf "%s" "$PROBE"'`)
  assert.equal(stdout, '$(echo INJECTED)', '环境变量值不应被二次求值')
}

// --- buildShellCommand 的目录与命令名 ---
const evilDir = '/tmp/dir$(echo INJECTED)'
const built = buildShellCommand(evilDir, evilDir, 'node', ['script.js'])
assert.ok(
  !built.includes(`cd "${evilDir}"`),
  'buildShellCommand 不应再用双引号包裹目录',
)
assert.match(built, /^cd '\/tmp\/dir\$\(echo INJECTED\)'/, '目录必须单引号转义')

const builtAbsolute = buildShellCommand(
  '/tmp/skill',
  '/tmp/skill$(echo INJECTED)',
  'node',
  ['/tmp/skill/gen.js'],
)
assert.ok(
  !/NODE_PATH="/.test(builtAbsolute),
  'NODE_PATH 不应再用双引号包裹',
)
assert.match(builtAbsolute, /NODE_PATH='[^']*\$\(echo INJECTED\)[^']*'/, 'NODE_PATH 必须转义')

if (bashAvailable) {
  // 造一个名字里带注入载荷的真实目录，验证 cd 进去后载荷未被执行
  const injectionDir = join(tempDir, 'dir$(echo INJECTED)')
  await mkdir(injectionDir, { recursive: true })
  const command = `${buildShellCommand(injectionDir, injectionDir, 'pwd', [])}`
  const stdout = evalInBash(command)
  assert.ok(
    stdout.includes('dir$(echo INJECTED)'),
    `cd 应进入字面目录名，实际输出: ${stdout}`,
  )
  assert.ok(!stdout.includes('dirINJECTED'), '目录名中的载荷被求值了')
}

console.log(
  `shell escaping tests passed${bashAvailable ? ' (含真实 bash 求值)' : ' (未找到 bash，跳过求值断言)'}`,
)
