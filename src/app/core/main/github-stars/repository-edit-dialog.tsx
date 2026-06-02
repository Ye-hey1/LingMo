'use client'

import NextImage from 'next/image'
import { useEffect, useState } from 'react'
import { Github, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { GithubStarRepository, GithubStarRepositoryUpdate } from '@/types/github-stars'
import { parseTagInput } from './github-stars-utils'

export function RepositoryEditDialog({
  repository,
  open,
  categories,
  onOpenChange,
  onSave,
}: {
  repository: GithubStarRepository | null
  open: boolean
  categories: Array<{ value: string; label: string; count: number }>
  onOpenChange: (open: boolean) => void
  onSave: (repoId: number, update: GithubStarRepositoryUpdate) => Promise<void>
}) {
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [category, setCategory] = useState('__auto__')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!repository || !open) return

    const effectiveDescription = repository.customDescription || repository.aiSummary || repository.description || ''
    const effectiveTags = repository.customTags.length > 0
      ? repository.customTags
      : repository.aiTags.length > 0
        ? repository.aiTags
        : repository.topics

    setDescription(effectiveDescription)
    setTags(effectiveTags.join(', '))
    setCategory(repository.customCategory || '__auto__')
    setSaving(false)
  }, [open, repository])

  const handleSave = async () => {
    if (!repository) return

    setSaving(true)
    try {
      await onSave(repository.id, {
        customDescription: description.trim() || null,
        customTags: parseTagInput(tags),
        customCategory: category === '__auto__' ? null : category,
      })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑仓库信息</DialogTitle>
          <DialogDescription>
            自定义描述、标签和分类会优先于 GitHub 原始信息显示。
          </DialogDescription>
        </DialogHeader>
        {repository ? (
          <div className="space-y-5 py-2">
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
              {repository.ownerAvatarUrl ? (
                <NextImage
                  src={repository.ownerAvatarUrl}
                  alt=""
                  width={40}
                  height={40}
                  className="size-10 shrink-0 rounded-full border bg-muted"
                  loading="lazy"
                  unoptimized
                />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-muted">
                  <Github className="size-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{repository.name}</div>
                <div className="truncate text-xs text-muted-foreground">{repository.fullName}</div>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="github-star-repo-description">描述</Label>
              <Textarea
                id="github-star-repo-description"
                value={description}
                rows={5}
                placeholder="编辑卡片上显示的仓库描述"
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="github-star-repo-tags">标签</Label>
              <Textarea
                id="github-star-repo-tags"
                value={tags}
                rows={3}
                placeholder="用逗号或换行分隔标签"
                onChange={(event) => setTags(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label>分类</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="选择分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">自动分类</SelectItem>
                  {categories.filter(item => item.value !== 'all').map(item => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={!repository || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
