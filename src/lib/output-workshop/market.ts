/**
 * LingMo 智能排版动态模板市场与本地自定义模板管理器
 * 支持从 GitHub 免 Git 动态下载安装设计技能包，并支持本地自建 SKILL.md 自定义排版规范
 */

import { exists, mkdir, writeTextFile, readTextFile, readDir } from "@tauri-apps/plugin-fs"
import { appDataDir, join } from "@tauri-apps/api/path"
import { type OutputMode, type OutputScenario, type OutputTemplate } from "./templates"
import type { DesignProfileId } from "./design-profiles"
import type { ExportBlueprint, SmartCardPagingMode } from "./smart-card-export"

// ---------------------------------------------------------------------------
// 1. 类型定义
// ---------------------------------------------------------------------------

export type GitHubPackageSpec = {
  owner: string
  repo: string
  ref: string
}

export type MarketInstallResult = {
  packageName: string
  skillsCount: number
  installedTemplateIds: string[]
}

interface OpenDesignManifestLite {
  name?: string
  title?: string
  title_i18n?: Record<string, string>
  description?: string
  description_i18n?: Record<string, string>
  icon?: string
  tags?: string[]
  od?: {
    mode?: string
    scenario?: string
    platform?: string
    preview?: {
      type?: string
      motion?: string
    }
    inputs?: Array<{
      name?: string
      label?: string
      type?: string
      required?: boolean
    }>
    pipeline?: {
      stages?: Array<{
        id?: string
        atoms?: string[]
      }>
    }
    useCase?: {
      query?: string | Record<string, string>
    }
  }
}

// 技能包安装与自定义根目录：AppData/article/skills/
const SKILLS_RELATIVE_PATH = "skills"

// ---------------------------------------------------------------------------
// 2. 本地自定义与动态 Skill 路径辅助
// ---------------------------------------------------------------------------

/**
 * 获取本地 AppData 中 skills/ 的绝对路径
 */
export async function getSkillsDir(): Promise<string> {
  const appData = await appDataDir()
  return await join(appData, "article", SKILLS_RELATIVE_PATH)
}

/**
 * 确保技能根目录及其子目录（installed 和 custom）存在
 */
async function ensureSkillsDirsExist(): Promise<{ installedDir: string; customDir: string }> {
  const root = await getSkillsDir()
  const installedDir = await join(root, "installed")
  const customDir = await join(root, "custom")

  if (!(await exists(root))) {
    await mkdir(root, { recursive: true })
  }
  if (!(await exists(installedDir))) {
    await mkdir(installedDir)
  }
  if (!(await exists(customDir))) {
    await mkdir(customDir)
  }

  return { installedDir, customDir }
}

// ---------------------------------------------------------------------------
// 3. GitHub 免 Git 极速模板下载安装服务
// ---------------------------------------------------------------------------

/**
 * 解析 GitHub 仓库名称（如 owner/repo 或完整 Github URL 链接）
 */
export function parseGitHubRepo(spec: string): GitHubPackageSpec | null {
  const trimmed = spec.trim()
  if (!trimmed) return null

  // URL 形式: https://github.com/owner/repo/tree/branch 或 https://github.com/owner/repo
  const urlMatch = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)(?:\/tree\/([^\s#?]+))?/i.exec(trimmed)
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2].replace(/\.git$/, ""),
      ref: urlMatch[3] || "main",
    }
  }

  // 缩写形式: owner/repo#branch 或 owner/repo
  const shortMatch = /^([^/\s#]+)\/([^/\s#]+?)(?:#(.+))?$/i.exec(trimmed)
  if (shortMatch) {
    const [, owner, repo, ref] = shortMatch
    return {
      owner,
      repo,
      ref: ref || "main",
    }
  }

  return null
}

/**
 * 从 GitHub 获取默认分支名 (如果传入的 ref 无法连通)
 */
async function fetchDefaultBranch(owner: string, repo: string): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`)
    if (res.ok) {
      const data = await res.json()
      return data.default_branch || "main"
    }
  } catch (e) {
    console.warn("读取 GitHub 默认分支失败，使用 main:", e)
  }
  return "main"
}

/**
 * 免 Git 依赖，直接通过 GitHub Content API 极速获取并保存模板文件
 * 支持多模板包 (skills/id/SKILL.md) 或单模板包 (根目录存在 SKILL.md)
 */
export async function installSkillsFromGitHub(
  repoSpec: string,
  onProgress?: (msg: string) => void
): Promise<MarketInstallResult> {
  const spec = parseGitHubRepo(repoSpec)
  if (!spec) {
    throw new Error("无效的 GitHub 仓库格式，应为 owner/repo 或完整的 github url")
  }

  const { owner, repo } = spec
  let ref = spec.ref
  if (ref === "main") {
    onProgress?.("正在获取仓库分支数据...")
    ref = await fetchDefaultBranch(owner, repo)
  }

  const packageId = `${owner}__${repo}`
  const { installedDir } = await ensureSkillsDirsExist()
  const packageDir = await join(installedDir, packageId)

  // 1. 获取仓库下的 skills/ 目录内容以查找模板包
  onProgress?.("正在检索在线设计模板包...")
  let apiRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/skills?ref=${ref}`)
  let isMultiPack = true

  // 如果没有 skills 目录，尝试直接获取根目录（单模板仓库）
  if (apiRes.status === 404) {
    isMultiPack = false
    apiRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/?ref=${ref}`)
  }

  if (!apiRes.ok) {
    throw new Error(`GitHub 仓库链接失败 (${apiRes.status})。请确认仓库名及分支是否正确，或仓库是否为私有。`)
  }

  const contents = await apiRes.json()
  if (!Array.isArray(contents)) {
    throw new Error("仓库结构解析错误，未返回有效的文件列表")
  }

  const discoveredSkills: Array<{ name: string; downloadUrl: string; baseDirUrl: string }> = []

  if (isMultiPack) {
    // 它是多模板包：每个 skills/ 下的文件夹是一个模板
    for (const item of contents) {
      if (item.type === "dir") {
        const skillName = item.name
        // 向 skills/name 文件夹请求获取 SKILL.md
        onProgress?.(`检索到模板: ${skillName}...`)
        const detailRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/skills/${skillName}?ref=${ref}`)
        if (detailRes.ok) {
          const detailItems = await detailRes.json()
          if (Array.isArray(detailItems)) {
            const skillMd = detailItems.find((f) => f.name.toLowerCase() === "skill.md")
            if (skillMd && skillMd.download_url) {
              discoveredSkills.push({
                name: skillName,
                downloadUrl: skillMd.download_url,
                baseDirUrl: `https://api.github.com/repos/${owner}/${repo}/contents/skills/${skillName}?ref=${ref}`,
              })
            }
          }
        }
      }
    }
  } else {
    // 单模板包：直接在根目录寻找 SKILL.md
    const skillMd = contents.find((f) => f.name.toLowerCase() === "skill.md")
    if (skillMd && skillMd.download_url) {
      discoveredSkills.push({
        name: repo, // 用仓库名作为模板 ID
        downloadUrl: skillMd.download_url,
        baseDirUrl: `https://api.github.com/repos/${owner}/${repo}/contents/?ref=${ref}`,
      })
    }
  }

  if (discoveredSkills.length === 0) {
    throw new Error("在此 GitHub 仓库中未找到任何有效的 SKILL.md 模板设计规范")
  }

  // 2. 清理或创建目标包文件夹
  if (!(await exists(packageDir))) {
    await mkdir(packageDir, { recursive: true })
  }

  const skillsSubDir = await join(packageDir, "skills")
  if (!(await exists(skillsSubDir))) {
    await mkdir(skillsSubDir)
  }

  // 3. 下载并保存各模板文件
  for (let i = 0; i < discoveredSkills.length; i++) {
    const skill = discoveredSkills[i]
    onProgress?.(`正在下载模板 (${i + 1}/${discoveredSkills.length}): ${skill.name}...`)

    const skillTargetDir = await join(skillsSubDir, skill.name)
    if (!(await exists(skillTargetDir))) {
      await mkdir(skillTargetDir)
    }

    // 下载 SKILL.md
    const mdRes = await fetch(skill.downloadUrl)
    const mdText = await mdRes.text()
    await writeTextFile(await join(skillTargetDir, "SKILL.md"), mdText)

    // 可选：下载 example.html 和 example.md 演示文件以防将来用到
    try {
      const dirRes = await fetch(skill.baseDirUrl)
      if (dirRes.ok) {
        const dirFiles = await dirRes.json()
        if (Array.isArray(dirFiles)) {
          const exHtml = dirFiles.find((f) => f.name.toLowerCase() === "example.html")
          if (exHtml && exHtml.download_url) {
            const htmlRes = await fetch(exHtml.download_url)
            const htmlText = await htmlRes.text()
            await writeTextFile(await join(skillTargetDir, "example.html"), htmlText)
          }

          const exMd = dirFiles.find((f) => f.name.toLowerCase() === "example.md")
          if (exMd && exMd.download_url) {
            const mdFileRes = await fetch(exMd.download_url)
            const mdFileText = await mdFileRes.text()
            await writeTextFile(await join(skillTargetDir, "example.md"), mdFileText)
          }

          const openDesignManifest = dirFiles.find((f) => f.name.toLowerCase() === "open-design.json")
          if (openDesignManifest && openDesignManifest.download_url) {
            const manifestRes = await fetch(openDesignManifest.download_url)
            const manifestText = await manifestRes.text()
            await writeTextFile(await join(skillTargetDir, "open-design.json"), manifestText)
          }
        }
      }
    } catch (e) {
      console.warn(`下载模板 ${skill.name} 样例附件失败(非致命):`, e)
    }
  }

  // 4. 保存 package.json 清单
  const manifest = {
    id: packageId,
    source: { type: "github", owner, repo, ref },
    installedAt: new Date().toISOString(),
    skills: discoveredSkills.map((s) => s.name),
  }
  await writeTextFile(await join(packageDir, "package.json"), JSON.stringify(manifest, null, 2))

  return {
    packageName: `${owner}/${repo}`,
    skillsCount: discoveredSkills.length,
    installedTemplateIds: discoveredSkills.map((skill) => `market-${packageId}--${skill.name}`),
  }
}

// ---------------------------------------------------------------------------
// 4. 本地自定义与已安装模板扫描器
// ---------------------------------------------------------------------------

/**
 * 从 SKILL.md 中解析出 Frontmatter 元数据并组装成 OutputTemplate
 */
function toTemplateDisplayName(id: string): string {
  const rawName = (id.includes("--") ? id.split("--").pop() : id.replace(/^custom-/, "")) || id
  return rawName
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || id
}

function readFirstMarkdownHeading(text: string): string | null {
  const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim()
  return heading && heading.length <= 80 ? heading : null
}

function resolveLocalized(value?: string | Record<string, string>): string | undefined {
  if (!value) return undefined
  if (typeof value === "string") return value
  return value["zh-CN"] || value.zh || value.en || Object.values(value).find((text) => typeof text === "string" && text.trim())
}

function normalizeFeatureList(items: Array<string | undefined>, fallback: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of [...items, ...fallback]) {
    const value = item?.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out.slice(0, 6)
}

function mapOpenDesignMode(mode?: string): OutputMode {
  switch ((mode || "").toLowerCase()) {
    case "deck":
    case "slides":
      return "deck"
    case "image":
    case "video":
    case "hyperframes":
      return "social"
    case "live-artifact":
    case "dashboard":
    case "report":
      return "infographic"
    case "prototype":
    case "design-system":
    case "scenario":
    default:
      return "creative"
  }
}

function mapOpenDesignScenario(scenario?: string): OutputScenario {
  switch ((scenario || "").toLowerCase()) {
    case "research":
    case "report":
    case "analysis":
      return "research"
    case "presentation":
    case "deck":
    case "pitch":
      return "presentation"
    case "share":
    case "social":
    case "marketing":
      return "sharing"
    case "learning":
    case "education":
      return "learning"
    case "product":
    case "prototype":
    case "note":
    default:
      return "note"
  }
}

function inferDesignProfileFromManifest(manifest?: OpenDesignManifestLite): DesignProfileId | undefined {
  const mode = manifest?.od?.mode?.toLowerCase()
  const tags = (manifest?.tags ?? []).map((tag) => tag.toLowerCase())
  if (mode === "deck" || tags.includes("deck") || tags.includes("slides")) return "swiss-deck"
  if (mode === "live-artifact" || tags.includes("dashboard") || tags.includes("data")) return "data-utility"
  if (mode === "image" || mode === "video" || tags.includes("social")) return "social-impact"
  if (tags.includes("code") || tags.includes("developer")) return "tech-utility"
  if (tags.includes("experimental") || tags.includes("brutalist")) return "experimental-brutalist"
  return undefined
}

function parseOpenDesignManifest(text?: string): OpenDesignManifestLite | undefined {
  if (!text?.trim()) return undefined
  try {
    const parsed = JSON.parse(text) as OpenDesignManifestLite
    return parsed && typeof parsed === "object" ? parsed : undefined
  } catch (e) {
    console.warn("解析 open-design.json 失败，忽略此模板清单:", e)
    return undefined
  }
}

async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    if (!(await exists(path))) return undefined
    return await readTextFile(path)
  } catch (e) {
    console.warn(`读取可选模板文件失败: ${path}`, e)
    return undefined
  }
}

function renderOpenDesignPromptAppendix(manifest?: OpenDesignManifestLite): string {
  if (!manifest?.od) return ""

  const blocks: string[] = []
  const query = resolveLocalized(manifest.od.useCase?.query)
  if (query) {
    blocks.push(`参考使用场景：${query}`)
  }

  if (manifest.od.inputs?.length) {
    blocks.push([
      "预期输入项：",
      ...manifest.od.inputs.map((input) => {
        const label = input.label || input.name || "input"
        return `- ${label}${input.type ? ` (${input.type})` : ""}${input.required ? "，必填" : ""}`
      }),
    ].join("\n"))
  }

  if (manifest.od.pipeline?.stages?.length) {
    blocks.push([
      "推荐工作流：",
      ...manifest.od.pipeline.stages.map((stage) => {
        const atoms = stage.atoms?.length ? `：${stage.atoms.join(", ")}` : ""
        return `- ${stage.id || "stage"}${atoms}`
      }),
    ].join("\n"))
  }

  return blocks.length ? `\n\n【Open Design Manifest 补充】\n${blocks.join("\n\n")}` : ""
}

function parseSkillTemplate(id: string, skillMdText: string, openDesignManifestText?: string): OutputTemplate | null {
  const trimmed = skillMdText.trim()
  if (!trimmed) return null

  const openDesignManifest = parseOpenDesignManifest(openDesignManifestText)
  const yamlMatch = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(trimmed)
  const yamlRaw = yamlMatch?.[1] || ""
  const skillPrompt = yamlMatch ? trimmed.slice(yamlMatch[0].length).trim() : trimmed
  if (!skillPrompt) return null

  // 简单 K-V 解析
  const metadata: Record<string, string> = {}
  yamlRaw.split(/\r?\n/).forEach((line) => {
    const colonIdx = line.indexOf(":")
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      let value = line.slice(colonIdx + 1).trim()
      // 清理引号
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1)
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1)
      }
      metadata[key] = value
    }
  })

  // 如果连名字都没有，则使用 ID 代替
  const manifestTitle = resolveLocalized(openDesignManifest?.title_i18n) || openDesignManifest?.title
  const manifestDescription = resolveLocalized(openDesignManifest?.description_i18n) || openDesignManifest?.description
  const name = metadata.name || metadata.zh_name || manifestTitle || readFirstMarkdownHeading(skillPrompt) || toTemplateDisplayName(id)
  const nameEn = metadata.nameEn || metadata.en_name || openDesignManifest?.name || id
  const icon = metadata.icon || metadata.emoji || openDesignManifest?.icon || "✨"
  const description = metadata.description || manifestDescription || "AI 自由创意设计 Skill"
  const manifestMode = mapOpenDesignMode(openDesignManifest?.od?.mode)
  const manifestScenario = mapOpenDesignScenario(openDesignManifest?.od?.scenario)
  const manifestAppendix = renderOpenDesignPromptAppendix(openDesignManifest)
  const mergedSkillPrompt = `${skillPrompt}${manifestAppendix}`
  const manifestPipeline = openDesignManifest?.od?.pipeline?.stages
    ?.map((stage) => stage.id)
    .filter((stageId): stageId is string => Boolean(stageId?.trim()))
  const manifestInputs = openDesignManifest?.od?.inputs
    ?.map((input) => input.label || input.name)
    .filter((label): label is string => Boolean(label?.trim()))

  // 解析导出蓝图
  const exportBlueprint: ExportBlueprint = {}
  if (metadata.cardSelectors) {
    exportBlueprint.cardSelectors = metadata.cardSelectors.split(",").map((s: string) => s.trim())
  }
  if (metadata.defaultRatio) {
    exportBlueprint.defaultRatio = metadata.defaultRatio
  }
  if (metadata.cardGap) {
    exportBlueprint.cardGap = parseInt(metadata.cardGap, 10)
  }
  if (metadata.pagingMode) {
    const pagingMode = metadata.pagingMode.trim()
    if (["semantic", "separator", "auto-fit", "auto-split", "dynamic"].includes(pagingMode)) {
      exportBlueprint.pagingMode = pagingMode as SmartCardPagingMode
    }
  }
  if (metadata.autoSplitMaxChars) {
    const autoSplitMaxChars = parseInt(metadata.autoSplitMaxChars, 10)
    if (Number.isFinite(autoSplitMaxChars)) {
      exportBlueprint.autoSplitMaxChars = autoSplitMaxChars
    }
  }
  if (metadata.dynamicMaxHeight) {
    const dynamicMaxHeight = parseInt(metadata.dynamicMaxHeight, 10)
    if (Number.isFinite(dynamicMaxHeight)) {
      exportBlueprint.dynamicMaxHeight = dynamicMaxHeight
    }
  }

  return {
    id,
    name,
    nameEn,
    mode: (metadata.mode as OutputMode) || manifestMode,
    scenario: (metadata.scenario as OutputScenario) || manifestScenario,
    description,
    icon,
    designConstraints: `【${name} 设计规范与约束】:\n${mergedSkillPrompt}`,
    outputHint: metadata.outputHint || "由 AI 根据 Skill 设计规范直绘生成网页",
    bestFor: metadata.bestFor || "AI 自由设计、个性排版、非结构化视觉输出",
    skillPrompt: mergedSkillPrompt, // 用于传递给 AI 扮演设计师的核心约束
    recommended: metadata.recommended === "true" || metadata.featured !== undefined,
    features: normalizeFeatureList([
      ...(openDesignManifest?.tags ?? []),
      ...(manifestInputs ?? []).map((label) => `输入:${label}`),
      openDesignManifest?.od?.mode ? `OD:${openDesignManifest.od.mode}` : undefined,
    ], ["AI直绘", "Skill规范"]),
    previewTone: openDesignManifest?.od?.preview?.type || openDesignManifest?.od?.preview?.motion,
    designProfileId: (metadata.designProfileId as DesignProfileId) || inferDesignProfileFromManifest(openDesignManifest),
    pipelineHint: manifestPipeline?.length ? manifestPipeline : undefined,
    exportBlueprint: Object.keys(exportBlueprint).length > 0 ? exportBlueprint : undefined,
  }
}

/**
 * 递归扫描已下载和本地自建的自定义技能模板列表
 */
export async function listInstalledTemplates(): Promise<OutputTemplate[]> {
  const templates: OutputTemplate[] = []
  const { installedDir, customDir } = await ensureSkillsDirsExist()

  // 1. 扫描在线下载的模板包 (installed/)
  try {
    const pkgEntries = await readDir(installedDir)
    for (const pkgEnt of pkgEntries) {
      if (pkgEnt.isDirectory) {
        const pkgId = pkgEnt.name
        const skillsSubDir = await join(installedDir, pkgId, "skills")

        if (await exists(skillsSubDir)) {
          const skillEntries = await readDir(skillsSubDir)
          for (const skillEnt of skillEntries) {
            if (skillEnt.isDirectory) {
              const skillId = skillEnt.name
              const skillMdPath = await join(skillsSubDir, skillId, "SKILL.md")

              if (await exists(skillMdPath)) {
                try {
                  const text = await readTextFile(skillMdPath)
                  const manifestText = await readOptionalTextFile(await join(skillsSubDir, skillId, "open-design.json"))
                  const parsed = parseSkillTemplate(`market-${pkgId}--${skillId}`, text, manifestText)
                  if (parsed) templates.push(parsed)
                } catch (e) {
                  console.warn(`读取模板 ${skillId} 失败:`, e)
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("扫描 installed 目录出错:", e)
  }

  // 2. 扫描本地用户自定义的模板 (custom/)
  try {
    const customEntries = await readDir(customDir)
    for (const customEnt of customEntries) {
      if (customEnt.isDirectory) {
        const skillId = customEnt.name
        const skillMdPath = await join(customDir, skillId, "SKILL.md")

        if (await exists(skillMdPath)) {
          try {
            const text = await readTextFile(skillMdPath)
            const manifestText = await readOptionalTextFile(await join(customDir, skillId, "open-design.json"))
            const parsed = parseSkillTemplate(`custom-${skillId}`, text, manifestText)
            if (parsed) templates.push(parsed)
          } catch (e) {
            console.warn(`读取自定义模板 ${skillId} 失败:`, e)
          }
        }
      }
    }
  } catch (e) {
    console.error("扫描 custom 目录出错:", e)
  }

  return templates
}

// ---------------------------------------------------------------------------
// 5. 本地新建自定义模板快捷引擎
// ---------------------------------------------------------------------------

/**
 * 快速在本地 custom/ 目录下建立一个新的自定义模板配置文件并返回其路径
 * @param templateName 模板名称（如: 极简日报, my-style）
 */
export async function createLocalCustomTemplate(templateName: string): Promise<string> {
  const name = templateName.trim()
  if (!name) {
    throw new Error("模板名称不能为空")
  }

  // 格式化 ID，只允许英文字母和数字，空格转短横线
  const skillId = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "")
  if (!skillId) {
    throw new Error("模板名称只包含非法字符，无法生成唯一标识，请使用英文字母或中文命名")
  }

  const { customDir } = await ensureSkillsDirsExist()
  const targetDir = await join(customDir, skillId)
  if (!(await exists(targetDir))) {
    await mkdir(targetDir)
  }

  const skillMdPath = await join(targetDir, "SKILL.md")
  if (await exists(skillMdPath)) {
    throw new Error(`名称为 "${name}" 的自定义模板已存在，请换个名字，或直接修改现有模板`)
  }

  const templateContent = `---
name: "${name}"
nameEn: "Custom ${skillId}"
emoji: "🎨"
description: "由您自定义的网页创意设计排版规则"
category: creative
scenario: note
bestFor: "日记排版、概念卡片、专属样式报告"
---

【设计与排版规范约束（在下方写出您的排版规则，AI 会绝对遵循此要求为您直绘网页）】:
1. **背景配色**：使用优雅的淡雅灰（#f1f5f9）或奶油色渐变。
2. **字体与布局**：标题使用大号衬线字体，正文排版两端对齐，段落间距 24px。
3. **点缀元素**：所有的列表均带有一个精美的小圆点符号，章节之间使用一条细长的虚线分割。
4. **页脚**：如果需要署名，优先使用输入材料的来源、标题或主题名，禁止写死模型名、平台名或固定工作室品牌。
`

  await writeTextFile(skillMdPath, templateContent)
  return skillMdPath
}
