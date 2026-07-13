import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executed = []
const selected = []
let parentJobRow = null

const fakeDb = {
  async execute(sql, values = []) {
    executed.push({ sql, values })
    return { rowsAffected: 1, lastInsertId: 1 }
  },
  async select(sql, values = []) {
    selected.push({ sql, values })
    if (/where parent_job_id/i.test(sql)) return parentJobRow ? [parentJobRow] : []
    if (/from link_jobs where id/i.test(sql)) {
      return [{
        id: 'job_1', mark_id: 42, tag_id: 7, url: 'https://example.com',
        source_type: 'webpage', status: 'running', current_stage: 'organize',
        progress: 70, attempt: 1, auto_organize: 1, created_at: 10, updated_at: 20,
      }]
    }
    if (/from link_stage_results/i.test(sql)) return []
    if (/from link_source_blocks/i.test(sql)) return []
    if (/from link_output_versions/i.test(sql)) return []
    if (/status in \('queued', 'running', 'failed'\)/i.test(sql)) return []
    return []
  },
}

async function loadModule() {
  const sourcePath = join(repoRoot, 'src/db/link-pipeline.ts')
  const source = await readFile(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText

  const module = { exports: {} }
  const localRequire = specifier => {
    if (specifier === './index') {
      return {
        getDb: async () => fakeDb,
        serializedWrite: async fn => await fn(),
        runDbBatch: async (_db, fn) => await fn(),
      }
    }
    throw new Error(`Unexpected dependency: ${specifier}`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports)
  return module.exports
}

const storage = await loadModule()
const indexSource = await readFile(join(repoRoot, 'src/db/index.ts'), 'utf8')

assert.match(indexSource, /initLinkPipelineDb/)

await storage.initLinkPipelineDb()
const schemaSql = executed.map(item => item.sql).join('\n')
for (const table of ['link_jobs', 'link_stage_results', 'link_source_blocks', 'link_output_versions']) {
  assert.match(schemaSql, new RegExp(`create table if not exists ${table}`, 'i'))
}
assert.match(schemaSql, /unique\s*\(job_id, stage, attempt\)/i)
assert.match(schemaSql, /unique\s*\(job_id, version\)/i)
assert.match(schemaSql, /idx_link_jobs_status/i)
assert.match(schemaSql, /lease_owner/i)
assert.match(schemaSql, /lease_expires_at/i)
assert.match(schemaSql, /next_retry_at/i)
assert.match(schemaSql, /parent_job_id/i)
assert.match(schemaSql, /input_json/i)
assert.match(schemaSql, /idx_link_jobs_parent_unique/i)

executed.length = 0
const job = await storage.createLinkJob({
  id: 'job_1',
  tagId: 7,
  url: 'https://example.com',
  sourceType: 'webpage',
  autoOrganize: true,
})
assert.equal(job.status, 'queued')
assert.equal(job.currentStage, 'capture')
assert.ok(executed.some(item => /insert(?: or ignore)? into link_jobs/i.test(item.sql)))

parentJobRow = {
  id: 'job_child', parent_job_id: 'job_capture', mark_id: 42, tag_id: 7,
  url: 'https://example.com', source_type: 'webpage', status: 'queued',
  current_stage: 'organize', progress: 60, attempt: 1, auto_organize: 1,
  input_json: '{"kind":"organized"}', created_at: 10, updated_at: 20,
}
executed.length = 0
const ensuredChild = await storage.ensureLinkJob({
  parentJobId: 'job_capture',
  markId: 42,
  tagId: 7,
  url: 'https://example.com',
  sourceType: 'webpage',
  currentStage: 'organize',
  progress: 60,
  input: { kind: 'organized' },
})
assert.equal(ensuredChild.created, false)
assert.equal(ensuredChild.job.id, 'job_child')
assert.equal(ensuredChild.job.parentJobId, 'job_capture')
assert.deepEqual(ensuredChild.job.input, { kind: 'organized' })
assert.equal(executed.filter(item => /insert.*link_jobs/is.test(item.sql)).length, 0)
parentJobRow = null

executed.length = 0
await storage.updateLinkJob('job_1', {
  status: 'running',
  currentStage: 'organize',
  progress: 70,
})
assert.ok(executed.some(item => /update link_jobs/i.test(item.sql)))

executed.length = 0
await storage.claimLinkJob('job_1', 'worker_1', { now: 1000, leaseMs: 30_000 })
const claimSql = executed.find(item => /update link_jobs/i.test(item.sql))?.sql || ''
assert.match(claimSql, /lease_owner/i)
assert.match(claimSql, /lease_expires_at/i)
assert.match(claimSql, /status = 'queued'/i)
assert.match(claimSql, /status = 'running'/i)

executed.length = 0
await storage.completeLinkJob('job_1', 'worker_1', { markId: 42 })
const completeSql = executed.find(item => /update link_jobs/i.test(item.sql))?.sql || ''
assert.match(completeSql, /where id = .*status = 'running'.*lease_owner/is)

executed.length = 0
await storage.failLinkJob('job_1', 'worker_1', {
  errorCode: 'ai_timeout',
  errorMessage: '模型响应超时',
  nextRetryAt: 60_000,
})
const failSql = executed.find(item => /update link_jobs/i.test(item.sql))?.sql || ''
assert.match(failSql, /next_retry_at/i)
assert.match(failSql, /where id = .*status = 'running'.*lease_owner/is)

executed.length = 0
await storage.upsertLinkStageResult({
  jobId: 'job_1',
  stage: 'extract',
  attempt: 1,
  status: 'succeeded',
  content: '原始正文',
})
assert.ok(executed.some(item => /insert into link_stage_results/i.test(item.sql)))

executed.length = 0
await storage.replaceLinkSourceBlocks('job_1', 42, [
  { kind: 'paragraph', content: '不可被 AI 覆盖的原始正文', sourceLocator: 'body:0' },
])
assert.ok(executed.some(item => /delete from link_source_blocks/i.test(item.sql)))
assert.ok(executed.some(item => /insert into link_source_blocks/i.test(item.sql)))

executed.length = 0
await storage.createLinkOutputVersion({
  jobId: 'job_1',
  markId: 42,
  version: 1,
  kind: 'organized_markdown',
  content: '# AI 整理结果',
})
assert.ok(executed.some(item => /insert into link_output_versions/i.test(item.sql)))
assert.ok(executed.some(item => /update link_output_versions set is_active = 0.*id <>/is.test(item.sql)))

executed.length = 0
await storage.retryLinkJob('job_1')
const retrySql = executed.find(item => /update link_jobs/i.test(item.sql))?.sql || ''
assert.match(retrySql, /where id = .*status = 'failed'/is)
assert.doesNotMatch(retrySql, /status in \([^)]*running/i)

executed.length = 0
await storage.updateLinkOutputVersionMetadata('output_1', { state: 'applied' })
assert.ok(executed.some(item => /update link_output_versions set metadata_json/i.test(item.sql)))

const bundle = await storage.getLinkJobBundle('job_1')
assert.equal(bundle?.job.id, 'job_1')
assert.deepEqual(bundle?.stages, [])
assert.deepEqual(bundle?.sourceBlocks, [])
assert.deepEqual(bundle?.outputs, [])

selected.length = 0
await storage.listRecoverableLinkJobs()
assert.ok(selected.some(item => /status in \('queued', 'running', 'failed'\)/i.test(item.sql)))

selected.length = 0
await storage.getLatestLinkJobForMark(42)
const latestJobSql = selected.find(item => /from link_jobs/i.test(item.sql))?.sql || ''
assert.match(latestJobSql, /case when status in \('queued', 'running', 'failed'\) then 0 else 1 end/i)

console.log('link pipeline storage tests passed')
