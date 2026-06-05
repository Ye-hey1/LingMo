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
}

const CURRENT_NOTE_CHAR_LIMIT = 5000
const LINKED_FILE_CHAR_LIMIT = 2200
const QUOTE_CHAR_LIMIT = 3000
const RAG_CONTEXT_CHAR_LIMIT = 4200
const MAX_LINKED_FILES = 5
const MAX_KEYWORDS = 8

const MODE_REWRITE_GUIDES: Record<EnhancePromptMode, string> = {
  chat: [
    'Target mode: Chat.',
    'Goal: make the question clearer while keeping a light, conversational feel.',
    'Format: use a compact prompt with these sections only when useful:',
    '问题：the clarified question or request.',
    '可参考：current note, quote, linked resources, or knowledge base context that should guide the answer.',
    '回答偏好：tone, depth, examples, comparison, or step-by-step needs inferred from the request.',
    'Avoid heavy execution language such as plans, verification commands, or tool workflows unless the user explicitly asks.',
  ].join('\n'),
  agent: [
    'Target mode: Agent.',
    'Goal: turn the request into an executable task prompt for an Agent that may inspect context and use tools.',
    'Format the enhanced prompt with these sections:',
    '目标：state the concrete outcome.',
    '上下文：list relevant current note, selected quote, linked files, knowledge base snippets, skills, and enabled tools.',
    '执行步骤：give concise steps the Agent should follow, including inspection before action when needed.',
    '验收标准：state how the user can tell the task is complete.',
    '约束：preserve user intent, avoid unrelated changes, mention unavailable capabilities only as constraints.',
  ].join('\n'),
  research: [
    'Target mode: Research.',
    'Goal: turn the request into a research-ready prompt with clear scope and evidence requirements.',
    'Format the enhanced prompt with these sections:',
    '研究范围：define the question boundaries and what to compare or investigate.',
    '时间要求：state freshness requirements when implied; if not specified, ask for current information only when web search is enabled or necessary.',
    '来源要求：describe source quality, citation, and cross-check expectations.',
    '输出格式：state the expected report structure, tables, bullets, citations, or conclusion format.',
    '注意事项：include assumptions, missing context, and what should not be overclaimed.',
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

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      temperature: 0.25,
      top_p: 0.9,
      messages: [
        {
          role: 'system',
          content: [
            'You are LingMo prompt enhancement engine for a note-first AI workspace.',
            'Rewrite the user request into a clearer prompt that can be sent directly in the current mode.',
            'Infer useful structure from the request semantics and provided context, but never change the user intent.',
            'Do not solve the task. Do not invent facts, files, requirements, or available capabilities.',
            'Use the target mode format exactly enough to make the next AI response orderly.',
            'Use the same language as the user request unless the user clearly asks otherwise.',
            'Output only the enhanced prompt text. No title, no markdown fence, no explanation.',
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
            '- Preserve the user intent exactly.',
            '- Add concrete context from current note, selected quote, linked files, knowledge base snippets, enabled web search, and Skills only when relevant.',
            '- Follow the target mode guide: Chat stays light, Agent becomes executable, Research becomes evidence-oriented.',
            '- Make the prompt concise enough to edit in the input box.',
            '- Prefer note-app terminology: current note, linked notes, selected quote, knowledge base, Agent tools.',
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
