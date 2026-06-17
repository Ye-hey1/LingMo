export interface SkillScriptDecodeResult {
  output: string
  warnings: string[]
  outputEncoding: 'utf8' | 'utf8-replacement'
}

export type SkillScriptOutputChunk =
  | string
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | number[]

function normalizeOutputChunk(value: SkillScriptOutputChunk): string | Uint8Array {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Uint8Array) {
    return value
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }

  if (Array.isArray(value)) {
    return new Uint8Array(value)
  }

  return String(value)
}

export function decodeSkillScriptOutput(value: SkillScriptOutputChunk): SkillScriptDecodeResult {
  const normalized = normalizeOutputChunk(value)
  if (typeof normalized === 'string') {
    return { output: normalized, warnings: [], outputEncoding: 'utf8' }
  }

  try {
    const strict = new TextDecoder('utf-8', { fatal: true })
    return { output: strict.decode(normalized), warnings: [], outputEncoding: 'utf8' }
  } catch {
    const output = new TextDecoder('utf-8', { fatal: false }).decode(normalized)
    return {
      output,
      warnings: ['Script output contained invalid UTF-8 bytes and was decoded with replacement characters.'],
      outputEncoding: 'utf8-replacement',
    }
  }
}

export function decodeSkillScriptOutputChunks(
  chunks: Array<SkillScriptOutputChunk | null | undefined>,
): SkillScriptDecodeResult {
  let output = ''
  const warnings: string[] = []
  let outputEncoding: SkillScriptDecodeResult['outputEncoding'] = 'utf8'

  for (const chunk of chunks) {
    if (chunk == null) continue
    const decoded = decodeSkillScriptOutput(chunk)
    output += decoded.output
    warnings.push(...decoded.warnings)
    if (decoded.outputEncoding === 'utf8-replacement') {
      outputEncoding = 'utf8-replacement'
    }
  }

  return { output, warnings, outputEncoding }
}
