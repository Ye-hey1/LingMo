'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, GitBranch, Download } from 'lucide-react'
import { useSkillsV2Store } from '@/stores/skills-v2'
import { useToast } from '@/hooks/use-toast'

interface SkillGitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SkillGitDialog({ open, onOpenChange }: SkillGitDialogProps) {
  const t = useTranslations('settings.skills')
  const { toast } = useToast()
  const { previewGit, installFromGit, previewing, installing, previewSkills } = useSkillsV2Store()
  const [url, setUrl] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const handlePreview = async () => {
    if (!url.trim()) {
      toast({ title: t('noGitUrl'), variant: 'destructive' })
      return
    }
    setSelected(new Set())
    try {
      const skills = await previewGit(url)
      if (skills.length === 0) {
        toast({ title: t('noSkillsInRepo') })
      }
    } catch (e) {
      toast({ title: t('previewError'), description: String(e), variant: 'destructive' })
    }
  }

  const handleInstall = async () => {
    if (selected.size === 0) return
    try {
      for (const name of selected) {
        await installFromGit(url, name)
      }
      toast({ title: t('installSuccess'), description: `${selected.size} skills` })
      onOpenChange(false)
      setUrl('')
      setSelected(new Set())
    } catch (e) {
      toast({ title: t('installError'), description: String(e), variant: 'destructive' })
    }
  }

  const toggleSelect = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === previewSkills.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(previewSkills.map(s => s.name)))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="size-5" />
            {t('previewSkills')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* URL Input */}
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('gitUrlPlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && handlePreview()}
            />
            <Button onClick={handlePreview} disabled={previewing || !url.trim()}>
              {previewing ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
              {previewing ? t('previewing') : t('preview')}
            </Button>
          </div>

          {/* Skills List */}
          {previewSkills.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t('selectSkillsToInstall')} ({previewSkills.length})
                </span>
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  {selected.size === previewSkills.length ? t('cancel') : t('importAll')}
                </Button>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1">
                {previewSkills.map((skill) => (
                  <label
                    key={skill.name}
                    className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.has(skill.name)}
                      onCheckedChange={() => toggleSelect(skill.name)}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{skill.name}</span>
                      {skill.description && (
                        <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {previewSkills.length > 0 && (
          <DialogFooter>
            <Button
              onClick={handleInstall}
              disabled={selected.size === 0 || installing}
            >
              {installing ? (
                <Loader2 className="size-4 animate-spin mr-1" />
              ) : (
                <Download className="size-4 mr-1" />
              )}
              {t('install')} ({selected.size})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Eye({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
