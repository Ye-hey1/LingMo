import { invoke } from '@tauri-apps/api/core'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getContextForQuery, type Keyword } from '@/lib/rag'
import { type LinkedResource, isLinkedFolder } from '@/lib/files'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { createOpenAIClient, getAISettings, handleAIError, validateAIService } from './utils'
import { sanitizeAiRewriteOutput } from './sanitize'

interface PromptQuoteContext {
  fileName: string
  startLine: number
  endLine: number
  fullContent: string
}

export type EnhancePromptMode = 'chat' | 'agent' | 'research'

interface EnhanceChatPromptOptions {
  userInput: string
  chatMode?: EnhancePromptMode
  currentFilePath?: string
  currentArticle?: string
  linkedResources?: LinkedResource[]
  linkedResourcePreviews?: Record<string, string | null>
  quoteData?: PromptQuoteContext | null
  isRagEnabled?: boolean
  webSearchEnabled?: boolean
  enabledSkillNames?: string[]
  recentMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
}

const CURRENT_NOTE_CHAR_LIMIT = 5000
const LINKED_FILE_CHAR_LIMIT = 2200
const QUOTE_CHAR_LIMIT = 3000
const RAG_CONTEXT_CHAR_LIMIT = 4200
const MAX_LINKED_FILES = 5
const MAX_KEYWORDS = 8
const RECENT_MESSAGES_LIMIT = 6
const RECENT_MESSAGE_CHAR_LIMIT = 500

const MODE_REWRITE_GUIDES: Record<EnhancePromptMode, string> = {
  chat: [
    'Target mode: Chat.',
    'Goal: clarify the question while keeping a light, conversational feel.',
    'Guidelines:',
    '- Determine the user intent first: is it a question, a request for explanation, a comparison, a creative task, or casual conversation?',
    '- For questions: restate clearly, add relevant context from notes/quotes/links, specify preferred answer depth.',
    '- For comparisons or analysis: list the items to compare and the dimensions that matter.',
    '- For casual conversation: keep it short and natural, don\'t add unnecessary structure.',
    '- Do NOT add execution plans, tool commands, or step-by-step workflows unless the user explicitly asks for them.',
  ].join('\n'),
  agent: [
    'Target mode: Agent.',
    'Goal: turn the request into a clear, actionable task prompt for an Agent with tools.',
    'Guidelines:',
    '- Determine the task type: file editing, information retrieval, code generation, analysis, multi-step workflow, or exploration.',
    '- For simple tasks (quick edit, lookup, single action): keep the prompt short and direct. Don\'t pad with formal sections.',
    '- For complex multi-step tasks: organize with clear structure — what to do, what to check, what constraints to respect.',
    '- Include relevant context (current note, linked files, quotes, knowledge base) only when it directly helps the task.',
    '- Preserve the user intent exactly. Do not add steps the user didn\'t ask for.',
    '- If the request is vague, add a short "如需补充" note instead of guessing.',
  ].join('\n'),
  research: [
    'Target mode: Research.',
    'Goal: turn the request into a research-ready prompt with clear scope.',
    'Guidelines:',
    '- Define what to investigate and where the boundaries are.',
    '- When the request implies time sensitivity (trends, recent developments), resolve relative time to concrete dates using the current date.',
    '- Specify source quality expectations only when the user cares about rigor (academic, technical, etc.).',
    '- State output format preferences (report, comparison table, bullet summary) only when implied by the request.',
    '- Keep the prompt proportional to the request. Don\'t add a full methodology section for a quick lookup.',
  ].join('\n'),
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}\n... (truncated, ${normalized.length - maxLength} more characters)`
}

function cleanupEnhancedPrompt(content: string): string {
  return sanitizeAiRewriteOutput(content)
    .replace(/^```(?:markdown|text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^增强后提示词[：:]\s*/i, '')
    .replace(/^Enhanced Prompt[：:]\s*/i, '')
    .trim()
}

function getLinkedResourceKey(resource: LinkedResource): string {
  return resource.relativePath || resource.path || resource.name
}

async function readLinkedFileSnippet(resource: LinkedResource): Promise<string | null> {
  if (isLinkedFolder(resource)) {
    return null
  }

  try {
    const workspace = await getWorkspacePath()
    const filePath = resource.path || resource.relativePath

    if (workspace.isCustom) {
      return truncateText(await readTextFile(filePath), LINKED_FILE_CHAR_LIMIT)
    }

    const { path, baseDir } = await getFilePathOptions(filePath)
    const content = baseDir
      ? await readTextFile(path, { baseDir })
      : await readTextFile(path)

    return truncateText(content, LINKED_FILE_CHAR_LIMIT)
  } catch (error) {
    console.warn('[Prompt Enhancer] Failed to read linked file:', resource.relativePath || resource.path, error)
    return null
  }
}

async function buildLinkedResourcesContext(
  linkedResources: LinkedResource[] = [],
  linkedResourcePreviews: Record<string, string | null> = {}
): Promise<string> {
  if (linkedResources.length === 0) {
    return ''
  }

  const sections: string[] = []
  const files = linkedResources.filter(resource => !isLinkedFolder(resource)).slice(0, MAX_LINKED_FILES)
  const folders = linkedResources.filter(isLinkedFolder)

  if (folders.length > 0) {
    sections.push([
      '<linked_folders>',
      folders.map(folder =>
        `- ${folder.name} (${folder.relativePath}) indexed ${folder.indexedCount}/${folder.fileCount}`
      ).join('\n'),
      '</linked_folders>',
    ].join('\n'))
  }

  if (files.length > 0) {
    const fileSections: string[] = []
    for (const resource of files) {
      const key = getLinkedResourceKey(resource)
      const preview = linkedResourcePreviews[key]
      const snippet = await readLinkedFileSnippet(resource)

      fileSections.push([
        `--- ${resource.name} (${resource.relativePath}) ---`,
        preview ? `<preview>\n${truncateText(preview, 1200)}\n</preview>` : '',
        snippet ? `<snippet>\n${snippet}\n</snippet>` : '',
      ].filter(Boolean).join('\n'))
    }

    sections.push(`<linked_files>\n${fileSections.join('\n\n')}\n</linked_files>`)
  }

  return sections.join('\n\n')
}

async function buildRagContext(userInput: string, enabled?: boolean): Promise<string> {
  if (!enabled || !userInput.trim()) {
    return ''
  }

  try {
    let keywords = await invoke<Keyword[]>('rank_keywords', {
      text: userInput,
      topK: MAX_KEYWORDS,
    })

    keywords = keywords
      .filter(keyword => keyword.text.trim().length > 1)
      .slice(0, MAX_KEYWORDS)

    if (keywords.length === 0) {
      return ''
    }

    const ragResult = await getContextForQuery(keywords)
    if (!ragResult.context) {
      return `<knowledge_base>\nNo highly relevant indexed note snippets were found for this request.\n</knowledge_base>`
    }

    return [
      '<knowledge_base>',
      `keywords: ${keywords.map(keyword => keyword.text).join(', ')}`,
      truncateText(ragResult.context, RAG_CONTEXT_CHAR_LIMIT),
      '</knowledge_base>',
    ].join('\n')
  } catch (error) {
    console.warn('[Prompt Enhancer] Failed to build RAG context:', error)
    return ''
  }
}

function buildQuoteContext(quoteData?: PromptQuoteContext | null): string {
  if (!quoteData) {
    return ''
  }

  const lineLabel = quoteData.startLine > 0 && quoteData.endLine > 0
    ? quoteData.startLine === quoteData.endLine
      ? `line ${quoteData.startLine}`
      : `lines ${quoteData.startLine}-${quoteData.endLine}`
    : 'unknown lines'

  return [
    '<selected_quote>',
    `file: ${quoteData.fileName}`,
    `range: ${lineLabel}`,
    truncateText(quoteData.fullContent, QUOTE_CHAR_LIMIT),
    '</selected_quote>',
  ].join('\n')
}

function buildRecentMessagesContext(messages?: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  if (!messages || messages.length === 0) {
    return ''
  }

  const recent = messages.slice(-RECENT_MESSAGES_LIMIT)
  const lines = recent.map(msg => {
    const label = msg.role === 'user' ? '👤' : '🤖'
    const content = msg.content.replace(/\n{2,}/g, '\n').trim()
    const truncated = content.length > RECENT_MESSAGE_CHAR_LIMIT
      ? `${content.slice(0, RECENT_MESSAGE_CHAR_LIMIT)}…`
      : content
    return `${label} ${truncated}`
  })

  return [
    '<recent_conversation>',
    `Last ${recent.length} messages in this conversation (oldest → newest):`,
    '',
    ...lines,
    '</recent_conversation>',
  ].join('\n')
}

function buildCapabilityContext(options: EnhanceChatPromptOptions): string {
  const capabilities = [
    'Current app is a note-first AI workspace with Markdown notes, editor actions, note search, RAG, MCP, Skills, and Agent tools.',
    options.isRagEnabled
      ? 'Knowledge base retrieval is enabled; the final prompt can ask the Agent to use indexed note context.'
      : 'Knowledge base retrieval is disabled; prefer current note and explicitly linked resources.',
    options.webSearchEnabled
      ? 'Web search is enabled through Tavily for current external facts.'
      : 'Web search is disabled; do not require live web data unless the user turns it on.',
  ]

  if (options.enabledSkillNames?.length) {
    capabilities.push(`Enabled Skills: ${options.enabledSkillNames.slice(0, 8).join(', ')}`)
  }

  return `<app_capabilities>\n${capabilities.map(item => `- ${item}`).join('\n')}\n</app_capabilities>`
}

function buildModeContext(mode: EnhancePromptMode): string {
  return `<target_mode>\n${MODE_REWRITE_GUIDES[mode]}\n</target_mode>`
}

async function buildEnhancerContext(options: EnhanceChatPromptOptions): Promise<string> {
  const mode = options.chatMode || 'agent'
  const sections: string[] = [
    buildModeContext(mode),
    buildCapabilityContext(options),
  ]

  if (options.currentFilePath && options.currentArticle) {
    sections.push([
      '<current_note>',
      `path: ${options.currentFilePath}`,
      truncateText(options.currentArticle, CURRENT_NOTE_CHAR_LIMIT),
      '</current_note>',
    ].join('\n'))
  }

  const quoteContext = buildQuoteContext(options.quoteData)
  if (quoteContext) {
    sections.push(quoteContext)
  }

  const linkedContext = await buildLinkedResourcesContext(
    options.linkedResources,
    options.linkedResourcePreviews
  )
  if (linkedContext) {
    sections.push(linkedContext)
  }

  const ragContext = await buildRagContext(options.userInput, options.isRagEnabled)
  if (ragContext) {
    sections.push(ragContext)
  }

  const messagesContext = buildRecentMessagesContext(options.recentMessages)
  if (messagesContext) {
    sections.push(messagesContext)
  }

  return sections.join('\n\n')
}

export async function enhanceChatPrompt(options: EnhanceChatPromptOptions): Promise<string> {
  const originalInput = options.userInput.trim()
  if (!originalInput) {
    return ''
  }

  try {
    const aiConfig = await getAISettings('promptEnhancerModel') || await getAISettings('primaryModel')
    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const context = await buildEnhancerContext(options)
    const openai = await createOpenAIClient(aiConfig)

    const now = new Date()
    const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const currentWeekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      temperature: 0.3,
      top_p: 0.9,
      messages: [
        {
          role: 'system',
          content: [
            'You are LingMo prompt enhancement engine for a note-first AI workspace.',
            `Current date: ${currentDate} (星期${currentWeekday}) ${currentTime}. Use this as “now” when resolving relative time expressions.`,
            'When the user says “最近”, “今年”, “目前”, “当前”, “latest”, “this year”, “recently” etc., resolve them to concrete time ranges based on the current date above.',
            '',
            'Rewrite the user request into a clearer prompt that can be sent directly in the current mode.',
            'Core principles:',
            '- First, classify the user intent: question, task/command, analysis, comparison, creative, follow-up (referring to previous conversation), or casual chat.',
            '- Adapt the prompt structure to the intent. Do NOT force every request into the same template.',
            '- If <recent_conversation> is provided and the user refers to earlier content (“继续”, “上面”, “之前”, “刚才”, “接着说”, “this”, “that”, “it”), resolve the reference to concrete context from the conversation.',
            '- Infer useful structure from the request semantics and provided context, but never change the user intent.',
            '- Do not solve the task. Do not invent facts, files, requirements, or available capabilities.',
            '- Use the same language as the user request unless the user clearly asks otherwise.',
            '- Output only the enhanced prompt text. No title, no markdown fence, no explanation.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            '<context>',
            context,
            '</context>',
            '',
            '<original_user_request>',
            originalInput,
            '</original_user_request>',
            '',
            '<rewrite_rules>',
            '- Preserve the user intent exactly. Do not add requirements the user did not express.',
            '- Resolve relative time expressions (最近, 今年, 目前, 当前, 最新 etc.) to concrete time ranges based on the current date.',
            '- Resolve conversation references (继续, 上面, 之前, 刚才, 接着说, 这个, 那个) using <recent_conversation> when available.',
            '- Add concrete context from current note, selected quote, linked files, knowledge base snippets, and Skills only when directly relevant to the request.',
            '- Adapt structure to intent: short for casual questions, structured for complex tasks, evidence-oriented for research.',
            '- Make the prompt concise enough to edit in the input box. Avoid bloated sections.',
            '- If critical information is missing, include a short “需要补充：” or equivalent line instead of inventing the answer.',
            '</rewrite_rules>',
          ].join('\n'),
        },
      ],
    })

    const enhanced = cleanupEnhancedPrompt(completion.choices[0]?.message?.content || '')
    return enhanced || originalInput
  } catch (error) {
    handleAIError(error)
    return originalInput
  }
}
