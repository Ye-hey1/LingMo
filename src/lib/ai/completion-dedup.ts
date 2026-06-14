/**
 * Utilities for trimming AI completion text against text after the cursor.
 * Mirrors the FIM post-processing used by ai-fim so accepting ghost text does
 * not duplicate content that already exists after the cursor.
 */

export function removeSuffixOverlap(completion: string, suffix: string): string {
  if (!completion || !suffix) {
    return completion
  }

  const maxPossible = Math.min(completion.length, suffix.length)

  for (let overlap = maxPossible; overlap >= 1; overlap--) {
    if (completion.slice(completion.length - overlap) === suffix.slice(0, overlap)) {
      return completion.slice(0, completion.length - overlap)
    }
  }

  return completion
}

export function isSubsetOfSuffix(completion: string, suffix: string): boolean {
  if (!completion) {
    return true
  }

  return Boolean(suffix) && suffix.includes(completion)
}
