'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Sparkles, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import type { AiHotspotTimeRange } from '@/lib/ai-hotspots'
import type { AiHotspotFilterMethod, AiHotspotSettings } from '@/stores/ai-hotspots'

interface HotspotSettingsDialogProps {
  open: boolean
  settings: AiHotspotSettings
  onOpenChange: (open: boolean) => void
  onSaveSettings: (patch: Partial<AiHotspotSettings>) => Promise<void>
  onAddUserFeed: (input: { title: string; feedUrl: string; groupName?: string | null; enabled?: boolean }) => Promise<void>
  onImportOpml: (content: string) => Promise<number>
}

export function HotspotSettingsDialog({
  open,
  settings,
  onOpenChange,
  onSaveSettings,
  onAddUserFeed,
  onImportOpml,
}: HotspotSettingsDialogProps) {
  const [rssTitle, setRssTitle] = useState('')
  const [rssUrl, setRssUrl] = useState('')
  const [opmlContent, setOpmlContent] = useState('')
  const [isAddingFeed, setIsAddingFeed] = useState(false)
  const [isImportingOpml, setIsImportingOpml] = useState(false)

  useEffect(() => {
    if (!open) {
      setRssTitle('')
      setRssUrl('')
      setOpmlContent('')
    }
  }, [open])

  const handleSettingChange = (patch: Partial<AiHotspotSettings>) => {
    void onSaveSettings(patch).then(() => {
      toast({ title: 'AI 热点设置已保存' })
    }).catch((error) => {
      toast({
        title: '保存设置失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    })
  }

  const handleAddFeed = async () => {
    const title = rssTitle.trim()
    const feedUrl = rssUrl.trim()
    if (!title || !feedUrl) {
      toast({ title: '请填写 RSS 名称和地址', variant: 'destructive' })
      return
    }

    setIsAddingFeed(true)
    try {
      await onAddUserFeed({ title, feedUrl, groupName: 'RSS', enabled: true })
      setRssTitle('')
      setRssUrl('')
      toast({ title: 'RSS 已添加' })
    } catch (error) {
      toast({
        title: '添加 RSS 失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setIsAddingFeed(false)
    }
  }

  const handleImportOpml = async () => {
    const content = opmlContent.trim()
    if (!content) {
      toast({ title: '请粘贴 OPML 内容', variant: 'destructive' })
      return
    }

    setIsImportingOpml(true)
    try {
      const count = await onImportOpml(content)
      setOpmlContent('')
      toast({ title: count > 0 ? `已导入 ${count} 个 RSS` : '没有发现新的 RSS' })
    } catch (error) {
      toast({
        title: '导入 OPML 失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setIsImportingOpml(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>AI 热点设置</DialogTitle>
          <DialogDescription>
            配置打开时自动刷新、默认时间范围，以及用户 RSS/OPML 来源。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section className="rounded-md border">
            <div className="border-b px-3 py-2 text-sm font-medium">刷新与显示</div>
            <div className="space-y-3 p-3">
              <label className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">打开时自动刷新</span>
                  <span className="block text-xs text-muted-foreground">先显示本地缓存，再按冷却时间后台刷新。</span>
                </span>
                <Switch
                  checked={settings.autoRefreshOnOpen}
                  onCheckedChange={(autoRefreshOnOpen) => handleSettingChange({ autoRefreshOnOpen })}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-sm font-medium">冷却时间（分钟）</span>
                  <Input
                    type="number"
                    min={0}
                    max={1440}
                    value={settings.refreshCooldownMinutes}
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      if (Number.isFinite(next)) {
                        handleSettingChange({ refreshCooldownMinutes: Math.max(0, Math.floor(next)) })
                      }
                    }}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium">默认时间范围</span>
                  <Select
                    value={settings.defaultTimeRange}
                    onValueChange={(defaultTimeRange) => handleSettingChange({ defaultTimeRange: defaultTimeRange as AiHotspotTimeRange })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24h">24 小时</SelectItem>
                      <SelectItem value="7d">7 天</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">标题翻译</span>
                    <span className="block text-xs text-muted-foreground">默认刷新暂不调用模型。</span>
                  </span>
                  <Switch
                    checked={settings.translateTitles}
                    onCheckedChange={(translateTitles) => handleSettingChange({ translateTitles })}
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium">单次翻译上限</span>
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    value={settings.translateMaxNew}
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      if (Number.isFinite(next)) {
                        handleSettingChange({ translateMaxNew: Math.max(0, Math.floor(next)) })
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">筛选与兴趣</span>
              <span className="text-xs text-muted-foreground">
                {settings.filterMethod === 'ai' ? 'AI 智能分类（消耗 Token）' : '词组匹配（免 Token）'}
              </span>
            </div>
            <div className="space-y-3 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">筛选模式</span>
                  <Select
                    value={settings.filterMethod}
                    onValueChange={(v) => handleSettingChange({ filterMethod: v as AiHotspotFilterMethod })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keyword">词组匹配（快、免 Token）</SelectItem>
                      <SelectItem value="ai">AI 智能分类（准、消耗 Token）</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">AI 最低相关度（{settings.aiMinScore.toFixed(1)}）</span>
                  <Input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={settings.aiMinScore}
                    onChange={(e) => handleSettingChange({ aiMinScore: Number(e.target.value) })}
                    disabled={settings.filterMethod !== 'ai'}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1 text-sm font-medium">
                  <Sparkles className="size-3.5 text-primary" />
                  兴趣词组 DSL
                </span>
                <Textarea
                  value={settings.interestText}
                  placeholder="[组别名]\n关键词 / +必须词 / !过滤词 / /正则/i => 别名 / @N"
                  className="min-h-[160px] font-mono text-xs leading-5"
                  onChange={(e) => handleSettingChange({ interestText: e.target.value })}
                />
                <span className="text-xs text-muted-foreground">
                  语法：空行分组，<code className="rounded bg-muted px-1">[组别名]</code> 打标签，<code className="rounded bg-muted px-1">+</code> 必须词，<code className="rounded bg-muted px-1">!</code> 过滤词，<code className="rounded bg-muted px-1">/正则/i</code> 正则。修改后刷新生效。
                </span>
              </label>

              {settings.filterMethod === 'ai' ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">自然语言兴趣描述（AI 分类用）</span>
                  <Textarea
                    value={settings.interestsText}
                    placeholder="用自然语言描述你关注的话题，AI 会自动提取标签并分类..."
                    className="min-h-[140px] text-xs leading-5"
                    onChange={(e) => handleSettingChange({ interestsText: e.target.value })}
                  />
                  <span className="text-xs text-muted-foreground">
                    按重要性排序，越靠前优先级越高。AI 会据此提取标签并对热点批量分类。
                  </span>
                </label>
              ) : null}
            </div>
          </section>

          <section className="rounded-md border">
            <div className="border-b px-3 py-2 text-sm font-medium">添加 RSS</div>
            <div className="space-y-2 p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <Input
                  value={rssTitle}
                  placeholder="来源名称"
                  onChange={(event) => setRssTitle(event.target.value)}
                />
                <Input
                  value={rssUrl}
                  placeholder="https://example.com/feed.xml"
                  onChange={(event) => setRssUrl(event.target.value)}
                />
              </div>
              <Button size="sm" disabled={isAddingFeed} onClick={() => void handleAddFeed()}>
                {isAddingFeed ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                添加 RSS
              </Button>
            </div>
          </section>

          <section className="rounded-md border">
            <div className="border-b px-3 py-2 text-sm font-medium">导入 OPML</div>
            <div className="space-y-2 p-3">
              <Textarea
                value={opmlContent}
                placeholder="粘贴 OPML XML 内容"
                className="min-h-[150px] font-mono text-xs"
                onChange={(event) => setOpmlContent(event.target.value)}
              />
              <Button size="sm" variant="outline" disabled={isImportingOpml} onClick={() => void handleImportOpml()}>
                {isImportingOpml ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                导入 OPML
              </Button>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
