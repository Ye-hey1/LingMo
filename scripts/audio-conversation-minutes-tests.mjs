import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const unavailableAiUtils = {
  createOpenAIClient: () => {
    throw new Error('AI client is not available in pure contract tests')
  },
  getAISettings: () => null,
  prepareMessages: () => ({ messages: [] }),
}

async function loadAudioRecordingModule(aiUtils = unavailableAiUtils) {
  const relativePath = 'src/lib/audio-recording-record.ts'
  const path = join(repoRoot, relativePath)
  const output = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      esModuleInterop: true,
    },
    fileName: path,
  }).outputText

  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)((id) => {
    if (id === '@/lib/ai/utils') {
      return aiUtils
    }
    throw new Error(`Unexpected dependency in ${relativePath}: ${id}`)
  }, module, module.exports)

  return module.exports
}

const audio = await loadAudioRecordingModule()

assert.equal(
  typeof audio.createAudioRecordingContent,
  'function',
  'recording imports need a versioned raw-content builder',
)
assert.equal(
  typeof audio.parseAudioTranscriptSegments,
  'function',
  'recording details need stable transcript segments',
)

const rawTranscript = '- 00:00 项目背景与参与方介绍。\n\n- 03:00 客户要求补充智能配送的人效指标。'
const rawContent = audio.createAudioRecordingContent(rawTranscript, {
  sourceFileName: '客户需求访谈.m4a',
  status: 'raw',
})
const rawMeta = audio.extractAudioRecordingMeta(rawContent)

assert.equal(rawMeta.version, 2)
assert.equal(rawMeta.status, 'raw')
assert.equal(rawMeta.sourceFileName, '客户需求访谈.m4a')

assert.equal(
  typeof audio.isAudioRecordingOrganizationStale,
  'function',
  'persisted organizing states need a deterministic stale-task check',
)
const organizingContent = audio.createAudioRecordingContent(rawTranscript, {
  sourceFileName: '客户需求访谈.m4a',
  status: 'organizing',
  organizationStartedAt: 10_000,
})
assert.equal(audio.extractAudioRecordingMeta(organizingContent).organizationStartedAt, 10_000)
assert.equal(
  audio.isAudioRecordingOrganizationStale({ status: 'organizing' }, 20_000),
  true,
  'legacy organizing records without a start time cannot represent a live task',
)
assert.equal(
  audio.isAudioRecordingOrganizationStale({ status: 'organizing', organizationStartedAt: 10_000 }, 20_000),
  false,
)
assert.equal(
  audio.isAudioRecordingOrganizationStale({ status: 'organizing', organizationStartedAt: 10_000 }, 400_001),
  true,
  'organizing records older than the task budget must become retryable',
)

const rawRecord = audio.parseAudioRecordingRecord({
  id: 1,
  tagId: 1,
  type: 'recording',
  desc: '客户需求访谈.m4a',
  content: rawContent,
  url: 'recordings/test.mp3',
  deleted: 0,
  createdAt: 1,
})

assert.equal(rawRecord.title, '客户需求访谈.m4a')
assert.equal(rawRecord.body, rawTranscript)
assert.equal(rawRecord.hasMinutes, false)
assert.equal(rawRecord.meta.status, 'raw')

const readyContent = audio.mergeAudioRecordingSummary(rawContent, {
  title: '智能配送与人效分析需求访谈',
  conversationType: 'requirements_interview',
  summary: '双方确认先梳理人效分析指标，再评估智能配送方案。',
  highlights: ['项目包含智能配送与智能配餐两个智能体'],
  requirements: [{
    requirement: '输出智能配送人效分析报告及相关指标',
    requester: '客户产品经理',
    priority: 'high',
    status: 'confirmed',
    evidence: { time: '03:00', quote: '客户要求补充智能配送的人效指标' },
  }],
  decisions: [{
    decision: '先从问数能力开始验证',
    status: 'confirmed',
    evidence: { time: '00:00' },
  }],
  actionItems: [{
    task: '整理现有排班数据字段',
    owner: '客户方',
    dueDate: '',
    status: 'open',
    evidence: { time: '03:00' },
  }],
  risks: [{ risk: '转写未提供可靠说话人分离', impact: '负责人可能需要人工确认' }],
  openQuestions: [{ question: '人效口径是否包含外包人员？' }],
})

const readyRecord = audio.parseAudioRecordingRecord({
  id: 2,
  tagId: 1,
  type: 'recording',
  desc: '客户需求访谈.m4a',
  content: readyContent,
  url: 'recordings/test.mp3',
  deleted: 0,
  createdAt: 1,
})

assert.equal(readyRecord.title, '智能配送与人效分析需求访谈')
assert.equal(readyRecord.body, rawTranscript, 'AI metadata must never replace the raw transcript')
assert.equal(readyRecord.hasMinutes, true)
assert.equal(readyRecord.meta.status, 'ready')
assert.equal(readyRecord.meta.requirements?.[0]?.priority, 'high')
assert.equal(readyRecord.meta.actionItems?.[0]?.owner, '客户方')
assert.match(readyRecord.summaryMarkdown, /核心结论/)
assert.match(readyRecord.summaryMarkdown, /需求识别/)
assert.match(readyRecord.summaryMarkdown, /行动项/)

const segments = audio.parseAudioTranscriptSegments(rawTranscript)
assert.deepEqual(segments, [
  { time: '00:00', text: '项目背景与参与方介绍。' },
  { time: '03:00', text: '客户要求补充智能配送的人效指标。' },
])
assert.deepEqual(audio.parseAudioTranscriptSegments('没有时间戳的短录音'), [
  { time: '00:00', text: '没有时间戳的短录音' },
])

const legacy = audio.parseAudioRecordingRecord({
  id: 3,
  tagId: 1,
  type: 'recording',
  desc: '旧录音',
  content: '<!-- lingmo:audio-recording {"summary":"旧摘要","highlights":["旧要点"],"takeaways":["旧行动"],"notes":[]} -->\n旧转写原文',
  url: 'recordings/legacy.mp3',
  deleted: 0,
  createdAt: 1,
})

assert.equal(legacy.body, '旧转写原文')
assert.equal(legacy.hasMinutes, true)
assert.equal(legacy.meta.status, 'ready')
assert.match(legacy.summaryMarkdown, /旧摘要/)

assert.equal(
  typeof audio.chunkAudioTranscript,
  'function',
  'long recordings need a whole-transcript chunker',
)
const longTranscript = Array.from({ length: 9 }, (_, index) => (
  `- ${String(index * 3).padStart(2, '0')}:00 SECTION-${index} ${String(index).repeat(220)}`
)).join('\n\n')
const transcriptChunks = audio.chunkAudioTranscript(longTranscript, {
  maxChars: 520,
  maxChunks: 4,
})
assert.equal(transcriptChunks.length, 4)
assert.match(transcriptChunks[0], /SECTION-0/)
assert.ok(transcriptChunks.some(chunk => chunk.includes('SECTION-4')), 'middle transcript content must be analyzed')
assert.match(transcriptChunks.at(-1), /SECTION-8/)
assert.equal(
  transcriptChunks.join('\n\n').replace(/\s+/g, ' ').trim(),
  longTranscript.replace(/\s+/g, ' ').trim(),
  'chunking must not sample away transcript content',
)

let abortedRequests = 0
const timeoutAudio = await loadAudioRecordingModule({
  getAISettings: async () => ({ model: 'test-model', topP: 1 }),
  prepareMessages: async prompt => ({ messages: [{ role: 'user', content: prompt }] }),
  createOpenAIClient: async () => ({
    chat: {
      completions: {
        create: (_body, options) => new Promise((_resolve, reject) => {
          const abort = () => {
            abortedRequests += 1
            const error = new Error('Request was aborted.')
            error.name = 'AbortError'
            reject(error)
          }
          if (options?.signal?.aborted) {
            abort()
          } else {
            options?.signal?.addEventListener('abort', abort, { once: true })
          }
        }),
      },
    },
  }),
})

let guardTimer
try {
  await assert.rejects(
    Promise.race([
      timeoutAudio.summarizeAudioRecording({
        title: '超时录音',
        content: '这是一段永远不会返回模型结果的转写。',
        url: 'recordings/timeout.mp3',
      }, { timeoutMs: 30 }),
      new Promise((_, reject) => {
        guardTimer = setTimeout(() => reject(new Error('test guard expired')), 500)
      }),
    ]),
    /会话纪要生成超时/,
  )
} finally {
  clearTimeout(guardTimer)
}
assert.equal(abortedRequests, 1, 'a timed-out primary request must be cancelled without starting fallback work')

const progressEvents = []
const completionBodies = []
const progressAudio = await loadAudioRecordingModule({
  getAISettings: async () => ({ model: 'test-model', topP: 1 }),
  prepareMessages: async prompt => ({ messages: [{ role: 'user', content: prompt }] }),
  createOpenAIClient: async () => ({
    chat: {
      completions: {
        async create(body, options) {
          completionBodies.push(body)
          assert.ok(options?.signal, 'every minutes request must share the task cancellation signal')
          return {
            id: 'chatcmpl-audio-minutes-test',
            object: 'chat.completion',
            created: 1,
            model: 'test-model',
            choices: [{
              index: 0,
              finish_reason: 'stop',
              logprobs: null,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  title: '测试会话纪要',
                  conversationType: 'project_meeting',
                  summary: '测试摘要',
                  highlights: ['测试重点'],
                  participants: [],
                  requirements: [],
                  decisions: [],
                  actionItems: [],
                  risks: [],
                  openQuestions: [],
                }),
                refusal: null,
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }
        },
      },
    },
  }),
})
await progressAudio.summarizeAudioRecording({
  title: '长录音进度测试',
  content: '会议内容。'.repeat(2_500),
  url: 'recordings/progress.mp3',
}, {
  timeoutMs: 1_000,
  onProgress: event => progressEvents.push(event),
})
const analysisEvents = progressEvents.filter(event => event.stage === 'analyzing')
assert.ok(analysisEvents.length >= 2, 'long transcripts must report chunk-analysis progress')
assert.ok(analysisEvents[0].total > 1)
assert.ok(analysisEvents.some(event => event.completed === event.total), 'progress must reach the final chunk')
assert.ok(progressEvents.some(event => event.stage === 'merging'), 'multi-chunk summaries need a visible merge stage')
assert.equal(progressEvents.at(-1)?.stage, 'complete')
assert.ok(completionBodies.length > 1, 'long transcripts should use chunk requests followed by one merge request')
assert.ok(
  completionBodies.slice(0, -1).every(body => body.max_tokens === 2_200),
  'chunk analysis needs a bounded output budget',
)
assert.equal(completionBodies.at(-1)?.max_tokens, 3_200, 'the final structured minutes need a bounded merge budget')

const malformedMinutesJson = `{
  "title":"数字员工项目会议",
  "conversationType":"project_meeting",
  "summary":"会议明确推进"数字员工"项目，并要求优先验证。",
  "highlights":["形成"先试点、后推广"的实施路径"],
  "participants":[],
  "requirements":[],
  "decisions":[],
  "actionItems":[],
  "risks":[],
  "openQuestions":[]
}`
const malformedJsonAudio = await loadAudioRecordingModule({
  getAISettings: async () => ({ model: 'test-model', topP: 1 }),
  prepareMessages: async prompt => ({ messages: [{ role: 'user', content: prompt }] }),
  createOpenAIClient: async () => ({
    chat: {
      completions: {
        async create() {
          return {
            id: 'chatcmpl-malformed-audio-minutes-test',
            object: 'chat.completion',
            created: 1,
            model: 'test-model',
            choices: [{
              index: 0,
              finish_reason: 'stop',
              logprobs: null,
              message: {
                role: 'assistant',
                content: malformedMinutesJson,
                refusal: null,
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }
        },
      },
    },
  }),
})
const repairedMalformedMinutes = await malformedJsonAudio.summarizeAudioRecording({
  title: '畸形 JSON 修复测试',
  content: '会议讨论数字员工项目。',
  url: 'recordings/malformed-json.mp3',
}, { timeoutMs: 1_000 })
assert.equal(repairedMalformedMinutes.summary, '会议明确推进"数字员工"项目，并要求优先验证。')
assert.deepEqual(repairedMalformedMinutes.highlights, ['形成"先试点、后推广"的实施路径'])

const missingSeparatorsJson = `{
  "title":"数组分隔符修复测试",
  "conversationType":"requirements_interview",
  "summary":"会议确认两项需求。",
  "highlights":[
    "先完成网点试点"
    "再评估区域推广"
  ],
  "participants":[],
  "requirements":[
    {"requirement":"补充人效指标","priority":"high","status":"confirmed"}
    {"requirement":"形成推广计划","priority":"medium","status":"proposed"}
  ],
  "decisions":[],
  "actionItems":[],
  "risks":[],
  "openQuestions":[]
}`
const missingSeparatorsAudio = await loadAudioRecordingModule({
  getAISettings: async () => ({ model: 'test-model', topP: 1 }),
  prepareMessages: async prompt => ({ messages: [{ role: 'user', content: prompt }] }),
  createOpenAIClient: async () => ({
    chat: {
      completions: {
        async create() {
          return {
            id: 'chatcmpl-missing-separators-test',
            object: 'chat.completion',
            created: 1,
            model: 'test-model',
            choices: [{
              index: 0,
              finish_reason: 'stop',
              logprobs: null,
              message: {
                role: 'assistant',
                content: missingSeparatorsJson,
                refusal: null,
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }
        },
      },
    },
  }),
})
const repairedMissingSeparators = await missingSeparatorsAudio.summarizeAudioRecording({
  title: '数组分隔符修复测试',
  content: '会议确认网点试点、人效指标和推广计划。',
  url: 'recordings/missing-separators.mp3',
}, { timeoutMs: 1_000 })
assert.deepEqual(repairedMissingSeparators.highlights, ['先完成网点试点', '再评估区域推广'])
assert.deepEqual(
  repairedMissingSeparators.requirements?.map(item => item.requirement),
  ['补充人效指标', '形成推广计划'],
)

let markModelCalls = 0
let primaryModelCalls = 0
const modelRepairAudio = await loadAudioRecordingModule({
  getAISettings: async modelType => ({
    model: modelType === 'markDescModel' ? 'mark-model' : 'primary-model',
    topP: 1,
  }),
  prepareMessages: async prompt => ({ messages: [{ role: 'user', content: prompt }] }),
  createOpenAIClient: async config => ({
    chat: {
      completions: {
        async create() {
          if (config.model === 'primary-model') {
            primaryModelCalls += 1
            throw new Error('primary fallback must not run when same-model JSON repair succeeds')
          }
          markModelCalls += 1
          const content = markModelCalls === 1
            ? '{"title":"截断结果","summary":"尚未结束'
            : JSON.stringify({
                title: '修复后的纪要',
                conversationType: 'project_meeting',
                summary: '仅修复 JSON 语法，保留原有事实。',
                highlights: ['语法修复成功'],
                participants: [],
                requirements: [],
                decisions: [],
                actionItems: [],
                risks: [],
                openQuestions: [],
              })
          return {
            id: `chatcmpl-model-repair-${markModelCalls}`,
            object: 'chat.completion',
            created: 1,
            model: config.model,
            choices: [{
              index: 0,
              finish_reason: 'stop',
              logprobs: null,
              message: { role: 'assistant', content, refusal: null },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }
        },
      },
    },
  }),
})
const modelRepairedMinutes = await modelRepairAudio.summarizeAudioRecording({
  title: '模型 JSON 修复测试',
  content: '会议确认继续推进项目。',
  url: 'recordings/model-json-repair.mp3',
}, { timeoutMs: 1_000 })
assert.equal(modelRepairedMinutes.summary, '仅修复 JSON 语法，保留原有事实。')
assert.equal(markModelCalls, 2, 'malformed output should trigger exactly one same-model JSON repair request')
assert.equal(primaryModelCalls, 0, 'successful syntax repair must avoid restarting with the fallback model')

const audioSource = await readFile(join(repoRoot, 'src/lib/audio-recording-record.ts'), 'utf8')
assert.match(audioSource, /requirements_interview/)
assert.match(audioSource, /"requirements"/)
assert.match(audioSource, /"decisions"/)
assert.match(audioSource, /"actionItems"/)
assert.match(audioSource, /不得编造(?:负责人|参与人)/)
assert.match(audioSource, /chunkAudioTranscript\(input\.content/)
assert.doesNotMatch(audioSource, /input\.content\.slice\(0,\s*18_?000\)/)
assert.doesNotMatch(audioSource, /console\.error\('\[audio-recording-record\]/)

assert.equal(
  typeof audio.mergeAudioRecordingMeta,
  'function',
  'background organization needs explicit status transitions',
)
const failedContent = audio.mergeAudioRecordingMeta(rawContent, {
  status: 'failed',
  error: '整理模型暂时不可用',
})
const failedRecord = audio.parseAudioRecordingRecord({
  id: 4,
  tagId: 1,
  type: 'recording',
  desc: '客户需求访谈.m4a',
  content: failedContent,
  url: 'recordings/test.mp3',
  deleted: 0,
  createdAt: 1,
})
assert.equal(failedRecord.meta.status, 'failed')
assert.equal(failedRecord.meta.error, '整理模型暂时不可用')
assert.equal(failedRecord.body, rawTranscript)

let transcriptionRecordSource = ''
try {
  transcriptionRecordSource = await readFile(join(repoRoot, 'src/lib/audio-transcription-record.ts'), 'utf8')
} catch {
  // The following assertions intentionally fail until the shared import path exists.
}
assert.match(transcriptionRecordSource, /export async function createAudioTranscriptionRecord/)
assert.match(transcriptionRecordSource, /updateMarkContentIfUnchanged/)
assert.match(transcriptionRecordSource, /summarizeAudioRecording/)
assert.match(transcriptionRecordSource, /onRawSaved/)
assert.match(transcriptionRecordSource, /organizationStartedAt/)

const controlLinkSource = await readFile(join(repoRoot, 'src/app/core/main/mark/control-link.tsx'), 'utf8')
const controlRecordingSource = await readFile(join(repoRoot, 'src/app/core/main/mark/control-recording.tsx'), 'utf8')
const markIndexSource = await readFile(join(repoRoot, 'src/app/core/main/mark/index.tsx'), 'utf8')
assert.match(controlLinkSource, /createAudioTranscriptionRecord/)
assert.match(controlLinkSource, /organize:\s*organizeAfterSave/)
assert.match(controlRecordingSource, /createAudioTranscriptionRecord/)
assert.match(markIndexSource, /createAudioTranscriptionRecord/)

assert.equal(
  typeof audio.replaceAudioRecordingTranscript,
  'function',
  'editing the transcript must preserve hidden meeting metadata',
)
const editedContent = audio.replaceAudioRecordingTranscript(readyContent, '人工修订后的完整原文')
const editedMeta = audio.extractAudioRecordingMeta(editedContent)
assert.equal(editedMeta.title, '智能配送与人效分析需求访谈')
assert.equal(editedMeta.requirements?.length, 1)
assert.equal(audio.parseAudioRecordingRecord({
  id: 5,
  tagId: 1,
  type: 'recording',
  desc: '智能配送与人效分析需求访谈',
  content: editedContent,
  url: 'recordings/test.mp3',
  deleted: 0,
  createdAt: 1,
}).body, '人工修订后的完整原文')

assert.equal(
  typeof audio.getAudioRecordingListPresentation,
  'function',
  'recording cards need a minutes-first title and preview',
)
assert.deepEqual(audio.getAudioRecordingListPresentation({
  id: 6,
  tagId: 1,
  type: 'recording',
  desc: '客户需求访谈.m4a',
  content: readyContent,
  url: 'recordings/test.mp3',
  deleted: 0,
  createdAt: 1,
}), {
  title: '智能配送与人效分析需求访谈',
  preview: '双方确认先梳理人效分析指标，再评估智能配送方案。',
})

let audioDetailSource = ''
try {
  audioDetailSource = await readFile(join(repoRoot, 'src/app/core/main/mark/audio-recording-detail-view.tsx'), 'utf8')
} catch {
  // The following assertions intentionally fail until the specialized view exists.
}
assert.match(audioDetailSource, /export function AudioRecordingDetailView/)
assert.match(audioDetailSource, /智能纪要/)
assert.match(audioDetailSource, /完整原文/)
assert.match(audioDetailSource, /AudioPlayer/)
assert.match(audioDetailSource, /requirements/)
assert.match(audioDetailSource, /actionItems/)
assert.match(audioDetailSource, /openQuestions/)
assert.match(audioDetailSource, /isAudioRecordingOrganizationStale/)
assert.match(audioDetailSource, /上次整理任务已中断/)
assert.match(audioDetailSource, /generationProgress/)

const markItemSource = await readFile(join(repoRoot, 'src/app/core/main/mark/mark-item.tsx'), 'utf8')
const markListItemContentSource = await readFile(join(repoRoot, 'src/app/core/main/mark/mark-list-item-content.tsx'), 'utf8')
assert.match(markItemSource, /AudioRecordingDetailView/)
assert.match(markItemSource, /replaceAudioRecordingTranscript/)
assert.match(markListItemContentSource, /getAudioRecordingListPresentation/)

console.log('audio conversation minutes tests passed')
