import type OpenAI from 'openai'

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam

function getTextContent(message: ChatMessage) {
  return typeof message.content === 'string' ? message.content.trim() : ''
}

function mergeSystemPrompts(primaryPrompt: string, messages: ChatMessage[]) {
  const sections: string[] = []
  const seen = new Set<string>()

  for (const content of [
    primaryPrompt,
    ...messages.filter(message => message.role === 'system').map(getTextContent),
  ]) {
    const normalized = content.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    sections.push(normalized)
  }

  return sections.join('\n\n')
}

export function buildHarnessConversationMessages(
  systemPrompt: string,
  userInput: string,
  contextOrMessages?: string | ChatMessage[],
): ChatMessage[] {
  if (Array.isArray(contextOrMessages) && contextOrMessages.length > 0) {
    const conversationMessages = contextOrMessages.filter(message => message.role !== 'system')
    const latestMessage = conversationMessages.at(-1)
    const includesCurrentUserMessage = latestMessage?.role === 'user' &&
      getTextContent(latestMessage) === userInput.trim()
    return [
      { role: 'system', content: mergeSystemPrompts(systemPrompt, contextOrMessages) },
      ...conversationMessages,
      ...(includesCurrentUserMessage ? [] : [{ role: 'user' as const, content: userInput }]),
    ]
  }

  const contextualMessages = typeof contextOrMessages === 'string' && contextOrMessages.trim()
    ? [{ role: 'system' as const, content: contextOrMessages.trim() }]
    : []

  return [
    { role: 'system', content: mergeSystemPrompts(systemPrompt, contextualMessages) },
    { role: 'user', content: userInput },
  ]
}
