import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executed = []
const activityEvents = []
let owned = true
let nextMarkId = 91
const storedMarks = []

function normalizeUrl(url) {
  return String(url || '').replace(/\/+$/, '').toLowerCase()
}

const fakeDb = {
  async execute(sql, values = []) {
    executed.push({ sql, values })
    if (/update marks set[\s\S]*captureJobId = \$8/i.test(sql)) {
      if (!owned) return { rowsAffected: 0, lastInsertId: null }

      const [tagId, type, content, url, desc, processed, processedAt, captureJobId, sourceIdentity, , marker] = values
      const existing = storedMarks
        .filter(mark => (
          mark.type === type
          && mark.deleted === 0
          && (
            (sourceIdentity && mark.sourceIdentity === sourceIdentity)
            || (
              normalizeUrl(mark.url) === normalizeUrl(url)
              && (!marker || String(mark.content || '').includes(marker))
            )
          )
        ))
        .sort((left, right) => (
          Number(right.sourceIdentity === sourceIdentity) - Number(left.sourceIdentity === sourceIdentity)
          || right.createdAt - left.createdAt
          || right.id - left.id
        ))[0]

      if (!existing) return { rowsAffected: 0, lastInsertId: null }

      Object.assign(existing, {
        tagId,
        type,
        content,
        url,
        desc,
        processed,
        processedAt,
        captureJobId,
        sourceIdentity,
      })
      return { rowsAffected: 1, lastInsertId: null }
    }
    if (/insert into marks[\s\S]*captureJobId/i.test(sql)) {
      if (
        !owned
        || storedMarks.some(mark => mark.captureJobId === values[8])
        || (values[9] && storedMarks.some(mark => mark.sourceIdentity === values[9]))
      ) {
        return { rowsAffected: 0, lastInsertId: null }
      }
      const storedMark = {
        id: nextMarkId++,
        tagId: values[0],
        type: values[1],
        content: values[2],
        url: values[3],
        desc: values[4],
        createdAt: values[5],
        deleted: 0,
        processed: values[6],
        processedAt: values[7],
        captureJobId: values[8],
        sourceIdentity: values[9],
      }
      storedMarks.push(storedMark)
      return { rowsAffected: 1, lastInsertId: storedMark.id }
    }
    if (/update link_jobs set mark_id/i.test(sql)) {
      return { rowsAffected: owned ? 1 : 0 }
    }
    if (/update marks[\s\S]*lease_owner/i.test(sql)) {
      return { rowsAffected: owned ? 1 : 0 }
    }
    return { rowsAffected: 1, lastInsertId: 1 }
  },
  async select(sql, values = []) {
    if (/inner join link_jobs/i.test(sql)) {
      const storedMark = storedMarks.find(mark => mark.captureJobId === values[0])
      return owned && storedMark ? [storedMark] : []
    }
    if (/where captureJobId/i.test(sql)) {
      const storedMark = storedMarks.find(mark => mark.captureJobId === values[0])
      return storedMark ? [storedMark] : []
    }
    if (/where marks\.sourceIdentity/i.test(sql)) {
      const storedMark = storedMarks.find(mark => mark.sourceIdentity === values[0] && mark.deleted === 0)
      return owned && storedMark ? [storedMark] : []
    }
    return []
  },
}

async function loadMarksModule() {
  const sourcePath = join(repoRoot, 'src/db/marks.ts')
  const output = ts.transpileModule(await readFile(sourcePath, 'utf8'), {
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
    if (specifier === '@tauri-apps/plugin-fs') {
      return { BaseDirectory: { AppData: 1 }, exists: async () => true, mkdir: async () => {}, remove: async () => {} }
    }
    if (specifier === './activity') {
      return { insertActivityEventWithDb: async (_db, event) => activityEvents.push(event) }
    }
    if (specifier === '@/lib/activity/events') {
      return { truncateActivityText: value => String(value || '').slice(0, 140) }
    }
    throw new Error(`Unexpected dependency: ${specifier}`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports)
  return module.exports
}

const marks = await loadMarksModule()
const source = await readFile(join(repoRoot, 'src/db/marks.ts'), 'utf8')

assert.match(source, /captureJobId\?: string \| null/)
assert.match(source, /idx_marks_capture_job_unique/)
assert.match(source, /idx_marks_source_identity_unique/)
assert.match(source, /where exists \([\s\S]*status = 'running'[\s\S]*lease_owner/is)
assert.match(source, /on conflict do nothing/i)
assert.match(source, /update link_jobs set mark_id[\s\S]*status = 'running'[\s\S]*lease_owner/is)

const input = {
  jobId: 'capture_1',
  owner: 'worker_1',
  mark: {
    tagId: 7,
    type: 'link',
    url: 'https://example.com',
    desc: '示例页面',
    content: '原始正文',
  },
}

const first = await marks.persistCapturedLinkMarkIfOwned(input)
assert.equal(first?.created, true)
assert.equal(first?.mark.id, 91)
assert.equal(first?.mark.captureJobId, 'capture_1')
assert.equal(activityEvents.length, 1)

const second = await marks.persistCapturedLinkMarkIfOwned(input)
assert.equal(second?.created, false)
assert.equal(second?.mark.id, 91)
assert.equal(activityEvents.length, 1, 'idempotent retry must not duplicate activity events')

owned = false
const lostLease = await marks.persistCapturedLinkMarkIfOwned({ ...input, jobId: 'capture_2' })
assert.equal(lostLease, null)
assert.equal(storedMarks.length, 1, 'lost worker must not create another mark')

const byCaptureJob = await marks.getMarkByCaptureJobId('capture_1')
assert.equal(byCaptureJob?.id, 91)

owned = true
const organizedWhileOwned = await marks.updateMarkContentIfUnchangedIfOwned({
  jobId: 'organize_1',
  owner: 'worker_1',
  id: 91,
  expectedDesc: '示例页面',
  expectedContent: '原始正文',
  nextDesc: '整理后标题',
  nextContent: '整理后正文',
})
assert.equal(organizedWhileOwned, true)

owned = false
const organizedAfterLeaseLoss = await marks.updateMarkContentIfUnchangedIfOwned({
  jobId: 'organize_1',
  owner: 'stale_worker',
  id: 91,
  expectedDesc: '示例页面',
  expectedContent: '原始正文',
  nextDesc: '不应写入',
  nextContent: '不应写入',
})
assert.equal(organizedAfterLeaseLoss, false, 'stale organizer must not write the mark')

const githubMarker = 'lingmo:github-project'
const githubExisting = {
  id: 200,
  tagId: 3,
  type: 'link',
  url: 'https://github.com/LingMo-App/LingMo/',
  desc: '旧标题',
  content: `<!-- ${githubMarker} -->\n旧项目卡片`,
  createdAt: 1700000000000,
  deleted: 0,
  deletedAt: null,
  pinned: 1,
  processed: 1,
  processedAt: 1700000001000,
  captureJobId: null,
}
storedMarks.push(githubExisting)
owned = true

const githubInput = {
  jobId: 'capture_github_1',
  owner: 'worker_github_1',
  upsertByUrl: true,
  sourceIdentity: 'github:https://github.com/lingmo-app/lingmo',
  existingContentMarker: githubMarker,
  mark: {
    tagId: 8,
    type: 'link',
    url: 'https://github.com/lingmo-app/lingmo',
    desc: '新标题',
    content: `<!-- ${githubMarker} -->\n新项目卡片`,
    processed: 0,
    processedAt: null,
  },
}

const activityBeforeGithubUpdate = activityEvents.length
const githubUpdated = await marks.persistCapturedLinkMarkIfOwned(githubInput)
assert.equal(githubUpdated?.created, false)
assert.equal(githubUpdated?.updated, true)
assert.equal(githubUpdated?.mark.id, 200, 'canonical GitHub URL and marker should update the existing mark')
assert.equal(githubUpdated?.mark.createdAt, 1700000000000)
assert.equal(githubUpdated?.mark.pinned, 1)
assert.equal(githubUpdated?.mark.deleted, 0)
assert.equal(githubUpdated?.mark.deletedAt, null)
assert.equal(githubUpdated?.mark.processed, 0)
assert.equal(githubUpdated?.mark.processedAt, null)
assert.equal(githubUpdated?.mark.captureJobId, 'capture_github_1')
assert.equal(activityEvents.length, activityBeforeGithubUpdate, 'updating an existing project must not create activity')

const githubUpdateRetry = await marks.persistCapturedLinkMarkIfOwned(githubInput)
assert.equal(githubUpdateRetry?.created, false)
assert.equal(githubUpdateRetry?.updated, false)
assert.equal(githubUpdateRetry?.mark.id, 200)
assert.equal(activityEvents.length, activityBeforeGithubUpdate, 'same-job update retry must not duplicate activity')

const ordinaryGithubLink = {
  id: 201,
  tagId: 4,
  type: 'link',
  url: 'https://github.com/example/plain-repo/',
  desc: '普通链接',
  content: '没有结构化项目 marker 的正文',
  createdAt: 1700000002000,
  deleted: 0,
  deletedAt: null,
  pinned: 0,
  processed: 1,
  processedAt: 1700000003000,
  captureJobId: null,
}
storedMarks.push(ordinaryGithubLink)

const markerMismatchInput = {
  ...githubInput,
  jobId: 'capture_github_2',
  sourceIdentity: 'github:https://github.com/example/plain-repo',
  mark: {
    ...githubInput.mark,
    url: 'https://github.com/EXAMPLE/plain-repo',
    desc: '结构化项目',
  },
}
const activityBeforeMarkerMismatch = activityEvents.length
const markerMismatch = await marks.persistCapturedLinkMarkIfOwned(markerMismatchInput)
assert.equal(markerMismatch?.created, true)
assert.equal(markerMismatch?.updated, false)
assert.notEqual(markerMismatch?.mark.id, ordinaryGithubLink.id)
assert.equal(ordinaryGithubLink.desc, '普通链接', 'marker mismatch must not overwrite an ordinary GitHub link')
assert.equal(ordinaryGithubLink.captureJobId, null)
assert.equal(activityEvents.length, activityBeforeMarkerMismatch + 1)

const markerMismatchRetry = await marks.persistCapturedLinkMarkIfOwned(markerMismatchInput)
assert.equal(markerMismatchRetry?.created, false)
assert.equal(markerMismatchRetry?.updated, false)
assert.equal(markerMismatchRetry?.mark.id, markerMismatch?.mark.id)
assert.equal(activityEvents.length, activityBeforeMarkerMismatch + 1, 'same-job insert retry must not duplicate activity')

const concurrentIdentity = 'github:https://github.com/example/concurrent'
const concurrentFirst = await marks.persistCapturedLinkMarkIfOwned({
  ...githubInput,
  jobId: 'capture_github_concurrent_1',
  sourceIdentity: concurrentIdentity,
  mark: {
    ...githubInput.mark,
    url: 'https://github.com/example/concurrent',
  },
})
const concurrentCountAfterFirst = storedMarks.length
const concurrentSecond = await marks.persistCapturedLinkMarkIfOwned({
  ...githubInput,
  jobId: 'capture_github_concurrent_2',
  sourceIdentity: concurrentIdentity,
  mark: {
    ...githubInput.mark,
    url: 'https://github.com/example/concurrent/',
    desc: '并发刷新后的标题',
  },
})
assert.equal(concurrentFirst?.mark.id, concurrentSecond?.mark.id)
assert.equal(storedMarks.length, concurrentCountAfterFirst, 'one canonical source identity must map to one mark')

const leaseProtectedGithub = {
  id: 203,
  tagId: 5,
  type: 'link',
  url: 'https://github.com/example/lease-protected/',
  desc: '租约保护标题',
  content: `<!-- ${githubMarker} -->\n租约保护正文`,
  createdAt: 1700000004000,
  deleted: 0,
  deletedAt: null,
  pinned: 1,
  processed: 1,
  processedAt: 1700000005000,
  captureJobId: null,
}
storedMarks.push(leaseProtectedGithub)
const markCountBeforeLeaseLoss = storedMarks.length
const activityBeforeLeaseLoss = activityEvents.length
owned = false

const githubAfterLeaseLoss = await marks.persistCapturedLinkMarkIfOwned({
  ...githubInput,
  jobId: 'capture_github_stale',
  owner: 'stale_worker',
  sourceIdentity: 'github:https://github.com/example/lease-protected',
  mark: {
    ...githubInput.mark,
    url: 'https://github.com/example/lease-protected',
    desc: '不应写入',
    content: `<!-- ${githubMarker} -->\n不应写入`,
  },
})
assert.equal(githubAfterLeaseLoss, null)
assert.equal(leaseProtectedGithub.desc, '租约保护标题', 'lost worker must not update an existing project')
assert.equal(leaseProtectedGithub.captureJobId, null)
assert.equal(storedMarks.length, markCountBeforeLeaseLoss, 'lost worker must not insert a replacement project')
assert.equal(activityEvents.length, activityBeforeLeaseLoss, 'lost worker must not create activity')

console.log('link capture idempotency tests passed')
