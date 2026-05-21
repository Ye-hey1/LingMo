'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Eye, EyeOff, Github, Globe2, LoaderCircle } from 'lucide-react'

import { SettingType, FormItem } from '../components/setting-base'
import useSettingStore from '@/stores/setting'
import { testTavilyHealth } from '@/lib/tavily'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { OpenBroswer } from '@/components/open-broswer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export default function WebSearchPage() {
  const t = useTranslations('settings.webSearch')
  const {
    tavilyApiKey,
    setTavilyApiKey,
    tavilySearchDepth,
    setTavilySearchDepth,
    webSearchEnabled,
    setWebSearchEnabled,
    githubProjectApiToken,
    setGithubProjectApiToken,
  } = useSettingStore()

  const normalizedSearchDepth = tavilySearchDepth === 'advanced' ? 'advanced' : 'basic'
  const [tavilyApiKeyVisible, setTavilyApiKeyVisible] = useState(false)
  const [githubTokenVisible, setGithubTokenVisible] = useState(false)
  const [testingTavily, setTestingTavily] = useState(false)
  const [tavilyHealthStatus, setTavilyHealthStatus] = useState<{ ok: boolean; message: string } | null>(null)

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
      <FormItem title="联网搜索（Tavily）" desc="用于 AI 对话输入框中的联网按钮；开启后 Agent 会优先使用 Tavily Search API 获取实时网页信息，若 Tavily 不可用会自动回退到 DuckDuckGo 精简搜索。">
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-muted-foreground" />
            <Input
              className="flex-1"
              value={tavilyApiKey}
              type={tavilyApiKeyVisible ? 'text' : 'password'}
              placeholder="tvly-..."
              onChange={(e) => void setTavilyApiKey(e.target.value)}
            />
            <Button variant="outline" size="icon" onClick={() => setTavilyApiKeyVisible((prev) => !prev)}>
              {tavilyApiKeyVisible ? <Eye /> : <EyeOff />}
            </Button>
            <OpenBroswer
              type="button"
              url="https://app.tavily.com/home"
              title="获取 Tavily API Key"
            />
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">搜索深度</span>
              <Select
                value={normalizedSearchDepth}
                onValueChange={(value) => void setTavilySearchDepth(value === 'advanced' ? 'advanced' : 'basic')}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="选择搜索深度" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">Basic</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={webSearchEnabled}
                onChange={(e) => void setWebSearchEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              默认在输入框开启联网
            </label>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-xs text-muted-foreground">
              健康检查会优先测试 Tavily 主链路；如果主链路异常但 Rust fallback 正常，会明确提示当前已自动兜底。
            </div>
            <Button variant="outline" onClick={() => void handleTestTavilyHealth()} disabled={testingTavily}>
              {testingTavily ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Globe2 className="mr-2 size-4" />}
              测试 Tavily
            </Button>
          </div>
          {tavilyHealthStatus && (
            <div className={`rounded-md border px-3 py-2 text-sm ${tavilyHealthStatus.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>
              {tavilyHealthStatus.message}
            </div>
          )}
        </div>
      </FormItem>
      <FormItem title="GitHub 开源项目识别" desc="用于记录模块的链接收藏：粘贴 GitHub 仓库链接时，可通过 GitHub API 读取仓库元数据和 README，再由 AI 整理成开源项目卡片。未配置时保持原链接记录流程。">
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4 text-muted-foreground" />
            <Input
              className="flex-1"
              value={githubProjectApiToken}
              type={githubTokenVisible ? 'text' : 'password'}
              placeholder="github_pat_... 或 ghp_..."
              onChange={(e) => void setGithubProjectApiToken(e.target.value)}
            />
            <Button variant="outline" size="icon" onClick={() => setGithubTokenVisible((prev) => !prev)}>
              {githubTokenVisible ? <Eye /> : <EyeOff />}
            </Button>
            <OpenBroswer
              type="button"
              url="https://github.com/settings/tokens"
              title="创建 GitHub Token"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            建议使用只读 Token；公开仓库通常无需额外权限。未填写 Token 时，GitHub 链接会按普通网页链接保存。
          </p>
        </div>
      </FormItem>
    </SettingType>
  )
}
