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

interface EnhanceChatPromptOptions {
  userInput: string
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

async function buildEnhancerContext(options: EnhanceChatPromptOptions): Promise<string> {
  const sections: string[] = [buildCapabilityContext(options)]

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
    const aiConfig = await getAISettings('primaryModel')
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
            'You are a prompt enhancer for a note-taking AI Agent.',
            'Rewrite the user request into a clear, actionable prompt that can be sent directly to the Agent.',
            'Do not solve the task. Do not invent requirements. Do not mention unavailable context.',
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
            '- Add concrete context from current note, selected quote, linked files, knowledge base snippets, enabled web search, and Skills when relevant.',
            '- Structure the result with a short objective, context to use, expected output, and constraints only if they help.',
            '- Make the prompt concise enough to edit in the input box.',
            '- Prefer note-app terminology: current note, linked notes, selected quote, knowledge base, Agent tools.',
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
