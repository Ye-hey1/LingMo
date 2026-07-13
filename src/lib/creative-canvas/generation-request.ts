import type { AiConfig } from '@/app/core/setting/config'
import type { CreativeCanvasGenerationOptions } from '@/types/creative-canvas'

const OPTIONAL_IMAGE_REQUEST_PARAMETERS = new Set([
  'n',
  'quality',
  'response_format',
  'size',
])

function normalizeCount(count: unknown) {
  const value = Number(count)
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(4, Math.floor(value)))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getUnsupportedOptionalParameter(error: unknown) {
  const message = getErrorMessage(error)
  const patterns = [
    /Setting\s+[`'"]([^`'"]+)[`'"]\s+is\s+not\s+supported/i,
    /Unsupported\s+(?:parameter|param)\s*:?\s*[`'"]?([a-z][\w-]*)/i,
    /(?:unknown|unrecognized)\s+(?:parameter|argument)\s*:?\s*[`'"]?([a-z][\w-]*)/i,
  ]

  for (const pattern of patterns) {
    const parameter = message.match(pattern)?.[1]?.toLowerCase()
    if (parameter && OPTIONAL_IMAGE_REQUEST_PARAMETERS.has(parameter)) return parameter
  }

  return null
}

export function buildImageRequest(
  aiConfig: AiConfig,
  prompt: string,
  options?: CreativeCanvasGenerationOptions,
) {
  const body: Record<string, unknown> = {
    model: options?.modelSelection ? aiConfig.model : options?.model?.trim() || aiConfig.model,
    prompt,
  }
  const count = normalizeCount(options?.count)
  const size = options?.size?.trim()
  const quality = options?.quality?.trim()

  // OpenAI-compatible providers commonly reject redundant OpenAI-only defaults.
  if (count > 1) body.n = count
  if (size) body.size = size
  if (quality && quality.toLowerCase() !== 'standard') body.quality = quality

  return body
}

export async function invokeImageRequestWithCompatibility<T>(
  request: Record<string, unknown>,
  invoke: (compatibleRequest: Record<string, unknown>) => Promise<T>,
) {
  let compatibleRequest = { ...request }

  while (true) {
    try {
      return {
        response: await invoke(compatibleRequest),
        request: compatibleRequest,
      }
    } catch (error) {
      const unsupportedParameter = getUnsupportedOptionalParameter(error)
      if (!unsupportedParameter || !(unsupportedParameter in compatibleRequest)) throw error

      const nextRequest = { ...compatibleRequest }
      delete nextRequest[unsupportedParameter]
      compatibleRequest = nextRequest
    }
  }
}
