'use client'

import { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'

interface WordCountProps {
  editor: Editor
}

export function WordCount({ editor }: WordCountProps) {
  const getCharacters = () => {
    const extensionCount = editor.storage.characterCount?.characters?.()
    if (typeof extensionCount === 'number') {
      return extensionCount
    }

    return Math.max(0, editor.state.doc.content.size - 2)
  }
  const [characters, setCharacters] = useState(getCharacters)

  useEffect(() => {
    if (!editor) {
      setCharacters(0)
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null

    const updateCharacters = () => {
      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        timer = null
        setCharacters(getCharacters())
      }, 180)
    }

    setCharacters(getCharacters())
    editor.on('create', updateCharacters)
    editor.on('update', updateCharacters)

    return () => {
      if (timer) {
        clearTimeout(timer)
      }
      editor.off('create', updateCharacters)
      editor.off('update', updateCharacters)
    }
  }, [editor])

  return (
    <span
      className="inline-flex h-5 items-center px-1 text-[11px] tabular-nums text-muted-foreground"
      title={`字符数：${characters}`}
    >
      {characters}
    </span>
  )
}
