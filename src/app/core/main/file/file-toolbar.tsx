"use client"
import {
  FolderGit2, 
  LoaderCircle,
  BookA,
} from "lucide-react"
import * as React from "react"
import { TooltipButton } from "@/components/tooltip-button"
import useArticleStore from "@/stores/article"
import { open } from '@tauri-apps/plugin-shell';
import useSettingStore from "@/stores/setting"
import { RepoNames } from "@/lib/sync/github.types"
import { GitlabInstanceType } from "@/lib/sync/gitlab.types"
import { GiteaInstanceType } from "@/lib/sync/gitea.types"
import { useTranslations } from "next-intl"
import useVectorStore from "@/stores/vector"
import useUsername from "@/hooks/use-username"
import { cn } from "@/lib/utils"

export function FileToolbar({
  compact = false,
  dense = false,
  tooltipSide = compact ? "bottom" : "top",
}: {
  compact?: boolean
  dense?: boolean
  tooltipSide?: "top" | "right" | "bottom" | "left"
}) {
  const { fileTreeLoading } = useArticleStore()
  const {
    primaryBackupMethod,
    githubCustomSyncRepo,
    giteeCustomSyncRepo,
    gitlabCustomSyncRepo,
    giteaCustomSyncRepo,
    gitlabInstanceType,
    gitlabCustomUrl,
    giteaInstanceType,
    giteaCustomUrl
  } = useSettingStore()
  const { processAllDocuments, isProcessing } = useVectorStore()
  const t = useTranslations('article.file.toolbar')

  const username = useUsername()
  const compactButtonClassName = dense
    ? "size-5 rounded-sm text-muted-foreground hover:text-foreground"
    : "size-7 rounded-md text-muted-foreground hover:text-foreground"
  const compactIconClassName = dense ? "size-3" : "size-4"

  const repoName = React.useMemo(() => {
    switch (primaryBackupMethod) {
      case 'github':
        return githubCustomSyncRepo.trim() || RepoNames.sync
      case 'gitee':
        return giteeCustomSyncRepo.trim() || RepoNames.sync
      case 'gitlab':
        return gitlabCustomSyncRepo.trim() || RepoNames.sync
      case 'gitea':
        return giteaCustomSyncRepo.trim() || RepoNames.sync
      default:
        return RepoNames.sync
    }
  }, [primaryBackupMethod, githubCustomSyncRepo, giteeCustomSyncRepo, gitlabCustomSyncRepo, giteaCustomSyncRepo])

  async function openRemoteRepo() {
    if (!username || !primaryBackupMethod) return

    let baseUrl = ''
    
    switch (primaryBackupMethod) {
      case 'github':
        baseUrl = 'https://github.com'
        break
      case 'gitee':
        baseUrl = 'https://gitee.com'
        break
      case 'gitlab':
        // 处理 Gitlab 自建实例
        if (gitlabInstanceType === GitlabInstanceType.SELF_HOSTED && gitlabCustomUrl) {
          baseUrl = gitlabCustomUrl.replace(/\/$/, '') // 移除末尾斜杠
        } else if (gitlabInstanceType === GitlabInstanceType.JIHULAB) {
          baseUrl = 'https://jihulab.com'
        } else {
          baseUrl = 'https://gitlab.com'
        }
        break
      case 'gitea':
        // 处理 Gitea 自建实例
        if (giteaInstanceType === GiteaInstanceType.SELF_HOSTED && giteaCustomUrl) {
          baseUrl = giteaCustomUrl.replace(/\/$/, '') // 移除末尾斜杠
        } else {
          baseUrl = 'https://gitea.com'
        }
        break
      default:
        return
    }

    open(`${baseUrl}/${username}/${repoName}`)
  }


  return (
    <div className={cn("flex items-center", compact ? "gap-0.5" : "h-12 gap-1 border-b px-2")}>
      {/* 向量数据库 */}
      <TooltipButton
        icon={isProcessing ? <LoaderCircle className={cn("animate-spin", compactIconClassName)} /> : <BookA className={cn("text-primary", compactIconClassName)} />}
        tooltipText={isProcessing ? t('processingVectors') : t('calculateVectors')}
        onClick={processAllDocuments}
        disabled={isProcessing}
        side={tooltipSide}
        buttonClassName={compact ? compactButtonClassName : undefined}
      />
      {/* 同步 */}
      {
        primaryBackupMethod && username ?
          <TooltipButton
            icon={fileTreeLoading ? <LoaderCircle className={cn("animate-spin", compactIconClassName)} /> : <FolderGit2 className={compactIconClassName} />}
            tooltipText={fileTreeLoading ? t('loadingSync') : t('accessRepo')}
            disabled={!username}
            onClick={openRemoteRepo}
            side={tooltipSide}
            buttonClassName={compact ? compactButtonClassName : undefined}
          />
          : null
      }
    </div>
  )
}
