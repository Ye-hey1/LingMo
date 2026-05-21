"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { AlertCircle, CheckCircle2, CloudSync, Database, FileArchive, FolderSync, Loader2, RefreshCw, ShieldAlert, Tags } from "lucide-react"
import { readDir } from "@tauri-apps/plugin-fs"
import { Store } from "@tauri-apps/plugin-store"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getSyncExcludeReason } from "@/config/sync-exclusions"
import { getAllMarks } from "@/db/marks"
import { getTags } from "@/db/tags"
import { SyncStateEnum } from "@/lib/sync/github.types"
import { cn } from "@/lib/utils"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import useSettingStore from "@/stores/setting"
import useSyncStore from "@/stores/sync"
import { S3Config, SYNC_PLATFORM_INFO, type SyncPlatform, WebDAVConfig } from "@/types/sync"

type ProviderStatus = "connected" | "disconnected" | "failed" | "unconfigured"

interface SyncHealthStats {
  marksTotal: number
  marksActive: number
  marksTrash: number
  tagsTotal: number
  filesTotal: number
  syncableFiles: number
  excludedFiles: number
  providerName: string
  providerStatus: ProviderStatus
  excludedSamples: Array<{ path: string; reason: string }>
  exclusionReasons: Array<{ reason: string; count: number }>
  recommendedActions: string[]
}

const STATUS_LABEL: Record<ProviderStatus, string> = {
  connected: "已连接",
  disconnected: "待检测",
  failed: "连接异常",
  unconfigured: "未配置",
}

const STATUS_CLASS: Record<ProviderStatus, string> = {
  connected: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-300",
  disconnected: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300",
  failed: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300",
  unconfigured: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300",
}

const PLATFORM_FALLBACK: Record<SyncPlatform, string> = {
  github: "GitHub",
  gitee: "Gitee",
  gitlab: "GitLab",
  gitea: "Gitea",
  s3: "S3",
  webdav: "WebDAV",
}

async function collectWorkspaceFiles() {
  const workspace = await getWorkspacePath()
  const files: string[] = []

  async function walk(relativeDir: string) {
    const pathOptions = await getFilePathOptions(relativeDir)
    const entries = workspace.isCustom
      ? await readDir(pathOptions.path)
      : await readDir(pathOptions.path, { baseDir: pathOptions.baseDir })

    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name.startsWith(".")) {
        continue
      }

      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      if (entry.isDirectory) {
        await walk(relativePath)
      } else if (entry.isFile) {
        files.push(relativePath)
      }
    }
  }

  await walk("")
  return files
}

async function getProviderStatus(platform: SyncPlatform): Promise<ProviderStatus> {
  const state = useSyncStore.getState()
  const store = await Store.load("store.json")

  if (platform === "github") {
    const username = await store.get<string>("githubUsername")
    const token = await store.get<string>("accessToken")
    if (!username || !token) return "unconfigured"
    return state.syncRepoState === SyncStateEnum.success ? "connected" : state.syncRepoState === SyncStateEnum.fail ? "failed" : "disconnected"
  }

  if (platform === "gitee") {
    const username = await store.get<string>("giteeUsername")
    const token = await store.get<string>("giteeAccessToken")
    if (!username || !token) return "unconfigured"
    return state.giteeSyncRepoState === SyncStateEnum.success ? "connected" : state.giteeSyncRepoState === SyncStateEnum.fail ? "failed" : "disconnected"
  }

  if (platform === "gitlab") {
    const projectId = await store.get<string>("gitlabProjectId")
    const token = await store.get<string>("gitlabAccessToken")
    if (!projectId || !token) return "unconfigured"
    return state.gitlabSyncProjectState === SyncStateEnum.success ? "connected" : state.gitlabSyncProjectState === SyncStateEnum.fail ? "failed" : "disconnected"
  }

  if (platform === "gitea") {
    const username = await store.get<string>("giteaUsername")
    const token = await store.get<string>("giteaAccessToken")
    if (!username || !token) return "unconfigured"
    return state.giteaSyncRepoState === SyncStateEnum.success ? "connected" : state.giteaSyncRepoState === SyncStateEnum.fail ? "failed" : "disconnected"
  }

  if (platform === "s3") {
    const config = await store.get<S3Config>("s3SyncConfig")
    if (!config?.bucket) return "unconfigured"
    return state.s3Connected ? "connected" : "failed"
  }

  const config = await store.get<WebDAVConfig>("webdavSyncConfig")
  if (!config?.url || !config?.username || !config?.password) return "unconfigured"
  return state.webdavConnected ? "connected" : "failed"
}

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: string | number
  hint: string
  icon: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{hint}</div>
    </div>
  )
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border/70 bg-background p-4 shadow-sm">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function SyncHealthPanel() {
  const { primaryBackupMethod } = useSettingStore()
  const syncState = useSyncStore()
  const [stats, setStats] = useState<SyncHealthStats | null>(null)
  const [loading, setLoading] = useState(false)

  const providerName = useMemo(() => {
    return SYNC_PLATFORM_INFO[primaryBackupMethod]?.name || PLATFORM_FALLBACK[primaryBackupMethod] || primaryBackupMethod
  }, [primaryBackupMethod])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [marks, tags, files] = await Promise.all([
        getAllMarks(),
        getTags(),
        collectWorkspaceFiles().catch(() => []),
      ])

      const excludedItems = files
        .map(file => ({ path: file, reason: getSyncExcludeReason(file) }))
        .filter((item): item is { path: string; reason: NonNullable<ReturnType<typeof getSyncExcludeReason>> } => Boolean(item.reason))
      const reasonMap = new Map<string, number>()
      excludedItems.forEach((item) => {
        reasonMap.set(item.reason.description, (reasonMap.get(item.reason.description) || 0) + 1)
      })

      const providerStatus = await getProviderStatus(primaryBackupMethod)
      const recommendedActions = [
        providerStatus === "unconfigured" ? "先到设置中配置同步平台，否则云端上传和下载不可用。" : "",
        marks.length > 0 ? "云同步会覆盖记录、标签和部分设置，重要迁移前建议先导出本地 ZIP。" : "",
        files.length > 0 ? "工作区文件适合日常增量同步，完整搬家请优先使用本地备份。" : "",
        excludedItems.length > 0 ? "排除文件不会进入云同步，需要保留时请检查本地备份。" : "",
      ].filter(Boolean)

      setStats({
        marksTotal: marks.length,
        marksActive: marks.filter(mark => mark.deleted !== 1).length,
        marksTrash: marks.filter(mark => mark.deleted === 1).length,
        tagsTotal: tags.length,
        filesTotal: files.length,
        syncableFiles: files.length - excludedItems.length,
        excludedFiles: excludedItems.length,
        providerName,
        providerStatus,
        excludedSamples: excludedItems.slice(0, 6).map(item => ({
          path: item.path,
          reason: item.reason.description,
        })),
        exclusionReasons: Array.from(reasonMap.entries()).map(([reason, count]) => ({ reason, count })),
        recommendedActions,
      })
    } finally {
      setLoading(false)
    }
  }, [primaryBackupMethod, providerName])

  useEffect(() => {
    void refresh()
  }, [refresh, syncState.syncRepoState, syncState.giteeSyncRepoState, syncState.gitlabSyncProjectState, syncState.giteaSyncRepoState, syncState.s3Connected, syncState.webdavConnected])

  const providerStatus = stats?.providerStatus || "unconfigured"

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border/70 bg-gradient-to-br from-background to-muted/35 p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <CloudSync className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">同步体检</h2>
                <Badge variant="outline" className={cn("h-6 border", STATUS_CLASS[providerStatus])}>
                  {providerName} · {STATUS_LABEL[providerStatus]}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                云同步负责记录、标签、部分设置与工作区文件；完整迁移仍建议使用本地 ZIP 备份。
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="记录"
          value={stats ? `${stats.marksActive}/${stats.marksTotal}` : "-"}
          hint={stats ? `回收站 ${stats.marksTrash} 条` : "正在读取记录"}
          icon={<Database className="h-4 w-4" />}
        />
        <StatCard
          label="标签"
          value={stats?.tagsTotal ?? "-"}
          hint="随标签 JSON 同步"
          icon={<Tags className="h-4 w-4" />}
        />
        <StatCard
          label="可同步文件"
          value={stats ? `${stats.syncableFiles}/${stats.filesTotal}` : "-"}
          hint="工作区文件增量同步"
          icon={<FolderSync className="h-4 w-4" />}
        />
        <StatCard
          label="已排除"
          value={stats?.excludedFiles ?? "-"}
          hint="不会进入云同步"
          icon={<ShieldAlert className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <PanelSection title="同步范围">
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {[
              "记录数据：活跃、回收站、处理状态",
              "标签数据：标签列表与标签关系",
              "应用设置：排除本机路径和外观偏好",
              "工作区文件：保存后的文件级同步",
            ].map(item => (
              <div key={item} className="flex items-start gap-2 rounded-md bg-muted/35 px-3 py-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </PanelSection>

        <PanelSection title="建议操作">
          <div className="space-y-2 text-sm text-muted-foreground">
            {(stats?.recommendedActions.length ? stats.recommendedActions : ["点击刷新获取当前同步建议。"]).map(item => (
              <div key={item} className="flex items-start gap-2 rounded-md bg-muted/35 px-3 py-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </PanelSection>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <PanelSection title="排除原因">
          {stats?.exclusionReasons.length ? (
            <div className="space-y-2">
              {stats.exclusionReasons.map(item => (
                <div key={item.reason} className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{item.reason}</span>
                  <Badge variant="secondary">{item.count}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md bg-muted/35 px-3 py-6 text-center text-sm text-muted-foreground">暂无被排除的工作区文件</div>
          )}
        </PanelSection>

        <PanelSection title="排除样例">
          {stats?.excludedSamples.length ? (
            <div className="space-y-2">
              {stats.excludedSamples.map(item => (
                <div key={item.path} className="flex items-start justify-between gap-3 rounded-md bg-muted/35 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground" title={item.path}>{item.path}</span>
                  <Badge variant="outline" className="shrink-0">{item.reason}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md bg-muted/35 px-3 py-6 text-center text-sm text-muted-foreground">没有排除样例</div>
          )}
        </PanelSection>
      </div>

      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <FileArchive className="mr-2 inline h-3.5 w-3.5 align-[-2px]" />
        本地 ZIP 备份包含更完整的应用数据，适合换设备、回滚和长期归档；云同步更适合日常多端保持一致。
      </div>
    </div>
  )
}
