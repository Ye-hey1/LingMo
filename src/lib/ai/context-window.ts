export const DEFAULT_CONTEXT_WINDOW = 32_768
export const DEFAULT_AGENT_CONTEXT_WINDOW = 128_000

const CONTEXT_WINDOW_PATTERNS: Array<[RegExp, number]> = [
  [/deepseek-v4-flash/i, 1_048_576],
  [/claude-?3/i, 200_000],
  [/claude-?sonnet/i, 200_000],
  [/gpt-4o/i, 128_000],
  [/gpt-4.*turbo/i, 128_000],
  [/gpt-4.*128k/i, 128_000],
  [/gpt-4.*32k/i, 32_000],
  [/gpt-4/i, 8_192],
  [/gpt-3\.5.*16k/i, 16_385],
  [/gpt-3\.5/i, 4_000],
  [/gemini-?3/i, 1_048_576],
  [/gemini-?2\.5/i, 1_048_576],
  [/gemini-?2/i, 1_048_576],
  [/gemini-?1\.5/i, 1_048_576],
  [/gemini/i, 1_000_000],
  [/deepseek-reasoner/i, 65_536],
  [/deepseek/i, 32_768],
  [/o[1-4]\b/i, 200_000],
  [/qwen-plus/i, 131_072],
  [/qwen-max/i, 32_768],
  [/qwen/i, 32_000],
  [/glm/i, 128_000],
  [/moonshot/i, 128_000],
  [/doubao/i, 128_000],
]

export function inferModelContextWindow(
  modelName: string | undefined,
  fallback = DEFAULT_CONTEXT_WINDOW,
): number {
  if (!modelName) return fallback

  for (const [pattern, contextWindow] of CONTEXT_WINDOW_PATTERNS) {
    if (pattern.test(modelName)) {
      return contextWindow
    }
  }

  return fallback
}

export function resolveModelContextWindow(
  configuredContextWindow: number | undefined,
  modelName: string | undefined,
  fallback = DEFAULT_CONTEXT_WINDOW,
): number {
  if (typeof configuredContextWindow === 'number' && configuredContextWindow > 0) {
    return configuredContextWindow
  }

  return inferModelContextWindow(modelName, fallback)
}
