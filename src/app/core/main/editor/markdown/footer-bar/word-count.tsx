'use client'

import { Editor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { Type } from 'lucide-react'

interface WordCountProps {
  editor: Editor
}

export function WordCount({ editor }: WordCountProps) {
  const [characters, setCharacters] = useState(() => editor.storage.characterCount?.characters?.() ?? 0)

  useEffect(() => {
    if (!editor) {
      setCharacters(0)
      return
    }

    const updateCharacters = () => {
      setCharacters(editor.storage.characterCount?.characters?.() ?? 0)
    }

    updateCharacters()
    editor.on('create', updateCharacters)
    editor.on('update', updateCharacters)

    return () => {
      editor.off('create', updateCharacters)
      editor.off('update', updateCharacters)
    }
  }, [editor])

  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={`字符数：${characters}`}
    >
      <Type className="size-3" />
      <span>{characters}</span>
    </span>
  )
}
