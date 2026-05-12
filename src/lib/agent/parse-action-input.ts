function closeJsonStructures(jsonStr: string): string {
  const stack: string[] = []
  let inString = false
  let escapeNext = false

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"') {
      inString = !inString
      if (!inString && stack[stack.length - 1] === '"') {
        stack.pop()
      } else if (inString) {
        stack.push('"')
      }
      continue
    }

    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char)
      } else if (char === '}' && stack[stack.length - 1] === '{') {
        stack.pop()
      } else if (char === ']' && stack[stack.length - 1] === '[') {
        stack.pop()
      }
    }
  }

  if (inString) {
    jsonStr += '"'
    if (stack[stack.length - 1] === '"') {
      stack.pop()
    }
  }

  while (stack.length > 0) {
    const open = stack.pop()
    if (open === '"') {
      jsonStr += '"'
    } else if (open === '[') {
      jsonStr += ']'
    } else if (open === '{') {
      jsonStr += '}'
    }
  }

  return jsonStr
}

function stripJsonWrappers(jsonStr: string): string {
  const stripped = jsonStr
    .replace(/<\|begin_of_box\|>/g, '')
    .replace(/<\|end_of_box\|>/g, '')
    .trim()

  const fenced = stripped.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/)
  if (fenced) {
    return fenced[1].trim()
  }

  return stripped
}

function extractFirstJsonObject(jsonStr: string): string {
  const start = jsonStr.indexOf('{')
  if (start === -1) {
    return jsonStr
  }

  let depth = 0
  let inString = false
  let escapeNext = false

  for (let i = start; i < jsonStr.length; i++) {
    const char = jsonStr[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (inString) {
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return jsonStr.slice(start, i + 1)
      }
    }
  }

  return jsonStr.slice(start)
}

function escapeLiteralNewlinesInStrings(jsonStr: string): string {
  let result = ''
  let inString = false
  let escapeNext = false

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i]

    if (escapeNext) {
      result += char
      escapeNext = false
      continue
    }

    if (char === '\\') {
      result += char
      escapeNext = true
      continue
    }

    if (char === '"') {
      inString = !inString
      result += char
      continue
    }

    if (inString && char === '\n') {
      result += '\\n'
      continue
    }

    if (inString && char === '\r') {
      result += '\\r'
      continue
    }

    result += char
  }

  return result
}

function normalizeParsedJson(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, any>
}

function tryParseObject(jsonStr: string): Record<string, any> | null {
  try {
    return normalizeParsedJson(JSON.parse(jsonStr))
  } catch {
    return null
  }
}

export interface StructuredAction {
  tool: string
  params: Record<string, any>
  thought?: string
}

export function parseActionInputJson(jsonStr: string): Record<string, any> | null {
  const stripped = stripJsonWrappers(jsonStr)
  const candidates = stripped.trim().startsWith('[')
    ? [stripped]
    : [
        stripped,
        extractFirstJsonObject(stripped),
      ]

  for (const candidate of candidates) {
    const parsed = tryParseObject(candidate)
    if (parsed) {
      return parsed
    }

    const repaired = closeJsonStructures(escapeLiteralNewlinesInStrings(candidate))
    const repairedParsed = tryParseObject(repaired)
    if (repairedParsed) {
      return repairedParsed
    }
  }

  return null
}

function getStringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getParamsField(value: unknown): Record<string, any> | null {
  if (value === undefined || value === null) {
    return {}
  }

  if (typeof value === 'string') {
    return parseActionInputJson(value)
  }

  return normalizeParsedJson(value)
}

function isEscapedAt(value: string, index: number): boolean {
  let slashCount = 0
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function decodeLooseJsonString(value: string): string {
  return value
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function findFieldStringStart(source: string, fieldNames: string[]): number {
  for (const name of fieldNames) {
    const match = new RegExp(`["']${name}["']\\s*:\\s*["']`, 'i').exec(source)
    if (match?.index !== undefined) {
      return match.index + match[0].length - 1
    }
  }
  return -1
}

function readStrictStringAt(source: string, quoteIndex: number): string | undefined {
  if (quoteIndex < 0 || (source[quoteIndex] !== '"' && source[quoteIndex] !== "'")) {
    return undefined
  }

  const quote = source[quoteIndex]
  let value = ''
  let escapeNext = false

  for (let i = quoteIndex + 1; i < source.length; i++) {
    const char = source[i]

    if (escapeNext) {
      value += `\\${char}`
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === quote) {
      return decodeLooseJsonString(value)
    }

    value += char
  }

  return undefined
}

function findLooseStringField(source: string, fieldNames: string[]): string | undefined {
  return readStrictStringAt(source, findFieldStringStart(source, fieldNames))
}

function isJsonLikeTailAfterString(tail: string): boolean {
  const cleaned = tail
    .replace(/```(?:json|JSON|markdown|MARKDOWN)?\s*$/g, '')
    .trim()

  return cleaned === '' || /^[}\]\s,;`]+$/.test(cleaned)
}

function findLooseContentField(source: string): { value: string; complete: boolean } | undefined {
  const quoteIndex = findFieldStringStart(source, ['content'])
  if (quoteIndex < 0) {
    return undefined
  }

  const valueStart = quoteIndex + 1
  let valueEnd = -1

  for (let i = source.length - 1; i > valueStart; i--) {
    if (source[i] !== '"' || isEscapedAt(source, i)) {
      continue
    }

    if (isJsonLikeTailAfterString(source.slice(i + 1))) {
      valueEnd = i
      break
    }
  }

  const rawValue = valueEnd >= valueStart
    ? source.slice(valueStart, valueEnd)
    : source.slice(valueStart)

  return {
    value: decodeLooseJsonString(
      rawValue
        .replace(/\s*```\s*$/g, '')
        .replace(/\s*[}\]]+\s*$/g, '')
    ).trimEnd(),
    complete: valueEnd >= valueStart,
  }
}

function hasStructuredAgentControlFields(source: string): boolean {
  return /["'](?:action|tool|tool_name)["']\s*:/.test(source) ||
    /["'](?:action_input|actionInput|params|parameters)["']\s*:/.test(source)
}

function parseLooseStructuredActionJson(jsonStr: string): StructuredAction | null {
  const source = stripJsonWrappers(jsonStr)
  if (!hasStructuredAgentControlFields(source)) {
    return null
  }

  const tool = findLooseStringField(source, ['action', 'tool', 'tool_name'])
  if (!tool || /^(final\s*answer|final)$/i.test(tool)) {
    return null
  }

  const params: Record<string, any> = {}
  const fileName = findLooseStringField(source, ['fileName', 'filename', 'name'])
  const filePath = findLooseStringField(source, ['filePath', 'filepath', 'path'])
  const folderPath = findLooseStringField(source, ['folderPath', 'folder'])
  const query = findLooseStringField(source, ['query'])
  const url = findLooseStringField(source, ['url'])
  const contentField = findLooseContentField(source)
  const content = contentField?.value

  if (fileName !== undefined) params.fileName = fileName
  if (filePath !== undefined) params.filePath = filePath
  if (folderPath !== undefined) params.folderPath = folderPath
  if (query !== undefined) params.query = query
  if (url !== undefined) params.url = url
  if (content !== undefined) params.content = content

  if (/^(create_file|update_markdown_file|safe_write_file)$/i.test(tool) && (!contentField || !contentField.complete)) {
    return null
  }

  if (Object.keys(params).length === 0) {
    return null
  }

  return {
    tool,
    params,
    thought: findLooseStringField(source, ['thought']),
  }
}

export function parseStructuredActionJson(jsonStr: string): StructuredAction | null {
  const source = stripJsonWrappers(jsonStr)
  const parsed = parseActionInputJson(jsonStr)
  if (!parsed) {
    return parseLooseStructuredActionJson(jsonStr)
  }

  const tool = getStringField(parsed.action) ||
    getStringField(parsed.tool) ||
    getStringField(parsed.tool_name)

  if (!tool || /^(final\s*answer|final)$/i.test(tool)) {
    return null
  }

  const rawContentField = findLooseContentField(source)
  if (/^(create_file|update_markdown_file|safe_write_file)$/i.test(tool) && rawContentField && !rawContentField.complete) {
    return null
  }

  const params = getParamsField(
    parsed.action_input ??
    parsed.actionInput ??
    parsed.params ??
    parsed.parameters
  )

  if (!params) {
    return parseLooseStructuredActionJson(jsonStr)
  }

  return {
    tool,
    params,
    thought: getStringField(parsed.thought),
  }
}

function getFinalAnswerField(value: Record<string, any> | null): string | undefined {
  if (!value) {
    return undefined
  }

  return getStringField(value.final_answer) ||
    getStringField(value.finalAnswer) ||
    getStringField(value.answer) ||
    getStringField(value.response) ||
    getStringField(value.output) ||
    getStringField(value.content)
}

export function parseStructuredFinalAnswerJson(jsonStr: string): string | null {
  const parsed = parseActionInputJson(jsonStr)
  if (!parsed) {
    return null
  }

  const directAnswer = getFinalAnswerField(parsed)
  if (directAnswer) {
    return directAnswer
  }

  const action = getStringField(parsed.action) ||
    getStringField(parsed.tool) ||
    getStringField(parsed.tool_name)

  if (!action || !/^(final\s*answer|final)$/i.test(action)) {
    return null
  }

  const rawParams = parsed.action_input ??
    parsed.actionInput ??
    parsed.params ??
    parsed.parameters

  if (typeof rawParams === 'string' && rawParams.trim()) {
    const parsedParams = parseActionInputJson(rawParams)
    return getFinalAnswerField(parsedParams) || rawParams.trim()
  }

  return getFinalAnswerField(getParamsField(rawParams)) || null
}

export function isStructuredThoughtOnlyJson(jsonStr: string): boolean {
  const parsed = parseActionInputJson(jsonStr)
  if (!parsed) {
    return false
  }

  const thought = getStringField(parsed.thought)
  if (!thought) {
    return false
  }

  const action = getStringField(parsed.action) ||
    getStringField(parsed.tool) ||
    getStringField(parsed.tool_name)

  return !action && !getFinalAnswerField(parsed)
}

export function isIncompleteStructuredAgentJson(jsonStr: string): boolean {
  const parsed = parseActionInputJson(jsonStr)
  if (!parsed) {
    return hasStructuredAgentControlFields(stripJsonWrappers(jsonStr))
  }

  const hasAgentControlField =
    'thought' in parsed ||
    'action' in parsed ||
    'tool' in parsed ||
    'tool_name' in parsed ||
    'action_input' in parsed ||
    'actionInput' in parsed ||
    'params' in parsed ||
    'parameters' in parsed

  if (!hasAgentControlField) {
    return false
  }

  return !parseStructuredActionJson(jsonStr) && !parseStructuredFinalAnswerJson(jsonStr)
}

export interface BatchStructuredAction {
  thought?: string
  actions: Array<{
    tool: string
    params: Record<string, any>
  }>
}

const MAX_BATCH_SIZE = 3

export function parseBatchActionJson(jsonStr: string): BatchStructuredAction | null {
  const parsed = parseActionInputJson(jsonStr)
  if (!parsed || typeof parsed !== 'object') return null

  const actions = parsed.actions ?? parsed.action_list ?? parsed.batch
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > MAX_BATCH_SIZE) {
    return null
  }

  const result: BatchStructuredAction = {
    thought: parsed.thought ?? undefined,
    actions: [],
  }

  for (const item of actions) {
    if (!item || typeof item !== 'object') return null

    const tool = item.action ?? item.tool ?? item.tool_name ?? item.name
    if (typeof tool !== 'string' || !tool.trim()) return null

    const params = item.action_input ?? item.actionInput ?? item.params ?? item.parameters ?? {}
    if (typeof params !== 'object' || Array.isArray(params)) return null

    result.actions.push({ tool: tool.trim(), params })
  }

  return result.actions.length > 0 ? result : null
}
