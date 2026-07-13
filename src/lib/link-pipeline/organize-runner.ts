import {
  claimLinkJob,
  completeLinkJob,
  createLinkOutputVersion,
  ensureLinkJob,
  failLinkJob,
  getLinkJobBundle,
  listRecoverableLinkJobs,
  replaceLinkSourceBlocks,
  renewLinkJobLease,
  retryLinkJob,
  updateLinkOutputVersionMetadata,
  updateLinkJob,
  upsertLinkStageResult,
  checkpointLinkJob,
  type LinkJob,
  type LinkSourceType,
} from '@/db/link-pipeline'
import { getMarkById, updateMarkContentIfUnchangedIfOwned } from '@/db/marks'
import { organizeLinkRecord } from '@/lib/ai/link-organizer'
import emitter from '@/lib/emitter'
import { createLinkProjectionFingerprint } from './projection'

export interface LinkOrganizationOutcome {
  jobId: string
  status: 'succeeded' | 'failed' | 'skipped'
  appliedToMark: boolean
  conflict?: boolean
  error?: string
}

export interface EnqueueLinkOrganizationInput {
  parentJobId?: string
  markId: number
  tagId: number
  url: string
  title: string
  metaDesc?: string
  rawDesc?: string
  rawContent: string
  sourceType?: LinkSourceType
}

export interface LinkOrganizationHooks {
  onSettled?: (outcome: LinkOrganizationOutcome) => void | Promise<void>
  startImmediately?: boolean
}

function createWorkerId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `link_worker_${crypto.randomUUID()}`
  }
  return `link_worker_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function getRetryDelayMs(attempt: number) {
  return Math.min(30 * 60_000, 15_000 * (2 ** Math.max(0, attempt - 1)))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function emitJobUpdated(jobId: string, markId?: number) {
  emitter.emit('link-pipeline-job-updated', { jobId, markId })
}

function getStageMetadata(job: LinkJob, bundle: Awaited<ReturnType<typeof getLinkJobBundle>>) {
  const extractStage = bundle?.stages
    .filter(stage => stage.stage === 'extract' && stage.status === 'succeeded')
    .sort((left, right) => right.attempt - left.attempt)[0]
  const metadata = extractStage?.output || {}
  return {
    title: String(metadata.title || job.url),
    metaDesc: String(metadata.metaDesc || ''),
    baselineDesc: String(metadata.baselineDesc || ''),
    projectionFingerprint: String(metadata.projectionFingerprint || ''),
  }
}

export async function enqueueLinkOrganization(
  input: EnqueueLinkOrganizationInput,
  hooks: LinkOrganizationHooks = {},
) {
  const ensured = await ensureLinkJob({
    parentJobId: input.parentJobId,
    markId: input.markId,
    tagId: input.tagId,
    url: input.url,
    sourceType: input.sourceType || 'webpage',
    autoOrganize: true,
    currentStage: 'organize',
    progress: 60,
    input: {
      title: input.title,
      metaDesc: input.metaDesc || '',
      baselineDesc: input.rawDesc || '',
    },
  })
  const job = ensured.job
  if (!ensured.created) {
    if (job.status === 'queued' && hooks.startImmediately !== false) {
      void runLinkOrganizationJob(job.id).then(outcome => hooks.onSettled?.(outcome))
    }
    return job
  }
  const baselineDesc = input.rawDesc || ''
  const projectionFingerprint = createLinkProjectionFingerprint({
    desc: baselineDesc,
    content: input.rawContent,
  })

  try {
    await replaceLinkSourceBlocks(job.id, input.markId, [{
      kind: 'document',
      content: input.rawContent,
      sourceLocator: input.url,
      metadata: { title: input.title, metaDesc: input.metaDesc || '' },
    }])
    await upsertLinkStageResult({
      jobId: job.id,
      stage: 'extract',
      attempt: job.attempt,
      status: 'succeeded',
      input: { url: input.url },
      output: {
        title: input.title,
        metaDesc: input.metaDesc || '',
        baselineDesc,
        projectionFingerprint,
        blockCount: 1,
      },
      startedAt: job.createdAt,
      completedAt: Date.now(),
    })
  } catch (error) {
    const message = getErrorMessage(error)
    await updateLinkJob(job.id, {
      status: 'failed',
      currentStage: 'extract',
      errorCode: 'link_enqueue_failed',
      errorMessage: message,
      nextRetryAt: Date.now() + getRetryDelayMs(job.attempt),
    })
    emitJobUpdated(job.id, job.markId)
    throw error
  }
  emitJobUpdated(job.id, job.markId)

  if (hooks.startImmediately !== false) {
    void runLinkOrganizationJob(job.id).then(outcome => hooks.onSettled?.(outcome))
  }
  return job
}

export async function runLinkOrganizationJob(jobId: string): Promise<LinkOrganizationOutcome> {
  const owner = createWorkerId()
  const job = await claimLinkJob(jobId, owner, { leaseMs: 120_000 })
  if (!job) {
    return { jobId, status: 'skipped', appliedToMark: false }
  }
  let leaseLost = false
  let heartbeatRunning = false
  const heartbeat = setInterval(() => {
    if (heartbeatRunning || leaseLost) return
    heartbeatRunning = true
    void renewLinkJobLease(job.id, owner, 120_000)
      .then(renewed => {
        if (!renewed) leaseLost = true
      })
      .catch(() => {
        leaseLost = true
      })
      .finally(() => {
        heartbeatRunning = false
      })
  }, 30_000)
  emitJobUpdated(job.id, job.markId)

  try {
    const bundle = await getLinkJobBundle(job.id)
    if (!bundle || !job.markId) {
      throw new Error('链接整理任务缺少关联记录')
    }

    let metadata = getStageMetadata(job, bundle)
    let rawContent = bundle.sourceBlocks.map(block => block.content).filter(Boolean).join('\n\n').trim()
    if (!rawContent) {
      const mark = await getMarkById(job.markId)
      rawContent = mark?.content?.trim() || ''
      if (!rawContent) {
        throw new Error('链接整理任务缺少原始正文')
      }

      const baselineDesc = mark?.desc || ''
      const projectionFingerprint = createLinkProjectionFingerprint({
        desc: baselineDesc,
        content: rawContent,
      })
      metadata = {
        title: mark?.desc?.split('\n')[0] || job.url,
        metaDesc: '',
        baselineDesc,
        projectionFingerprint,
      }
      await replaceLinkSourceBlocks(job.id, job.markId, [{
        kind: 'document',
        content: rawContent,
        sourceLocator: job.url,
        metadata: { recoveredFromMark: true },
      }])
      await upsertLinkStageResult({
        jobId: job.id,
        stage: 'extract',
        attempt: job.attempt,
        status: 'succeeded',
        input: { url: job.url, recoveredFromMark: true },
        output: {
          title: metadata.title,
          metaDesc: '',
          baselineDesc,
          projectionFingerprint,
          blockCount: 1,
          recoveredFromMark: true,
        },
        completedAt: Date.now(),
      })
    }

    const organizeLeaseActive = !leaseLost && await checkpointLinkJob(job.id, owner, {
      currentStage: 'organize',
      progress: 70,
      leaseMs: 120_000,
    })
    if (!organizeLeaseActive) {
      return { jobId: job.id, status: 'skipped', appliedToMark: false }
    }
    emitJobUpdated(job.id, job.markId)
    await upsertLinkStageResult({
      jobId: job.id,
      stage: 'organize',
      attempt: job.attempt,
      status: 'running',
      input: { sourceFingerprint: metadata.projectionFingerprint },
      startedAt: Date.now(),
    })

    const reusableOutput = bundle.outputs.find(output => (
      output.kind === 'organized_markdown'
      && Boolean(metadata.projectionFingerprint)
      && output.sourceFingerprint === metadata.projectionFingerprint
    ))
    const organized = reusableOutput
      ? {
          desc: reusableOutput.desc || metadata.title,
          content: reusableOutput.content,
          model: reusableOutput.model,
          promptVersion: reusableOutput.promptVersion,
          chunkCount: Number(reusableOutput.metadata.chunkCount || 1),
        }
      : await organizeLinkRecord({
          url: job.url,
          title: metadata.title,
          metaDesc: metadata.metaDesc,
          content: rawContent,
        })
    if (!organized) {
      throw new Error('AI 模型未配置、超时或未返回可用整理结果')
    }

    const renderLeaseActive = !leaseLost && await checkpointLinkJob(job.id, owner, { currentStage: 'render', progress: 90 })
    if (!renderLeaseActive) {
      return { jobId: job.id, status: 'skipped', appliedToMark: false }
    }
    await upsertLinkStageResult({
      jobId: job.id,
      stage: 'organize',
      attempt: job.attempt,
      status: 'succeeded',
      input: { sourceFingerprint: metadata.projectionFingerprint },
      output: {
        desc: organized.desc,
        contentLength: organized.content.length,
        model: organized.model,
        promptVersion: organized.promptVersion,
        chunkCount: organized.chunkCount,
        reusedOutput: Boolean(reusableOutput),
      },
      completedAt: Date.now(),
    })
    emitJobUpdated(job.id, job.markId)

    // Persist the model result before mutating the Mark. Recovery can then reuse it
    // if the app exits between rendering, applying, and completing the job.
    const output = reusableOutput || await createLinkOutputVersion({
      jobId: job.id,
      markId: job.markId,
      kind: 'organized_markdown',
      content: organized.content,
      desc: organized.desc,
      model: organized.model,
      promptVersion: organized.promptVersion,
      sourceFingerprint: metadata.projectionFingerprint,
      metadata: {
        state: 'generated',
        appliedToMark: false,
        conflict: false,
        chunkCount: organized.chunkCount,
        attempt: job.attempt,
      },
    })
    const currentMark = await getMarkById(job.markId)
    const outputAlreadyApplied = Boolean(
      currentMark
      && (currentMark.desc || '') === organized.desc
      && (currentMark.content || '') === organized.content,
    )
    const applyLeaseActive = !leaseLost && await checkpointLinkJob(job.id, owner, {
      currentStage: 'render',
      progress: 95,
      leaseMs: 120_000,
    })
    if (!applyLeaseActive) {
      return { jobId: job.id, status: 'skipped', appliedToMark: false }
    }
    const appliedToMark = outputAlreadyApplied || await updateMarkContentIfUnchangedIfOwned({
      jobId: job.id,
      owner,
      id: job.markId,
      expectedDesc: metadata.baselineDesc,
      expectedContent: rawContent,
      nextDesc: organized.desc,
      nextContent: organized.content,
    })
    await updateLinkOutputVersionMetadata(output.id, {
      ...output.metadata,
      state: appliedToMark ? 'applied' : 'conflict',
      appliedToMark,
      conflict: !appliedToMark,
      outputAlreadyApplied,
      chunkCount: organized.chunkCount,
      appliedAttempt: job.attempt,
    })
    await upsertLinkStageResult({
      jobId: job.id,
      stage: 'render',
      attempt: job.attempt,
      status: appliedToMark ? 'succeeded' : 'skipped',
      output: {
        appliedToMark,
        conflict: !appliedToMark,
        reason: appliedToMark ? undefined : 'mark_projection_changed',
      },
      completedAt: Date.now(),
    })
    const completed = !leaseLost && await completeLinkJob(job.id, owner, { markId: job.markId })
    if (!completed) {
      return { jobId: job.id, status: 'skipped', appliedToMark, conflict: !appliedToMark }
    }
    emitJobUpdated(job.id, job.markId)
    emitter.emit('link-pipeline-mark-updated', { markId: job.markId, jobId: job.id })

    return {
      jobId: job.id,
      status: 'succeeded',
      appliedToMark,
      conflict: !appliedToMark,
    }
  } catch (error) {
    const message = getErrorMessage(error)
    if (!leaseLost) {
      await upsertLinkStageResult({
        jobId: job.id,
        stage: job.currentStage === 'render' ? 'render' : 'organize',
        attempt: job.attempt,
        status: 'failed',
        errorCode: 'link_organize_failed',
        errorMessage: message,
        completedAt: Date.now(),
      })
      const failed = await failLinkJob(job.id, owner, {
        errorCode: 'link_organize_failed',
        errorMessage: message,
        nextRetryAt: Date.now() + getRetryDelayMs(job.attempt),
      })
      if (failed) emitJobUpdated(job.id, job.markId)
    }
    return { jobId: job.id, status: leaseLost ? 'skipped' : 'failed', appliedToMark: false, error: message }
  } finally {
    clearInterval(heartbeat)
  }
}

export async function retryLinkOrganizationJob(jobId: string) {
  const job = await retryLinkJob(jobId)
  if (!job || job.status !== 'queued') {
    return { jobId, status: 'skipped', appliedToMark: false } satisfies LinkOrganizationOutcome
  }
  return await runLinkOrganizationJob(job.id)
}

let recoveryPromise: Promise<void> | null = null
let recoveryTimer: ReturnType<typeof setTimeout> | null = null
const RECOVERY_SCAN_INTERVAL_MS = 30_000

function scheduleRecoveryScan() {
  if (recoveryTimer) return
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    void startLinkPipelineRecovery()
  }, RECOVERY_SCAN_INTERVAL_MS)
}

export function startLinkPipelineRecovery() {
  if (recoveryPromise) {
    scheduleRecoveryScan()
    return recoveryPromise
  }
  recoveryPromise = (async () => {
    const jobs = await listRecoverableLinkJobs()
    const captureJobs = jobs.filter(job => job.currentStage === 'capture')
    const organizeJobs = jobs.filter(job => job.currentStage !== 'capture')
    if (captureJobs.length > 0) {
      const { startLinkCaptureRecovery } = await import('./capture-runner')
      await startLinkCaptureRecovery(captureJobs)
    }
    for (const job of organizeJobs) {
      if ((job.sourceType === 'webpage' || job.sourceType === 'wechat') && job.autoOrganize && job.markId) {
        await runLinkOrganizationJob(job.id)
      }
    }
  })().finally(() => {
    recoveryPromise = null
    scheduleRecoveryScan()
  })
  return recoveryPromise
}
