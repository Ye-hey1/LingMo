import { summarizeArtifactInput } from './input'
import { getArtifactTemplate } from './templates'
import type { ArtifactTemplateId } from './types'
import { VISUAL_REPORTS_ROOT } from '@/lib/visual-report-constants'

const SHARED_ARTIFACT_DIRECTIVES = `你是资深视觉设计师和前端工程师。目标是把用户材料转成可交付的自包含 HTML，而不是普通 Markdown 总结。

硬性规则：
- 使用用户提供的真实信息，不编造数据。
- 输出应完整覆盖用户材料的主要章节、要点、数据组和行动项。
- 如果内容较长，宁可增加 section、card 或 slide，也不要压缩到几段。
- 最终必须通过 create_visual_report 工具落地为 HTML 文件。
- sections 参数应包含 title、body、bullets、importance，其中 importance 只能是 high、medium、low。
- content 可以保留原始材料摘要，sourceFormat 应写明输入格式，templateId 应写明所选模板。`

export interface BuildArtifactPromptOptions {
  title: string
  sourceContent: string
  sourceLabel?: string
  templateId?: ArtifactTemplateId | string
}

export function buildArtifactGenerationPrompt(options: BuildArtifactPromptOptions): string {
  const template = getArtifactTemplate(options.templateId)
  const summary = summarizeArtifactInput(options.sourceContent)
  const sourceBlock = summary.preview && summary.format !== 'markdown' && summary.format !== 'html' && summary.format !== 'text'
    ? `${summary.preview}\n\n--- 原始内容 ---\n${summary.raw}`
    : summary.raw

  return `${SHARED_ARTIFACT_DIRECTIVES}

模板：
- templateId: ${template.id}
- name: ${template.name}
- scene: ${template.scenario}
- aspect: ${template.aspectHint}
- output: ${template.outputHint}

请调用 create_visual_report，建议参数：
- title: "${options.title}"
- subtitle: "由 LingMo 根据输入材料生成的可交付 HTML"
- reportType: "${template.scenario === 'deck' ? 'plan' : template.scenario === 'data' ? 'research' : 'note'}"
- templateId: "${template.id}"
- sourceFormat: "${summary.format}"
- sourceLabel: "${options.sourceLabel ?? '手动输入'}"
- folderPath: "${VISUAL_REPORTS_ROOT}"
- openAfterCreate: true

输入格式：${summary.format}
用户材料：
${sourceBlock}`
}
