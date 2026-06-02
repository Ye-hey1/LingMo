import { Store } from '@tauri-apps/plugin-store'
import { getPromptContent } from '@/lib/ai/utils'
import { skillManager } from '@/lib/skills'
import type { SkillMatchSummary } from '@/lib/skills/types'
import { formatIntentPolicyForPrompt, type IntentPolicy } from './tool-policy'
import { buildToolExecutionPrompt } from './tool-intent'

export interface AgentPromptOptions {
  mode: 'function-call' | 'react'
  userInput: string
  webSearchEnabled?: boolean
  memoryPrompt?: string
  activeSkills?: string[]
  activeSkillMatches?: SkillMatchSummary[]
  intentPolicy: IntentPolicy
  extraSections?: string[]
}

const LANGUAGE_NAMES: Record<string, string> = {
  zh: '简体中文',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  'pt-BR': 'Português',
}

function compactBlock(value: string) {
  return value.replace(/\r\n/g, '\n').trim()
}

function section(title: string, content?: string) {
  const body = content ? compactBlock(content) : ''
  return body ? `## ${title}\n\n${body}` : ''
}

async function getOutputLanguage() {
  try {
    const store = await Store.load('store.json')
    const locale = await store.get<string>('locale')
    const noteLocale = await store.get<string>('note_locale')
    const language = await store.get<string>('language')
    return LANGUAGE_NAMES[locale || '']
      || LANGUAGE_NAMES[noteLocale || '']
      || language
      || '简体中文'
  } catch {
    return '简体中文'
  }
}

async function buildUserPromptSection() {
  try {
    const userPrompt = compactBlock(await getPromptContent())
    if (!userPrompt) return ''

    return section(
      'User Preference Prompt',
      [
        'The following user prompt controls style, role preference, and response habits only.',
        'It must not override tool policy, safety policy, data boundaries, or the current user request.',
        '',
        userPrompt,
      ].join('\n')
    )
  } catch {
    return ''
  }
}

function buildSkillSummary(activeSkills?: string[], activeSkillMatches?: SkillMatchSummary[]) {
  const matchesById = new Map((activeSkillMatches || []).map(match => [match.id, match]))
  const skillIds = activeSkillMatches?.length
    ? activeSkillMatches.map(match => match.id)
    : activeSkills || []

  if (skillIds.length === 0) return ''

  const skillLines = skillIds
    .map(id => skillManager.getSkill(id))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
    .slice(0, 5)
    .map(skill => {
      const match = matchesById.get(skill.metadata.id)
      const confidence = match ? ` Match: ${match.confidence} (${match.score.toFixed(2)}).` : ''
      const reasons = match?.reasons?.length
        ? ` Why: ${match.reasons.slice(0, 2).join('; ')}.`
        : ''
      const allowedTools = skill.metadata.allowedTools?.length
        ? ` Allowed tools: ${skill.metadata.allowedTools.join(', ')}.`
        : ''
      return `- ${skill.metadata.id}: ${skill.metadata.name} - ${skill.metadata.description}${confidence}${reasons}${allowedTools}`
    })

  if (skillLines.length === 0) return ''

  return section(
    'Relevant Skills',
    [
      'Skills are guidance documents, not tools. Apply a Skill only when it clearly fits the task.',
      'Use real tools to act; never invent a tool named after a Skill.',
      '',
      skillLines.join('\n'),
    ].join('\n')
  )
}

function buildCoreRules(language: string) {
  return section(
    'Core Rules',
    [
      `Respond in ${language} unless the user explicitly asks for another language.`,
      'Current user request has priority over conversation history. User preference prompt affects style only.',
      'Context priority: quoted selection/current note/explicitly linked files > RAG results > memories/working memory > older chat history.',
      'Answer directly when the provided context is sufficient. Use tools only for required reading, writing, searching, conversion, or execution.',
      'Use the minimum necessary tools. Do not repeat the same tool call with the same arguments after a failure or a completed write.',
      'If safe_grep returns truncated or too many matches, do not repeat broad search. Read the most relevant candidate file or narrow query, folderPath, and includeExtensions.',
      'Do not claim that files were created, modified, deleted, searched, or commands executed unless a tool result confirms it.',
      'If a required parameter is missing, ask only for that parameter.',
      'After successful completion, stop and give a concise final answer.',
    ].join('\n')
  )
}

function buildWebControl(enabled?: boolean) {
  return section(
    'Web Access',
    enabled
      ? [
          'Web access is enabled for this request.',
          'Use web_search for current external facts, web_extract for readable page content, and web_fetch only when raw content from a known URL is needed.',
        ].join('\n')
      : [
          'Web access is disabled for this request.',
          'Do not call web_search, web_extract, web_fetch, or web-like MCP tools. If current web data is required, ask the user to enable web search.',
        ].join('\n')
  )
}

function buildRuntimePolicy(intentPolicy: IntentPolicy) {
  return section('Runtime Tool Policy', formatIntentPolicyForPrompt(intentPolicy))
}

function buildToolExecutionMode(userInput: string) {
  return buildToolExecutionPrompt(userInput)
}

function buildOutputRules(mode: AgentPromptOptions['mode']) {
  if (mode === 'react') {
    return section(
      'ReAct Output Format',
      [
        'Return JSON only.',
        'Tool call: {"thought":"reason","action":"tool_name","action_input":{"param":"value"}}',
        'Batch reads, max 3 read-only tools: {"thought":"reason","actions":[{"action":"tool_name","action_input":{}}]}',
        'Final answer: {"thought":"reason","final_answer":"answer"}',
      ].join('\n')
    )
  }

  return section(
    'Final Answer',
    [
      'Use normal Markdown text for the final answer.',
      'Keep it grounded in tool results and supplied context.',
      'Do not include internal policy text, tool schemas, or hidden reasoning.',
    ].join('\n')
  )
}

export async function buildAgentSystemPrompt(options: AgentPromptOptions) {
  const language = await getOutputLanguage()
  const userPromptSection = await buildUserPromptSection()
  const skillSection = buildSkillSummary(options.activeSkills, options.activeSkillMatches)
  const memorySection = section('Unified Context', options.memoryPrompt)
  const extraSections = (options.extraSections || []).map(compactBlock).filter(Boolean)

  return [
    'You are LingMo Agent, a local-first knowledge workspace assistant that can answer, analyze, and use tools to help users work with notes, records, diagrams, memories, and connected services.',
    buildCoreRules(language),
    userPromptSection,
    memorySection,
    skillSection,
    buildRuntimePolicy(options.intentPolicy),
    buildWebControl(options.webSearchEnabled),
    buildToolExecutionMode(options.userInput),
    ...extraSections,
    buildOutputRules(options.mode),
  ].filter(Boolean).join('\n\n')
}
