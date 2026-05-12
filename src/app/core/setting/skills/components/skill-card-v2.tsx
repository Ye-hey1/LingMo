'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Sparkles, Trash2, GitBranch, Archive, FolderOpen, Monitor, Loader2 } from 'lucide-react'
import type { SkillRecord } from '@/stores/skills-v2'

const SOURCE_ICONS: Record<string, React.ReactNode> = {
  git: <GitBranch className="size-3.5" />,
  archive: <Archive className="size-3.5" />,
  local: <FolderOpen className="size-3.5" />,
  discovered: <Monitor className="size-3.5" />,
}

interface SkillCardV2Props {
  skill: SkillRecord
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  sourceLabel: string
  deleteTitle: string
  deleteDesc: string
  cancelLabel: string
  deleteLabel: string
  updateLabel: string
  deleting?: boolean
}

export function SkillCardV2({
  skill,
  onToggle,
  onDelete,
  sourceLabel,
  deleteTitle,
  deleteDesc,
  cancelLabel,
  deleteLabel,
  updateLabel,
  deleting = false,
}: SkillCardV2Props) {
  const sourceIcon = SOURCE_ICONS[skill.source_type] || <Sparkles className="size-3.5" />

  return (
    <Card className="hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 shrink-0 text-primary">{sourceIcon}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm truncate">{skill.name}</span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  {sourceLabel}
                </Badge>
                {skill.update_status === 'available' && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0">
                    {updateLabel}
                  </Badge>
                )}
              </div>
              {skill.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{skill.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Switch
              checked={skill.enabled}
              disabled={deleting}
              onCheckedChange={(checked) => onToggle(skill.id, checked)}
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" disabled={deleting} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                  {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
                  <AlertDialogDescription>{deleteDesc}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(skill.id)}>{deleteLabel}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
