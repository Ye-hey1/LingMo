import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { Copy, File, FileDown, FileUp, FolderOpen, ImageIcon, LoaderCircle, RefreshCwOff, Trash2, FileText, Star } from "lucide-react"
import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { ask } from '@tauri-apps/plugin-dialog';
import { platform } from '@tauri-apps/plugin-os';
import { Store } from '@tauri-apps/plugin-store';
import { RepoNames } from "@/lib/sync/github.types";
import { S3Config, WebDAVConfig } from "@/types/sync";
import { cloneDeep } from "lodash-es";
import { openPath } from "@tauri-apps/plugin-opener";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { createEmptyDiagramContent, ensureDiagramFileName, isDiagramPath } from "@/lib/diagram";
import { useSidebarStore } from "@/stores/sidebar";
import { toast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import useClipboardStore from "@/stores/clipboard";
import { appDataDir, join } from '@tauri-apps/api/path';
import { deleteFile } from "@/lib/sync/github";
import { deleteFile as deleteGiteeFile } from "@/lib/sync/gitee";
import { deleteFile as deleteGitlabFile } from "@/lib/sync/gitlab";
import { deleteFile as deleteGiteaFile } from "@/lib/sync/gitea";
import { s3Delete } from "@/lib/sync/s3";
import { webdavDelete } from "@/lib/sync/webdav";
import { getSyncRepoName } from "@/lib/sync/repo-utils";
import { generateUniqueFilename } from "@/lib/default-filename";
import { MobileActionMenu, MobileMenuItem, MobileSeparator } from "./mobile-action-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import useSettingStore from "@/stores/setting";
import { VectorKnowledgeMenu } from "./vector-knowledge-menu";
import { isSkillsFolder } from "@/lib/skills/utils";
import { KNOWLEDGE_GRAPH_TAG_DRAG_TYPE } from "@/lib/knowledge-graph-tags";
import {
  emitNoteGenFilePointerDrag,
  NOTE_GEN_FILE_POINTER_DRAG_THRESHOLD,
  type NoteGenFilePointerDragPhase,
} from "@/lib/file-pointer-drag";
import { sanitizeFileName } from "@/lib/sync/filename-utils";
import useFavoritesStore from "@/stores/favorites";

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

type PointerDragPoint = Pick<PointerEvent, 'clientX' | 'clientY'>
type FilePointerDragState = {
  pointerId: number
  startX: number
  startY: number
  dragging: boolean
  removeListeners: () => void
}

function shouldAutoSyncOnInitialRead(options?: { isNewFile?: boolean }) {
  return options?.isNewFile !== true
}

function stopRenameInputPropagation(event: React.SyntheticEvent) {
  event.stopPropagation()
}

function buildFileRenamePlan({
  originalName,
  currentPath,
  enteredName,
}: {
  originalName: string
  currentPath: string
  enteredName: string
}) {
  const sanitizedName = sanitizeFileName(enteredName.replace(/\s+/g, '_'))
  const isCreatingDiagram = originalName === '' && isDiagramPath(sanitizedName)
  const needsMarkdownSuffix = originalName === '' && !isCreatingDiagram && !sanitizedName.endsWith('.md')
  const displayName = isCreatingDiagram ? ensureDiagramFileName(sanitizedName) : needsMarkdownSuffix ? `${sanitizedName}.md` : sanitizedName
  const parentPath = currentPath.split('/').slice(0, -1).join('/')
  const targetRelativePath = parentPath ? `${parentPath}/${displayName}` : displayName

  return {
    operation: originalName === '' ? 'create' : 'rename',
    displayName,
    targetRelativePath,
  } as const
}

function getDisplayFileName(fileName: string) {
  const displayName = fileName
    .replace(/\.drawio\.xml$/i, '')
    .replace(/\.excalidraw\.json$/i, '')
    .replace(/\.diagram\.json$/i, '')
    .replace(/\.(md|markdown|pdf|drawio|json|txt)$/i, '')

  return displayName || fileName
}

function FileNameLabel({ name, title, textSize }: { name: string; title?: string; textSize: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [scrollState, setScrollState] = useState({ enabled: false, distance: 0, duration: 5 })

  const updateScrollState = useCallback(() => {
    const wrap = wrapRef.current
    const text = textRef.current
    if (!wrap || !text) {
      return
    }

    const distance = Math.ceil(text.scrollWidth - wrap.clientWidth)
    setScrollState({
      enabled: distance > 6,
      distance: Math.max(0, distance),
      duration: Math.min(12, Math.max(4, distance / 18)),
    })
  }, [])

  useEffect(() => {
    updateScrollState()
  }, [name, textSize, updateScrollState])

  const style = {
    '--file-name-scroll-distance': `${scrollState.distance}px`,
    '--file-name-scroll-duration': `${scrollState.duration}s`,
  } as CSSProperties

  return (
    <span
      ref={wrapRef}
      className={`file-manager-name min-w-0 flex-1 text-${textSize} ${scrollState.enabled ? 'is-scrollable' : ''}`}
      style={style}
      title={title ?? name}
      onMouseEnter={updateScrollState}
    >
      <span ref={textRef} className="file-manager-name-text">
        {name}
      </span>
    </span>
  )
}

export function FileItem({ item, focusSidebar }: { item: DirTree; focusSidebar?: () => void }) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [isComposing, setIsComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pointerDragRef = useRef<FilePointerDragState | null>(null)
  const suppressNextClickRef = useRef(false)
  const {
    activeFilePath,
    setActiveFilePath,
    readArticle,
    fileTree,
    setFileTree,
    loadFileTree,
    vectorIndexedFiles,
    checkFileVectorIndexed,
    cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder,
    syncOpenTabsForPathChange,
  } = useArticleStore()
  const setArticleState = useArticleStore.setState
  const { setClipboardItem, clipboardItem, clipboardOperation } = useClipboardStore()
  const { centerPanelVisible } = useSidebarStore()
  const { fileManagerTextSize } = useSettingStore()
  const { favorites, toggleFavorite } = useFavoritesStore()
  const t = useTranslations('article.file')
  const isMobile = useIsMobile()

  // 妫€鏌ヨ矾寰勬槸鍚﹀湪 skills 鏂囦欢澶逛笅
  const isInSkillsFolder = (itemPath: string): boolean => {
    const parts = itemPath.split('/')
    return parts.some(part => isSkillsFolder(part))
  }

  const path = computedParentPath(item)

  const handleVectorUpdated = useCallback(() => {
    checkFileVectorIndexed(path)
  }, [path, checkFileVectorIndexed])

  // 鏍规嵁鏂囧瓧澶у皬鏄犲皠鍥炬爣澶у皬
  const getIconSize = (textSize: string) => {
    const sizeMap = {
      'xs': 'size-3',
      'sm': 'size-3.5',
      'md': 'size-4',
      'lg': 'size-5',
      'xl': 'size-6'
    }
    return sizeMap[textSize as keyof typeof sizeMap] || 'size-4'
  }

  const iconSize = getIconSize(fileManagerTextSize)

  // 妫€鏌ユ枃浠舵槸鍚﹁鍓垏
  const isCut = clipboardOperation === 'cut' && clipboardItem?.path === path

  const hasVector = item.isFile && !isInSkillsFolder(path) && vectorIndexedFiles.has(path)

  const renderVectorIcon = () => {
    if (isInSkillsFolder(path)) return null

    const status = item.vectorCalcStatus

    if (status === 'calculating') {
      return <LoaderCircle className={`${iconSize} ml-1 shrink-0 animate-spin text-muted-foreground`} />
    }
    return null
  }

  const isFavorite = favorites.some(favorite => favorite.path === path)
  const displayFileName = item.isFile ? getDisplayFileName(item.name) : item.name

  const isRoot = path.split('/').length === 1
  const folderPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
  // 涓嶉渶瑕?cloneDeep锛屽洜涓?getCurrentFolder 鍙鍙栨暟鎹笉淇敼
  const currentFolder = getCurrentFolder(folderPath, fileTree)

  function handleToggleFavorite(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    void toggleFavorite(path, item.name)
  }

  function rememberDraggingPath() {
    if (typeof window === 'undefined') return
    ;(window as unknown as { __noteGenDraggingFilePath?: string }).__noteGenDraggingFilePath = path
  }

  function clearDraggingPath() {
    if (typeof window === 'undefined') return
    const dragState = window as unknown as { __noteGenDraggingFilePath?: string }
    if (dragState.__noteGenDraggingFilePath === path) {
      delete dragState.__noteGenDraggingFilePath
    }
  }

  const renderFavoriteButton = () => (
    <button
      type="button"
      className={`file-manager-favorite-button ${isFavorite ? 'is-favorite' : ''}`}
      title={isFavorite ? '取消收藏' : '添加收藏'}
      aria-label={isFavorite ? '取消收藏' : '添加收藏'}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={handleToggleFavorite}
    >
      <Star className="size-3.5" fill={isFavorite ? 'currentColor' : 'none'} />
    </button>
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const value = input.value
    const cursorPosition = input.selectionStart || 0
    
    if (isComposing) {
      setName(value)
      return
    }
    
    if (value.includes(' ')) {
      const sanitizedValue = value.replace(/\s+/g, '_')
      setName(sanitizedValue)
      
      // 淇濇寔鍏夋爣浣嶇疆
      requestAnimationFrame(() => {
        if (input.selectionStart !== null) {
          input.setSelectionRange(cursorPosition, cursorPosition)
        }
      })
    } else {
      setName(value)
    }
  }, [isComposing])

  const handleCompositionStart = useCallback(() => {
    setIsComposing(true)
  }, [])

  // 杈撳叆娉曞悎鎴愮粨鏉燂紝杩涜绌烘牸鏇挎崲
  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false)
    const input = e.currentTarget
    const value = input.value
    const cursorPosition = input.selectionStart || 0
    
    // 鍙湁褰撳€煎寘鍚┖鏍兼椂鎵嶉渶瑕佹浛鎹㈠拰鎭㈠鍏夋爣浣嶇疆
    if (value.includes(' ')) {
      const sanitizedValue = value.replace(/\s+/g, '_')
      setName(sanitizedValue)
      
      // 璁＄畻鏂扮殑鍏夋爣浣嶇疆锛堢┖鏍煎彉涓轰笅鍒掔嚎锛岄暱搴︿笉鍙橈紝鎵€浠ヤ綅缃繚鎸佷笉鍙橈級
      requestAnimationFrame(() => {
        if (input.selectionStart !== null) {
          input.setSelectionRange(cursorPosition, cursorPosition)
        }
      })
    } else {
      setName(value)
    }
  }, [])

  async function handleSelectFile() {
    // 璁╂枃浠剁鐞嗗櫒鑾峰緱鐒︾偣锛屼互渚垮搷搴斿揩鎹烽敭
    focusSidebar?.()
    const currentPath = computedParentPath(item)

    // 纭繚涓棿缂栬緫鍣ㄩ潰鏉垮睍寮€
    if (!centerPanelVisible) {
      useSidebarStore.setState({ centerPanelVisible: true })
      localStorage.setItem('centerPanelVisible', 'true')
    }

    if (item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
      setActiveFilePath(currentPath)
    } else if (item.name.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template)$/i)) {
      setActiveFilePath(currentPath)
    } else {
      setActiveFilePath(currentPath)
    }
  }

  function emitCurrentPointerDrag(phase: NoteGenFilePointerDragPhase, point: PointerDragPoint) {
    rememberDraggingPath()
    emitNoteGenFilePointerDrag({
      phase,
      path,
      name: item.name,
      displayName: displayFileName,
      isDirectory: item.isDirectory,
      isFile: item.isFile,
      x: point.clientX,
      y: point.clientY,
    })
  }

  function cleanupPointerDrag() {
    const state = pointerDragRef.current
    pointerDragRef.current = null
    state?.removeListeners()
  }

  function handleGlobalPointerDragMove(event: PointerEvent) {
    const state = pointerDragRef.current
    if (!state || state.pointerId !== event.pointerId) return

    const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY)
    if (!state.dragging && distance < NOTE_GEN_FILE_POINTER_DRAG_THRESHOLD) return

    if (!state.dragging) {
      state.dragging = true
      suppressNextClickRef.current = true
      emitCurrentPointerDrag('start', event)
    }

    event.preventDefault()
    emitCurrentPointerDrag('move', event)
  }

  function finishGlobalPointerDrag(event: PointerEvent, phase: 'end' | 'cancel') {
    const state = pointerDragRef.current
    if (!state || state.pointerId !== event.pointerId) return

    const wasDragging = state.dragging
    cleanupPointerDrag()

    if (wasDragging) {
      event.preventDefault()
      emitCurrentPointerDrag(phase, event)
      clearDraggingPath()
    }
  }

  function handlePointerDragDown(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || item.isDirectory || item.name === '' || isEditing) return
    cleanupPointerDrag()

    const onPointerMove = (nativeEvent: PointerEvent) => handleGlobalPointerDragMove(nativeEvent)
    const onPointerUp = (nativeEvent: PointerEvent) => finishGlobalPointerDrag(nativeEvent, 'end')
    const onPointerCancel = (nativeEvent: PointerEvent) => finishGlobalPointerDrag(nativeEvent, 'cancel')

    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)

    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      removeListeners: () => {
        window.removeEventListener('pointermove', onPointerMove, true)
        window.removeEventListener('pointerup', onPointerUp, true)
        window.removeEventListener('pointercancel', onPointerCancel, true)
      },
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort in WebView; global move still works for normal cases.
    }
  }

  function handlePointerDragMove(event: React.PointerEvent<HTMLElement>) {
    handleGlobalPointerDragMove(event.nativeEvent)
  }

  function handlePointerDragEnd(event: React.PointerEvent<HTMLElement>) {
    finishGlobalPointerDrag(event.nativeEvent, 'end')
  }

  function handlePointerDragCancel(event: React.PointerEvent<HTMLElement>) {
    finishGlobalPointerDrag(event.nativeEvent, 'cancel')
  }

  function handleFileRowClick() {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }
    void handleSelectFile()
  }

  async function handleDeleteFile() {
    // 娣诲姞纭寮圭獥
    const answer = await ask(t('deleteConfirm'), {
      title: item.name,
      kind: 'warning',
    });
    // 濡傛灉鐢ㄦ埛纭鍒犻櫎锛屽垯缁х画鎵ц
    if (answer) {
      try {
        const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
        const workspace = await getWorkspacePath()

        // 浣跨敤褰撳墠璺緞锛岃€屼笉鏄噸鏂拌绠楃殑璺緞
        const currentPath = computedParentPath(item)

        const pathOptions = await getFilePathOptions(currentPath)

        // 先检查文件是否存在，避免删除不存在的文件时报错
        let fileExists = false
        if (workspace.isCustom) {
          fileExists = await exists(pathOptions.path)
        } else {
          fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        if (fileExists) {
          if (workspace.isCustom) {
            await remove(pathOptions.path)
          } else {
            await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
        }

        if (currentFolder) {
          const index = currentFolder.children?.findIndex(file => file.name === item.name)
          if (index !== undefined && index !== -1 && currentFolder.children) {
            const current = currentFolder.children[index]
            if (current.sha) {
              // 鏈変簯绔増鏈細鍙爣璁颁负闈炴湰鍦版枃浠讹紝淇濈暀浜戠鏂囦欢
              current.isLocale = false
            } else {
              // 绾湰鍦版枃浠讹細鐩存帴浠庢枃浠舵爲涓Щ闄?
              currentFolder.children.splice(index, 1)
            }
          }
        } else {
          const cacheTree = cloneDeep(fileTree)
          const index = cacheTree.findIndex(file => file.name === item.name)
          if (index !== undefined && index !== -1) {
            const current = cacheTree[index]
            if (current.sha) {
              // 鏈変簯绔増鏈細鍙爣璁颁负闈炴湰鍦版枃浠讹紝淇濈暀浜戠鏂囦欢
              current.isLocale = false
            } else {
              // 绾湰鍦版枃浠讹細鐩存帴浠庢枃浠舵爲涓Щ闄?
              cacheTree.splice(index, 1)
            }
          }
          setFileTree(cacheTree)
        }

        try {
          const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
          await deleteVectorDocumentsByFilename(path)
          // 浠庡悜閲忕储寮曟槧灏勪腑绉婚櫎
          const newMap = new Map(vectorIndexedFiles)
          newMap.delete(path)
          setArticleState({ vectorIndexedFiles: newMap })
        } catch (error) {
          console.error(`鍒犻櫎鏂囦欢 ${item.name} 鐨勫悜閲忔暟鎹け璐?`, error)
        }

        await cleanTabsByDeletedFile(currentPath)
      } catch (error) {
        console.error('Delete file failed:', error)
        // 文件不存在时静默刷新文件树即可，不需要弹窗提示
        await loadFileTree({ skipRemoteSync: true })
      }
    }
  }

  async function handleDeleteSyncFile() {
    const answer = await ask(t('context.deleteSyncFile') + '?', {
      title: item.name,
      kind: 'warning',
    });
    if (answer) {
      const currentPath = computedParentPath(item)

      const cacheTree = cloneDeep(fileTree)
      const setLoadingStatus = (items: typeof cacheTree): boolean => {
        for (const entry of items) {
          const entryPath = computedParentPath(entry)
          if (entryPath === currentPath && entry.isFile) {
            entry.loading = true
            return true
          }
          if (entry.children && setLoadingStatus(entry.children)) {
            return true
          }
        }
        return false
      }
      if (setLoadingStatus(cacheTree)) {
        setFileTree(cacheTree)
      }

      try {
        // 鑾峰彇褰撳墠涓昏澶囦唤鏂瑰紡
        const store = await Store.load('store.json');
        const backupMethod = await store.get<'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'>('primaryBackupMethod') || 'github';
        const repoName = backupMethod === 's3' || backupMethod === 'webdav'
          ? RepoNames.sync
          : await getSyncRepoName(backupMethod)

        let success = false
        switch (backupMethod) {
          case 'github': {
            const result = await deleteFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = !!result
            break;
          }
          case 'gitee': {
            const result = await deleteGiteeFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = result !== false
            break;
          }
          case 'gitlab': {
            const result = await deleteGitlabFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = !!result
            break;
          }
          case 'gitea': {
            const result = await deleteGiteaFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = !!result
            break;
          }
          case 's3': {
            const s3Config = await store.get<S3Config>('s3SyncConfig')
            if (s3Config) {
              const result = await s3Delete(s3Config, currentPath)
              success = result
            }
            break;
          }
          case 'webdav': {
            const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
            if (webdavConfig) {
              const result = await webdavDelete(webdavConfig, currentPath)
              success = result
            }
            break;
          }
        }

        if (success) {
          // 鍙洿鏂板綋鍓嶆枃浠剁殑鐘舵€侊紝涓嶅埛鏂版暣涓枃浠舵爲
          const cacheTree = cloneDeep(fileTree)

          // 閫掑綊鏌ユ壘骞舵洿鏂?鍒犻櫎鏂囦欢
          const updateOrRemoveFile = (items: typeof cacheTree): boolean => {
            for (let i = 0; i < items.length; i++) {
              const entry = items[i]
              const entryPath = computedParentPath(entry)
              if (entryPath === currentPath && entry.isFile) {
                if (entry.isLocale) {
                  // 鏈湴瀛樺湪锛氬彧娓呴櫎杩滅▼ SHA
                  entry.sha = undefined
                  entry.loading = undefined
                } else {
                  // 鏈湴涓嶅瓨鍦細浠庡垪琛ㄤ腑绉婚櫎
                  items.splice(i, 1)
                }
                return true
              }
              if (entry.children && updateOrRemoveFile(entry.children)) {
                return true
              }
            }
            return false
          }

          if (updateOrRemoveFile(cacheTree)) {
            setFileTree(cacheTree)
          }

          toast({
            title: t('context.delete'),
            description: t('context.deleteSyncFileSuccess'),
          });
        } else {
          const cacheTree = cloneDeep(fileTree)
          const clearLoadingStatus = (items: typeof cacheTree): boolean => {
            for (const entry of items) {
              const entryPath = computedParentPath(entry)
              if (entryPath === currentPath && entry.isFile) {
                entry.loading = undefined
                return true
              }
              if (entry.children && clearLoadingStatus(entry.children)) {
                return true
              }
            }
            return false
          }
          if (clearLoadingStatus(cacheTree)) {
            setFileTree(cacheTree)
          }
          throw new Error('鍒犻櫎鎿嶄綔杩斿洖澶辫触')
        }
      } catch (error) {
        const cacheTree = cloneDeep(fileTree)
        const clearLoadingStatus = (items: typeof cacheTree): boolean => {
          for (const entry of items) {
            const entryPath = computedParentPath(entry)
            if (entryPath === currentPath && entry.isFile) {
              entry.loading = undefined
              return true
            }
            if (entry.children && clearLoadingStatus(entry.children)) {
              return true
            }
          }
          return false
        }
        if (clearLoadingStatus(cacheTree)) {
          setFileTree(cacheTree)
        }
        console.error('[handleDeleteSyncFile] 鍒犻櫎杩滅▼鏂囦欢澶辫触:', error);
        toast({
          title: t('context.delete'),
          description: t('context.deleteSyncFileError'),
          variant: 'destructive',
        });
      }
    }
  }

  async function handleStartRename() {
    // 寤惰繜鎵ц锛岀‘淇濅笂涓嬫枃鑿滃崟瀹屽叏鍏抽棴
    setTimeout(() => {
      setIsEditing(true)
      setTimeout(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          // 鍙€変腑鏂囦欢鍚嶏紝涓嶅寘鍚墿灞曞悕
          const lastDotIndex = item.name.lastIndexOf('.')
          if (lastDotIndex > 0) {
            input.setSelectionRange(0, lastDotIndex)
          } else {
            input.select()
          }
        }
      }, 100)
    }, 300)
  }

  async function handleRename() {
    const originalName = item.name
    
    let finalName = name
    
    if (!name || name.trim() === '') {
      const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
      finalName = await generateUniqueFilename(parentPath, 'Untitled')
      setName(finalName)
    } else {
      // 缁熶竴澶勭悊锛氬皢绌烘牸鏇挎崲涓轰笅鍒掔嚎锛岀‘淇濇湰鍦板拰杩滅▼鏂囦欢鍚嶄竴鑷?      finalName = sanitizeFileName(name.replace(/\s+/g, '_'))
      setName(finalName)
    }
  
    if (finalName && finalName.trim() !== '' && finalName !== originalName) {
      const renamePlan = buildFileRenamePlan({
        originalName,
        currentPath: path,
        enteredName: finalName,
      })
      const { displayName, operation, targetRelativePath } = renamePlan

      if (targetRelativePath === path) {
        setIsEditing(false)
        return
      }

      try {
        const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
        const workspace = await getWorkspacePath()

        if (operation === 'rename') {
          const oldPathOptions = await getFilePathOptions(path)
          const newPathOptions = await getFilePathOptions(targetRelativePath)

          let targetExists = false
          if (workspace.isCustom) {
            targetExists = await exists(newPathOptions.path)
          } else {
            targetExists = await exists(newPathOptions.path, { baseDir: newPathOptions.baseDir })
          }

          if (targetExists) {
            toast({ title: '鏂囦欢鍚嶅凡瀛樺湪' })
            setTimeout(() => inputRef.current?.focus(), 300)
            return
          }

          if (workspace.isCustom) {
            await rename(oldPathOptions.path, newPathOptions.path)
          } else {
            await rename(oldPathOptions.path, newPathOptions.path, {
              newPathBaseDir: BaseDirectory.AppData,
              oldPathBaseDir: BaseDirectory.AppData
            })
          }
          await syncOpenTabsForPathChange(path, targetRelativePath)
        } else {
          const pathOptions = await getFilePathOptions(targetRelativePath)

          let isExists = false
          if (workspace.isCustom) {
            isExists = await exists(pathOptions.path)
          } else {
            isExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
          }

          if (isExists) {
            toast({ title: '鏂囦欢鍚嶅凡瀛樺湪' })
            setTimeout(() => inputRef.current?.focus(), 300)
            return
          }

          const initialContent = isDiagramPath(targetRelativePath) ? createEmptyDiagramContent(targetRelativePath) : ''
          if (workspace.isCustom) {
            await writeTextFile(pathOptions.path, initialContent)
          } else {
            await writeTextFile(pathOptions.path, initialContent, { baseDir: pathOptions.baseDir })
          }
        }

        const nextTree = cloneDeep(fileTree)
        const nextFolder = getCurrentFolder(folderPath, nextTree)

        if (nextFolder && nextFolder.children) {
          const fileIndex = nextFolder?.children?.findIndex(file => file.name === originalName)
          if (fileIndex !== undefined && fileIndex !== -1) {
            nextFolder.children[fileIndex].name = displayName
            nextFolder.children[fileIndex].isEditing = false
          }
        } else {
          const fileIndex = nextTree.findIndex(file => file.name === originalName)
          if (fileIndex !== -1 && fileIndex !== undefined) {
            nextTree[fileIndex].name = displayName
            nextTree[fileIndex].isEditing = false
          }
        }
        setFileTree(nextTree)

        let newPath = targetRelativePath
        if (newPath.startsWith('/')) {
          newPath = newPath.slice(1)
        }
        setActiveFilePath(newPath)
        // 鏂板缓鏂囦欢鍚庤嚜鍔ㄩ€夋嫨璇ユ枃浠跺苟璇诲彇鍐呭
        readArticle(newPath, '', shouldAutoSyncOnInitialRead({ isNewFile: operation === 'create' }))
        setIsEditing(false)
      } catch (error) {
        console.error('Rename file failed:', error)
        setName(originalName)
        setIsEditing(false)
        await loadFileTree({ skipRemoteSync: true })
        toast({
          title: t('context.rename'),
          description: '閲嶅懡鍚嶅け璐ワ紝宸叉仮澶嶆枃浠跺垪琛? ' + error,
          variant: 'destructive',
        })
      }
    } else {
      if (originalName === '') {
        // 鍙湁褰撳師鏂囦欢鍚嶄负绌猴紙鏂板缓鏂囦欢锛夋椂鎵嶅垹闄ゅ垪琛ㄩ」
        if (currentFolder && currentFolder.children) {
          const index = currentFolder?.children?.findIndex(item => item.name === '')
          if (index !== undefined && index !== -1 && currentFolder?.children) {
            currentFolder?.children?.splice(index, 1)
          }
          setFileTree(fileTree)
        } else {
          const cacheTree = cloneDeep(fileTree)
          const index = cacheTree.findIndex(item => item.name === '')
          if (index !== -1) {
            cacheTree.splice(index, 1)
          }
          setFileTree(cacheTree)
        }
      } else {
        if (currentFolder && currentFolder.children) {
          const fileIndex = currentFolder?.children?.findIndex(file => file.name === item.name)
          if (fileIndex !== undefined && fileIndex !== -1) {
            currentFolder.children[fileIndex].isEditing = false
          }
          setFileTree(fileTree)
        } else {
          const cacheTree = cloneDeep(fileTree)
          const fileIndex = cacheTree.findIndex(file => file.name === item.name)
          if (fileIndex !== -1 && fileIndex !== undefined) {
            cacheTree[fileIndex].isEditing = false
          }
          setFileTree(cacheTree)
        }
      }
    }
    setIsEditing(false)
  }

  async function handleShowFileManager() {
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    
    // 纭畾鏂囦欢鎵€鍦ㄧ殑鐩綍璺緞
    const folderPath = item.parent ? computedParentPath(item.parent) : ''
    
    // 鏍规嵁宸ヤ綔鍖虹被鍨嬬‘瀹氭纭殑璺緞
    if (workspace.isCustom) {
      const pathOptions = await getFilePathOptions(folderPath)
      openPath(pathOptions.path)
    } else {
      // 榛樿宸ヤ綔鍖?- 浣跨敤 AppData 鐩綍
      const appDir = await appDataDir()
      openPath(await join(appDir, 'article', folderPath))
    }
  }

  async function handleDragStart(ev: React.DragEvent<HTMLElement>) {
    rememberDraggingPath()
    const payload = JSON.stringify({
      path,
      name: item.name,
      displayName: displayFileName,
      isDirectory: item.isDirectory,
      isFile: item.isFile,
      source: 'note-gen-file',
    })
    ev.dataTransfer.effectAllowed = 'copyMove'
    ev.dataTransfer.setData(KNOWLEDGE_GRAPH_TAG_DRAG_TYPE, payload)
    ev.dataTransfer.setData('application/x-note-gen-file', payload)
    ev.dataTransfer.setData('text/plain', path)
    ev.dataTransfer.setData('text', path)
  }

  async function handleCopyFile() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: false,
      sha: item.sha,
      isLocale: item.isLocale
    }, 'copy')
    toast({ title: t('clipboard.copied') })
  }

  async function handleCutFile() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: false,
      sha: item.sha,
      isLocale: item.isLocale
    }, 'cut')
    toast({ title: t('clipboard.cut') })
  }

  async function handlePasteFile() {
    if (!clipboardItem) {
      toast({ title: t('clipboard.empty'), variant: 'destructive' })
      return
    }

    try {
      const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()

      // 绮樿创鐩爣锛氭枃浠舵墍鍦ㄧ殑鐩綍锛堝悓绾х矘璐达級
      const targetDir = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''

      // 妫€鏌ユ槸鍚︿細閫犳垚寰幆宓屽
      if (clipboardItem.isDirectory) {
        // 妫€鏌ユ槸鍚︾矘璐村埌鍏跺瓙鏂囦欢澶瑰唴閮紙targetDir 浠?clipboardItem.path/ 寮€澶达級
        if (targetDir.startsWith(clipboardItem.path + '/')) {
          toast({ title: '无法将父文件夹粘贴到其子文件夹内部', variant: 'destructive' })
          return
        }
      }

      if (clipboardItem.isDirectory) {
        const { generateCopyFoldername } = await import('@/lib/default-filename')
        const { mkdir, readDir } = await import('@tauri-apps/plugin-fs')

        const targetName = await generateCopyFoldername(targetDir, clipboardItem.name)
        const targetPathRelative = targetDir ? `${targetDir}/${targetName}` : targetName
        const targetPathOptions = await getFilePathOptions(targetPathRelative)
        const sourcePathOptions = await getFilePathOptions(clipboardItem.path)

        // 妫€鏌ユ槸鍚︽槸绮樿创鍒拌嚜韬唴閮紙闇€瑕侀伩鍏嶅惊鐜紩鐢級
        const isPasteIntoSelf = targetDir === clipboardItem.path

        if (workspace.isCustom) {
          await mkdir(targetPathOptions.path)
        } else {
          await mkdir(targetPathOptions.path, { baseDir: targetPathOptions.baseDir })
        }

        const copyDirRecursively = async (srcRelative: string, destRelative: string) => {
          const entries = await readDir(
            srcRelative,
            workspace.isCustom ? {} : { baseDir: sourcePathOptions.baseDir || BaseDirectory.AppData }
          )

          for (const entry of entries) {
            const srcEntryPath = `${srcRelative}/${entry.name}`
            const destEntryPath = `${destRelative}/${entry.name}`

            if (entry.isDirectory) {
              if (isPasteIntoSelf && entry.name === targetName) {
                continue
              }

              if (workspace.isCustom) {
                await mkdir(destEntryPath)
              } else {
                await mkdir(destEntryPath, { baseDir: targetPathOptions.baseDir })
              }
              await copyDirRecursively(srcEntryPath, destEntryPath)
            } else {
              try {
                let content = ''
                if (workspace.isCustom) {
                  content = await readTextFile(srcEntryPath)
                  await writeTextFile(destEntryPath, content)
                } else {
                  content = await readTextFile(srcEntryPath, { baseDir: sourcePathOptions.baseDir || BaseDirectory.AppData })
                  await writeTextFile(destEntryPath, content, { baseDir: targetPathOptions.baseDir })
                }
              } catch (err) {
                console.error(`Error copying file ${srcEntryPath}:`, err)
              }
            }
          }
        }

        await copyDirRecursively(sourcePathOptions.path, targetPathOptions.path)

        // 濡傛灉鏄壀鍒囨搷浣滐紝鍒犻櫎鍘熸枃浠跺す
        if (clipboardOperation === 'cut') {
          if (workspace.isCustom) {
            await remove(sourcePathOptions.path, { recursive: true })
          } else {
            await remove(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir, recursive: true })
          }
          // 娓呯悊宸茶鍒犻櫎鐨勫師鏂囦欢澶瑰搴旂殑 tabs
          await cleanTabsByDeletedFolder(clipboardItem?.path || '')
          setClipboardItem(null, 'none')
        }
      } else {
        // 绮樿创鏂囦欢
        const sourcePathOptions = await getFilePathOptions(clipboardItem.path)
        const { generateCopyFilename } = await import('@/lib/default-filename')
        const uniqueFilename = await generateCopyFilename(targetDir, clipboardItem.name)
        const targetPathRelative = targetDir ? `${targetDir}/${uniqueFilename}` : uniqueFilename
        const targetPathOptions = await getFilePathOptions(targetPathRelative)

        // Read content from source file
        let content = ''
        if (workspace.isCustom) {
          content = await readTextFile(sourcePathOptions.path)
          await writeTextFile(targetPathOptions.path, content)
        } else {
          content = await readTextFile(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir })
          await writeTextFile(targetPathOptions.path, content, { baseDir: targetPathOptions.baseDir })
        }

        // If cut operation, delete the original file
        if (clipboardOperation === 'cut') {
          if (workspace.isCustom) {
            await remove(sourcePathOptions.path)
          } else {
            await remove(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir })
          }
          // 娓呯悊宸茶鍒犻櫎鐨勫師鏂囦欢瀵瑰簲鐨?tabs
          await cleanTabsByDeletedFile(clipboardItem?.path || '')
          // Clear clipboard after cut & paste operation
          setClipboardItem(null, 'none')
        }
      }

      // Refresh file tree
      loadFileTree()
      toast({ title: t('clipboard.pasted') })
    } catch (error) {
      console.error('Paste operation failed:', error)
      toast({ title: t('clipboard.pasteFailed'), variant: 'destructive' })
    }
  }

  async function handleEditEnd() {
    if (currentFolder && currentFolder.children) {
      const index = currentFolder?.children?.findIndex(item => item.name === '')
      if (index !== undefined && index !== -1 && currentFolder?.children) {
        currentFolder?.children?.splice(index, 1)
      }
      setFileTree(fileTree)
    } else {
      const cacheTree = cloneDeep(fileTree)
      const index = cacheTree.findIndex(item => item.name === '')
      if (index !== -1) {
        cacheTree.splice(index, 1)
      }
      setFileTree(cacheTree)
    }
    setIsEditing(false)
  }

  useEffect(() => {
    if (item.isEditing) {
      setIsEditing(true)
      setName(item.name)
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [item])

  useEffect(() => {
    const handleRenameEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>
      if (customEvent.detail.path === path) {
        handleStartRename()
      }
    }

    const handleDeleteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ item: { path: string } }>
      if (customEvent.detail.item.path === path) {
        handleDeleteFile()
      }
    }

    const handlePasteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetPath: string }>
      if (customEvent.detail.targetPath === path) {
        handlePasteFile()
      }
    }

    window.addEventListener('filemanager-rename', handleRenameEvent)
    window.addEventListener('filemanager-delete', handleDeleteEvent)
    window.addEventListener('filemanager-paste', handlePasteEvent)

    return () => {
      window.removeEventListener('filemanager-rename', handleRenameEvent)
      window.removeEventListener('filemanager-delete', handleDeleteEvent)
      window.removeEventListener('filemanager-paste', handlePasteEvent)
    }
  }, [path, handleStartRename, handleDeleteFile, handlePasteFile])

  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')

  useEffect(() => {
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch {
      setCurrentPlatform('unknown')
    }
  }, [])

  const modKey = currentPlatform === 'macos' ? 'Cmd' : 'Ctrl'
  const deleteKey = currentPlatform === 'macos' ? 'Delete' : 'Del'
  const renameKey = currentPlatform === 'macos' ? 'Enter' : 'F2'

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`${path === activeFilePath ? 'file-manange-item active' : 'file-manange-item'} ${!isRoot ? 'file-manager-child-item' : ''} ${!item.isDirectory && item.name !== '' ? 'is-draggable-file' : ''} group/file`}
            draggable={false}
            onPointerDown={handlePointerDragDown}
            onPointerMove={handlePointerDragMove}
            onPointerUp={handlePointerDragEnd}
            onPointerCancel={handlePointerDragCancel}
            onClick={handleFileRowClick}
          >
            {
              isEditing ? 
              <div className="flex gap-1 items-center w-full select-none">
                <span className={item.parent ? 'size-0' : `${iconSize} ml-1`} />
                <File className={iconSize} />
                <Input
                  ref={inputRef}
                  className={`h-5 rounded-sm text-${fileManagerTextSize} px-1 font-normal flex-1 mr-1`}
                  value={name}
                  onPointerDown={stopRenameInputPropagation}
                  onMouseDown={stopRenameInputPropagation}
                  onClick={stopRenameInputPropagation}
                  onDoubleClick={stopRenameInputPropagation}
                  onContextMenu={stopRenameInputPropagation}
                  onBlur={handleRename}
                  onChange={handleInputChange}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={(e) => {
                    // 闃绘鍒犻櫎蹇嵎閿啋娉″埌鍏ㄥ眬蹇嵎閿鐞嗗櫒
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      e.stopPropagation()
                    }
                    if (e.code === 'Enter' && !e.nativeEvent.isComposing) {
                      handleRename()
                    } else if (e.code === 'Escape') {
                      handleEditEnd()
                    }
                  }}
                />
              </div> :
              item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i) ?
              <span
                draggable={false}
                title={path}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex min-w-0 flex-1 select-none items-center justify-between gap-1 dark:hover:text-white`}>
                <div className="file-manager-row-main flex min-w-0 flex-1 select-none items-center gap-1.5">
                  <span className={item.parent ? 'size-0' : `${iconSize} ml-1`}></span>
                  <div className="file-manager-icon-anchor relative flex items-center">
                    {renderFavoriteButton()}
                    <ImageIcon className={iconSize} />
                  </div>
                  <FileNameLabel name={displayFileName} title={item.name} textSize={fileManagerTextSize} />
                  {renderVectorIcon()}
                </div>
                {isMobile && (
                  <MobileActionMenu className="ml-1">
                    <MobileMenuItem onClick={handleShowFileManager}>
                      {t('context.viewDirectory')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFile}>
                      {t('context.cut')}
                    </MobileMenuItem>
                    <MobileMenuItem onClick={handleCopyFile}>
                      {t('context.copy')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!clipboardItem} onClick={handlePasteFile}>
                      {t('context.paste')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleStartRename}>
                      {t('context.rename')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.sha} className="text-red-600" onClick={handleDeleteSyncFile}>
                      {t('context.deleteSyncFile')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.isLocale || item.name === ''} className="text-red-600" onClick={handleDeleteFile}>
                      {t('context.deleteLocalFile')}
                    </MobileMenuItem>
                  </MobileActionMenu>
                )}
              </span> :
              item.name.match(/\.pdf$/i) ?
              <span
                draggable={false}
                title={path}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex min-w-0 flex-1 select-none items-center justify-between gap-1 dark:hover:text-white`}>
                <div className="file-manager-row-main flex min-w-0 flex-1 select-none items-center gap-1.5">
                  <span className={item.parent ? 'size-0' : `${iconSize} ml-1`}></span>
                  <div className="file-manager-icon-anchor relative flex items-center">
                    {renderFavoriteButton()}
                    <FileText className={`${iconSize} text-red-500`} />
                  </div>
                  <FileNameLabel name={displayFileName} title={item.name} textSize={fileManagerTextSize} />
                  {renderVectorIcon()}
                </div>
              </span> :
              <span
                draggable={false}
                title={path}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex min-w-0 flex-1 select-none items-center justify-between gap-1 dark:hover:text-white`}>
                <div className="file-manager-row-main flex min-w-0 flex-1 select-none items-center gap-1.5">
                  <span className={item.parent ? 'size-0' : `${iconSize} ml-1`}></span>
                  <div className="file-manager-icon-anchor relative flex items-center">
                    {renderFavoriteButton()}
                    { item.loading ? (
                      <LoaderCircle className={`${iconSize} animate-spin`} />
                    ) : item.isLocale ? (
                      item.sha ? <FileUp className={iconSize} /> : <File className={iconSize} />
                    ) : (
                      <FileDown className={iconSize} />
                    )}
                  </div>
                  <FileNameLabel name={displayFileName} title={item.name} textSize={fileManagerTextSize} />
                  {renderVectorIcon()}
                </div>
                {isMobile && (
                  <MobileActionMenu className="ml-1">
                    <MobileMenuItem onClick={handleShowFileManager}>
                      {t('context.viewDirectory')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFile}>
                      {t('context.cut')}
                    </MobileMenuItem>
                    <MobileMenuItem onClick={handleCopyFile}>
                      {t('context.copy')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!clipboardItem} onClick={handlePasteFile}>
                      {t('context.paste')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleStartRename}>
                      {t('context.rename')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.sha} className="text-red-600" onClick={handleDeleteSyncFile}>
                      {t('context.deleteSyncFile')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.isLocale || item.name === ''} className="text-red-600" onClick={handleDeleteFile}>
                      {t('context.deleteLocalFile')}
                    </MobileMenuItem>
                  </MobileActionMenu>
                )}
              </span>
            }
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem inset onClick={handleShowFileManager} menuType="file">
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('context.viewDirectory')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <VectorKnowledgeMenu
            item={item}
            hasVector={hasVector}
            onVectorUpdated={handleVectorUpdated}
          />
          <ContextMenuSeparator />
          <ContextMenuItem inset disabled={!item.isLocale} onClick={handleCutFile} menuType="file">
            <File className="mr-2 h-4 w-4" />
            {t('context.cut')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{modKey}X</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem inset onClick={handleCopyFile} menuType="file">
            <Copy className="mr-2 h-4 w-4" />
            {t('context.copy')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{modKey}C</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem inset disabled={!clipboardItem} onClick={handlePasteFile} menuType="file">
            <File className="mr-2 h-4 w-4" />
            {t('context.paste')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{modKey}V</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!item.isLocale} inset onClick={handleStartRename} menuType="file">
            <File className="mr-2 h-4 w-4" />
            {t('context.rename')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{renameKey}</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled={!item.sha} inset className="text-red-900" onClick={handleDeleteSyncFile} menuType="file">
            <RefreshCwOff className="mr-2 h-4 w-4" />
            {t('context.deleteSyncFile')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!item.isLocale || item.name === ''} inset className="text-red-900" onClick={handleDeleteFile} menuType="file">
            <Trash2 className="mr-2 h-4 w-4" />
            {t('context.deleteLocalFile')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{deleteKey}</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  )
}
