import { insertMark } from '@/db/marks'
import { ensureTagByName } from '@/db/tags'
import {
  fetchWechatArticleAsMarkdown,
  isWechatArticleUrl,
  parseWechatArticleHtml,
  WECHAT_ARTICLE_TAG_NAME,
} from '@/lib/wechat-article'
import { findSavedWechatArticle } from '@/lib/wechat-article-cache'

export async function captureWechatArticleToMark(url: string, htmlSource = '') {
  if (!isWechatArticleUrl(url)) {
    throw new Error('这不是微信公众号文章链接')
  }

  const saved = await findSavedWechatArticle(url)
  if (saved) return saved.mark

  const article = htmlSource.trim()
    ? parseWechatArticleHtml(htmlSource.trim(), url)
    : await fetchWechatArticleAsMarkdown(url)
  const articleTag = await ensureTagByName(WECHAT_ARTICLE_TAG_NAME)

  await insertMark({
    tagId: articleTag.id,
    type: 'link',
    desc: article.desc,
    content: article.content,
    url,
  })

  const nextSaved = await findSavedWechatArticle(url)
  if (nextSaved) return nextSaved.mark

  throw new Error('公众号文章已保存，但未能读取保存记录')
}
