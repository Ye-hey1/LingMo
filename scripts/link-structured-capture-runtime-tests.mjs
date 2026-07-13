import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runnerPath = join(repoRoot, 'src/lib/link-pipeline/capture-runner.ts')
const compiled = ts.transpileModule(await readFile(runnerPath, 'utf8'), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
    strict: true,
  },
  fileName: runnerPath,
}).outputText

function createJob(sourceType) {
  const now = Date.now()
  return {
    id: `capture_${sourceType}`,
    tagId: 7,
    url: `https://example.com/${sourceType}`,
    sourceType,
    status: 'running',
    currentStage: 'capture',
    progress: 0,
    attempt: 1,
    autoOrganize: true,
    input: {},
    createdAt: now,
    updatedAt: now,
    startedAt: now,
  }
}

async function runScenario({
  sourceType,
  draft,
  updated = false,
  recoveredMark = null,
  completeError = null,
  captureError = null,
  failAccepted = true,
}) {
  const events = []
  const persisted = []
  const organizationInputs = []
  const organizationRuns = []
  const stageResults = []
  const job = createJob(sourceType)
  const module = { exports: {} }
  const localRequire = specifier => {
    if (specifier === '@/db/link-pipeline') {
      return {
        checkpointLinkJob: async () => true,
        claimLinkJob: async () => job,
        completeLinkJob: async () => {
          if (completeError) throw completeError
          return true
        },
        ensureLinkJob: async () => ({ created: true, job }),
        failLinkJob: async () => failAccepted,
        listRecoverableLinkJobs: async () => [],
        renewLinkJobLease: async () => true,
        retryLinkJob: async () => job,
        upsertLinkStageResult: async result => stageResults.push(result),
      }
    }
    if (specifier === '@/db/marks') {
      return {
        getMarkByCaptureJobId: async () => recoveredMark,
        getMarkById: async () => null,
        persistCapturedLinkMarkIfOwned: async input => {
          persisted.push(input)
          return {
            mark: {
              id: 91,
              ...input.mark,
              createdAt: Date.now(),
              deleted: 0,
              captureJobId: input.jobId,
            },
            created: !updated,
            updated,
          }
        },
      }
    }
    if (specifier === '@/lib/emitter') {
      return { __esModule: true, default: { emit: (name, event) => events.push({ name, event }) } }
    }
    if (specifier === './capture-adapters') {
      const capture = async (_url, _tagOrOptions, maybeOptions) => {
        if (captureError) throw captureError
        const options = maybeOptions || _tagOrOptions
        options?.onProgress?.(45, `正在处理 ${sourceType}`)
        return draft
      }
      return {
        captureGithub: capture,
        captureVideo: capture,
        captureWebpage: async () => draft,
        captureWechat: async () => draft,
        captureXiaohongshu: capture,
        getLinkCaptureErrorMessage: error => error.message,
        toLinkCaptureError: error => error,
      }
    }
    if (specifier === './organize-runner') {
      return {
        enqueueLinkOrganization: async input => {
          organizationInputs.push(input)
          return { id: `organize_${sourceType}` }
        },
        runLinkOrganizationJob: async id => organizationRuns.push(id),
      }
    }
    throw new Error(`Unexpected dependency: ${specifier}`)
  }

  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports)
  const outcome = await module.exports.runLinkCaptureJob(job.id)
  await new Promise(resolve => setTimeout(resolve, 0))
  return { outcome, events, persisted, organizationInputs, organizationRuns, stageResults }
}

const structuredGithub = await runScenario({
  sourceType: 'github',
  updated: true,
  draft: {
    tagId: 11,
    url: 'https://github.com/owner/repo',
    title: 'owner/repo',
    desc: 'owner/repo',
    content: '<!-- lingmo:github-project -->\n项目卡片',
    sourceType: 'github',
    organization: 'adapter_structured',
    upsertByUrl: true,
    sourceIdentity: 'github:https://github.com/owner/repo',
    existingContentMarker: 'lingmo:github-project',
  },
})
assert.equal(structuredGithub.outcome.status, 'succeeded')
assert.equal(structuredGithub.outcome.updatedExisting, true)
assert.equal(structuredGithub.organizationInputs.length, 0, 'structured GitHub cards must not run generic AI organization')
assert.equal(structuredGithub.persisted[0].upsertByUrl, true)
assert.equal(structuredGithub.persisted[0].sourceIdentity, 'github:https://github.com/owner/repo')
assert.equal(structuredGithub.persisted[0].existingContentMarker, 'lingmo:github-project')

const githubFallback = await runScenario({
  sourceType: 'github',
  draft: {
    tagId: 7,
    url: 'https://github.com/owner/repo',
    title: 'GitHub',
    desc: 'GitHub fallback',
    content: '普通网页正文',
    sourceType: 'webpage',
    organization: 'generic_ai',
    warning: 'GitHub API 暂不可用',
  },
})
assert.equal(githubFallback.organizationInputs.length, 1, 'GitHub webpage fallback must preserve the AI option')
assert.equal(githubFallback.organizationInputs[0].sourceType, 'webpage')
assert.equal(githubFallback.outcome.warning, 'GitHub API 暂不可用')

const recoveredGithubFallback = await runScenario({
  sourceType: 'github',
  draft: null,
  recoveredMark: {
    id: 92,
    tagId: 7,
    type: 'link',
    url: 'https://github.com/owner/recovered',
    desc: 'Recovered GitHub fallback',
    content: '不含 GitHub 项目标记的普通网页正文',
    createdAt: Date.now(),
    deleted: 0,
    captureJobId: 'capture_github',
  },
})
assert.equal(recoveredGithubFallback.organizationInputs.length, 1)
assert.equal(recoveredGithubFallback.organizationInputs[0].sourceType, 'webpage')

const structuredVideo = await runScenario({
  sourceType: 'video',
  draft: {
    tagId: 13,
    url: 'https://youtu.be/example',
    title: '示例视频',
    desc: '示例视频',
    content: '<!-- lingmo:video-transcript -->\n转写正文',
    sourceType: 'video',
    organization: 'adapter_structured',
  },
})
assert.equal(structuredVideo.organizationInputs.length, 0, 'video transcript cards must not run generic AI organization twice')
assert.ok(
  structuredVideo.events.some(({ name, event }) => (
    name === 'link-pipeline-capture-progress'
    && event.message === '正在处理 video'
  )),
  'adapter progress messages must reach the capture progress event',
)

const completionFailure = await runScenario({
  sourceType: 'video',
  completeError: new Error('complete failed'),
  draft: {
    tagId: 13,
    url: 'https://youtu.be/failure',
    title: '失败进度测试',
    desc: '失败进度测试',
    content: '<!-- lingmo:video-transcript -->\n转写正文',
    sourceType: 'video',
    organization: 'adapter_structured',
  },
})
const failureEvent = completionFailure.events.findLast(({ name, event }) => (
  name === 'link-pipeline-capture-progress' && event.status === 'failed'
))
assert.equal(failureEvent?.event.progress, 95, 'late failures must not move progress backwards')

const staleWorkerFailure = await runScenario({
  sourceType: 'video',
  captureError: new Error('stale worker adapter failure'),
  failAccepted: false,
  draft: null,
})
assert.equal(staleWorkerFailure.outcome.status, 'skipped', 'a stale owner must not report a persisted failure')
assert.equal(
  staleWorkerFailure.events.some(({ name, event }) => (
    name === 'link-pipeline-capture-progress' && event.status === 'failed'
  )),
  false,
  'a stale owner must not emit a failed queue event',
)

console.log('structured link capture runtime tests passed')
