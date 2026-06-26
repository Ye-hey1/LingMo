export type DrawioExportFormatLike = 'png' | 'svg' | 'xmlpng' | 'xmlsvg'

export interface DrawioExportPayloadLike {
  data?: string
  svg?: string
}

export interface DrawioExportedSvgInspection {
  valid: boolean
  width?: number
  height?: number
  viewBox?: [number, number, number, number]
  visibleElementCount: number
  drawioCellCount: number
  issues: string[]
}

function decodeBase64Utf8(value: string): string {
  const binary = globalThis.atob(value.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

function decodePlainDataUrlPayload(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function decodeDrawioSvgExportData(data: string): string {
  const trimmed = data.trim()
  const dataUrlMatch = trimmed.match(/^data:([^,]*),([\s\S]*)$/i)
  if (dataUrlMatch) {
    const metadata = dataUrlMatch[1].toLowerCase()
    if (!metadata.startsWith('image/svg+xml')) {
      throw new Error('Expected an SVG data URL.')
    }

    return metadata.split(';').includes('base64')
      ? decodeBase64Utf8(dataUrlMatch[2])
      : decodePlainDataUrlPayload(dataUrlMatch[2])
  }

  if (/^(?:<\?xml\b[\s\S]*?\?>\s*)?<svg[\s>]/i.test(trimmed)) {
    return trimmed
  }

  throw new Error('Expected SVG data or an SVG data URL.')
}

export function selectDrawioExportData(
  payload: DrawioExportPayloadLike,
  format: DrawioExportFormatLike,
): string | undefined {
  if (format === 'png' || format === 'xmlpng') {
    return typeof payload.data === 'string' && payload.data.trim() ? payload.data : undefined
  }

  const candidates = [payload.svg, payload.data]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    try {
      decodeDrawioSvgExportData(candidate)
      return candidate
    } catch {
      // Try the next draw.io response field before failing at the writer boundary.
    }
  }

  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
}

function readSvgAttribute(svgTag: string, name: string): string | undefined {
  const match = svgTag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match?.[1] ?? match?.[2]
}

function readNumericAttribute(svgTag: string, name: string): number | undefined {
  const value = readSvgAttribute(svgTag, name)
  if (!value) return undefined

  const match = value.trim().match(/^[-+]?\d*\.?\d+/)
  if (!match) return undefined

  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : undefined
}

function readViewBox(svgTag: string): [number, number, number, number] | undefined {
  const value = readSvgAttribute(svgTag, 'viewBox')
  if (!value) return undefined

  const values = value
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number(part))

  if (values.length !== 4 || values.some((part) => !Number.isFinite(part))) {
    return undefined
  }

  return [values[0], values[1], values[2], values[3]]
}

function stripDrawioTextFallback(svg: string): string {
  return svg.replace(
    /<a\b[^>]*drawio\.com\/doc\/faq\/svg-export-text-problems[\s\S]*?<\/a>/gi,
    '',
  )
}

export function inspectDrawioExportedSvg(svg: string): DrawioExportedSvgInspection {
  const svgTagMatch = svg.match(/<svg\b[^>]*>/i)
  const issues: string[] = []
  if (!svgTagMatch) {
    return {
      valid: false,
      visibleElementCount: 0,
      drawioCellCount: 0,
      issues: ['missing-svg-root'],
    }
  }

  const svgTag = svgTagMatch[0]
  const viewBox = readViewBox(svgTag)
  const width = readNumericAttribute(svgTag, 'width') ?? viewBox?.[2]
  const height = readNumericAttribute(svgTag, 'height') ?? viewBox?.[3]
  if (!width || !height || width <= 0 || height <= 0) {
    issues.push('missing-positive-size')
  }

  const visibleContent = stripDrawioTextFallback(svg)
  const visibleElementCount = (visibleContent.match(/<(?:path|rect|circle|ellipse|line|polyline|polygon|text|image|foreignObject|use)\b/gi) || []).length
  const drawioCellCount = Array.from(visibleContent.matchAll(/\bdata-cell-id=["']([^"']+)["']/gi))
    .filter((match) => match[1] !== '0' && match[1] !== '1')
    .length

  if (visibleElementCount === 0) {
    issues.push('missing-visible-elements')
  }

  return {
    valid: issues.length === 0,
    width,
    height,
    viewBox,
    visibleElementCount,
    drawioCellCount,
    issues,
  }
}
