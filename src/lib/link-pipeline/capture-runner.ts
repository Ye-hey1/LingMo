import {
  checkpointLinkJob,
  claimLinkJob,
  completeLinkJob,
  ensureLinkJob,
  failLinkJob,
  listRecoverableLinkJobs,
  renewLinkJobLease,
  retryLinkJob,
  upsertLinkStageResult,
  type LinkJob,
  type LinkSourceType,
} from '@/db/link-pipeline'
import {
  getMarkByCaptureJobId,
  getMarkById,
  persistCapturedLinkMarkIfOwned,
  type Mark,
} from '@/db/marks'
import emitter from '@/lib/emitter'
import {
  buildLinkSourceIdentity,
  captureGithub,
  captureVideo,
  captureWebpage,
  captureWechat,
  captureXiaohongshu,
  getLinkCaptureErrorMessage,
  toLinkCaptureError,
  type CapturedLinkDraft,
} from './capture-adapters'
import { enqueueLinkOrganization, runLinkOrganizationJob } from './organize-runner'

const CAPTURE_LEASE_MS = 120_000
const CAPTURE_HEARTBEAT_MS = 30_000
const CAPTURE_RECOVERY_CONCURRENCY = 2
type CapturableLinkSourceType = Exclude<LinkSourceType, 'unknown'>

export interface EnqueueLinkCaptureInput {
  jobId?: string
  tagId: number
  url: string
  sourceType: CapturableLinkSourceType
  autoOrganize?: boolean
  wechatHtmlSource?: string
}

export interface LinkCaptureOutcome {
  jobId: string
  status: 'succeeded' | 'failed' | 'skipped'
  markId?: number
  organizationJobId?: string
  sourceType?: CapturableLinkSourceType
  updatedExisting?: boolean
  warning?: string
  error?: string
}

export interface LinkCaptureHooks {
  onSettled?: (outcome: LinkCaptureOutcome) => void | Promise<void>
}

function createWorkerId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `capture_worker_${crypto.randomUUID()}`
  }
  return `capture_worker_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function getRetryDelayMs(attempt: number) {
  return Math.min(30 * 60_000, 15_000 * (2 ** Math.max(0, attempt - 1)))
}

function emitCaptureProgress(job: LinkJob, patch: {
  status?: LinkJob['status']
  progress?: number
  tagId?: number
  markId?: number
  message?: string
  errorMessage?: string
}) {
  const status = patch.status || job.status
  const progress = patch.progress ?? job.progress
  const markId = patch.markId ?? job.markId
  emitter.emit('link-pipeline-job-updated', { jobId: job.id, markId })
  emitter.emit('link-pipeline-capture-progress', {
    jobId: job.id,
    tagId: patch.tagId ?? job.tagId,
    status,
    progress,
    startedAt: job.startedAt || job.createdAt,
    markId,
    message: patch.message,
    errorMessage: patch.errorMessage,
  })
}

async function captureDraft(
  job: LinkJob,
  onProgress: (progress: number, message: string) => void,
): Promise<CapturedLinkDraft> {
  switch (job.sourceType) {
    case 'wechat':
      return await captureWechat(job.url, String(job.input.wechatHtmlSource || ''))
    case 'webpage':
      return await captureWebpage(job.url, job.tagId)
    case 'github':
      return await captureGithub(job.url, job.tagId, { onProgress })
    case 'xiaohongshu':
      return await captureXiaohongshu(job.url, { onProgress })
    case 'video':
      return await captureVideo(job.url, { onProgress })
    default:
      throw new Error(`暂不支持持久抓取来源：${job.sourceType}`)
  }
}

function markToDraft(job: LinkJob, mark: Mark): CapturedLinkDraft {
  const title = mark.desc?.split('\n')[0]?.trim() || job.url
  const githubStructured = job.sourceType === 'github' && mark.content?.includes('lingmo:github-project')
  const sourceType: CapturableLinkSourceType = job.sourceType === 'github' && !githubStructured
    ? 'webpage'
    : job.sourceType === 'unknown'
      ? 'webpage'
      : job.sourceType
  const organization = sourceType === 'webpage' || sourceType === 'wechat'
    ? 'generic_ai'
    : 'adapter_structured'
  return {
    tagId: mark.tagId,
    url: mark.url || job.url,
    title,
    desc: mark.desc || title,
    content: mark.content || '',
    sourceType,
    organization,
    upsertByUrl: githubStructured,
    sourceIdentity: githubStructured ? buildLinkSourceIdentity('github', mark.url || job.url) : undefined,
    existingContentMarker: githubStructured ? 'lingmo:github-project' : undefined,
  }
}

export async function enqueueLinkCapture(
  input: EnqueueLinkCaptureInput,
  hooks: LinkCaptureHooks = {},
) {
  const ensured = await ensureLinkJob({
    id: input.jobId,
    tagId: input.tagId,
    url: input.url,
    sourceType: input.sourceType,
    autoOrganize: input.autoOrganize ?? true,
    currentStage: 'capture',
    progress: 0,
    input: {
      wechatHtmlSource: input.wechatHtmlSource || '',
    },
  })
  emitCaptureProgress(ensured.job, { status: ensured.job.status, progress: ensured.job.progress })
  if (ensured.created || ensured.job.status === 'queued') {
    void runLinkCaptureJob(ensured.job.id).then(outcome => hooks.onSettled?.(outcome))
  }
  return ensured.job
}

export async function runLinkCaptureJob(jobId: string): Promise<LinkCaptureOutcome> {
  const owner = createWorkerId()
  const job = await claimLinkJob(jobId, owner, {
    leaseMs: CAPTURE_LEASE_MS,
    expectedStage: 'capture',
  })
  if (!job || job.currentStage !== 'capture') {
    return { jobId, status: 'skipped' }
  }

  let leaseLost = false
  let capturedMarkId = job.markId
  let updatedExisting = false
  let lastProgress = Math.max(10, job.progress)
  let heartbeatRunning = false
  const heartbeat = setInterval(() => {
    if (heartbeatRunning || leaseLost) return
    heartbeatRunning = true
    void renewLinkJobLease(job.id, owner, CAPTURE_LEASE_MS)
      .then(renewed => {
        if (!renewed) leaseLost = true
      })
      .catch(() => {
        leaseLost = true
      })
      .finally(() => {
        heartbeatRunning = false
      })
  }, CAPTURE_HEARTBEAT_MS)

  emitCaptureProgress(job, { status: 'running', progress: lastProgress })
  try {
    const captureLeaseActive = !leaseLost && await checkpointLinkJob(job.id, owner, {
      currentStage: 'capture',
      progress: 15,
      leaseMs: CAPTURE_LEASE_MS,
    })
    if (!captureLeaseActive) {
      leaseLost = true
      return { jobId: job.id, status: 'skipped' }
    }
    lastProgress = Math.max(lastProgress, 15)
    emitCaptureProgress(job, { status: 'running', progress: 15 })
    await upsertLinkStageResult({
      jobId: job.id,
      stage: 'capture',
      attempt: job.attempt,
      status: 'running',
      input: { url: job.url, sourceType: job.sourceType },
      startedAt: Date.now(),
    })

    let mark = await getMarkByCaptureJobId(job.id)
    if (!mark && job.markId) mark = await getMarkById(job.markId)
    const recoveredFromMark = Boolean(mark)
    if (mark) capturedMarkId = mark.id
    let draft = mark
      ? markToDraft(job, mark)
      : await captureDraft(job, (progress, message) => {
          if (leaseLost) return
          lastProgress = Math.max(lastProgress, progress)
          emitCaptureProgress(job, {
            status: 'running',
            progress: lastProgress,
            message,
          })
        })

    const persistLeaseActive = !leaseLost && await checkpointLinkJob(job.id, owner, {
      currentStage: 'capture',
      progress: 60,
      leaseMs: CAPTURE_LEASE_MS,
    })
    if (!persistLeaseActive) {
      leaseLost = true
      return { jobId: job.id, status: 'skipped' }
    }
    lastProgress = Math.max(lastProgress, 60)
    emitCaptureProgress(job, {
      status: 'running',
      progress: lastProgress,
      tagId: draft.tagId,
      message: '正在安全保存链接内容',
    })

    if (!mark) {
      const persisted = await persistCapturedLinkMarkIfOwned({
        jobId: job.id,
        owner,
        mark: {
          tagId: draft.tagId,
          type: 'link',
          url: draft.url,
          desc: draft.desc,
          content: draft.content,
        },
        upsertByUrl: draft.upsertByUrl,
        sourceIdentity: draft.sourceIdentity,
        existingContentMarker: draft.existingContentMarker,
      })
      if (!persisted) {
        leaseLost = true
        return { jobId: job.id, status: 'skipped' }
      }
      mark = persisted.mark
      updatedExisting = persisted.updated
      capturedMarkId = mark.id
      draft = {
        ...draft,
        tagId: mark.tagId,
        url: mark.url || draft.url,
        desc: mark.desc || draft.desc,
        content: mark.content || draft.content,
      }
      emitter.emit('link-pipeline-mark-updated', { jobId: job.id, markId: mark.id })
    }

    await upsertLinkStageResult({
      jobId: job.id,
      stage: 'capture',
      attempt: job.attempt,
      status: 'succeeded',
      input: { url: job.url, sourceType: job.sourceType },
      output: {
        title: draft.title,
        metaDesc: draft.metaDesc || '',
        contentLength: draft.content.length,
        recoveredFromMark,
        resolvedSourceType: draft.sourceType,
        sourceIdentity: draft.sourceIdentity || '',
        organization: draft.organization,
        updatedExisting,
        warning: draft.warning || '',
        metadata: draft.metadata || {},
      },
      completedAt: Date.now(),
    })

    const shouldOrganize = Boolean(
      job.autoOrganize
      && draft.organization === 'generic_ai'
      && draft.content.trim(),
    )
    const organizeLeaseActive = !leaseLost && await checkpointLinkJob(job.id, owner, {
      currentStage: 'capture',
      progress: shouldOrganize ? 80 : 95,
      leaseMs: CAPTURE_LEASE_MS,
    })
    if (!organizeLeaseActive) {
      leaseLost = true
      return { jobId: job.id, status: 'skipped', markId: mark.id }
    }
    lastProgress = Math.max(lastProgress, shouldOrganize ? 80 : 95)
    emitCaptureProgress(job, {
      status: 'running',
      progress: lastProgress,
      tagId: mark.tagId,
      markId: mark.id,
      message: shouldOrganize ? '正文已保存，正在准备 AI 整理' : '链接内容已保存',
    })

    const organizationJob = shouldOrganize
      ? await enqueueLinkOrganization({
          parentJobId: job.id,
          markId: mark.id,
          tagId: mark.tagId,
          url: draft.url,
          title: draft.title,
          metaDesc: draft.metaDesc,
          rawDesc: draft.desc,
          rawContent: draft.content,
          sourceType: draft.sourceType,
        }, { startImmediately: false })
      : null

    const completed = !leaseLost && await completeLinkJob(job.id, owner, { markId: mark.id })
    if (!completed) {
      leaseLost = true
      return { jobId: job.id, status: 'skipped', markId: mark.id, organizationJobId: organizationJob?.id }
    }

    emitCaptureProgress(job, {
      status: 'succeeded',
      progress: 100,
      tagId: mark.tagId,
      markId: mark.id,
      message: updatedExisting ? '链接记录已更新' : '链接记录已保存',
    })
    emitter.emit('link-pipeline-mark-updated', { jobId: job.id, markId: mark.id })
    if (organizationJob) void runLinkOrganizationJob(organizationJob.id)
    return {
      jobId: job.id,
      status: 'succeeded',
      markId: mark.id,
      organizationJobId: organizationJob?.id,
      sourceType: draft.sourceType,
      updatedExisting,
      warning: draft.warning,
    }
  } catch (error) {
    const typedError = toLinkCaptureError(error)
    const message = getLinkCaptureErrorMessage(typedError)
    if (!leaseLost) {
      try {
        await upsertLinkStageResult({
          jobId: job.id,
          stage: 'capture',
          attempt: job.attempt,
          status: 'failed',
          errorCode: `link_capture_${typedError.code}`,
          errorMessage: message,
          completedAt: Date.now(),
        })
      } catch {
        // The job CAS below remains the source of truth for retry recovery.
      }
      let failed = false
      try {
        failed = await failLinkJob(job.id, owner, {
          errorCode: `link_capture_${typedError.code}`,
          errorMessage: message,
          nextRetryAt: Date.now() + getRetryDelayMs(job.attempt),
        })
      } catch {
        failed = false
      }
      if (failed) {
        emitCaptureProgress(job, {
          status: 'failed',
          progress: lastProgress,
          markId: capturedMarkId,
          errorMessage: message,
        })
      } else {
        leaseLost = true
      }
    }
    return { jobId: job.id, status: leaseLost ? 'skipped' : 'failed', markId: capturedMarkId, error: message }
  } finally {
    clearInterval(heartbeat)
  }
}

export async function retryLinkCaptureJob(jobId: string) {
  const job = await retryLinkJob(jobId)
  if (!job || job.currentStage !== 'capture' || job.status !== 'queued') {
    return { jobId, status: 'skipped' } satisfies LinkCaptureOutcome
  }
  emitCaptureProgress(job, { status: 'queued', progress: 0 })
  return await runLinkCaptureJob(job.id)
}

export async function startLinkCaptureRecovery(jobs?: LinkJob[]) {
  const candidates = jobs || await listRecoverableLinkJobs()
  const captureJobs = candidates.filter(job => (
      job.currentStage === 'capture'
      && job.sourceType !== 'unknown'
      && (job.status === 'queued' || job.status === 'running' || job.status === 'failed')
    ))
  captureJobs.forEach(job => emitCaptureProgress(job, {
    status: job.status,
    progress: job.progress,
    markId: job.markId,
    errorMessage: job.errorMessage,
  }))
  const pending = [...captureJobs]
  const workers = Array.from(
    { length: Math.min(CAPTURE_RECOVERY_CONCURRENCY, pending.length) },
    async () => {
      while (pending.length > 0) {
        const job = pending.shift()
        if (job) await runLinkCaptureJob(job.id)
      }
    },
  )
  await Promise.all(workers)
}
