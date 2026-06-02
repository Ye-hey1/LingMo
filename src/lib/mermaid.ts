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

export function ensureMermaidFileName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, '_')
  if (!normalized) {
    return getDefaultMermaidBaseName()
  }

  if (isMermaidPath(normalized)) {
    return normalized
  }

  return `${normalized}.mmd`
}

export function getDefaultMermaidBaseName(): string {
  return 'Untitled_Mermaid_Diagram.mmd'
}

let mermaidInstance: typeof mermaidType | null = null

export async function getMermaidRenderer(theme: 'light' | 'dark' | 'system' = 'light') {
  if (!mermaidInstance) {
    const mod = await import('mermaid')
    mermaidInstance = mod.default
  }

  mermaidInstance.initialize({
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    securityLevel: 'strict',
    fontFamily: 'inherit',
  })

  return mermaidInstance
}
