'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Search, Download, Loader2, CheckCircle, FolderSearch } from 'lucide-react'
import { useSkillsV2Store } from '@/stores/skills-v2'
import { useToast } from '@/hooks/use-toast'

const TOOL_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'cursor': 'Cursor',
  'windsurf': 'Windsurf',
}

export function SkillScanner() {
  const t = useTranslations('settings.skills')
  const { toast } = useToast()
  const { scan, discovered, importDiscovered, scanning } = useSkillsV2Store()
  const [scanResult, setScanResult] = useState<{ total: number; newCount: number } | null>(null)

  const handleScan = async () => {
    try {
      const result = await scan()
      setScanResult({ total: result.total_scanned, newCount: result.new_count })
      if (result.new_count > 0) {
        toast({
          title: t('scanFound'),
          description: t('scanFoundDesc', { count: result.new_count }),
        })
      } else {
        toast({ title: t('scanComplete'), description: t('scanNoNew') })
      }
    } catch (error) {
      toast({ title: t('scanError'), description: String(error), variant: 'destructive' })
    }
  }

  const handleImportAll = async () => {
    const unimported = discovered.filter(d => !d.imported)
    for (const item of unimported) {
      try {
        await importDiscovered(item.id)
      } catch (e) {
        console.error('Failed to import:', item.name_guess, e)
      }
    }
    toast({ title: t('importAllDone'), description: `${unimported.length} skills imported` })
  }

  const unimported = discovered.filter(d => !d.imported)
  const grouped = unimported.reduce<Record<string, typeof unimported>>((acc, item) => {
    const key = item.tool_key
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <FolderSearch className="size-5" />
              {t('systemScanTitle')}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t('systemScanDesc')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unimported.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleImportAll}>
                <Download className="size-4 mr-1" />
                {t('importAll')} ({unimported.length})
              </Button>
            )}
            <Button size="sm" onClick={handleScan} disabled={scanning}>
              {scanning ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              {scanning ? t('scanning') : t('scanNow')}
            </Button>
          </div>
        </div>
        {scanResult && (
          <div className="flex gap-2 mt-2">
            <Badge variant="secondary">{scanResult.total} {t('dirsScanned')}</Badge>
            <Badge variant={scanResult.newCount > 0 ? 'default' : 'secondary'}>
              {scanResult.newCount} {t('newFound')}
            </Badge>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {Object.keys(grouped).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Search className="mx-auto h-10 w-10 mb-3 opacity-50" />
            <p>{t('scanEmpty')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([toolKey, items]) => (
              <div key={toolKey}>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Badge variant="outline">{TOOL_LABELS[toolKey] || toolKey}</Badge>
                  <span className="text-muted-foreground">{items.length} skills</span>
                </h4>
                <div className="space-y-1">
                  {items.map(item => (
                    <DiscoveredSkillItem key={item.id} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DiscoveredSkillItem({ item }: { item: { id: string; name_guess: string | null; imported: boolean } }) {
  const t = useTranslations('settings.skills')
  const { importDiscovered } = useSkillsV2Store()
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(item.imported)

  const handleImport = async () => {
    setImporting(true)
    try {
      await importDiscovered(item.id)
      setImported(true)
    } catch (e) {
      console.error('Import failed:', e)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-md hover:bg-muted/50">
      <span className="text-sm">{item.name_guess || 'Unknown'}</span>
      {imported ? (
        <Badge variant="secondary" className="text-xs">
          <CheckCircle className="size-3 mr-1" /> {t('imported')}
        </Badge>
      ) : (
        <Button size="sm" variant="ghost" onClick={handleImport} disabled={importing}>
          {importing ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
        </Button>
      )}
    </div>
  )
}
