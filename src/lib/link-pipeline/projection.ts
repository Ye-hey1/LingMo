export interface LinkProjectionSnapshot {
  desc?: string
  content?: string
}

export function createLinkProjectionFingerprint(snapshot: LinkProjectionSnapshot): string {
  const value = `${snapshot.desc || ''}\u0000${snapshot.content || ''}`
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
