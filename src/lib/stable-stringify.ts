/**
 * 稳定的 JSON 序列化：对象 key 按字典序递归排序，保证相同结构产出相同字符串。
 * 用于缓存键、去重签名、checksum 等需要确定性输出的场景。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}
