export function getOutputFileName(path?: string | null): string {
  if (!path) return ""
  return path.replace(/\\/g, "/").split("/").pop() || path
}

export function getOutputTitleFromPath(path?: string | null, fallback = ""): string {
  const fileName = getOutputFileName(path)
  return fileName.replace(/\.[^.]+$/, "") || fallback
}
