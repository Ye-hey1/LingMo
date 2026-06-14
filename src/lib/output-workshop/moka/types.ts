export type MokaTemplateKind = "single" | "split" | "ai-single" | "ai-split"

export interface MokaStyleOption {
  id: string
  name: string
  icon: string
  desc: string
}

export interface MokaPalette {
  id: string
  label: string
  a: string
  bg: string
  tc: string
  bc: string
}

export type MokaInlineStyle = Record<string, string | number | boolean | null | undefined>

export interface MokaSection {
  heading: string
  text: string
  headingStyle?: MokaInlineStyle
  textStyle?: MokaInlineStyle
}

export interface MokaSingleContent {
  emoji: string
  category: string
  title: string
  lead?: string
  sections: MokaSection[]
  tip?: string
  tags: string[]
  titleStyle?: MokaInlineStyle
  leadStyle?: MokaInlineStyle
  tipStyle?: MokaInlineStyle
  tagStyles?: MokaInlineStyle[]
}

export type MokaSlideType = "cover" | "content" | "end"

export interface MokaSlide {
  type: MokaSlideType
  emoji?: string
  category?: string
  title?: string
  subtitle?: string
  heading?: string
  text?: string
  extra?: string
  cta?: string
  sub?: string
  tags?: string[]
  titleStyle?: MokaInlineStyle
  subtitleStyle?: MokaInlineStyle
  headingStyle?: MokaInlineStyle
  textStyle?: MokaInlineStyle
  extraStyle?: MokaInlineStyle
  ctaStyle?: MokaInlineStyle
  subStyle?: MokaInlineStyle
  tagStyles?: MokaInlineStyle[]
}

export type MokaStyleConfig = Record<string, any>

export interface MokaAiSingleDesign {
  styleConfig: MokaStyleConfig
  content: MokaSingleContent
}

export interface MokaAiSplitDesign {
  styleConfig: MokaStyleConfig
  slides: MokaSlide[]
}

export type MokaParsedResult =
  | { kind: "single"; content: MokaSingleContent; usedFallback: boolean; warning?: string }
  | { kind: "split"; slides: MokaSlide[]; usedFallback: boolean; warning?: string }
  | { kind: "ai-single"; design: MokaAiSingleDesign; usedFallback: boolean; warning?: string }
  | { kind: "ai-split"; design: MokaAiSplitDesign; usedFallback: boolean; warning?: string }

export interface MokaBuildOptions {
  templateId: string
  styleId?: string
  title: string
  sourceLabel?: string
  generatedAt?: string
  themeColor?: string
  paletteId?: string
  referenceImageName?: string
  result: MokaParsedResult
}
