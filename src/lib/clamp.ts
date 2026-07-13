/**
 * 将任意输入钳制到 [min, max] 整数区间；非有限数字返回 fallback。
 * 签名 (value, fallback, min, max)。
 */
export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}
