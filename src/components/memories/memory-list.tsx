'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MemoryItem } from './memory-item'
import { MemoryForm } from './memory-form'
import { MemoryStats } from './memory-stats'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Brain, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import useMemoriesStore from '@/stores/memories'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import type { Memory } from '@/db/memories'

type TabValue = 'all' | 'preference' | 'memory'

export function MemoryList() {
  const t = useTranslations('settings.memories')
  const { memories, loading, deleteMemory, clearAllMemories, loadMemories, loadStats } = useMemoriesStore()
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null)

  useEffect(() => {
    loadMemories()
  }, [loadMemories])

  const preferences = memories.filter(m => m.category === 'preference')
  const memoryList = memories.filter(m => m.category === 'memory')

  const openAddDialog = () => {
    setEditingMemory(null)
    setFormOpen(true)
  }

  const openEditDialog = (memory: Memory) => {
    setEditingMemory(memory)
    setFormOpen(true)
  }

  const refreshMemories = async () => {
    await Promise.all([loadMemories(), loadStats()])
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteMemory(id)
      toast({
        title: t('success'),
        description: t('deleted'),
      })
    } catch (error) {
      toast({
        title: t('error'),
        description: t('errorDelete') + `: ${error}`,
        variant: 'destructive',
      })
    }
  }

  const handleClearAll = async () => {
    try {
      await clearAllMemories()
      toast({
        title: t('success'),
        description: t('cleared'),
      })
    } catch (error) {
      toast({
        title: t('error'),
        description: t('errorClear') + `: ${error}`,
        variant: 'destructive',
      })
    }
  }

  const renderMemoryItems = (items: Memory[]) => (
    items.length === 0 ? (
      <div className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
        {t('emptyTab')}
      </div>
    ) : (
      <div className="divide-y divide-border/70 rounded-md border">
        {items.map(memory => (
          <MemoryItem
            key={memory.id}
            memory={memory}
            onEdit={() => openEditDialog(memory)}
            onDelete={() => handleDelete(memory.id)}
          />
        ))}
      </div>
    )
  )

  if (loading) {
    return (
      <div className="space-y-1">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col space-y-5">
      <MemoryStats />

      <Dialog
        open={formOpen}
        onOpenChange={(nextOpen) => {
          setFormOpen(nextOpen)
          if (!nextOpen) {
            setEditingMemory(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMemory ? t('editMemory') : t('form.title')}</DialogTitle>
            <DialogDescription>{t('form.contentPlaceholder')}</DialogDescription>
          </DialogHeader>
          <MemoryForm
            memory={editingMemory || undefined}
            onSuccess={() => {
              setFormOpen(false)
              setEditingMemory(null)
            }}
          />
        </DialogContent>
      </Dialog>

      <Tabs className="w-full min-w-0" value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="all">
              {t('tabs.all')} ({memories.length})
            </TabsTrigger>
            <TabsTrigger value="preference">
              {t('tabs.preference')} ({preferences.length})
            </TabsTrigger>
            <TabsTrigger value="memory">
              {t('tabs.memory')} ({memoryList.length})
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refreshMemories}>
              <RefreshCw className="mr-2 size-4" />
              {t('refresh')}
            </Button>
            <Button variant="default" size="sm" onClick={openAddDialog}>
              <Plus className="mr-2 size-4" />
              {t('addMemory')}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={memories.length === 0}>
                  <Trash2 className="mr-2 size-4" />
                  {t('clearAll')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('clearConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('clearConfirmDesc')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearAll}>
                    {t('confirmClear')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {memories.length === 0 ? (
          <div className="flex w-full flex-1 flex-col items-center justify-center gap-6 p-6 text-center md:p-12">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
              <Brain className="size-6" />
            </div>
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="text-lg font-medium tracking-tight">{t('empty')}</div>
              <div className="text-sm text-muted-foreground">{t('emptyHint')}</div>
            </div>
            <div className="flex flex-col items-center gap-4 text-sm">
              <Button size="sm" onClick={openAddDialog}>
                <Plus className="mr-2 size-4" />
                {t('addMemory')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <TabsContent value="all" className="mt-4">
              {renderMemoryItems(memories)}
            </TabsContent>

            <TabsContent value="preference" className="mt-4">
              {renderMemoryItems(preferences)}
            </TabsContent>

            <TabsContent value="memory" className="mt-4">
              {renderMemoryItems(memoryList)}
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}
