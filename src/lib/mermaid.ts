import type mermaidType from 'mermaid'

export const MERMAID_FILE_SUFFIXES = ['.mmd', '.mermaid'] as const

export function isMermaidPath(path: string): boolean {
  const normalized = path.toLowerCase()
  return MERMAID_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

export function createDefaultMermaidContent(): string {
  return [
    'flowchart TD',
    '  A[开始] --> B{是否需要图表表达?}',
    '  B -- 是 --> C[编写 Mermaid 代码]',
    '  B -- 否 --> D[继续使用普通 Markdown]',
    '  C --> E[右侧实时预览]',
  ].join('\n')
}

let mermaidInstance: typeof mermaidType | null = null

type MermaidAppTheme = 'light' | 'dark' | 'system'
type MermaidThemeVariables = Record<string, string | number | boolean>

function getCleanMermaidThemeVariables(theme: MermaidAppTheme): MermaidThemeVariables {
  const isDark = theme === 'dark'
  const palette = isDark
    ? {
        background: '#0b0f14',
        surface: '#111827',
        surfaceAlt: '#172033',
        muted: '#1f2937',
        border: '#4b5563',
        line: '#cbd5e1',
        text: '#f8fafc',
        mutedText: '#d1d5db',
        subtleText: '#e5e7eb',
      }
    : {
        background: '#ffffff',
        surface: '#ffffff',
        surfaceAlt: '#f8fafc',
        muted: '#f1f5f9',
        border: '#cbd5e1',
        line: '#334155',
        text: '#111827',
        mutedText: '#374151',
        subtleText: '#1f2937',
      }

  const scale = isDark
    ? ['#1f2937', '#172033', '#243244', '#111827', '#1f2937', '#172033', '#243244', '#111827', '#1f2937', '#172033', '#243244', '#111827']
    : ['#e2e8f0', '#f1f5f9', '#e5e7eb', '#f8fafc', '#e2e8f0', '#f1f5f9', '#e5e7eb', '#f8fafc', '#e2e8f0', '#f1f5f9', '#e5e7eb', '#f8fafc']
  const scaleVariables: MermaidThemeVariables = {}

  scale.forEach((color, index) => {
    scaleVariables[`cScale${index}`] = color
    scaleVariables[`cScaleInv${index}`] = palette.line
    scaleVariables[`cScalePeer${index}`] = palette.surfaceAlt
    scaleVariables[`cScaleLabel${index}`] = palette.text
    scaleVariables[`pie${index}`] = color
  })

  return {
    darkMode: isDark,
    background: palette.background,
    mainBkg: palette.surface,
    secondBkg: palette.surfaceAlt,
    tertiaryColor: palette.muted,
    primaryColor: palette.surface,
    secondaryColor: palette.surfaceAlt,
    primaryTextColor: palette.text,
    secondaryTextColor: palette.text,
    tertiaryTextColor: palette.mutedText,
    primaryBorderColor: palette.border,
    secondaryBorderColor: palette.border,
    tertiaryBorderColor: palette.border,
    lineColor: palette.line,
    defaultLinkColor: palette.line,
    textColor: palette.text,
    titleColor: palette.text,
    nodeBorder: palette.border,
    clusterBkg: palette.surfaceAlt,
    clusterBorder: palette.border,
    edgeLabelBackground: palette.background,
    labelBackground: palette.background,
    labelTextColor: palette.text,
    actorBkg: palette.surface,
    actorBorder: palette.border,
    actorTextColor: palette.text,
    actorLineColor: palette.line,
    signalColor: palette.line,
    signalTextColor: palette.text,
    noteBkgColor: palette.surfaceAlt,
    noteBorderColor: palette.border,
    noteTextColor: palette.text,
    labelBoxBkgColor: palette.surface,
    labelBoxBorderColor: palette.border,
    loopTextColor: palette.text,
    activationBorderColor: palette.border,
    activationBkgColor: palette.surfaceAlt,
    sequenceNumberColor: palette.background,
    sectionBkgColor: palette.surfaceAlt,
    sectionBkgColor2: palette.surface,
    altSectionBkgColor: palette.muted,
    gridColor: palette.border,
    taskBkgColor: palette.surface,
    taskBorderColor: palette.border,
    activeTaskBkgColor: palette.surfaceAlt,
    activeTaskBorderColor: palette.line,
    critBkgColor: palette.surfaceAlt,
    critBorderColor: palette.line,
    doneTaskBkgColor: palette.muted,
    doneTaskBorderColor: palette.border,
    taskTextColor: palette.text,
    taskTextDarkColor: palette.text,
    taskTextLightColor: palette.text,
    taskTextOutsideColor: palette.mutedText,
    taskTextClickableColor: palette.subtleText,
    personBorder: palette.border,
    personBkg: palette.surface,
    personTextColor: palette.text,
    git0: palette.surface,
    gitBranchLabel0: palette.text,
    gitBranchLabel1: palette.text,
    gitBranchLabel2: palette.text,
    gitBranchLabel3: palette.text,
    gitBranchLabel4: palette.text,
    gitBranchLabel5: palette.text,
    gitBranchLabel6: palette.text,
    gitBranchLabel7: palette.text,
    ...scaleVariables,
  }
}

export async function getMermaidRenderer(theme: 'light' | 'dark' | 'system' = 'light') {
  if (!mermaidInstance) {
    const mod = await import('mermaid')
    mermaidInstance = mod.default
  }

  mermaidInstance.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: getCleanMermaidThemeVariables(theme),
    securityLevel: 'strict',
    fontFamily: 'inherit',
    fontSize: 14,
    timeline: {
      disableMulticolor: true,
      useMaxWidth: true,
    },
  })

  return mermaidInstance
}
