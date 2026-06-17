import { createOpenAIClient, getAISettings, validateAIService } from '@/lib/ai/utils'
import { readWorkspaceTextFile } from '@/lib/file-binary'
import { upsertNoteInsight } from '@/db/note-intelligence'
import type { CounterpointResult } from './types'

function noteTitle(notePath: string) {
  return notePath.split('/').pop()?.replace(/\.md$/i, '') || notePath
}

function trimForPrompt(content: string) {
  const normalized = content.replace(/\n{3,}/g, '\n\n').trim()
  return normalized.length > 9000 ? `${normalized.slice(0, 9000)}\n\n[内容已截断]` : normalized
}

export async function generateCounterpointForNote(
  notePath: string,
  content?: string,
): Promise<CounterpointResult> {
  const noteContent = content ?? await readWorkspaceTextFile(notePath)
  const aiConfig = await getAISettings('primaryModel')
  const validated = await validateAIService(aiConfig?.baseURL)
  if (!validated) {
    throw new Error('请先配置可用的 AI 服务。')
  }

  const openai = await createOpenAIClient(aiConfig)
  const title = `反观点：${noteTitle(notePath)}`
  const prompt = [
    '你是一个帮助用户发现认知盲区的笔记审阅助手。',
    '请阅读下面的笔记，生成一个可信、克制、有帮助的反观点。不要为了反驳而反驳，不要嘲讽。',
    '',
    '输出必须使用简体中文 Markdown，并严格包含这些小节：',
    '## 核心主张',
    '## 最强反方观点',
    '## 反方成立的前提',
    '## 可能忽略的证据',
    '## 最小验证动作',
    '',
    '笔记内容：',
    trimForPrompt(noteContent),
  ].join('\n')

  const completion = await openai.chat.completions.create({
    model: aiConfig?.model || '',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.35,
    max_tokens: 1400,
  })

  const markdown = completion.choices[0]?.message?.content?.trim()
  if (!markdown) {
    throw new Error('模型没有返回可用的反观点。')
  }

  await upsertNoteInsight({
    type: 'counterpoint',
    source_note: notePath,
    target_note: null,
    title,
    summary: markdown.split('\n').find(line => line.trim() && !line.startsWith('#'))?.slice(0, 160) || '已生成反观点。',
    rationale: '由当前笔记内容生成，用于暴露论证盲区。',
    confidence: 0.75,
  })

  return {
    notePath,
    title,
    markdown,
  }
}

export function appendCounterpointToContent(content: string, result: CounterpointResult) {
  const block = [
    '',
    '---',
    '',
    `# ${result.title}`,
    '',
    result.markdown.trim(),
    '',
  ].join('\n')

  return `${content.replace(/\s+$/g, '')}${block}`
}
