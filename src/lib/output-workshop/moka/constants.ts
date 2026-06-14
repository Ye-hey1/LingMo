import type { MokaPalette, MokaStyleOption, MokaTemplateKind } from "./types"

export const MOKA_SINGLE_STYLES: MokaStyleOption[] = [
  { id: "ai", name: "AI设计", icon: "✨", desc: "参考图/自由生成独特版式" },
  { id: "editorial", name: "杂志风", icon: "📰", desc: "左色条 + 双线" },
  { id: "notecard", name: "便签风", icon: "🗒", desc: "虚线边框 + 星点" },
  { id: "minimal", name: "极简线", icon: "✦", desc: "圆点编号 + 下划" },
  { id: "stamp", name: "手账风", icon: "📮", desc: "格纹底 + 邮票框" },
  { id: "bold", name: "撞色块", icon: "🎨", desc: "色块标题 + 白底" },
  { id: "newspaper", name: "报纸风", icon: "📜", desc: "双线报头 + 序号" },
  { id: "film", name: "胶片风", icon: "🎞", desc: "胶片孔 + 色条" },
  { id: "label", name: "标签风", icon: "🏷", desc: "价签形 + 打孔" },
  { id: "creamy", name: "奶油风", icon: "🧁", desc: "柔和圆润 + 温暖治愈" },
  { id: "retro", name: "复古风", icon: "📻", desc: "怀旧色调 + 胶片质感" },
  { id: "japanese", name: "日系风", icon: "🎌", desc: "清新淡雅 + 手绘感" },
  { id: "pure", name: "极简风", icon: "◻️", desc: "纯粹简洁 + 大量留白" },
  { id: "pop", name: "波普风", icon: "🎯", desc: "大胆撞色 + 几何图形" },
  { id: "luxury", name: "轻奢风", icon: "💎", desc: "金色点缀 + 优雅线条" },
  { id: "business", name: "商务风", icon: "💼", desc: "专业严谨 + 蓝色调" },
  { id: "tech", name: "科技风", icon: "💻", desc: "未来感 + 赛博朋克" },
  { id: "edu", name: "教育风", icon: "📚", desc: "知识感 + 书本元素" },
  { id: "law", name: "法律风", icon: "⚖️", desc: "庄重感 + 天平元素" },
  { id: "food", name: "美食风", icon: "🍜", desc: "食欲感 + 餐具元素" },
  { id: "travel", name: "旅游风", icon: "✈️", desc: "探索感 + 地图元素" },
]

const MOKA_BASE_SPLIT_STYLES: MokaStyleOption[] = [
  { id: "ai", name: "AI设计", icon: "✨", desc: "参考图/自由生成独特版式" },
  { id: "vivid", name: "撞色块", icon: "🎨", desc: "满版色 + 白内容" },
  { id: "clean", name: "极简线", icon: "✦", desc: "白底 + 色块序号" },
  { id: "paper", name: "手账风", icon: "📮", desc: "格纹底 + 邮票框" },
  { id: "editorial", name: "杂志风", icon: "📰", desc: "分色块 + 双线" },
  { id: "gradient", name: "渐变风", icon: "🌅", desc: "渐变封面 + 白内容" },
]

const MOKA_BASE_SPLIT_STYLE_IDS = new Set(MOKA_BASE_SPLIT_STYLES.map((style) => style.id))

export const MOKA_SPLIT_STYLES: MokaStyleOption[] = [
  ...MOKA_BASE_SPLIT_STYLES,
  ...MOKA_SINGLE_STYLES.filter((style) => {
    return !MOKA_BASE_SPLIT_STYLE_IDS.has(style.id) &&
      !["notecard", "minimal", "stamp", "bold", "newspaper", "film", "label"].includes(style.id)
  }),
]

export const MOKA_PALETTES: MokaPalette[] = [
  { id: "coral", label: "珊瑚", a: "#e05a4b", bg: "#fff8f6", tc: "#2a1210", bc: "#4a3330" },
  { id: "rose", label: "玫瑰", a: "#d44d6e", bg: "#fdf4f6", tc: "#2a1018", bc: "#5a2a38" },
  { id: "sunset", label: "晚霞", a: "#e85d4e", bg: "#fff5f4", tc: "#2a1210", bc: "#5a3028" },
  { id: "peach", label: "蜜桃", a: "#f4a261", bg: "#fff8f4", tc: "#2a1a10", bc: "#5a4028" },
  { id: "sage", label: "抹茶", a: "#4a7c59", bg: "#f4faf6", tc: "#172312", bc: "#344d38" },
  { id: "ocean", label: "海洋", a: "#2e86ab", bg: "#f4f9fb", tc: "#0f1e26", bc: "#2a4a5a" },
  { id: "lavender", label: "薰衣草", a: "#7b68ee", bg: "#f7f5fd", tc: "#1a1030", bc: "#4a3a7a" },
  { id: "mint", label: "薄荷", a: "#3eb489", bg: "#f4fbf8", tc: "#0f2218", bc: "#2a5a48" },
  { id: "ink", label: "水墨", a: "#2d3561", bg: "#f4f5fb", tc: "#0f1220", bc: "#333650" },
  { id: "amber", label: "琥珀", a: "#c47c2b", bg: "#fffbf4", tc: "#1f1508", bc: "#4a3010" },
  { id: "plum", label: "梅子", a: "#8b3a62", bg: "#fdf4f8", tc: "#2a1020", bc: "#4a2a38" },
  { id: "slate", label: "青石", a: "#4a7c8a", bg: "#f4fafb", tc: "#101e22", bc: "#2a3e44" },
  { id: "rust", label: "铁锈", a: "#a0522d", bg: "#fef8f4", tc: "#200e08", bc: "#4a2818" },
  { id: "pine", label: "松针", a: "#2d6a4f", bg: "#f0faf5", tc: "#0a1e14", bc: "#1e4432" },
  { id: "midnight", label: "午夜", a: "#1a1a2e", bg: "#f4f4f6", tc: "#0a0a14", bc: "#2a2a3e" },
  { id: "wine", label: "红酒", a: "#722f37", bg: "#fdf4f5", tc: "#1f0a0c", bc: "#4a2028" },
  { id: "forest", label: "森林", a: "#1b4332", bg: "#f0f5f2", tc: "#0a1a14", bc: "#2a4a3a" },
  { id: "coffee", label: "咖啡", a: "#6f4e37", bg: "#faf6f4", tc: "#1a1410", bc: "#4a3a2a" },
  { id: "charcoal", label: "炭灰", a: "#4a4a4a", bg: "#f5f5f5", tc: "#1a1a1a", bc: "#3a3a3a" },
  { id: "terracotta", label: "陶土", a: "#c65d3b", bg: "#fdf6f4", tc: "#2a1814", bc: "#5a3a2a" },
  { id: "gold", label: "金色", a: "#d4a574", bg: "#fdf9f4", tc: "#2a2018", bc: "#5a4a3a" },
]

export const MOKA_FONT_FAMILY = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"

export const MOKA_AI_SINGLE_TEMPLATE_ID = "moka-ai-single"
export const MOKA_AI_SPLIT_TEMPLATE_ID = "moka-ai-split"

export function getMokaTemplateKind(templateId: string): MokaTemplateKind | null {
  if (templateId === MOKA_AI_SINGLE_TEMPLATE_ID) return "ai-single"
  if (templateId === MOKA_AI_SPLIT_TEMPLATE_ID) return "ai-split"
  if (templateId.startsWith("moka-single-")) return "single"
  if (templateId.startsWith("moka-split-")) return "split"
  return null
}

export function isMokaTemplateId(templateId: string): boolean {
  return getMokaTemplateKind(templateId) !== null
}

export function isMokaAiTemplateId(templateId: string): boolean {
  const kind = getMokaTemplateKind(templateId)
  return kind === "ai-single" || kind === "ai-split"
}

export function getMokaStyleId(templateId: string): string {
  if (templateId.startsWith("moka-single-")) return templateId.replace("moka-single-", "")
  if (templateId.startsWith("moka-split-")) return templateId.replace("moka-split-", "")
  return "ai"
}

export function getMokaPalette(seed?: string): MokaPalette {
  if (seed) {
    const normalized = seed.toLowerCase()
    const byId = MOKA_PALETTES.find((palette) => palette.id === normalized || palette.a.toLowerCase() === normalized)
    if (byId) return byId
  }
  return MOKA_PALETTES[0]
}

export function isMokaWechatLeaningStyle(styleId: string): boolean {
  return ["business", "tech", "edu", "law"].includes(styleId)
}
