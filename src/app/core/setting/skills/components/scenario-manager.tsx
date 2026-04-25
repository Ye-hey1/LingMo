'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Layers, Plus, Trash2, Loader2, ToggleLeft, ToggleRight } from 'lucide-react'
import { useSkillsV2Store, ScenarioRecord } from '@/stores/skills-v2'
import { useToast } from '@/hooks/use-toast'
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

export function ScenarioManager() {
  const t = useTranslations('settings.skills')
  const { toast } = useToast()
  const {
    scenarios, fetchScenarios, createScenario, deleteScenario,
    activeScenarioId, fetchActiveScenario, switchScenario,
    scenarioSkills, skills,
    addToScenario, removeFromScenario,
  } = useSkillsV2Store()

  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchScenarios()
    fetchActiveScenario()
  }, [fetchScenarios, fetchActiveScenario])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await createScenario(newName.trim())
      setNewName('')
      toast({ title: t('scenarioCreated') })
    } catch (e) {
      toast({ title: t('scenarioCreateError'), description: String(e), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  const handleActivate = async (id: string) => {
    const newId = activeScenarioId === id ? null : id
    await switchScenario(newId)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Layers className="size-5" />
          {t('scenarioTitle')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('scenarioDesc')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create new scenario */}
        <div className="flex gap-2">
          <Input
            placeholder={t('scenarioNamePlaceholder')}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            className="max-w-xs"
          />
          <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t('createScenario')}
          </Button>
        </div>

        {/* Scenario list */}
        {scenarios.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            {t('noScenarios')}
          </div>
        ) : (
          <div className="space-y-2">
            {scenarios.map(scenario => (
              <ScenarioItem
                key={scenario.id}
                scenario={scenario}
                isActive={activeScenarioId === scenario.id}
                onActivate={() => handleActivate(scenario.id)}
                onDelete={() => deleteScenario(scenario.id)}
                skillsInScenario={activeScenarioId === scenario.id ? scenarioSkills : []}
                allSkills={skills}
                onAddSkill={(skillId) => addToScenario(scenario.id, skillId)}
                onRemoveSkill={(skillId) => removeFromScenario(scenario.id, skillId)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface ScenarioItemProps {
  scenario: ScenarioRecord
  isActive: boolean
  onActivate: () => void
  onDelete: () => void
  skillsInScenario: { id: string; name: string; enabled: boolean }[]
  allSkills: { id: string; name: string; enabled: boolean }[]
  onAddSkill: (skillId: string) => void
  onRemoveSkill: (skillId: string) => void
}

function ScenarioItem({ scenario, isActive, onActivate, onDelete, skillsInScenario, allSkills, onAddSkill, onRemoveSkill }: ScenarioItemProps) {
  const t = useTranslations('settings.skills')
  const [expanded, setExpanded] = useState(isActive)

  const unassigned = allSkills.filter(s => !skillsInScenario.some(ss => ss.id === s.id))

  return (
    <div className={`border rounded-lg p-3 ${isActive ? 'border-primary bg-primary/5' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <span className="font-medium">{scenario.name}</span>
          <Badge variant={isActive ? 'default' : 'secondary'} className="text-xs">
            {skillsInScenario.length} skills
          </Badge>
          {scenario.description && (
            <span className="text-xs text-muted-foreground hidden md:inline">{scenario.description}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onActivate}>
            {isActive ? (
              <ToggleRight className="size-4 text-primary" />
            ) : (
              <ToggleLeft className="size-4 text-muted-foreground" />
            )}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('deleteScenarioTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('deleteScenarioDesc')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>{t('delete')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          {/* Skills in scenario */}
          {skillsInScenario.length > 0 ? (
            <div className="space-y-1">
              {skillsInScenario.map(skill => (
                <div key={skill.id} className="flex items-center justify-between py-1 px-2 bg-background rounded text-sm">
                  <span>{skill.name}</span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onRemoveSkill(skill.id)}>
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('noSkillsInScenario')}</p>
          )}

          {/* Add skills */}
          {unassigned.length > 0 && (
            <div className="border-t pt-2 mt-2">
              <p className="text-xs text-muted-foreground mb-1">{t('addSkillsToScenario')}</p>
              <div className="flex flex-wrap gap-1">
                {unassigned.map(skill => (
                  <Button key={skill.id} size="sm" variant="outline" className="h-6 text-xs" onClick={() => onAddSkill(skill.id)}>
                    <Plus className="size-3 mr-1" />{skill.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
