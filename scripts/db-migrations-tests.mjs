/**
 * 迁移框架的行为测试。
 *
 * 跑在真实 SQLite（node:sqlite）上，验证的是实际执行结果而非源码文本：
 * 版本推进、幂等、失败回滚、降级保护、清单校验。
 */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(join(repoRoot, '.tmp'), { recursive: true })
const tempDir = await mkdtemp(join(repoRoot, '.tmp', 'lingmo-db-migrations-'))
const require = createRequire(import.meta.url)

async function loadMigrations() {
  const sourcePath = join(repoRoot, 'src/db/migrations.ts')
  const source = await readFile(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText

  const outPath = join(tempDir, 'migrations.cjs')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, output, 'utf8')
  return require(outPath)
}

const { MIGRATIONS, runMigrations, getSchemaVersion, validateMigrations } = await loadMigrations()

/** 把 node:sqlite 适配成框架期望的 MigrationDatabase。 */
function adapt(sqlite) {
  return {
    async execute(query, bindValues = []) {
      if (bindValues.length > 0) return sqlite.prepare(query).run(...bindValues)
      sqlite.exec(query)
      return undefined
    },
    async select(query, bindValues = []) {
      return sqlite.prepare(query).all(...bindValues)
    },
  }
}

function freshDb() {
  return new DatabaseSync(':memory:')
}

// --- 随仓库清单一起校验：清单本身必须合法 ---
validateMigrations(MIGRATIONS)

// --- 空清单：版本保持 0，不报错 ---
{
  const sqlite = freshDb()
  const db = adapt(sqlite)
  const result = await runMigrations(db, [])
  assert.equal(result.fromVersion, 0)
  assert.equal(result.toVersion, 0)
  assert.deepEqual(result.applied, [])
  assert.equal(await getSchemaVersion(db), 0)
  sqlite.close()
}

const fixture = [
  {
    version: 1,
    description: '建 probe 表',
    statements: ['CREATE TABLE probe (id INTEGER PRIMARY KEY, name TEXT)'],
  },
  {
    version: 2,
    description: '给 probe 加 note 列',
    statements: ['ALTER TABLE probe ADD COLUMN note TEXT'],
  },
  {
    version: 3,
    description: '写入基线数据并建索引',
    statements: [
      "INSERT INTO probe (id, name, note) VALUES (1, 'seed', 'ok')",
      'CREATE INDEX idx_probe_name ON probe(name)',
    ],
  },
]

// --- 全新库：从 0 一路推到最新 ---
{
  const sqlite = freshDb()
  const db = adapt(sqlite)
  const result = await runMigrations(db, fixture)
  assert.equal(result.fromVersion, 0)
  assert.equal(result.toVersion, 3)
  assert.deepEqual(result.applied, [1, 2, 3])
  assert.equal(await getSchemaVersion(db), 3)

  const columns = sqlite.prepare('PRAGMA table_info(probe)').all().map(c => c.name)
  assert.deepEqual(columns, ['id', 'name', 'note'], 'v2 的加列未生效')
  // node:sqlite 返回 null-prototype 对象，展开成普通对象再比较
  const rows = sqlite.prepare('SELECT name, note FROM probe').all().map(r => ({ ...r }))
  assert.deepEqual(rows, [{ name: 'seed', note: 'ok' }], 'v3 的数据迁移未生效')

  // --- 幂等：再跑一次不应重复执行 ---
  const again = await runMigrations(db, fixture)
  assert.deepEqual(again.applied, [], '已应用的迁移被重复执行')
  assert.equal(again.fromVersion, 3)
  const count = sqlite.prepare('SELECT COUNT(*) AS n FROM probe').get()
  assert.equal(count.n, 1, '重复执行导致数据重复插入')
  sqlite.close()
}

// --- 部分已应用：只跑欠缺的那几版 ---
{
  const sqlite = freshDb()
  const db = adapt(sqlite)
  await runMigrations(db, fixture.slice(0, 1))
  assert.equal(await getSchemaVersion(db), 1)

  const result = await runMigrations(db, fixture)
  assert.deepEqual(result.applied, [2, 3], '应只补跑 v2、v3')
  assert.equal(result.fromVersion, 1)
  assert.equal(result.toVersion, 3)
  sqlite.close()
}

// --- 失败：版本号不推进，但已执行语句不回滚（非原子，见 migrations.ts 注释） ---
{
  const sqlite = freshDb()
  const db = adapt(sqlite)
  const broken = [
    fixture[0],
    {
      version: 2,
      description: '故意写坏的迁移',
      statements: [
        'CREATE TABLE half_done (id INTEGER)',
        'THIS IS NOT VALID SQL',
      ],
    },
  ]

  await assert.rejects(
    () => runMigrations(db, broken),
    err => {
      assert.match(err.message, /v2/, '异常信息应含版本号')
      assert.match(err.message, /failed/, '异常信息应标明失败')
      return true
    },
  )

  assert.equal(await getSchemaVersion(db), 1, '失败后版本号不应推进')

  // 非原子：失败前已执行的语句会留下。这正是要求迁移语句幂等的原因。
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='half_done'")
    .all()
  assert.equal(tables.length, 1, '失败前已执行的语句应保留（非原子行为）')

  // 版本号未推进 => 下次启动重跑本版本。用幂等写法验证重跑能成功收敛。
  const fixed = [
    fixture[0],
    {
      version: 2,
      description: '幂等重写后的 v2',
      statements: [
        'CREATE TABLE IF NOT EXISTS half_done (id INTEGER)',
        'ALTER TABLE probe ADD COLUMN note TEXT',
      ],
    },
  ]
  const recovered = await runMigrations(db, fixed)
  assert.deepEqual(recovered.applied, [2], '幂等重写后应能重跑成功')
  assert.equal(await getSchemaVersion(db), 2)
  sqlite.close()
}

// --- 降级保护：库版本高于程序已知版本时不动手 ---
{
  const sqlite = freshDb()
  const db = adapt(sqlite)
  await runMigrations(db, fixture)
  assert.equal(await getSchemaVersion(db), 3)

  const result = await runMigrations(db, fixture.slice(0, 1))
  assert.deepEqual(result.applied, [], '降级时不应应用任何迁移')
  assert.equal(await getSchemaVersion(db), 3, '降级时不应改动版本号')
  sqlite.close()
}

// --- 清单校验：版本号必须从 1 起连续 ---
for (const bad of [
  [{ version: 0, description: 'v0 非法', statements: ['SELECT 1'] }],
  [{ version: 2, description: '起点不是 1', statements: ['SELECT 1'] }],
  [
    { version: 1, description: 'ok', statements: ['SELECT 1'] },
    { version: 3, description: '跳号', statements: ['SELECT 1'] },
  ],
  [
    { version: 1, description: 'ok', statements: ['SELECT 1'] },
    { version: 1, description: '重复', statements: ['SELECT 1'] },
  ],
]) {
  assert.throws(() => validateMigrations(bad), /migration version/, '非法清单应被拒绝')
}

assert.throws(
  () => validateMigrations([{ version: 1, description: '空语句', statements: [] }]),
  /no statements/,
  '空语句清单应被拒绝',
)

console.log('db migrations tests passed')
