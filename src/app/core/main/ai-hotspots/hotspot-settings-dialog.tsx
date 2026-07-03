'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, QrCode, Sparkles } from 'lucide-react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import type { AiHotspotTimeRange } from '@/lib/ai-hotspots'
import {
  getWechatMpStatus,
  pollWechatMpLogin,
  startWechatMpLogin,
  type WechatMpLoginStatus,
} from '@/lib/wechat-mp-native'
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
  // RSS/OPML 的新增入口已移到信源库，这里保留 props 兼容调用方。
  onAddUserFeed: _onAddUserFeed,
  onImportOpml: _onImportOpml,
}: HotspotSettingsDialogProps) {
  const [wechatQrImage, setWechatQrImage] = useState('')
  const [wechatLoginStatus, setWechatLoginStatus] = useState<WechatMpLoginStatus['status'] | 'idle'>('idle')
  const [wechatLoginMessage, setWechatLoginMessage] = useState('登录后，AI 热点会用你的公众号平台会话抓取 mp.weixin.qq.com 正文。')
  const [isStartingWechatLogin, setIsStartingWechatLogin] = useState(false)
  const [wechatConnected, setWechatConnected] = useState(false)

  useEffect(() => {
    if (!open) {
      setWechatQrImage('')
      return
    }
    void getWechatMpStatus().then((status) => {
      setWechatConnected(status.connected)
      setWechatLoginStatus(status.connected ? 'success' : 'idle')
      setWechatLoginMessage(status.message)
    }).catch(() => {
      setWechatConnected(false)
      setWechatLoginStatus('idle')
      setWechatLoginMessage('微信未连接')
    })
  }, [open])

  useEffect(() => {
    if (!open || !wechatQrImage || wechatLoginStatus === 'success' || wechatLoginStatus === 'failed') {
      return
    }

    const timer = window.setInterval(() => {
      void pollWechatMpLogin().then((status) => {
        setWechatLoginStatus(status.status)
        setWechatLoginMessage(status.message)
        if (status.status === 'success') {
          setWechatConnected(true)
          toast({ title: '公众号平台登录成功' })
        }
      }).catch((error) => {
        setWechatLoginStatus('failed')
        setWechatLoginMessage(error instanceof Error ? error.message : String(error))
      })
    }, 2000)

    return () => window.clearInterval(timer)
  }, [open, toast, wechatLoginStatus, wechatQrImage])

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

  const handleStartWechatLogin = async () => {
    setIsStartingWechatLogin(true)
    try {
      const result = await startWechatMpLogin()
      setWechatQrImage(result.qrImageDataUrl)
      setWechatLoginStatus(result.status)
      setWechatConnected(false)
      setWechatLoginMessage('请用已开通公众号平台权限的微信扫码，并在手机上确认登录。')
    } catch (error) {
      setWechatLoginStatus('failed')
      setWechatLoginMessage(error instanceof Error ? error.message : String(error))
      toast({
        title: '获取公众号登录二维码失败',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      setIsStartingWechatLogin(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[540px] max-h-[calc(100vh-32px)] min-h-0 w-[760px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <div className="shrink-0 border-b border-border/70 px-5 py-3.5">
          <DialogHeader>
            <DialogTitle>AI 热点设置</DialogTitle>
            <DialogDescription>
              配置自动刷新、默认时间范围和公众号连接。
            </DialogDescription>
          </DialogHeader>
        </div>

        <Tabs defaultValue="display" className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-5 pt-3">
            <TabsList className="grid h-10 w-full grid-cols-3 gap-1 rounded-md bg-muted/45 p-1">
              <TabsTrigger value="display" className="h-8 rounded-sm px-2 text-xs">刷新显示</TabsTrigger>
              <TabsTrigger value="filters" className="h-8 rounded-sm px-2 text-xs">筛选兴趣</TabsTrigger>
              <TabsTrigger value="wechat" className="h-8 rounded-sm px-2 text-xs">公众号</TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 p-5 pt-3">
            <div className="h-full min-h-0 overflow-y-auto rounded-md border border-border/70 bg-background shadow-sm shadow-black/5">
            <TabsContent value="display" className="m-0 h-full">
              <section>
                <div className="border-b px-4 py-3 text-sm font-medium">刷新与显示</div>
                <div className="space-y-4 p-4">
                  <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">打开时自动刷新</span>
                      <span className="block text-xs text-muted-foreground">先显示本地缓存，再按冷却时间后台刷新。</span>
                    </span>
                    <Switch
                      checked={settings.autoRefreshOnOpen}
                      onCheckedChange={(autoRefreshOnOpen) => handleSettingChange({ autoRefreshOnOpen })}
                    />
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
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
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="24h">24 小时</SelectItem>
                          <SelectItem value="7d">7 天</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
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
            </TabsContent>

            <TabsContent value="filters" className="m-0 h-full">
              <section>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <span className="text-sm font-medium">筛选与兴趣</span>
                  <span className="text-xs text-muted-foreground">
                    {settings.filterMethod === 'ai' ? 'AI 智能分类（消耗 Token）' : '词组匹配（免 Token）'}
                  </span>
                </div>
                <div className="space-y-3 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
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
                      className="h-[170px] min-h-0 resize-none font-mono text-xs leading-5"
                      onChange={(e) => handleSettingChange({ interestText: e.target.value })}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      语法：空行分组，[组别名] 打标签，+ 必须词，! 过滤词，/正则/i 正则。修改后刷新生效。
                    </span>
                  </label>

                  {settings.filterMethod === 'ai' ? (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium">自然语言兴趣描述（AI 分类用）</span>
                      <Textarea
                        value={settings.interestsText}
                        placeholder="用自然语言描述你关注的话题，AI 会自动提取标签并分类..."
                        className="h-[110px] min-h-0 resize-none text-xs leading-5"
                        onChange={(e) => handleSettingChange({ interestsText: e.target.value })}
                      />
                    </label>
                  ) : null}
                </div>
              </section>
            </TabsContent>

            <TabsContent value="wechat" className="m-0 h-full">
              <section>
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <span className="text-sm font-medium">公众号连接</span>
                  <span className={wechatConnected ? 'inline-flex items-center gap-1 text-xs font-medium text-emerald-600' : 'text-xs text-muted-foreground'}>
                    {wechatConnected ? <CheckCircle2 className="size-3.5" /> : null}
                    {wechatConnected ? '微信已连接' : '微信未连接'}
                  </span>
                </div>
                <div className="space-y-4 p-4">
                  <div className="grid gap-3 rounded-md border bg-muted/25 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">微信公众平台</span>
                        {wechatLoginStatus === 'waiting' || wechatLoginStatus === 'scanned' ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" />
                            {wechatLoginStatus === 'scanned' ? '等待手机确认' : '等待扫码'}
                          </span>
                        ) : null}
                      </div>
                      <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{wechatLoginMessage}</p>
                    </div>
                    <Button size="sm" onClick={() => void handleStartWechatLogin()} disabled={isStartingWechatLogin}>
                      {isStartingWechatLogin ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
                      {wechatConnected ? '重新扫码' : '扫码登录'}
                    </Button>
                  </div>
                  {wechatQrImage ? (
                    <div className="flex items-center gap-3 rounded-md border bg-background p-3">
                      <img src={wechatQrImage} alt="公众号平台登录二维码" className="size-24 rounded-sm object-contain" />
                      <div className="min-w-0 text-xs leading-5 text-muted-foreground">
                        用具备公众号平台权限的微信扫码确认。连接成功后，可在信源库的公众号模块搜索并订阅。
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            </TabsContent>

          </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
