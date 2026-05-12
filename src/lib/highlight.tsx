import React from 'react'

export function highlightTextReact(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text

  const parts: React.ReactNode[] = []
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase().trim()

  let lastIndex = 0
  let index = lowerText.indexOf(lowerQuery)

  while (index !== -1) {
    if (index > lastIndex) {
      parts.push(text.substring(lastIndex, index))
    }
    parts.push(
      <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 text-foreground px-0.5 rounded">
        {text.substring(index, index + lowerQuery.length)}
      </mark>
    )
    lastIndex = index + lowerQuery.length
    index = lowerText.indexOf(lowerQuery, lastIndex)
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }

  return <>{parts}</>
}
