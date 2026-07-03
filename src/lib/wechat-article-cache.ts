import { getAllMarks } from '@/db/marks'
import { isWechatArticleMark, parseWechatArticleRecord } from '@/lib/wechat-article-record'

function normalizeUrl(value: string) {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.toString()
  } catch {
    return value.trim()
  }
}

export async function findSavedWechatArticle(url: string) {
  const targetUrl = normalizeUrl(url)
  const marks = await getAllMarks()

  for (const mark of marks) {
    if (mark.deleted === 1 || !isWechatArticleMark(mark)) continue

    const record = parseWechatArticleRecord(mark)
    const recordUrl = normalizeUrl(record.meta.url || mark.url || '')
    const markUrl = normalizeUrl(mark.url || '')
    if (recordUrl !== targetUrl && markUrl !== targetUrl) continue

    return {
      mark,
      record,
    }
  }

  return null
}
