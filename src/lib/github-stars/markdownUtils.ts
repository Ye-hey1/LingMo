/**
 * 去除 Markdown 格式，提取纯文本
 */
export const stripMarkdownFormatting = (text: string): string => {
  return text
    .replace(/!\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
};
