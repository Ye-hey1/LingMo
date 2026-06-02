'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { GithubStarCustomCategory } from '@/types/github-stars'
import { parseTagInput } from './github-stars-utils'

export function CategoryCreateDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (category: Pick<GithubStarCustomCategory, 'name' | 'keywords' | 'icon'>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [keywords, setKeywords] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setName('')
      setIcon('')
      setKeywords('')
      setSaving(false)
    }
  }, [open])

  const handleSave = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) return

    setSaving(true)
    try {
      await onSubmit({
        name: trimmedName,
        icon: icon.trim() || null,
        keywords: parseTagInput(keywords),
      })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加分类</DialogTitle>
          <DialogDescription>
            新分类会显示在左侧分类栏，可用于卡片分类选择和后续自动匹配。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="github-star-category-name">分类名称</Label>
            <Input
              id="github-star-category-name"
              value={name}
              placeholder="例如：AI工具、效率工具、阅读收藏"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="github-star-category-icon">图标</Label>
            <Input
              id="github-star-category-icon"
              value={icon}
              maxLength={4}
              placeholder="可输入一个 emoji"
              onChange={(event) => setIcon(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="github-star-category-keywords">关键词</Label>
            <Input
              id="github-star-category-keywords"
              value={keywords}
              placeholder="用逗号分隔，例如 agent, llm, prompt"
              onChange={(event) => setKeywords(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
