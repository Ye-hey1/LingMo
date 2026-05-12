const ASSISTANT_META_BLOCKQUOTE_PATTERNS = [
  /^基于(?:当前)?(?:笔记|文档|文件|资料|上下文)[《"“].*[》"”]?$/,
  /^(?:参考|依据)(?:笔记|文档|文件|资料|上下文)[：:《"“].*$/,
  /^(?:来源|引用)(?:[:：]\s*)?.*$/,
  /^(?:总结完毕|总结完成|已完成|已总结|整理完毕|分析完毕)(?:\s|$|[，,。.!！]).*$/,
]

export function cleanAssistantGeneratedContent(value: string): string {
  if (!value) {
    return value
  }

  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      const normalized = trimmed.replace(/^>\s*/, '').trim()
      if (!normalized) {
        return true
      }

      const isMetaBlockquote = trimmed.startsWith('>')
        && ASSISTANT_META_BLOCKQUOTE_PATTERNS.some(pattern => pattern.test(normalized))

      return !isMetaBlockquote
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
