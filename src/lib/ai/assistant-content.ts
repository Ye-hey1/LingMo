import { sanitizeVisibleAssistantContent } from '@/lib/agent/parse-action-input'

const ASSISTANT_META_BLOCKQUOTE_PATTERNS = [
  /^基于(?:当前)?(?:笔记|文档|文件|资料|上下文)[《"“].*[》"”]?$/,
  /^(?:参考|依据)(?:笔记|文档|文件|资料|上下文)[：:《"“].*$/,
  /^(?:来源|引用)(?:[:：]\s*)?.*$/,
  /^(?:总结完毕|总结完成|已完成|已总结|整理完毕|分析完毕)(?:\s|$|[，,。.!！]).*$/,
]

const INTERNAL_OUTPUT_PATTERNS = [
  /^【系统提示[:：].*$/,
  /^---\s*截断元数据\s*---$/,
  /^---\s*分页与精细读取指南\s*---$/,
  /^-{12,}$/,
  /^-\s*原始字符数[:：]/,
  /^-\s*当前展示[:：]/,
  /^-\s*隐藏字符数[:：]/,
  /^-\s*如果你需要阅读隐藏的部分/,
  /^-\s*请在下一轮中使用具有精细参数的工具/,
  /^你的上一条输出因为达到模型输出长度上限被截断/,
  /^\.\.\. \[已截断\s*\d+\s*字符\] \.\.\.$/,
]

export function cleanAssistantGeneratedContent(value: string): string {
  if (!value) {
    return value
  }

  return sanitizeVisibleAssistantContent(value)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      const normalized = trimmed.replace(/^>\s*/, '').trim()
      if (!normalized) {
        return true
      }

      if (INTERNAL_OUTPUT_PATTERNS.some(pattern => pattern.test(normalized))) {
        return false
      }

      const isMetaBlockquote = trimmed.startsWith('>')
        && ASSISTANT_META_BLOCKQUOTE_PATTERNS.some(pattern => pattern.test(normalized))

      return !isMetaBlockquote
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
