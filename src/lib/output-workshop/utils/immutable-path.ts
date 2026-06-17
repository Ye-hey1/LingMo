/**
 * 通用不可变路径工具：按 "a.b.0.c" 形式的路径读写嵌套对象/数组。
 * 从 use-output-generation hook 提取，供 moka 编辑等场景复用。
 */

export function isPathIndex(segment: string): boolean {
  return /^\d+$/.test(segment)
}

export function getPathValue(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".").filter(Boolean)
  let current: unknown = root
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export function setPathValue(root: Record<string, unknown>, path: string, value: unknown): boolean {
  const parts = path.split(".").filter(Boolean)
  if (parts.length === 0) return false

  let current: Record<string, unknown> | unknown[] = root
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i]
    const nextPart = parts[i + 1]
    const key = isPathIndex(part) ? Number(part) : part
    const holder = current as Record<string, unknown>
    if (!holder[key] || typeof holder[key] !== "object") {
      holder[key] = isPathIndex(nextPart) ? [] : {}
    }
    current = holder[key] as Record<string, unknown> | unknown[]
  }

  const finalPart = parts[parts.length - 1]
  const finalKey = isPathIndex(finalPart) ? Number(finalPart) : finalPart
  ;(current as Record<string, unknown>)[finalKey] = value
  return true
}
