export interface CodeBlockLanguageRegistry {
  supportedLanguages: readonly string[]
  isRegistered?: (language: string) => boolean
  passthroughLanguages?: readonly string[]
}

export interface NormalizeCodeFenceOptions {
  fallbackLanguage?: string | null
}

const LANGUAGE_ALIASES: Record<string, string> = {
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  shellscript: 'shell',
  'shell-script': 'shell',
  sh: 'bash',
  zsh: 'bash',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  md: 'markdown',
  mdown: 'markdown',
  yml: 'yaml',
  html: 'xml',
  htm: 'xml',
  text: 'plaintext',
  txt: 'plaintext',
  plain: 'plaintext',
}

function normalizeLanguageToken(language: string): string {
  return language
    .trim()
    .replace(/^\{?\.?/, '')
    .replace(/\}?$/, '')
    .replace(/^language-/, '')
    .toLowerCase()
}

function createLanguageSet(languages: readonly string[] | undefined) {
  return new Set((languages || []).map(language => language.toLowerCase()))
}

function isLanguageAvailable(language: string, registry: CodeBlockLanguageRegistry, supportedLanguages: Set<string>) {
  return supportedLanguages.has(language) || registry.isRegistered?.(language) === true
}

export function normalizeCodeBlockLanguage(
  language: string | null | undefined,
  registry: CodeBlockLanguageRegistry,
): string | null {
  if (!language) {
    return null
  }

  const normalized = normalizeLanguageToken(language)
  if (!normalized) {
    return null
  }

  const passthroughLanguages = createLanguageSet(registry.passthroughLanguages)
  if (passthroughLanguages.has(normalized)) {
    return normalized
  }

  const supportedLanguages = createLanguageSet(registry.supportedLanguages)
  const alias = LANGUAGE_ALIASES[normalized] || normalized

  if (isLanguageAvailable(alias, registry, supportedLanguages)) {
    return alias
  }

  if (isLanguageAvailable(normalized, registry, supportedLanguages)) {
    return normalized
  }

  return null
}

export function normalizeMarkdownCodeFenceLanguages(
  markdown: string,
  registry: CodeBlockLanguageRegistry,
  options: NormalizeCodeFenceOptions = {},
): string {
  if (!markdown.includes('```') && !markdown.includes('~~~')) {
    return markdown
  }

  return markdown.replace(
    /(^|\n)([ \t]{0,3})(`{3,}|~{3,})([^\n]*)/g,
    (match, lineStart: string, indent: string, fence: string, info: string) => {
      const trimmedInfo = info.trim()
      if (!trimmedInfo) {
        return match
      }

      const parts = trimmedInfo.split(/\s+/)
      const rawLanguage = parts[0]
      const normalizedLanguage = normalizeCodeBlockLanguage(rawLanguage, registry)
      const safeLanguage = normalizedLanguage || options.fallbackLanguage

      if (!safeLanguage) {
        return match
      }

      const originalLanguage = normalizeLanguageToken(rawLanguage)
      if (safeLanguage === originalLanguage) {
        return match
      }

      const infoIndent = info.match(/^\s*/)?.[0] || ''
      const rest = parts.slice(1).join(' ')
      return `${lineStart}${indent}${fence}${infoIndent}${safeLanguage}${rest ? ` ${rest}` : ''}`
    },
  )
}
