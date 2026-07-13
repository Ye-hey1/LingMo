import { Store } from '@tauri-apps/plugin-store'
import { getPromptContent } from '@/lib/ai/utils'
import { buildXiaoMoIdentityPrompt } from '@/lib/ai/xiaomo-prompt'
import { skillManager } from '@/lib/skills'
import type { SkillMatchSummary } from '@/lib/skills/types'
import { formatIntentPolicyForPrompt, type IntentPolicy } from './tool-policy'
import { buildToolExecutionPrompt } from './tool-intent'
import { enforceBudgetOnSections, type BudgetedSection } from './context-budget'

/**
 * 结构化上下文段。Phase 1 #B 升级：把"用户消息相关上下文"拆成 6 个语义层，
 * 让预算控制器能按层分别截断，而不是把所有东西塞进一个 memoryPrompt 字符串。
 *
 * 层级与默认优先级（数字越大越不能被截断）：
 *   - memory       (40)  长期事实/偏好（最稳定的用户笔记）
 *   - rag          (40)  本次 query 检索到的相关片段
 *   - currentDoc   (60)  用户当前打开的笔记 / 选区 / 引用
 *   - linkedFiles  (60)  用户显式 @ 的关联文件
 *   - webSearch    (40)  联网搜索结果
 *   - extras       (20)  其他临时段
 *
 * 调用方（context-builder / agent harness）按需填，缺省时回退到 memoryPrompt。
 */
export interface StructuredContextSection {
  /** 段标识，用于 budget warnings 与 telemetry */
  id: string
  /** 段内容（已序列化的 Markdown 文本） */
  content: string
  /**
   * 优先级覆盖；不传则用层级默认值。
   * 调用方一般不需要传，让默认分级生效即可。
   */
  priority?: number
  /** 截断策略覆盖 */
  truncateStrategy?: 'hard-cut' | 'drop-subsection' | 'drop-whole'
  /** 最低保留 tokens */
  minTokens?: number
}

export interface StructuredContextSections {
  memory?: string
  rag?: string
  currentDoc?: string
  linkedFiles?: string
  webSearch?: string
  /** 其他临时段，按 20 优先级装入 */
  extras?: StructuredContextSection[]
}

export interface AgentPromptOptions {
  userInput: string
  webSearchEnabled?: boolean
  memoryPrompt?: string
  /**
   * Phase 1 #B：结构化上下文段。优先级高于 memoryPrompt；
   * 同时提供时，结构化段覆盖 memoryPrompt。
   */
  contextSections?: StructuredContextSections
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

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
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
      const confidence = match ? ` confidence="${match.confidence}"` : ''
      return [
        '  <skill>',
        `    <id>${escapeXml(skill.metadata.id)}</id>`,
        `    <name>${escapeXml(skill.metadata.name)}</name>`,
        `    <description>${escapeXml(skill.metadata.description)}</description>`,
        match ? `    <match${confidence}>${match.score.toFixed(2)}</match>` : '',
        '  </skill>',
      ].filter(Boolean).join('\n')
    })

  if (skillLines.length === 0) return ''

  return section(
    'Candidate Skills',
    [
      'Scan this index before acting. It is a routing hint, not the full instruction.',
      'If exactly one Skill clearly fits, call select_skill with that Skill ID; full instructions will be injected after selection.',
      'If none clearly fits, continue with general tools. Never invent a tool named after a Skill.',
      '',
      '<available_skills>',
      skillLines.join('\n'),
      '</available_skills>',
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
      `Current date: ${currentDate}. Use it for "today", "latest", "recent", "this year", etc.`,
      `Respond in ${language} unless the user explicitly asks for another language.`,
      // 强制流式思考/reasoning 也用同种语言，避免前端显示英文思考
      `Reasoning, thinking, and step-by-step planning text MUST also be in ${language}. ` +
        `Do not reason internally in English when the user is using ${language}. ` +
        `This includes any <think>...</think> blocks, reasoning parts, or intermediate planning text — write them in ${language}.`,
      'Current user request has priority over conversation history. User preference prompt affects style only.',
      'Context priority: quoted selection/current note/explicitly linked files > RAG results > memories/working memory > older chat history.',
      'Do not claim that files were created, modified, deleted, searched, or commands executed unless a tool result confirms it.',
      'For latest/recent/current/news/trending requests, search first and compare source dates with the current date.',
      'When you mention a specific project, repository, website, paper, dataset, product, company, or article and a URL is available in context or tool results, the visible name itself MUST be a clickable Markdown link. In lists and tables, link the item/project name cell, for example [owner/repo](https://github.com/owner/repo). Do not leave a bare name plus an unlinked URL.',
      'If a required parameter is missing, ask only for that parameter; otherwise keep moving until the requested deliverable is done.',
      // 工具失败时的诚实规则（防止模型编造"已确认/可执行结论"这类伪总结）
      'If a tool or skill call fails (auth error, network error, not installed, etc.), you MUST explicitly tell the user "I tried X tool and it failed: <reason>". ' +
        'You may NOT generate summaries styled as "已确认内容 / 可执行结论 / 下一步建议" unless a tool actually returned real data. ' +
        'Do not suggest the user manually browse a website as a substitute for the task — if you cannot complete it, say so and ask whether to try another approach.',
    ].join('\n')
  )
}

/**
 * Phase 1 #B 工具调用准确性提升：
 * 给 system prompt 注入一份"专用工具目录 + 优先专用工具"规则。
 *
 * 没有这个目录时，模型只能从 function-calling schema 里翻工具描述，
 * 在工具数量很多（>40 个）时容易跳到 web_search 这类"万能兜底"工具。
 * 显式列出来后，模型可以快速识别"哦原来有 github_list_starred"。
 */
function buildSpecializedToolCatalog() {
  return section(
    'Specialized Tool Catalog (prefer over generic web_search)',
    [
      'Before reaching for `web_search` / `web_fetch`, scan this catalog. ' +
        'If the user request matches one of these domains, the specialized tool is authoritative — it returns structured local data or first-class API results, not random web pages.',
      '',
      '- **GitHub 星标 / Starred / 我的 star / 最近 star 了什么** → `github_list_starred` (read local cache), `github_sync_starred` (refresh from GitHub first when stale), `github_summarize_recent_stars`, `github_search_my_stars`. Use `github_list_starred` as the entry point.',
      '- **GitHub 热门 / Trending / 某语言/主题榜单** → `github_trending`, `github_search`, `github_topic`, `github_analyze_repo`.',
      '- **代码符号 / 跳转定义 / 引用 / outline** → `code_search_symbols`, `code_file_outline`, `code_find_definition`, `code_find_references`, `code_read_context`.',
      '- **Git 操作 / commit / branch / diff / blame** → `git_status`, `git_diff`, `git_log`, `git_show`, `git_blame`.',
      '- **闪卡 / 复习 / spaced repetition** → `generate_flashcards`, `get_study_insights`.',
      '- **知识库 / GraphRAG / 笔记关系 / 证据 / 历史工作 / 相关资料综合查询** → `query_knowledge` first. It orchestrates object search, current-note context, evidence blocks, and structured graph summaries.',
      '- **统一知识对象 / 知识库概览 / 跨 notes、marks、AI 热点、记忆、agent runs 检索** → after `query_knowledge`, use `search_knowledge_objects`, `get_knowledge_object_overview` for narrower object-only follow-up. Prefer this before broad `safe_grep` or ad hoc file scans.',
      '- **知识库健康 / 索引诊断 / 缓存状态 / 队列积压 / 检索变慢或不完整** → `get_knowledge_system_health` first to identify whether the issue is stale registry rows, vector cache state, or semantic extraction backlog.',
      '- **知识库陈旧 / 同步后重建 / 文件整理后刷新 / 索引不同步** → `get_knowledge_system_health` first, then `reindex_knowledge_objects` only when the diagnosis shows stale/orphan/missing-vector index issues.',
      '- **当前笔记上下文 / 相关笔记 / backlinks / 语义关系 / 链接建议** → `query_knowledge` first; use `get_current_note_context`, then `get_connected_notes`, `get_note_backlinks`, `suggest_links_for_note` when deeper graph detail is needed. If `query_knowledge` reports warnings, low evidence, or skipped branches, state the uncertainty in the final answer.',
      '- **笔记整理 / 打标签 / 找未分类笔记** → `tag_files`, `set_note_status`, `find_unindexed_notes`, `bulk_ensure_frontmatter`, `list_tags`, `search_tags`.',
      '- **历史自省 / 最近失败的 run / 上次怎么做的** → `query_agent_runs`, `query_self_failures`, `get_agent_run_detail`, `list_agent_run_summaries`.',
      '- **高亮 / mark / 标注** → `read_marks`, `search_marks`, `search_all_marks`, `create_mark`.',
      '- **活动统计 / 最近做了什么** → `get_user_activity`.',
      '- **图表 / draw.io / 流程图 / 架构图 / 思维导图** → `create_diagram_from_outline` for outlines, `create_drawio_diagram_from_cells` for custom draw.io XML, `read_diagram_file` + `edit_drawio_diagram` for targeted updates, `validate_drawio_diagram` after complex draw.io generation/edits, `export_drawio_diagram` when a rendered SVG/PNG preview is requested, `get_drawio_shape_library` before cloud/Kubernetes/icon diagrams.',
      '- **创意画布 / 无限画布 / 生图 / 文生图 / 图生图 / 参考图工作流** → `creative_canvas_get_state` first, `creative_canvas_get_selection` when selection matters, `creative_canvas_create_generation_flow` or `creative_canvas_generate_image` for image flows, `creative_canvas_run_generation` / `creative_canvas_retry_generation` for execution, `creative_canvas_insert_asset_into_note` to place generated images into notes. For maintenance use `creative_canvas_recover_jobs`, `creative_canvas_analyze_asset_cleanup`, `creative_canvas_cleanup_assets`; for migration use `creative_canvas_import_infinite_canvas_json`. Upstream-style `canvas_*` aliases map to the same LingMo-native tools.',
      '',
      'Rule: when the user mentions any of the above intents (in any language, incl. Chinese 星标/热门/代码符号/闪卡/标签), you MUST try the specialized tool first. ' +
        'Only fall back to `web_search` if the specialized tool returns empty results AND the user clearly wants external public data (e.g. "搜一下网上怎么说 X").',
      'Never use `web_search` as a substitute for `github_list_starred` when the user asks about their own stars — that data is local and authoritative.',
    ].join('\n')
  )
}

function buildDrawioGenerationPolicy() {
  return section(
    'Draw.io Diagram Generation Policy',
    [
      'When creating or editing draw.io diagrams, treat the current XML in `read_diagram_file` or quoted diagram context as the source of truth.',
      '',
      'Creation route:',
      '- Use `create_diagram_from_outline` for simple mind maps or flowcharts from outlines.',
      '- Use `create_drawio_diagram_from_cells` when the user needs a richer custom draw.io diagram, cloud architecture diagram, or precise layout.',
      '- For `create_drawio_diagram_from_cells`, generate ONLY sibling `<mxCell>` elements. Do not include `<mxfile>`, `<mxGraphModel>`, `<root>`, XML comments, or root cells `id="0"` / `id="1"`; LingMo wraps them automatically.',
      '- Use unique, stable IDs starting from meaningful names or `cell-2`; set `parent="1"` for top-level shapes.',
      '',
      'Editing route:',
      '- Before modifying an existing draw.io file, use `read_diagram_file` unless the full current XML is already in context.',
      '- Prefer `edit_drawio_diagram` for small changes: add/update/delete by `cell_id` with a complete replacement `<mxCell>` in `new_xml`.',
      '- Use `update_diagram_file` only for full regeneration or major restructuring.',
      '',
      'Icon/library route:',
      '- Before using AWS, Azure, GCP, Kubernetes, Material Design, or other icon syntax, call `get_drawio_shape_library` for the target library.',
      '- Never guess cloud icon syntax from memory; use the library guidance returned by the tool.',
      '',
      'Layout rules:',
      '- Plan node positions before generating XML. Keep elements readable, non-overlapping, and within a compact viewport.',
      '- For edges, set explicit `exitX`, `exitY`, `entryX`, `entryY` where possible, and add `<Array as="points">` waypoints to route around obstacles.',
      '- After creating or editing a non-trivial draw.io diagram, call `validate_drawio_diagram`. Fix structural issues such as duplicate IDs, missing geometry, broken edge endpoints, or severe overlaps before final response.',
      '- When the user asks for preview, image, SVG, PNG, export, or rendered output, call `export_drawio_diagram` after validation succeeds. Prefer SVG for crisp diagrams unless the user asks for PNG.',
      '- `export_drawio_diagram` requires the target file to be open in the draw.io editor iframe. Newly created diagrams open by default; for an existing closed diagram, validate/save it and explain that export needs the diagram opened instead of retrying the same export call.',
      '- Do not return raw draw.io XML in the chat answer; send XML only through diagram tools.',
    ].join('\n')
  )
}

function buildStaticIdentity(language: string) {
  return buildXiaoMoIdentityPrompt(language)
}

function buildStaticRuntimeDiscipline() {
  return section(
    'Agent Decision Loop',
    [
      '1. Classify the turn: direct answer, context lookup, current web fact, write/edit, destructive action, command execution, or missing parameter.',
      '2. Answer directly when context is sufficient; otherwise gather the smallest evidence needed.',
      '3. For multi-step work, perform one distinct action after each observation and use the result to choose the next action.',
      '4. Do not repeat a tool with identical arguments. On failure, change approach or explain the blocker.',
      '5. For requested artifacts, files, notes, plans, or edits, a progress sentence is not completion; create/update the deliverable first — but ONLY when the user explicitly requested a file/note (see "Note Saving Policy" below).',
      '6. When done, stop and give a concise Markdown answer with results and material caveats only.',
    ].join('\n')
  )
}

/**
 * 笔记保存策略（用户明确偏好）：
 * 默认禁止 agent 自主把内容整理/保存为笔记文件。
 * 这避免了工作区被自动生成的 .md 污染，把文件创建权完全交给用户。
 */
function buildNoteSavingPolicy() {
  return section(
    'Note Saving Policy',
    [
      'Do NOT autonomously create, write, or save .md note files unless the user explicitly asks you to.',
      'Examples of explicit triggers that ALLOW saving: "save this", "存成笔记", "整理成笔记保存", "写到一个文件里", "导出为 markdown", "create a note", "write to a file".',
      'Examples of NON-triggers (do NOT save on these): "总结一下", "整理一下", "列出要点", "帮我看看", "分析", "调研", generic research/summary requests where the user did not ask for a file.',
      'When the user asks for research, summaries, analyses, plans, or outlines but did NOT ask for a file, give the full content inline in the chat answer instead of calling create_file / update_markdown_file / replace_editor_content / insert_at_cursor.',
      'If unsure, ASK the user "需要保存成笔记吗？" before calling any write tool — do not assume.',
      'This policy applies to ALL note/document types: research notes, GitHub trending digests, meeting notes, plans, etc.',
    ].join('\n')
  )
}

function buildWebControl(enabled?: boolean) {
  return section(
    'Web Access',
    enabled
      ? [
          'Web access is enabled for this request.',
          'Use web_search for current external facts, web_extract for readable pages, and web_fetch only for raw content from a known URL.',
          'For latest/recent/current/news/trending, use a date window and treat old or undated results as insufficient for strict latest claims.',
          'Every source mention should be a clickable Markdown link like [Source Title](https://example.com).',
          'For concrete projects, repositories, websites, papers, datasets, products, companies, and articles, link the visible name itself whenever the URL is known, including inside tables.',
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
      'Independent read-only lookups may be batched up to 3 tool calls in one model step.',
      'Writes, deletes, execution, and uncertain operations require exactly one tool call followed by observation.',
      'Only when the user explicitly asked to save/write into a note/file, completion requires a successful write/create/edit tool result before the final Markdown answer. For research/summary/analysis requests without an explicit save instruction, keep the answer inline in chat (see Note Saving Policy).',
      'When complete, answer in Markdown with only user-visible results and important verification caveats.',
    ].join('\n')
  )
}

export async function buildAgentSystemPrompt(options: AgentPromptOptions) {
  const language = await getOutputLanguage()
  const userPromptSection = await buildUserPromptSection()
  const forcedSkillSection = buildForcedSkillSection(options.forcedSkillIds)
  const skillSection = buildSkillSummary(options.activeSkills, options.activeSkillMatches, options.forcedSkillIds)

  // Phase 1 #B：优先使用结构化上下文段；否则回退到 memoryPrompt
  const ctx = options.contextSections
  const memoryContent = ctx?.memory ?? options.memoryPrompt ?? ''
  const ragContent = ctx?.rag ?? ''
  const currentDocContent = ctx?.currentDoc ?? ''
  const linkedFilesContent = ctx?.linkedFiles ?? ''
  const webSearchContent = ctx?.webSearch ?? ''

  const memorySection = section('Unified Context', memoryContent)
  const ragSection = section('Retrieved Context (RAG)', ragContent)
  const currentDocSection = section('Current Document', currentDocContent)
  const linkedFilesSection = section('Linked Files', linkedFilesContent)
  const webSearchSection = section('Web Search Results', webSearchContent)

  const extraSections = (options.extraSections || []).map(compactBlock).filter(Boolean)
  const ctxExtras = (ctx?.extras || [])

  // Phase 1 #C 自进化闭环：自动注入"最近失败提醒"
  // 让 agent 在做高风险动作前看到最近 7 天的失败 run，避免重复踩坑
  const recentFailuresSection = await buildRecentFailuresSection()

  // Phase 0 #5：按优先级装配段落，超预算时按策略截断
  // 优先级参考 context-budget.ts 设计文档
  const budgetedSections: BudgetedSection[] = [
    // 100 — 必保留：Identity
    {
      id: 'identity',
      content: buildStaticIdentity(language),
      priority: 100,
      truncateStrategy: 'drop-subsection',
      minTokens: 200,
    },
    // 100 — 必保留：Core Rules（含日期/反伪总结规则）
    {
      id: 'core-rules',
      content: buildCoreRules(language),
      priority: 100,
      truncateStrategy: 'drop-subsection',
      minTokens: 120,
    },
    // 100 — 必保留：Runtime Discipline
    {
      id: 'runtime-discipline',
      content: buildStaticRuntimeDiscipline(),
      priority: 100,
      truncateStrategy: 'drop-subsection',
      minTokens: 80,
    },
    // 100 — 必保留：Note Saving Policy（用户明确偏好，禁止自主保存）
    {
      id: 'note-saving-policy',
      content: buildNoteSavingPolicy(),
      priority: 100,
      truncateStrategy: 'drop-subsection',
      minTokens: 80,
    },
    // 80 — Anti-Patterns
    {
      id: 'anti-patterns',
      content: [
        '## Anti-Patterns (MUST follow)',
        '- Do NOT call the same tool with the same arguments more than once.',
        '- Do NOT claim files were created/modified/deleted unless a tool result confirms it.',
        '- Do NOT fabricate file paths — only use paths returned by tools (list_files, search, safe_grep, etc.).',
        '- If a tool fails, analyze the error before retrying. Do NOT retry with the exact same arguments.',
        '- If you have enough information to answer, give the Final Answer immediately. Do NOT call unnecessary tools.',
        '- When safe_grep returns truncated results, read the specific files instead of broadening the search.',
      ].join('\n'),
      priority: 80,
      truncateStrategy: 'drop-whole',
    },
    // 80 — Output Rules
    {
      id: 'output-rules',
      content: buildOutputRules(),
      priority: 80,
      truncateStrategy: 'drop-whole',
    },
    // 80 — Forced Skill（用户显式 /skill 调用）
    {
      id: 'forced-skill',
      content: forcedSkillSection,
      priority: 80,
      truncateStrategy: 'drop-subsection',
      minTokens: 100,
    },
    // 60 — Runtime Policy
    {
      id: 'runtime-policy',
      content: buildRuntimePolicy(options.intentPolicy),
      priority: 60,
      truncateStrategy: 'drop-whole',
    },
    // 60 — Tool Execution Mode
    {
      id: 'tool-execution-mode',
      content: buildToolExecutionMode(options.userInput),
      priority: 60,
      truncateStrategy: 'drop-whole',
    },
    // 60 — Skill Summary
    {
      id: 'skill-summary',
      content: skillSection,
      priority: 60,
      truncateStrategy: 'drop-whole',
    },
    // 60 — Web Control
    {
      id: 'web-control',
      content: buildWebControl(options.webSearchEnabled),
      priority: 60,
      truncateStrategy: 'drop-whole',
    },
    // 60 — Recent Failures（自进化提醒，比 RAG 优先级高，让 agent 务必看到）
    {
      id: 'recent-failures',
      content: recentFailuresSection,
      priority: 60,
      truncateStrategy: 'drop-whole',
    },
    // 80 — Specialized Tool Catalog（专用工具优先于 web_search 的关键规则）
    {
      id: 'specialized-tool-catalog',
      content: buildSpecializedToolCatalog(),
      priority: 80,
      truncateStrategy: 'drop-subsection',
      minTokens: 200,
    },
    {
      id: 'drawio-generation-policy',
      content: buildDrawioGenerationPolicy(),
      priority: 80,
      truncateStrategy: 'drop-subsection',
      minTokens: 200,
    },
    // 60 — Current Document（用户打开的笔记 / 选区 / 引用）
    {
      id: 'current-doc',
      content: currentDocSection,
      priority: 60,
      truncateStrategy: 'drop-subsection',
      minTokens: 80,
    },
    // 60 — Linked Files（用户显式 @ 关联）
    {
      id: 'linked-files',
      content: linkedFilesSection,
      priority: 60,
      truncateStrategy: 'drop-subsection',
      minTokens: 60,
    },
    // 40 — Memory / Unified Context（长期事实/偏好）
    {
      id: 'memory',
      content: memorySection,
      priority: 40,
      truncateStrategy: 'drop-subsection',
      minTokens: 80,
    },
    // 40 — RAG 检索片段
    {
      id: 'rag',
      content: ragSection,
      priority: 40,
      truncateStrategy: 'drop-subsection',
      minTokens: 60,
    },
    // 40 — Web Search（联网搜索结果）
    {
      id: 'web-search',
      content: webSearchSection,
      priority: 40,
      truncateStrategy: 'drop-subsection',
      minTokens: 60,
    },
    // 20 — User Preference Prompt
    {
      id: 'user-prompt',
      content: userPromptSection,
      priority: 20,
      truncateStrategy: 'drop-whole',
    },
    // 20 — Extras（来自 options.extraSections 的传统调用）
    ...extraSections.map((content, idx) => ({
      id: `extra-${idx}`,
      content,
      priority: 20 as const,
      truncateStrategy: 'drop-whole' as const,
    })),
    // 20 — Context Extras（来自 contextSections.extras 的结构化临时段）
    ...ctxExtras.map((extra, idx) => ({
      id: extra.id || `ctx-extra-${idx}`,
      content: compactBlock(extra.content || ''),
      priority: (extra.priority ?? 20) as number,
      truncateStrategy: (extra.truncateStrategy ?? 'drop-whole') as 'hard-cut' | 'drop-subsection' | 'drop-whole',
      minTokens: extra.minTokens,
    })),
  ]

  const budgetResult = enforceBudgetOnSections(budgetedSections, {
    totalBudget: 16000,
    warnOnOverflow: true,
  })

  // 在静态段与动态段之间插入边界标记（保留原有协议）
  const staticIds = new Set(['identity', 'runtime-discipline'])
  const idOrder = budgetedSections.map(s => s.id)
  const staticParts: string[] = []
  const dynamicParts: string[] = []
  for (const id of idOrder) {
    const text = budgetResult.keptTextById[id]
    if (!text) continue
    if (staticIds.has(id)) staticParts.push(text)
    else dynamicParts.push(text)
  }

  const parts: string[] = []
  if (staticParts.length > 0) parts.push(staticParts.join('\n\n'))
  parts.push(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  if (dynamicParts.length > 0) parts.push(dynamicParts.join('\n\n'))

  return parts.filter(Boolean).join('\n\n')
}

/**
 * Phase 1 #C 自进化闭环：构建"最近失败提醒"段。
 *
 * 从 KnowledgeObject 注册表查 tag='failed-run' 且近 7 天的记录，取 top 3。
 * 失败原因从 agent_runs 原表的 error 字段提取。
 *
 * 设计：
 *   - 静默失败：所有异常都 try/catch，绝不让自进化逻辑破坏主 prompt 构建
 *   - 短小：每条只保留 200 字符的 goal + 100 字符的 error
 *   - 不依赖任何外部状态：纯查询 + 字符串拼接
 */
async function buildRecentFailuresSection(): Promise<string> {
  try {
    const { objectRegistry } = await import('@/lib/knowledge/object-registry')
    const { getAgentRunFromDb } = await import('@/db/agent')

    const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000
    const failures = await objectRegistry.query({
      sourceType: 'agent_run',
      tag: 'failed-run',
      updatedSince: sinceMs,
      limit: 3,
      orderBy: 'updatedAt',
      orderDir: 'desc',
    })

    if (failures.length === 0) return ''

    const lines: string[] = [
      '## Recent Failures (avoid repeating)',
      '',
      'These are the most recent failed agent runs. Read them before retrying similar actions.',
      'If the current request resembles any of them, change approach or surface the blocker explicitly.',
      '',
    ]

    for (const ko of failures) {
      let goal = ko.title || '(no goal)'
      let errorHint = ''
      try {
        const record = await getAgentRunFromDb(ko.sourceId)
        if (record) {
          if (record.userGoal) goal = record.userGoal
          errorHint = (record.error || record.finalAnswer || '').trim()
        }
      } catch {
        // 用 KO 自带的 title 作为 fallback
      }

      const goalTrimmed = goal.length > 200 ? `${goal.slice(0, 200)}...` : goal
      const errorTrimmed = errorHint.length > 100 ? `${errorHint.slice(0, 100)}...` : errorHint
      const route = ko.metadata ? safeJsonParse(ko.metadata).route : ''
      lines.push(`- Goal: ${goalTrimmed}${route ? ` (route: ${route})` : ''}`)
      if (errorTrimmed) {
        lines.push(`  Error: ${errorTrimmed}`)
      }
    }

    return lines.join('\n')
  } catch {
    // 自进化是 nice-to-have，绝不破坏主流程
    return ''
  }
}

function safeJsonParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
