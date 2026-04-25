'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, GitBranch, Archive, FolderOpen, Download, Eye } from 'lucide-react'
import { useSkillsV2Store } from '@/stores/skills-v2'
import { useToast } from '@/hooks/use-toast'
import { SkillGitDialog } from './skill-git-dialog'
import { open } from '@tauri-apps/plugin-dialog'

export function SkillInstall() {
  const t = useTranslations('settings.skills')
  const { toast } = useToast()
  const { installFromArchive, installFromLocalDir, installing } = useSkillsV2Store()
  const [gitDialogOpen, setGitDialogOpen] = useState(false)

  const handleSelectZip = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      })
      if (selected) {
        const record = await installFromArchive(selected)
        toast({ title: t('installSuccess'), description: record.name })
      }
    } catch (e) {
      toast({ title: t('installError'), description: String(e), variant: 'destructive' })
    }
  }

  const handleSelectFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false })
      if (selected) {
        const record = await installFromLocalDir(selected)
        toast({ title: t('installSuccess'), description: record.name })
      }
    } catch (e) {
      toast({ title: t('installError'), description: String(e), variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <GitBranch className="size-5" />
            {t('installTitle')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('installDesc')}</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Git URL */}
            <InstallMethodCard
              icon={<GitBranch className="size-8 text-primary" />}
              title="Git"
              description={t('gitUrl')}
              actionLabel={t('preview')}
              actionIcon={<Eye className="size-4" />}
              onAction={() => setGitDialogOpen(true)}
              disabled={installing}
            />

            {/* ZIP */}
            <InstallMethodCard
              icon={<Archive className="size-8 text-primary" />}
              title="ZIP"
              description={t('selectZip')}
              actionLabel={t('selectZip')}
              actionIcon={<Download className="size-4" />}
              onAction={handleSelectZip}
              disabled={installing}
              loading={installing}
            />

            {/* Local Folder */}
            <InstallMethodCard
              icon={<FolderOpen className="size-8 text-primary" />}
              title={t('sourceLocal')}
              description={t('selectFolder')}
              actionLabel={t('selectFolder')}
              actionIcon={<FolderOpen className="size-4" />}
              onAction={handleSelectFolder}
              disabled={installing}
              loading={installing}
            />
          </div>
        </CardContent>
      </Card>

      <SkillGitDialog open={gitDialogOpen} onOpenChange={setGitDialogOpen} />
    </div>
  )
}

function InstallMethodCard({
  icon,
  title,
  description,
  actionLabel,
  actionIcon,
  onAction,
  disabled,
  loading,
}: {
  icon: React.ReactNode
  title: string
  description: string
  actionLabel: string
  actionIcon: React.ReactNode
  onAction: () => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      {icon}
      <div className="text-center">
        <h4 className="font-medium">{title}</h4>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onAction} disabled={disabled}>
        {loading ? <Loader2 className="size-4 animate-spin mr-1" /> : actionIcon}
        {loading ? `${actionLabel}...` : actionLabel}
      </Button>
    </div>
  )
}
