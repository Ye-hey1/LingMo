export const CLAW_STREAM_FORMAT_SOURCE =
  "claw-code/rust/crates/rusty-claude-cli/src/render.rs"

export const CLAW_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const

export const CLAW_STATUS_SYMBOL = {
  done: "✔",
  error: "✘",
} as const

type FenceLine = {
  character: "`" | "~"
  length: number
  hasInfo: boolean
  indent: number
}

type FenceMarker = {
  character: "`" | "~"
  length: number
}

type FenceRewrite = {
  character: "`" | "~"
  newLength: number
  indent: number
}

function splitLinesInclusive(text: string) {
  return text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+/g) || []
}

function stripLineEnding(line: string) {
  return line.replace(/(?:\r\n|\n|\r)$/, "")
}

function getLineEnding(line: string) {
  return line.match(/(?:\r\n|\n|\r)$/)?.[0] || ""
}

function parseFenceLine(line: string): FenceLine | null {
  const trimmed = stripLineEnding(line)
  const indent = trimmed.match(/^ */)?.[0].length || 0
  if (indent > 3) return null

  const rest = trimmed.slice(indent)
  const character = rest[0]
  if (character !== "`" && character !== "~") return null

  let length = 0
  while (rest[length] === character) length += 1
  if (length < 3) return null

  const info = rest.slice(length)
  if (character === "`" && info.includes("`")) return null

  return {
    character,
    length,
    hasInfo: info.trim().length > 0,
    indent,
  }
}

function parseFenceOpener(line: string): FenceMarker | null {
  const fence = parseFenceLine(line)
  return fence ? { character: fence.character, length: fence.length } : null
}

function lineClosesFence(line: string, opener: FenceMarker) {
  const indent = line.match(/^ */)?.[0].length || 0
  if (indent > 3) return false

  const rest = line.slice(indent)
  let length = 0
  while (rest[length] === opener.character) length += 1
  if (length < opener.length) return false

  return /^[ \t]*$/.test(rest.slice(length))
}

export function normalizeClawNestedFences(markdown: string) {
  const lines = splitLinesInclusive(markdown)
  const fenceInfo = lines.map(parseFenceLine)
  const stack: Array<{ lineIndex: number; fence: FenceLine }> = []
  const pairs: Array<{ openerIndex: number; closerIndex: number; innerMax: number }> = []

  for (let index = 0; index < fenceInfo.length; index += 1) {
    const fence = fenceInfo[index]
    if (!fence) continue

    if (fence.hasInfo) {
      stack.push({ lineIndex: index, fence })
      continue
    }

    const top = stack[stack.length - 1]
    const closesTop = Boolean(
      top &&
      top.fence.character === fence.character &&
      fence.length >= top.fence.length,
    )

    if (closesTop && top) {
      stack.pop()
      const innerMax = fenceInfo
        .slice(top.lineIndex + 1, index)
        .reduce((max, innerFence) => Math.max(max, innerFence?.length || 0), 0)
      pairs.push({
        openerIndex: top.lineIndex,
        closerIndex: index,
        innerMax,
      })
    } else {
      stack.push({ lineIndex: index, fence })
    }
  }

  const rewrites = new Map<number, FenceRewrite>()
  for (const pair of pairs) {
    const opener = fenceInfo[pair.openerIndex]
    const closer = fenceInfo[pair.closerIndex]
    if (!opener || !closer || opener.length > pair.innerMax) continue

    const rewrite = {
      character: opener.character,
      newLength: pair.innerMax + 1,
      indent: opener.indent,
    }
    rewrites.set(pair.openerIndex, rewrite)
    rewrites.set(pair.closerIndex, {
      character: closer.character,
      newLength: pair.innerMax + 1,
      indent: closer.indent,
    })
  }

  if (rewrites.size === 0) return markdown

  return lines.map((line, index) => {
    const rewrite = rewrites.get(index)
    const fence = fenceInfo[index]
    if (!rewrite || !fence) return line

    const body = stripLineEnding(line)
    const lineEnding = getLineEnding(line)
    const info = body.slice(fence.indent + fence.length)
    return `${" ".repeat(rewrite.indent)}${rewrite.character.repeat(rewrite.newLength)}${info}${lineEnding}`
  }).join("")
}

export function findClawStreamSafeBoundary(markdown: string): number | null {
  let openFence: FenceMarker | null = null
  let lastBoundary: number | null = null
  let cursor = 0

  for (const line of splitLinesInclusive(markdown)) {
    const offset = cursor
    cursor += line.length
    const lineWithoutNewline = stripLineEnding(line)

    if (openFence) {
      if (lineClosesFence(lineWithoutNewline, openFence)) {
        openFence = null
        lastBoundary = offset + line.length
      }
      continue
    }

    const opener = parseFenceOpener(lineWithoutNewline)
    if (opener) {
      openFence = opener
      continue
    }

    if (lineWithoutNewline.trim().length === 0) {
      lastBoundary = offset + line.length
    }
  }

  return lastBoundary
}

export function getClawStreamVisibleMarkdown(markdown: string, streaming: boolean) {
  if (!streaming) return markdown
  const boundary = findClawStreamSafeBoundary(markdown)
  return boundary == null ? "" : markdown.slice(0, boundary)
}

export function getClawStatusGlyph(tone: "running" | "done" | "error", frameIndex: number) {
  if (tone === "done") return CLAW_STATUS_SYMBOL.done
  if (tone === "error") return CLAW_STATUS_SYMBOL.error
  return CLAW_SPINNER_FRAMES[frameIndex % CLAW_SPINNER_FRAMES.length]
}

export function formatClawStatusLabel(label: string) {
  const normalized = label.trim()
  const labels: Record<string, string> = {
    "准备中": "Preparing agent",
    "思考中": "Thinking",
    "正在写答案": "Writing answer",
    "准备调用工具": "Preparing tool call",
    "正在调用工具": "Calling tool",
    "工具调用完成": "Tool complete",
    "工具调用已取消": "Tool cancelled",
    "工具步骤失败，正在恢复": "Tool failed, recovering",
    "工具调用失败": "Tool failed",
    "工具被策略阻止": "Tool blocked",
    "已跳过额外工具调用": "Skipped tool call",
    "工具选择已调整": "Tool adjusted",
    "使用缓存结果": "Using cached result",
    "等待确认": "Waiting for confirmation",
    "处理中": "Working",
    "已思考": "Done",
    "完成": "Done",
    "已停止": "Stopped",
    "执行失败": "Failed",
  }
  return labels[normalized] || normalized || "Working"
}
