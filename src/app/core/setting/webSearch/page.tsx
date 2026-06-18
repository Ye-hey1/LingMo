'use client'

import { useState } from 'react'
import { open } from '@tauri-apps/plugin-shell'
import { useTranslations } from 'next-intl'
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Github,
  Globe2,
  LoaderCircle,
  Search,
  Sparkles,
} from 'lucide-react'

import { SettingType } from '../components/setting-base'
import useSettingStore from '@/stores/setting'
import { testTavilyHealth } from '@/lib/tavily'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { TooltipButton } from '@/components/tooltip-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface SearchChannelRowProps {
  icon: React.ReactNode
  name: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  readiness?: 'ready' | 'missing'
  open: boolean
  onOpenChange: (open: boolean) => void
  children?: React.ReactNode
}

interface SecretFieldProps {
  value: string
  visible: boolean
  placeholder: string
  docsUrl: string
  docsLabel: string
  onChange: (value: string) => void
  onToggleVisible: () => void
}

interface ChannelFieldProps {
  label: string
  children: React.ReactNode
}

interface SettingLineProps {
  title: string
  description?: string
  children: React.ReactNode
}

function hasSecret(value: string) {
  return value.trim().length > 0
}

function readinessLabel(readiness?: SearchChannelRowProps['readiness']) {
  if (readiness === 'ready') return '已配置'
  if (readiness === 'missing') return '需 Key'
  return null
}

function ReadinessBadge({ readiness }: { readiness?: SearchChannelRowProps['readiness'] }) {
  const label = readinessLabel(readiness)
  if (!label) return null

  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 rounded px-1.5 py-0 text-[10px] font-medium',
        readiness === 'ready' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        readiness === 'missing' && 'text-muted-foreground'
      )}
    >
      {label}
    </Badge>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 border-t border-border/60 pt-5">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  )
}

function ChannelField({ label, children }: ChannelFieldProps) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function SettingLine({ title, description, children }: SettingLineProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/50 px-3 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  )
}

function SecretField({
  value,
  visible,
  placeholder,
  docsUrl,
  docsLabel,
  onChange,
  onToggleVisible,
}: SecretFieldProps) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5">
      <Input
        className="h-8 min-w-0 flex-1 border-border/70 bg-muted/20 text-sm shadow-none"
        value={value}
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <TooltipButton
        variant="ghost"
        size="icon"
        icon={visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        tooltipText={visible ? '隐藏密钥' : '显示密钥'}
        onClick={onToggleVisible}
        buttonClassName="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => void open(docsUrl)}
      >
        {docsLabel}
      </Button>
    </div>
  )
}

function SearchChannelRow({
  icon,
  name,
  description,
  checked,
  onCheckedChange,
  readiness,
  open,
  onOpenChange,
  children,
}: SearchChannelRowProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="border-b border-border/60 last:border-b-0">
      <div className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex min-w-0 items-center gap-3 text-left">
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md border',
                checked
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : 'border-border/60 bg-muted/20 text-muted-foreground'
              )}
            >
              {icon}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold leading-none">{name}</span>
                <ReadinessBadge readiness={readiness} />
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
            </div>
            <ChevronDown
              className={cn(
                'ml-auto size-4 shrink-0 text-muted-foreground transition-transform md:hidden',
                open && 'rotate-180'
              )}
            />
          </button>
        </CollapsibleTrigger>
        <div className="flex items-center justify-between gap-3 md:justify-end">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="hidden h-8 gap-1.5 rounded-md px-2 text-xs text-muted-foreground md:inline-flex">
              配置
              <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
          <Switch
            checked={checked}
            onCheckedChange={(nextChecked) => {
              void onCheckedChange(nextChecked)
              if (nextChecked) onOpenChange(true)
            }}
          />
        </div>
      </div>
      {children && (
        <CollapsibleContent>
          <div className="space-y-3 border-t border-border/40 bg-muted/10 px-3 py-3">
            {children}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

export default function WebSearchPage() {
  const t = useTranslations('settings.webSearch')
  const {
    tavilyApiKey,
    setTavilyApiKey,
    tavilySearchDepth,
    setTavilySearchDepth,
    serpApiKey,
    setSerpApiKey,
    exaApiKey,
    setExaApiKey,
    researchSearchTavilyEnabled,
    setResearchSearchTavilyEnabled,
    researchSearchSerpApiEnabled,
    setResearchSearchSerpApiEnabled,
    researchSearchExaEnabled,
    setResearchSearchExaEnabled,
    webSearchEnabled,
    setWebSearchEnabled,
    githubProjectApiToken,
    setGithubProjectApiToken,
  } = useSettingStore()

  const normalizedSearchDepth = tavilySearchDepth === 'advanced' ? 'advanced' : 'basic'
  const [tavilyApiKeyVisible, setTavilyApiKeyVisible] = useState(false)
  const [serpApiKeyVisible, setSerpApiKeyVisible] = useState(false)
  const [exaApiKeyVisible, setExaApiKeyVisible] = useState(false)
  const [githubTokenVisible, setGithubTokenVisible] = useState(false)
  const [testingTavily, setTestingTavily] = useState(false)
  const [tavilyHealthStatus, setTavilyHealthStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [openChannel, setOpenChannel] = useState<string | undefined>()
  const [githubTokenOpen, setGithubTokenOpen] = useState(false)

  async function handleTestTavilyHealth() {
    setTestingTavily(true)
    try {
      const result = await testTavilyHealth()
      setTavilyHealthStatus({
        ok: result.ok,
        message: result.message,
      })
    } finally {
      setTestingTavily(false)
    }
  }

  return (
    <SettingType id="webSearch" icon={<Globe2 />} title={t('title')} desc={t('desc')}>
      <div className="space-y-6">
        <Section title="搜索渠道">
          <div className="border-y border-border/60">
            <SearchChannelRow
              icon={<Globe2 className="size-4" />}
              name="Tavily"
              description="网页搜索、摘要与正文提取。"
              checked={researchSearchTavilyEnabled}
              onCheckedChange={(checked) => void setResearchSearchTavilyEnabled(checked)}
              readiness={hasSecret(tavilyApiKey) ? 'ready' : 'missing'}
              open={openChannel === 'tavily'}
              onOpenChange={(open) => setOpenChannel(open ? 'tavily' : undefined)}
            >
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px_auto] xl:items-end">
                <ChannelField label="API Key">
                  <SecretField
                    value={tavilyApiKey}
                    visible={tavilyApiKeyVisible}
                    placeholder="tvly-..."
                    docsUrl="https://app.tavily.com/home"
                    docsLabel="获取 Key"
                    onChange={(value) => void setTavilyApiKey(value)}
                    onToggleVisible={() => setTavilyApiKeyVisible((prev) => !prev)}
                  />
                </ChannelField>
                <ChannelField label="搜索深度">
                  <Select
                    value={normalizedSearchDepth}
                    onValueChange={(value) => void setTavilySearchDepth(value === 'advanced' ? 'advanced' : 'basic')}
                  >
                    <SelectTrigger className="h-8 w-full rounded-md border-border/70 bg-muted/20 shadow-none">
                      <SelectValue placeholder="选择深度" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">Basic</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </ChannelField>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 rounded-md px-2.5 xl:mb-0"
                  onClick={() => void handleTestTavilyHealth()}
                  disabled={testingTavily}
                >
                  {testingTavily ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                  测试连接
                </Button>
              </div>
              {tavilyHealthStatus && (
                <div
                  className={cn(
                    'rounded-md border px-2.5 py-2 text-xs leading-5',
                    tavilyHealthStatus.ok
                      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-destructive/30 bg-destructive/5 text-destructive'
                  )}
                >
                  {tavilyHealthStatus.message}
                </div>
              )}
            </SearchChannelRow>

            <SearchChannelRow
              icon={<Search className="size-4" />}
              name="SerpAPI"
              description="传统搜索结果页信号。"
              checked={researchSearchSerpApiEnabled}
              onCheckedChange={(checked) => void setResearchSearchSerpApiEnabled(checked)}
              readiness={hasSecret(serpApiKey) ? 'ready' : 'missing'}
              open={openChannel === 'serpapi'}
              onOpenChange={(open) => setOpenChannel(open ? 'serpapi' : undefined)}
            >
              <ChannelField label="API Key">
                <SecretField
                  value={serpApiKey}
                  visible={serpApiKeyVisible}
                  placeholder="SerpAPI Key"
                  docsUrl="https://serpapi.com/manage-api-key"
                  docsLabel="获取 Key"
                  onChange={(value) => void setSerpApiKey(value)}
                  onToggleVisible={() => setSerpApiKeyVisible((prev) => !prev)}
                />
              </ChannelField>
            </SearchChannelRow>

            <SearchChannelRow
              icon={<Sparkles className="size-4" />}
              name="Exa"
              description="语义搜索与专题扩展。"
              checked={researchSearchExaEnabled}
              onCheckedChange={(checked) => void setResearchSearchExaEnabled(checked)}
              readiness={hasSecret(exaApiKey) ? 'ready' : 'missing'}
              open={openChannel === 'exa'}
              onOpenChange={(open) => setOpenChannel(open ? 'exa' : undefined)}
            >
              <ChannelField label="API Key">
                <SecretField
                  value={exaApiKey}
                  visible={exaApiKeyVisible}
                  placeholder="Exa API Key"
                  docsUrl="https://dashboard.exa.ai/api-keys"
                  docsLabel="获取 Key"
                  onChange={(value) => void setExaApiKey(value)}
                  onToggleVisible={() => setExaApiKeyVisible((prev) => !prev)}
                />
              </ChannelField>
            </SearchChannelRow>
          </div>
        </Section>

        <Section title="全局行为">
          <div className="border-y border-border/60">
            <SettingLine title="自动联网默认策略" description="开启后每轮默认带入网页搜索；关闭时由输入内容自动判断是否需要联网。">
              <span className="text-sm text-muted-foreground">{webSearchEnabled ? '默认开启' : '默认关闭'}</span>
              <Switch checked={webSearchEnabled} onCheckedChange={(checked) => void setWebSearchEnabled(checked)} />
            </SettingLine>
          </div>
        </Section>

        <Section title="项目识别">
          <div className="border-y border-border/60">
            <Collapsible open={githubTokenOpen} onOpenChange={setGithubTokenOpen}>
              <div className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <CollapsibleTrigger asChild>
                  <button type="button" className="flex min-w-0 items-center gap-3 text-left">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/20 text-muted-foreground">
                      <Github className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold leading-none">GitHub Token</span>
                        <ReadinessBadge readiness={hasSecret(githubProjectApiToken) ? 'ready' : undefined} />
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">粘贴 GitHub 仓库链接时读取项目元数据。</div>
                    </div>
                    <ChevronDown
                      className={cn(
                        'ml-auto size-4 shrink-0 text-muted-foreground transition-transform md:hidden',
                        githubTokenOpen && 'rotate-180'
                      )}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="hidden h-8 gap-1.5 rounded-md px-2 text-xs text-muted-foreground md:inline-flex">
                    配置
                    <ChevronDown className={cn('size-3.5 transition-transform', githubTokenOpen && 'rotate-180')} />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="border-t border-border/40 bg-muted/10 px-3 py-3">
                  <ChannelField label="访问令牌">
                    <SecretField
                      value={githubProjectApiToken}
                      visible={githubTokenVisible}
                      placeholder="github_pat_... 或 ghp_..."
                      docsUrl="https://github.com/settings/tokens"
                      docsLabel="创建 Token"
                      onChange={(value) => void setGithubProjectApiToken(value)}
                      onToggleVisible={() => setGithubTokenVisible((prev) => !prev)}
                    />
                  </ChannelField>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </Section>
      </div>
    </SettingType>
  )
}
