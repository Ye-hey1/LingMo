import type { MCPServerConfig } from './types'

const BRACED_ENV_RE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/
const WRAPPED_SECRET_RE = /^\$\{(.+)\}$/
const LITERAL_SECRET_RE = /^(?:as_sk_|fc-|sk-|[A-Za-z0-9_-]{24,})/i

function unwrapLiteralSecret(value: string): string {
  const trimmed = value.trim()
  const wrapped = trimmed.match(WRAPPED_SECRET_RE)
  if (!wrapped) return trimmed

  const inner = wrapped[1]?.trim()
  if (!inner || /^[A-Za-z_][A-Za-z0-9_]*$/.test(inner)) {
    return trimmed
  }

  return inner
}

function expandEnvToken(value: string): { value: string; missingEnv: boolean } {
  let missingEnv = false
  const expanded = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, key) => {
    const envValue = typeof process !== 'undefined' ? process.env?.[key] : undefined
    if (envValue != null && envValue !== '') {
      return envValue
    }
    if (LITERAL_SECRET_RE.test(key)) {
      return key
    }
    missingEnv = true
    return ''
  })

  return { value: expanded, missingEnv }
}

export function resolveMcpConfigValue(value: unknown): string {
  if (value == null) return ''
  const raw = String(value).trim()
  if (!raw) return ''

  if (BRACED_ENV_RE.test(raw)) {
    const expanded = expandEnvToken(raw)
    return expanded.missingEnv ? '' : expanded.value.trim()
  }

  const expanded = expandEnvToken(unwrapLiteralSecret(raw))
  return expanded.missingEnv ? '' : expanded.value.trim()
}

export function resolveMcpHeaders(headers?: MCPServerConfig['headers'] | string): Record<string, string> {
  if (!headers) return {}

  const parsed = typeof headers === 'string'
    ? JSON.parse(headers) as Record<string, unknown>
    : headers

  return Object.fromEntries(
    Object.entries(parsed)
      .map(([key, value]) => [key, resolveMcpConfigValue(value)] as const)
      .filter(([, value]) => value.length > 0)
  )
}

export function resolveMcpEnv(env?: MCPServerConfig['env']): Record<string, string> {
  if (!env) return {}

  return Object.fromEntries(
    Object.entries(env)
      .map(([key, value]) => [key, resolveMcpConfigValue(value)] as const)
      .filter(([, value]) => value.length > 0)
  )
}

export function hasUnresolvedMcpPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value)
}
