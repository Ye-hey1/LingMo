import { Store } from '@tauri-apps/plugin-store'
import { getPromptContent } from '@/lib/ai/utils'
import { buildXiaoMoIdentityPrompt } from '@/lib/ai/xiaomo-prompt'
import { skillManager } from '@/lib/skills'
import type { SkillMatchSummary } from '@/lib/skills/types'
import { formatIntentPolicyForPrompt, type IntentPolicy } from './tool-policy'
import { buildToolExecutionPrompt } from './tool-intent'

export interface AgentPromptOptions {
  userInput: string
  webSearchEnabled?: boolean
  memoryPrompt?: string
  activeSkills?: string[]
  activeSkillMatches?: SkillMatchSummary[]
  forcedSkillIds?: string[]
  intentPolicy: IntentPolicy
  extraSections?: string[]
}

export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '__LINGMO_SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'

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

function normalizeSkillIds(skillIds?: string[]) {
  return Array.from(new Set((skillIds || []).map(id => id.trim()).filter(Boolean)))
}

function buildFullSkillBlock(skill: NonNullable<ReturnType<typeof skillManager.getSkill>>) {
  const lines: string[] = []
  const fileInfo = skillManager.getSkillFileInfo(skill.metadata.id)

  lines.push(`### ${skill.metadata.name}`)
  lines.push('')
  lines.push(`- ID: ${skill.metadata.id}`)
  lines.push(`- Description: ${skill.metadata.description}`)
  if (fileInfo) {
    lines.push(`- Base directory for this skill: ${fileInfo.directory} (${skill.metadata.scope === 'global' ? 'AppData' : 'workspace'})`)
  }
  if (skill.metadata.version) {
    lines.push(`- Version: ${skill.metadata.version}`)
  }
  if (skill.metadata.author) {
    lines.push(`- Author: ${skill.metadata.author}`)
  }
  if (skill.metadata.allowedTools?.length) {
    lines.push(`- Authorized tools: ${skill.metadata.allowedTools.join(', ')}`)
  }

  if (skill.scripts?.length) {
    lines.push('')
    lines.push('Available scripts:')
    for (const script of skill.scripts) {
      lines.push(`- ${script.path} (${script.type})`)
    }
  }

  if (skill.references?.length) {
    lines.push('')
    lines.push('Available references:')
    for (const reference of skill.references) {
      lines.push(`- ${reference.path}`)
    }
  }

  if (skill.assets?.length) {
    lines.push('')
    lines.push('Available assets:')
    for (const asset of skill.assets) {
      lines.push(`- ${asset.path} (${asset.type})`)
    }
  }

  lines.push('')
  lines.push('Instructions:')
  lines.push(skill.instructions)

  return lines.join('\n')
}

function buildForcedSkillSection(forcedSkillIds?: string[]) {
  const skillIds = normalizeSkillIds(forcedSkillIds)
  if (skillIds.length === 0) return ''

  const skillBlocks = skillIds
    .map(id => skillManager.findSkill(id))
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill))
    .map(buildFullSkillBlock)

  if (skillBlocks.length === 0) return ''

  return section(
    'Slash-Invoked Skills',
    [
      'The user explicitly invoked these Skills with a slash command.',
      'Apply these complete Skill instructions before generic behavior, user preference prompt, or automatic skill matching.',
      'Treat the text after the slash command as the concrete user request for this Skill.',
      'If extra reference content is needed, prefer the load_skill_content tool with the Skill ID. Skill reference paths shown below are AppData skill resources, not normal workspace notes.',
      'If a Skill mentions Claude, MCP, or another host environment, map the method to LingMo tools that are actually available instead of calling non-existent tools.',
      '',
      skillBlocks.join('\n\n---\n\n'),
    ].join('\n')
  )
}

function buildSkillSummary(activeSkills?: string[], activeSkillMatches?: SkillMatchSummary[], excludedSkillIds?: string[]) {
  const matchesById = new Map((activeSkillMatches || []).map(match => [match.id, match]))
  const excluded = new Set(normalizeSkillIds(excludedSkillIds))
  const skillIds = activeSkillMatches?.length
    ? activeSkillMatches.map(match => match.id)
    : activeSkills || []

  if (skillIds.length === 0) return ''

  const skillLines = skillIds
    .filter(id => !excluded.has(id))
    .map(id => skillManager.findSkill(id))
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
  // 注入当前日期，确保模型知道当前时间（借鉴 claude-code-source 的 userContext 模式）
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const weekDay = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const currentDate = `${year}-${month}-${day} (周${weekDay}) ${hours}:${minutes}`

  return section(
    'Dynamic Runtime Context',
    [
      `**Current date: ${currentDate}**. Always use this as the reference for "today", "latest", "recent", "this year", etc.`,
      `Respond in ${language} unless the user explicitly asks for another language.`,
      'Current user request has priority over conversation history. User preference prompt affects style only.',
      'Context priority: quoted selection/current note/explicitly linked files > RAG results > memories/working memory > older chat history.',
      'Answer directly when the provided context is sufficient. Use tools only for required reading, writing, searching, conversion, or execution.',
      'Use the minimum necessary tools. Do not repeat the same tool call with the same arguments after a failure or a completed write.',
      'If safe_grep returns truncated or too many matches, do not repeat broad search. Read the most relevant candidate file or narrow query, folderPath, and includeExtensions.',
      'Do not claim that files were created, modified, deleted, searched, or commands executed unless a tool result confirms it.',
      'For planning, drafting, itinerary, note, document, or file-output tasks, do not stop after an acknowledgement or "I will do it" progress sentence. Complete the requested deliverable or use the required write tool first.',
      'If a required parameter is missing, ask only for that parameter.',
      'After successful completion, stop and give a concise final answer.',
      'When asked about "latest", "recent", "current", "trending" topics that require up-to-date information, ALWAYS use web_search first. Do NOT rely on training data alone for time-sensitive questions.',
      'For latest/recent/current answers, verify source publication dates against the current date. If web_search returns only older or undated results, say the search did not find enough recent dated evidence instead of presenting old data as latest.',
    ].join('\n')
  )
}

function buildStaticIdentity(language: string) {
  return buildXiaoMoIdentityPrompt(language)
}

function buildStaticRuntimeDiscipline() {
  return section(
    'Agent Runtime Discipline',
    [
      'Run one clear turn step at a time: model response -> optional tool call -> observation -> next model response or final answer.',
      'Treat each tool result as the evidence for the next step. Do not ignore a failed or policy-blocked observation.',
      'After a successful tool result, either take a distinct next action that uses that result, or produce the final answer.',
      'Do not repeat the same action with the same arguments. If retrying is necessary, change the arguments based on the error.',
      'Keep tool arguments minimal and exact. Prefer reading targeted files or narrowed searches over broad repeated scans.',
      'A progress update is not a final answer. If your last text only says you are starting, planning, checking, or will output later, continue the loop.',
      'When the task is done, stop and answer normally in user-visible Markdown. Do not call another tool just to look busy.',
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
          'When the request is latest/recent/current/news/trending, call web_search with a days/startDate/endDate window and prefer topic=news. Treat results marked outside-window or date-unverified as insufficient for strict latest claims unless corroborated by another dated source.',
          'For hot/latest information summaries, every source mention must be a clickable Markdown link like [Source Title](https://example.com). Do not output plain source names without links when a URL is available.',
          'Summaries should read like a sharp human briefing: what happened, why it matters, what to watch next. Avoid academic section titles unless the user asks for a formal report.',
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

function buildOutputRules() {
  return section(
    'Harness Output Format',
    [
      'Use the model tool-calling protocol whenever a tool is needed.',
      'Do not emit ReAct JSON, Action/Observation text, or final_answer wrappers.',
      'For independent read-only lookups, you may request up to 3 tool calls in one model step.',
      'For writes, deletes, execution, or any uncertain operation, request exactly one tool call and wait for the observation.',
      'If the user asks to output/save/write into a note, document, or file, completion requires a successful write/create/edit tool result before the final Markdown answer.',
      'When complete, answer directly in Markdown with only user-visible results and any important verification caveats.',
    ].join('\n')
  )
}

export async function buildAgentSystemPrompt(options: AgentPromptOptions) {
  const language = await getOutputLanguage()
  const userPromptSection = await buildUserPromptSection()
  const forcedSkillSection = buildForcedSkillSection(options.forcedSkillIds)
  const skillSection = buildSkillSummary(options.activeSkills, options.activeSkillMatches, options.forcedSkillIds)
  const memorySection = section('Unified Context', options.memoryPrompt)
  const extraSections = (options.extraSections || []).map(compactBlock).filter(Boolean)
  const staticSections = [
    buildStaticIdentity(language),
    buildStaticRuntimeDiscipline(),
  ]

  const dynamicSections = [
    buildCoreRules(language),
    userPromptSection,
    memorySection,
    forcedSkillSection,
    skillSection,
    buildRuntimePolicy(options.intentPolicy),
    buildWebControl(options.webSearchEnabled),
    buildToolExecutionMode(options.userInput),
    ...extraSections,
  ]

  return [
    ...staticSections,
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    ...dynamicSections,
    '## Anti-Patterns (MUST follow)',
    '- Do NOT call the same tool with the same arguments more than once.',
    '- Do NOT claim files were created/modified/deleted unless a tool result confirms it.',
    '- Do NOT fabricate file paths — only use paths returned by tools (list_files, search, safe_grep, etc.).',
    '- If a tool fails, analyze the error before retrying. Do NOT retry with the exact same arguments.',
    '- If you have enough information to answer, give the Final Answer immediately. Do NOT call unnecessary tools.',
    '- When safe_grep returns truncated results, read the specific files instead of broadening the search.',
    '',
    buildOutputRules(),
  ].filter(Boolean).join('\n\n')
}
