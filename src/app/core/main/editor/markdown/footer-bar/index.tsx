'use client'

import { Editor } from '@tiptap/react'
import { FileText, Network, Keyboard, Feather } from 'lucide-react'
import { WordCount } from './word-count'
import { FileCreatedAt } from './file-created-at'
import { CopyButton } from './copy-button'
import { ExportButton } from './export-button'
import { HeadingCollapseMenu } from './heading-collapse-menu'
import { VectorCalc } from './vector-calc'
import { SyncTools } from '../sync/sync-tools'
import { SyncButton } from '../sync/sync-button'
import { PullButton } from '../sync/pull-button'
import { HistorySheet } from '../sync/history-sheet'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { isMobileDevice } from '@/lib/check'
import { KNOWLEDGE_GRAPH_TAB_PATH } from '@/app/core/main/knowledge/knowledge-graph-constants'
import emitter from '@/lib/emitter'

interface FooterBarProps {
  editor: Editor
  outlineOpen?: boolean
  onToggleOutline?: () => void
}

export function FooterBar({
  editor,
}: FooterBarProps) {
  const activeFilePath = useArticleStore((state) => state.activeFilePath)
  const {
    aiCompletionEnabled,
    setAiCompletionEnabled,
    typewriterMode,
    setTypewriterMode,
    zenMode,
    setZenMode,
  } = useSettingStore()
  const isMobile = isMobileDevice()
  const fileName = activeFilePath
    ? activeFilePath.split('/').pop() || activeFilePath
    : '未命名'

  if (isMobile) {
    return (
      <div className="h-7 flex items-center justify-between gap-3 px-3 border-t border-border bg-background text-xs text-muted-foreground">
        <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
          <FileText className="size-3.5 shrink-0" />
          <div className="min-w-0 flex items-center gap-1.5 overflow-hidden">
            <span className="block min-w-0 truncate font-medium text-foreground/90">{fileName}</span>
            <div className="shrink-0">
              <WordCount editor={editor} />
            </div>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <HistorySheet editor={editor} />
          <SyncButton />
          <PullButton editor={editor} />
        </div>
      </div>
    )
  }

  return (
    <div className="h-6 flex items-center justify-between px-3 border-t border-border bg-background text-xs text-muted-foreground select-none">
      {/* Left side: Word count, Copy, Export, Graph locate */}
      <div className="flex min-w-0 items-center gap-1">
        <WordCount editor={editor} />
        <FileCreatedAt />
        <HeadingCollapseMenu editor={editor} />
        <CopyButton editor={editor} />
        <ExportButton editor={editor} />
        {activeFilePath && activeFilePath.endsWith('.md') && (
          <button
            type="button"
            className="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="在图谱中定位"
            onClick={() => {
              // 发送事件通知图谱定位到当前文件
              emitter.emit('graph-locate-node' as any, { path: activeFilePath })
              // 打开图谱视图
              useArticleStore.getState().setActiveFilePath(KNOWLEDGE_GRAPH_TAB_PATH)
            }}
          >
            <Network className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Right side: Sync tools & Mode toggles */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setTypewriterMode(!typewriterMode)}
          className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] transition-colors hover:bg-muted/80
            ${typewriterMode ? 'text-[#1677ff] bg-[#1677ff]/10 hover:bg-[#1677ff]/20 font-medium' : 'text-muted-foreground hover:text-foreground'}
          `}
          title={typewriterMode ? "关闭打字机模式" : "开启打字机模式"}
        >
          <Keyboard className="h-3 w-3" />
          <span>打字机</span>
        </button>

        <button
          type="button"
          onClick={() => setZenMode(!zenMode)}
          className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] transition-colors hover:bg-muted/80
            ${zenMode ? 'text-[#1677ff] bg-[#1677ff]/10 hover:bg-[#1677ff]/20 font-medium' : 'text-muted-foreground hover:text-foreground'}
          `}
          title={zenMode ? "关闭禅模式" : "开启禅模式"}
        >
          <Feather className="h-3 w-3" />
          <span>专注</span>
        </button>
        <div className="h-3 w-px bg-border/80 mx-1" />
        <VectorCalc
          aiCompletionEnabled={aiCompletionEnabled}
          onToggleAICompletion={setAiCompletionEnabled}
        />
        <SyncTools editor={editor} />
      </div>
    </div>
  )
}

export default FooterBar
