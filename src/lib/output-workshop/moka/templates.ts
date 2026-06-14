import type { OutputTemplate } from "../templates"
import {
  MOKA_AI_SINGLE_TEMPLATE_ID,
  MOKA_AI_SPLIT_TEMPLATE_ID,
} from "./constants"

const MOKA_DESIGN_CONSTRAINTS = `
## Moka 原生能力约束

1. 输出为 3:4 内容卡片，优先适配小红书多图、微信图文卡片和知识卡片
2. 使用 moka 模板结构：单页卡片包含 emoji、分类、标题、导语、sections、tip、tags；分页卡片包含 cover/content/end slides
3. 文案必须来自用户材料，可以压缩、重排、拆页，不得编造事实、数字、人物或引用
4. 每张卡片必须带 .moka-card 与 data-moka-card，便于输出工坊智能卡片导出
5. Moka AI 必须返回 styleConfig 视觉方案，由输出工坊渲染为自包含 HTML
6. 如用户上传参考图，先分析参考图的配色、构图、留白、字体层级和装饰语言，再迁移到 styleConfig
`

const MOKA_EXPORT_BLUEPRINT = {
  cardSelectors: [".moka-card", ".moka-slide", "[data-moka-card]"],
  defaultRatio: "3:4",
  cardGap: 28,
}

export const MOKA_OUTPUT_TEMPLATES: OutputTemplate[] = [
  {
    id: MOKA_AI_SINGLE_TEMPLATE_ID,
    name: "Moka AI 单页创作",
    nameEn: "Moka AI Single Creation",
    mode: "moka",
    scenario: "sharing",
    description: "复用 moka AI design，根据文案、风格、配色和参考图生成独特单页卡片",
    icon: "✨",
    designConstraints: MOKA_DESIGN_CONSTRAINTS,
    outputHint: "AI 生成 styleConfig + content，再渲染为 3:4 单页卡片",
    bestFor: "需要参考图风格迁移、非固定模板、单图视觉设计",
    features: ["AI 设计", "参考图", "单页卡片"],
    outputTargets: ["PNG", "HTML", "智能卡片"],
    previewTone: "moka-ai-single",
    sizePresets: ["3:4"],
    recommended: true,
    exportBlueprint: MOKA_EXPORT_BLUEPRINT,
  },
  {
    id: MOKA_AI_SPLIT_TEMPLATE_ID,
    name: "Moka AI 分页创作",
    nameEn: "Moka AI Multi-page Creation",
    mode: "moka",
    scenario: "sharing",
    description: "复用 moka AI split design，根据文案、风格、配色和参考图生成多页卡片组",
    icon: "🪄",
    designConstraints: MOKA_DESIGN_CONSTRAINTS,
    outputHint: "AI 生成 styleConfig + slides，每页都支持智能卡片选择导出",
    bestFor: "小红书多图、参考图风格迁移、封面+内容页+结尾页",
    features: ["AI 设计", "参考图", "多页导出"],
    outputTargets: ["PNG ZIP", "HTML", "智能卡片"],
    previewTone: "moka-ai-split",
    sizePresets: ["3:4"],
    recommended: true,
    exportBlueprint: MOKA_EXPORT_BLUEPRINT,
  },
]
