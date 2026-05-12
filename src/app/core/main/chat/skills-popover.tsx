"use client"

import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useSkillsV2Store } from '@/stores/skills-v2'
import { useSkillsStore } from '@/stores/skills'
import type { SkillMetadata } from '@/lib/skills/types'
import { cn } from '@/lib/utils'

interface DisplaySkill {
  key: string
  id: string
  name: string
  description?: string | null
  enabled: boolean
  source: string
  runtime: boolean
  updateStatus?: string
}

function toSkillId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function runtimeRow(skill: SkillMetadata): DisplaySkill {
  return {
    key: `runtime-${skill.id}`,
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled !== false,
    source: skill.scope,
    runtime: true,
  }
}

export function SkillsPopover() {
  const [open, setOpen] = useState(false)
  const {
    skills: installedSkills,
    fetchSkills,
    loading,
  } = useSkillsV2Store()
  const {
    skills: runtimeSkills,
    initSkills,
  } = useSkillsStore()

  useEffect(() => {
    if (!open) {
      return
    }

    void fetchSkills()
    void initSkills()
  }, [fetchSkills, initSkills, open])

  const displaySkills = useMemo(() => {
    const runtimeById = new Map(runtimeSkills.map(skill => [skill.id, skill]))
    const representedRuntimeIds = new Set<string>()

    const installedRows: DisplaySkill[] = installedSkills.map(skill => {
      const runtimeId = toSkillId(skill.name)
      const runtimeSkill = runtimeById.get(runtimeId)
      if (runtimeSkill) {
        representedRuntimeIds.add(runtimeSkill.id)
      }

      return {
        key: `installed-${skill.id}`,
        id: runtimeSkill?.id || runtimeId || skill.id,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled,
        source: skill.source_type,
        runtime: Boolean(runtimeSkill),
        updateStatus: skill.update_status,
      }
    })

    const runtimeRows = runtimeSkills
      .filter(skill => !representedRuntimeIds.has(skill.id))
      .map(runtimeRow)

    return [...installedRows, ...runtimeRows].sort((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }, [installedSkills, runtimeSkills])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label="查看已安装 Skills"
              >
                <Sparkles className="size-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>已安装 Skills</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent align="end" side="top" className="w-[180px] p-0">
        <Command>
          <CommandInput placeholder="选择 Skill" className="h-9" />
          <CommandList className="max-h-[180px]">
            <CommandEmpty>
              {loading ? (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  加载中
                </span>
              ) : (
                '当前没有已安装 Skills'
              )}
            </CommandEmpty>
            <CommandGroup>
              {displaySkills.map(skill => (
                <CommandItem
                  key={skill.key}
                  value={[skill.name, skill.id, skill.description || '', skill.source].join(' ')}
                  className={cn(
                    'h-8 gap-2 px-2',
                    !skill.enabled && 'text-muted-foreground'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{skill.name}</span>
                  {skill.updateStatus === 'available' && (
                    <span className="shrink-0 text-[11px] text-primary">更新</span>
                  )}
                  {skill.enabled ? (
                    <Check className="ml-auto size-4 shrink-0" />
                  ) : (
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">停用</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
