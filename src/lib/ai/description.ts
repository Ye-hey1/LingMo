import OpenAI from 'openai';
import { getAISettings, prepareMessages, createOpenAIClient, handleAIError } from './utils';

type ImageDescriptionMode = 'brief' | 'structured'

interface ImageDescriptionOptions {
  mode?: ImageDescriptionMode
  sourceLabel?: string
}

/**
 * 生成简短描述
 */
export async function fetchAiDesc(text: string) {
  try {
    const aiConfig = await getAISettings('markDescModel')
    const descContent = `Based on the screenshot content: ${text}, return a concise Chinese title within 50 characters. Avoid special characters and quotes.`
    const { messages } = await prepareMessages(descContent)

    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
    })

    return completion.choices[0].message.content || ''
  } catch (error) {
    handleAIError(error, false)
    return null
  }
}

function buildImagePrompt(mode: ImageDescriptionMode, sourceLabel: string) {
  if (mode === 'structured') {
    return [
      `Please analyze the ${sourceLabel} and return concise Simplified Chinese Markdown.`,
      'Use exactly this structure:',
      '# 主题',
      '一句话概括主题',
      '',
      '## 关键信息',
      '- 最多 5 条',
      '',
      '## 文本摘录',
      '- 提取画面中最重要的可见文本，最多 8 条',
      '',
      'Requirements:',
      '1. Do not mention model or recognition process.',
      '2. Keep each bullet short and information-dense.',
      '3. If text is limited, infer the screen topic conservatively.',
    ].join('\n')
  }

  return `Based on the ${sourceLabel} content, return a concise Chinese description.`
}

/**
 * 通过图片生成描述
 */
export async function fetchAiDescByImage(base64: string, options?: ImageDescriptionOptions) {
  try {
    const aiConfig = await getAISettings('imageMethodModel')
    const mode = options?.mode || 'brief'
    const sourceLabel = options?.sourceLabel || 'screenshot'
    const descContent = buildImagePrompt(mode, sourceLabel)
    const { messages: preparedMessages } = await prepareMessages(descContent)
    const openai = await createOpenAIClient(aiConfig)

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    for (let i = 0; i < preparedMessages.length; i++) {
      const msg = preparedMessages[i]

      if (i === preparedMessages.length - 1 && msg.role === 'user') {
        const textContent = typeof msg.content === 'string' ? msg.content : descContent
        messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: base64,
              },
            },
            {
              type: 'text',
              text: textContent,
            },
          ],
        })
      } else {
        messages.push(msg)
      }
    }

    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
    })

    return completion.choices[0].message.content || ''
  } catch (error) {
    handleAIError(error, false)
    return null
  }
}
