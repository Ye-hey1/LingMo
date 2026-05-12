'use client'

import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react'
import dynamic from 'next/dynamic'
import useArticleStore, { findFolderInTree } from '@/stores/article'
import emitter from '@/lib/emitter'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { useSidebarStore } from '@/stores/sidebar'
import useChatStore from '@/stores/chat'
import { OnboardingSpotlight } from '@/components/onboarding-spotlight'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TabBar, TabInfo } from './tab-bar'
import { EmptyState } from './empty-state'
import { FolderView } from './folder'
import { UnsupportedFile } from './unsupported-file'
import { isDiagramPath } from '@/lib/diagram'
import { TemplateSelectDialog, type TemplateSelectDialogRef, type TemplateSelectResult } from '../file/template-select-dialog'
import { generateUniqueFilename } from '@/lib/default-filename'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import {
  KNOWLEDGE_GRAPH_TAB_ID,
  KNOWLEDGE_GRAPH_TAB_NAME,
  isKnowledgeGraphTabPath,
} from '../knowledge/knowledge-graph-constants'
import {
  FLASHCARD_TAB_ID,
  FLASHCARD_TAB_NAME,
  isFlashcardTabPath,
} from '../flashcard/flashcard-constants'
import {
  MEMORY_TAB_ID,
  MEMORY_TAB_NAME,
  isMemoryTabPath,
} from '../memory/memory-constants'

import { writeTextFile } from '@tauri-apps/plugin-fs'
import { toast } from '@/hooks/use-toast'

const MdEditor = dynamic(() => import('./markdown/md-editor-wrapper').then(m => m.MdEditor), { ssr: false })
const BacklinksPanel = dynamic(() => import('./markdown/backlinks-panel').then(m => m.BacklinksPanel), { ssr: false })
const RelatedNotesPanel = dynamic(() => import('@/lib/related-notes').then(m => m.RelatedNotesPanel), { ssr: false })
const ImageEditor = dynamic(() => import('./image/image-editor').then(m => m.ImageEditor), { ssr: false })
const PdfViewer = dynamic(() => import('./pdf/pdf-viewer').then(m => m.PdfViewer), { ssr: false })
const DiagramEditor = dynamic(() => import('./diagram/diagram-editor').then(m => m.DiagramEditor), { ssr: false })
const KnowledgeGraph = dynamic(() => import('../knowledge/knowledge-graph').then(m => m.KnowledgeGraph), { ssr: false })
const FlashcardWorkspace = dynamic(() => import('../flashcard/flashcard-workspace').then(m => m.FlashcardWorkspace), { ssr: false })
const MemoryWorkspace = dynamic(() => import('../memory/memory-workspace').then(m => m.MemoryWorkspace), { ssr: false })
import {
  createDefaultOnboardingProgress,
  getCompletionFeedbackMode,
  getActiveOnboardingStep,
  markOnboardingStepDone,
  normalizeOnboardingProgress,
  type OnboardingProgress,
  type OnboardingStepId,
} from './onboarding-state'
import {
  findRecentOnboardingFile,
  getOnboardingAgentPrompt,
  getOnboardingSpotlightTarget,
  ONBOARDING_SAMPLE_RECORD,
} from './empty-state-actions'

// 常量：扩展名到类型的映射（避免每次渲染时重新创建）
const MARKDOWN_EXTENSIONS = new Set([
  'md', 'txt', 'markdown', 'py', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less',
  'html', 'xml', 'json', 'yaml', 'yml', 'sh', 'bash', 'java', 'c', 'cpp', 'h', 'go',
  'rs', 'sql', 'rb', 'php', 'vue', 'svelte', 'astro', 'toml', 'ini', 'conf', 'cfg',
  'gitignore', 'env', 'example', 'template'
])

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'])
const PDF_EXTENSIONS = new Set(['pdf'])
const ONBOARDING_PROGRESS_STORE_KEY = 'desktopOnboardingProgress'

export function EditorLayout() {
  const {
    activeFilePath,
    fileTree,
    setActiveFilePath,
    openTabs,
    activeTabId,
    setOpenTabs,
    setActiveTabId,
    addTab,
    removeTab,
    initOpenTabs,
    initShowCloudFiles,
    loadFileTree,
    newFile,
    readArticle,
  } = useArticleStore()
  const { setLeftSidebarTab, rightSidebarVisible, toggleRightSidebar } = useSidebarStore()
  const { setOnboardingPromptDraft } = useChatStore()
  const tOnboarding = useTranslations('article.emptyState.onboarding')

  const tabContentsRef = useRef<Record<string, string>>({})
  const templateDialogRef = useRef<TemplateSelectDialogRef>(null)
  const [tabs, setLocalTabs] = useState<TabInfo[]>([])
  const [localActiveTabId, setLocalActiveTabId] = useState<string>('')
  const [mountedPersistentTabIds, setMountedPersistentTabIds] = useState<Set<string>>(new Set())
  const tabsRef = useRef<TabInfo[]>([])
  const lastDocumentPathRef = useRef('')
  const isInitializedRef = useRef(false)
  const currentOnboardingTaskRef = useRef<OnboardingStepId | null>(null)
  const [onboardingProgress, setOnboardingProgress] = useState<OnboardingProgress>(createDefaultOnboardingProgress())
  const [currentOnboardingTask, setCurrentOnboardingTask] = useState<OnboardingStepId | null>(null)
  const [activeOnboardingStep, setActiveOnboardingStep] = useState<OnboardingStepId | null>(null)
  const [completedOnboardingStep, setCompletedOnboardingStep] = useState<OnboardingStepId | null>(null)
  const [showOrganizeNextStepDialog, setShowOrganizeNextStepDialog] = useState(false)
  const [onboardingResumeFilePath, setOnboardingResumeFilePath] = useState('')

  const persistOnboardingProgress = useCallback(async (progress: OnboardingProgress) => {
    const store = await Store.load('store.json')
    await store.set(ONBOARDING_PROGRESS_STORE_KEY, progress)
    await store.save()
  }, [])

  // Template dialog: always-mounted listener for creating notes
  const handleTemplateSelect = useCallback(async (result: TemplateSelectResult) => {
    if (!result.template) {
      newFile()
      return
    }

    const template = result.template
    try {
      const currentActiveFilePath = useArticleStore.getState().activeFilePath
      const parentPath = currentActiveFilePath?.includes('/') ? currentActiveFilePath.split('/').slice(0, -1).join('/') : ''

      const baseName = template.title.replace(/\s+/g, '_')
      const fileName = await generateUniqueFilename(parentPath, baseName)
      const relativePath = parentPath ? `${parentPath}/${fileName}` : fileName

      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(relativePath)

      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, template.content)
      } else {
        await writeTextFile(pathOptions.path, template.content, { baseDir: pathOptions.baseDir })
      }

      const { collapsibleList } = useArticleStore.getState()
      await loadFileTree({ skipRemoteSync: true })
      if (parentPath && !collapsibleList.includes(parentPath)) {
        useArticleStore.setState({ collapsibleList: [...collapsibleList, parentPath] })
      }

      setActiveFilePath(relativePath)
      readArticle(relativePath, '', false)
    } catch (error) {
      console.error('Create file from template failed:', error)
      toast({
        description: String(error),
        variant: 'destructive',
      })
    }
  }, [loadFileTree, newFile, readArticle, setActiveFilePath])

  useEffect(() => {
    const handler = () => {
      templateDialogRef.current?.open()
    }
    emitter.on('template-select-dialog:open', handler)
    return () => {
      emitter.off('template-select-dialog:open', handler)
    }
  }, [])

  // Initialize tabs from store on mount
  useEffect(() => {
    if (!isInitializedRef.current) {
      isInitializedRef.current = true
      initOpenTabs()
      initShowCloudFiles()
    }
  }, [initOpenTabs, initShowCloudFiles])

  useEffect(() => {
    const loadOnboardingProgress = async () => {
      const store = await Store.load('store.json')
      const savedProgress = await store.get<OnboardingProgress>(ONBOARDING_PROGRESS_STORE_KEY)
      setOnboardingProgress(normalizeOnboardingProgress(savedProgress))
    }

    void loadOnboardingProgress()
  }, [])

  useEffect(() => {
    currentOnboardingTaskRef.current = currentOnboardingTask
  }, [currentOnboardingTask])

  useEffect(() => {
    if (activeFilePath && !activeFilePath.includes('://')) {
      lastDocumentPathRef.current = activeFilePath
    }
  }, [activeFilePath])

  useEffect(() => {
    const handleOnboardingStepComplete = ({
      step,
      filePath,
    }: { step: OnboardingStepId; filePath?: string }) => {
      setOnboardingProgress((current) => {
        if (current.steps[step]) {
          return current
        }

        const nextProgress = markOnboardingStepDone(current, step)
        const feedbackMode = getCompletionFeedbackMode(step, currentOnboardingTaskRef.current)

        if (feedbackMode === 'dialog') {
          const resumeFilePath = filePath || activeFilePath
          setOnboardingResumeFilePath(resumeFilePath)
          setCurrentOnboardingTask(null)
          setActiveOnboardingStep(null)
          setCompletedOnboardingStep(null)
          setShowOrganizeNextStepDialog(true)
        } else if (currentOnboardingTaskRef.current) {
          setCurrentOnboardingTask(null)
          setActiveOnboardingStep(null)
          setCompletedOnboardingStep(step)
        }
        void persistOnboardingProgress(nextProgress)
        return nextProgress
      })
    }

    emitter.on('onboarding-step-complete', handleOnboardingStepComplete)
    return () => {
      emitter.off('onboarding-step-complete', handleOnboardingStepComplete)
    }
  }, [activeFilePath, persistOnboardingProgress])

  // Sync with store
  useEffect(() => {
    setLocalTabs(openTabs)
    tabsRef.current = openTabs
  }, [openTabs])

  useEffect(() => {
    setLocalActiveTabId(activeTabId)
  }, [activeTabId])

  // Helper to check if path is a folder
  const isFolderPath = useCallback((path: string): boolean => {
    const fileName = path.split('/').pop() || ''
    return !fileName.includes('.')
  }, [])

  // Get item type based on path
  const getItemType = useCallback((path: string): 'knowledgeGraph' | 'flashcards' | 'memory' | 'markdown' | 'image' | 'pdf' | 'diagram' | 'folder' | 'unknown' => {
    if (!path) return 'unknown'
    if (isKnowledgeGraphTabPath(path)) return 'knowledgeGraph'
    if (isFlashcardTabPath(path)) return 'flashcards'
    if (isMemoryTabPath(path)) return 'memory'

    // First check if it's a folder
    const folder = findFolderInTree(path, fileTree)
    if (folder) return 'folder'

    if (isDiagramPath(path)) {
      return 'diagram'
    }

    // Check file extension
    const extension = path.split('.').pop()?.toLowerCase()
    if (!extension) return 'unknown'

    if (MARKDOWN_EXTENSIONS.has(extension)) {
      return 'markdown'
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
      return 'image'
    }
    if (PDF_EXTENSIONS.has(extension)) {
      return 'pdf'
    }
    return 'unknown'
  }, [fileTree])

  const shouldKeepTabMounted = useCallback((tab: TabInfo): boolean => {
    const itemType = getItemType(tab.path)
    return itemType === 'pdf' || itemType === 'diagram' || itemType === 'knowledgeGraph' || itemType === 'flashcards' || itemType === 'memory'
  }, [getItemType])

  useEffect(() => {
    if (!localActiveTabId) return

    const activeTab = tabsRef.current.find(tab => tab.id === localActiveTabId)
    if (!activeTab || !shouldKeepTabMounted(activeTab)) return

    setMountedPersistentTabIds((current) => {
      if (current.has(activeTab.id)) {
        return current
      }
      const next = new Set(current)
      next.add(activeTab.id)
      return next
    })
  }, [localActiveTabId, shouldKeepTabMounted])

  useEffect(() => {
    setMountedPersistentTabIds((current) => {
      if (current.size === 0) {
        return current
      }

      const validTabIds = new Set(
        tabs
          .filter(tab => shouldKeepTabMounted(tab))
          .map(tab => tab.id),
      )
      const next = new Set([...current].filter(id => validTabIds.has(id)))
      const changed = next.size !== current.size || [...next].some(id => !current.has(id))

      return changed ? next : current
    })
  }, [tabs, shouldKeepTabMounted])

  // Check if file/folder exists
  const checkPathExists = useCallback(async (path: string): Promise<boolean> => {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    const pathOptions = await getFilePathOptions(path)

    try {
      if (workspace.isCustom) {
        return await exists(pathOptions.path)
      } else {
        return await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      return false
    }
  }, [])

  // Check if path is a folder in fileTree
  const isFolderInTree = useCallback((path: string): boolean => {
    return !!findFolderInTree(path, fileTree)
  }, [fileTree])

  // Check if path is a file in fileTree
  const isFileInTree = useCallback((path: string): boolean => {
    const extension = path.split('.').pop()?.toLowerCase()
    if (!extension) return false

    const validExtensions = ['md', 'txt', 'markdown', 'py', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less', 'html', 'xml', 'json', 'yaml', 'yml', 'sh', 'bash', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'sql', 'rb', 'php', 'vue', 'svelte', 'astro', 'toml', 'ini', 'conf', 'cfg', 'gitignore', 'env', 'example', 'template', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'pdf']

    if (!validExtensions.includes(extension)) return false

    // Check if file exists in fileTree
    const checkInTree = (items: typeof fileTree): boolean => {
      for (const item of items) {
        if (item.isFile && path.includes(item.name)) return true
        if (item.children) {
          if (checkInTree(item.children)) return true
        }
      }
      return false
    }
    return checkInTree(fileTree)
  }, [fileTree])

  // Clean up tabs that no longer exist
  useEffect(() => {
    const cleanupTabs = async () => {
      if (tabs.length === 0) return

      const validTabs: TabInfo[] = []
      let hasInvalid = false

      for (const tab of tabs) {
        if (isKnowledgeGraphTabPath(tab.path) || isFlashcardTabPath(tab.path) || isMemoryTabPath(tab.path)) {
          validTabs.push(tab)
          continue
        }

        if (tab.isFolder) {
          // Check if folder exists in fileTree
          if (isFolderInTree(tab.path)) {
            validTabs.push(tab)
          } else {
            hasInvalid = true
          }
        } else {
          // Check if file exists in fileTree or on disk
          if (isFileInTree(tab.path) || await checkPathExists(tab.path)) {
            validTabs.push(tab)
          } else {
            hasInvalid = true
            // Clean up content cache
            delete tabContentsRef.current[tab.path]
          }
        }
      }

      if (hasInvalid) {
        setOpenTabs(validTabs)
      }
    }

    cleanupTabs()
  }, [fileTree, tabs.length, isFolderInTree, isFileInTree, checkPathExists, setOpenTabs])

  // Initialize and update tabs when active path changes
  useEffect(() => {
    if (!activeFilePath) return

    const name = activeFilePath.split('/').pop() || activeFilePath
    const isGraphTab = isKnowledgeGraphTabPath(activeFilePath)
    const isFlashcardsTab = isFlashcardTabPath(activeFilePath)
    const isMemoryTab = isMemoryTabPath(activeFilePath)
    const isVirtualTab = isGraphTab || isFlashcardsTab || isMemoryTab
    const isFolder = isVirtualTab ? false : isFolderPath(activeFilePath)

    // Check if tab already exists
    const existingTab = tabsRef.current.find(tab => tab.path === activeFilePath)

    if (existingTab) {
      // Set as active
      if (activeTabId !== existingTab.id) {
        setActiveTabId(existingTab.id)
      }
    } else {
      // Add new tab
      const newTab: TabInfo = {
        id: isGraphTab
          ? KNOWLEDGE_GRAPH_TAB_ID
          : isFlashcardsTab
            ? FLASHCARD_TAB_ID
            : isMemoryTab
              ? MEMORY_TAB_ID
              : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        path: activeFilePath,
        name: isGraphTab
          ? KNOWLEDGE_GRAPH_TAB_NAME
          : isFlashcardsTab
            ? FLASHCARD_TAB_NAME
            : isMemoryTab
              ? MEMORY_TAB_NAME
              : name,
        isFolder: isFolder
      }
      addTab(newTab)
    }
  }, [activeFilePath, activeTabId, isFolderPath, addTab, setActiveTabId])

  // Handle tab switch
  const handleTabSwitch = useCallback((path: string) => {
    if (path) {
      setActiveFilePath(path)
    }
  }, [setActiveFilePath])

  // Handle new tab button - return to empty state without creating a file
  const handleNewTab = useCallback(async () => {
    await Promise.all([
      setActiveFilePath(''),
      setActiveTabId(''),
    ])
  }, [setActiveFilePath, setActiveTabId])

  // Handle close tab
  const handleCloseTab = useCallback((closedPath: string) => {
    // Bug fix: Emit event to clean up loadedPathsRef in MdEditor
    emitter.emit('editor-file-close', { path: closedPath })
    delete tabContentsRef.current[closedPath]

    // Get closedTab from the current ref value
    const currentTabs = tabsRef.current
    const closedTab = currentTabs.find(t => t.path === closedPath)
    if (!closedTab) return

    const remainingTabs = currentTabs.filter(t => t.id !== closedTab.id)
    const closedIndex = currentTabs.findIndex(t => t.id === closedTab.id)
    const isClosingActiveTab =
      localActiveTabId === closedTab.id ||
      activeTabId === closedTab.id ||
      activeFilePath === closedPath

    // Remove the tab
    removeTab(closedTab.id)

    // If we closed the active tab/path, pick a deterministic fallback
    if (!isClosingActiveTab) {
      return
    }

    if (remainingTabs.length > 0) {
      const targetTab =
        remainingTabs[Math.max(0, closedIndex - 1)] ||
        remainingTabs[remainingTabs.length - 1]
      setActiveTabId(targetTab.id)
      setActiveFilePath(targetTab.path)
      return
    }

    setActiveTabId('')
    setActiveFilePath('')
  }, [activeFilePath, activeTabId, localActiveTabId, removeTab, setActiveTabId, setActiveFilePath])

  // Handle close other tabs
  const handleCloseOtherTabs = useCallback((keepPath: string) => {
    const tabsToRemove = tabsRef.current.filter(t => t.path !== keepPath)

    tabsToRemove.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })

    // Update active tab if needed
    const keptTab = tabsRef.current.find(t => t.path === keepPath)
    if (keptTab && localActiveTabId !== keptTab.id) {
      setActiveTabId(keptTab.id)
      setActiveFilePath(keptTab.path)
    }
  }, [localActiveTabId, removeTab, setActiveTabId, setActiveFilePath])

  // Handle close all tabs
  const handleCloseAllTabs = useCallback(() => {
    tabsRef.current.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })
    setActiveTabId('')
    setActiveFilePath('')
  }, [removeTab, setActiveTabId, setActiveFilePath])

  // Handle close left tabs
  const handleCloseLeftTabs = useCallback((rightPath: string) => {
    const rightIndex = tabsRef.current.findIndex(t => t.path === rightPath)
    const tabsToRemove = tabsRef.current.slice(0, rightIndex)

    tabsToRemove.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })

    // Update active tab if needed
    if (rightIndex > 0) {
      const rightTab = tabsRef.current[rightIndex]
      if (rightTab && localActiveTabId !== rightTab.id) {
        setActiveTabId(rightTab.id)
        setActiveFilePath(rightTab.path)
      }
    }
  }, [localActiveTabId, removeTab, setActiveTabId, setActiveFilePath])

  // Handle close right tabs
  const handleCloseRightTabs = useCallback((leftPath: string) => {
    const leftIndex = tabsRef.current.findIndex(t => t.path === leftPath)
    const tabsToRemove = tabsRef.current.slice(leftIndex + 1)

    tabsToRemove.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })
  }, [removeTab])

  const onboardingAgentPrompt = getOnboardingAgentPrompt({
    intro: tOnboarding('agentPrompt.intro'),
    requirements: [
      tOnboarding('agentPrompt.requirement1'),
      tOnboarding('agentPrompt.requirement2'),
      tOnboarding('agentPrompt.requirement3'),
      tOnboarding('agentPrompt.requirement4'),
    ],
    outro: tOnboarding('agentPrompt.outro'),
  })

  const handleStartOnboardingStep = useCallback(async (step: OnboardingStepId) => {
    if (onboardingProgress.dismissed) {
      const nextProgress = {
        ...onboardingProgress,
        dismissed: false,
      }
      setOnboardingProgress(nextProgress)
      await persistOnboardingProgress(nextProgress)
    }

    setCurrentOnboardingTask(step)
    setActiveOnboardingStep(step)
    setCompletedOnboardingStep(null)
    setShowOrganizeNextStepDialog(false)

    if (step === 'create-record') {
      emitter.emit('onboarding-record-prefill-changed', {
        prefillText: ONBOARDING_SAMPLE_RECORD,
      })
      await setLeftSidebarTab('notes')
      return
    }

    if (step === 'organize-note') {
      await setLeftSidebarTab('notes')
      return
    }

    if (step === 'ai-polish') {
      const candidateResumeFilePath = findRecentOnboardingFile({
        preferredPath: onboardingResumeFilePath,
        activeFilePath,
        openTabPaths: openTabs.map((tab) => tab.path),
        fileTree,
      })
      const resolvedResumeFilePath = candidateResumeFilePath && await checkPathExists(candidateResumeFilePath)
        ? candidateResumeFilePath
        : ''

      if (!rightSidebarVisible) {
        await toggleRightSidebar()
      }
      if (resolvedResumeFilePath) {
        await setActiveFilePath(resolvedResumeFilePath)
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120))
      setOnboardingPromptDraft(onboardingAgentPrompt)
    }
  }, [activeFilePath, fileTree, onboardingAgentPrompt, onboardingProgress, onboardingResumeFilePath, openTabs, persistOnboardingProgress, rightSidebarVisible, setActiveFilePath, setLeftSidebarTab, setOnboardingPromptDraft, toggleRightSidebar])

  const handleDismissOnboarding = useCallback(async () => {
    const nextProgress = {
      ...onboardingProgress,
      dismissed: true,
    }

    setOnboardingProgress(nextProgress)
    setCurrentOnboardingTask(null)
    setActiveOnboardingStep(null)
    setCompletedOnboardingStep(null)
    setShowOrganizeNextStepDialog(false)
    await persistOnboardingProgress(nextProgress)
  }, [onboardingProgress, persistOnboardingProgress])

  const handleDismissSpotlight = useCallback(() => {
    setActiveOnboardingStep(null)
  }, [])

  const handleDismissOrganizeNextStepDialog = useCallback(() => {
    setShowOrganizeNextStepDialog(false)
  }, [])

  const handleAcceptOrganizeNextStepDialog = useCallback(async () => {
    setShowOrganizeNextStepDialog(false)
    setCompletedOnboardingStep('organize-note')
    await Promise.all([
      setActiveFilePath(''),
      setActiveTabId(''),
    ])
  }, [setActiveFilePath, setActiveTabId])

  const handleContinueToNextStep = useCallback(() => {
    const nextStep = getActiveOnboardingStep(onboardingProgress)
    setCompletedOnboardingStep(null)
    if (nextStep) {
      void handleStartOnboardingStep(nextStep)
    }
  }, [handleStartOnboardingStep, onboardingProgress])

  const spotlightTitle = activeOnboardingStep ? tOnboarding(`spotlight.${activeOnboardingStep}.title`) : ''
  const spotlightDescription = activeOnboardingStep ? tOnboarding(`spotlight.${activeOnboardingStep}.desc`) : ''

  // Render content panel for a tab
  const renderContentPanel = useCallback((tab: TabInfo, isActive: boolean) => {
    const itemType = getItemType(tab.path)

    return (
      <div
        key={tab.id}
        className={isActive
          ? 'relative z-10 flex h-full min-h-0 w-full overflow-hidden'
          : 'pointer-events-none absolute inset-0 z-0 flex min-h-0 overflow-hidden opacity-0'
        }
        aria-hidden={!isActive}
      >
        {itemType === 'folder' && (
          <FolderView folderPath={tab.path} />
        )}
        {itemType === 'image' && (
          <Suspense fallback={<div className="flex-1" />}>
            <ImageEditor filePath={tab.path} />
          </Suspense>
        )}
        {itemType === 'pdf' && (
          <Suspense fallback={<div className="flex-1" />}>
            <PdfViewer filePath={tab.path} isActive={isActive} />
          </Suspense>
        )}
        {itemType === 'diagram' && (
          <Suspense fallback={<div className="flex-1" />}>
            <DiagramEditor filePath={tab.path} isActive={isActive} />
          </Suspense>
        )}
        {itemType === 'knowledgeGraph' && (
          <Suspense fallback={<div className="flex-1" />}>
            <KnowledgeGraph focusPath={lastDocumentPathRef.current} />
          </Suspense>
        )}
        {itemType === 'flashcards' && (
          <Suspense fallback={<div className="flex-1" />}>
            <FlashcardWorkspace sourcePath={lastDocumentPathRef.current} />
          </Suspense>
        )}
        {itemType === 'memory' && (
          <Suspense fallback={<div className="flex-1" />}>
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <MemoryWorkspace />
            </div>
          </Suspense>
        )}
        {itemType === 'markdown' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Suspense fallback={<div className="flex-1" />}>
              <MdEditor
                key={tab.id}
                tabContentsRef={tabContentsRef}
                filePath={tab.path}
              />
            </Suspense>
            <BacklinksPanel />
            <RelatedNotesPanel />
          </div>
        )}
        {itemType === 'unknown' && (
          <UnsupportedFile filePath={tab.path} />
        )}
      </div>
    )
  }, [getItemType])

  const renderedTabs = useMemo(() =>
    tabs.filter(tab => tab.id === localActiveTabId || mountedPersistentTabIds.has(tab.id)),
    [tabs, localActiveTabId, mountedPersistentTabIds]
  )

  // No tabs or no active tab - show empty state
  if (tabs.length === 0 || !activeTabId) {
    return (
      <div className="flex-1 relative w-full h-full flex flex-col overflow-hidden">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSwitch={handleTabSwitch}
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseAllTabs={handleCloseAllTabs}
          onCloseLeftTabs={handleCloseLeftTabs}
          onCloseRightTabs={handleCloseRightTabs}
        />
        <EmptyState
          onboardingProgress={onboardingProgress}
          activeOnboardingStep={currentOnboardingTask}
          visibleOnboardingStep={activeOnboardingStep}
          completedOnboardingStep={completedOnboardingStep}
          onStartOnboardingStep={handleStartOnboardingStep}
          onContinueToNextStep={handleContinueToNextStep}
          onDismissOnboarding={handleDismissOnboarding}
        />
        <OnboardingSpotlight
          targetId={activeOnboardingStep ? getOnboardingSpotlightTarget(activeOnboardingStep) : null}
          title={spotlightTitle}
          description={spotlightDescription}
          onDismiss={handleDismissSpotlight}
        />
        <Dialog open={showOrganizeNextStepDialog} onOpenChange={setShowOrganizeNextStepDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{tOnboarding('afterOrganizeDialog.title')}</DialogTitle>
              <DialogDescription>{tOnboarding('afterOrganizeDialog.description')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                onClick={handleDismissOrganizeNextStepDialog}
                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {tOnboarding('afterOrganizeDialog.cancel')}
              </button>
              <button
                onClick={() => void handleAcceptOrganizeNextStepDialog()}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
              >
                {tOnboarding('afterOrganizeDialog.confirm')}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <TemplateSelectDialog ref={templateDialogRef} onSelect={handleTemplateSelect} />
      </div>
    )
  }

  return (
    <div className="flex-1 relative w-full h-full flex flex-col overflow-hidden">
      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={localActiveTabId}
        onTabSwitch={handleTabSwitch}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onCloseOtherTabs={handleCloseOtherTabs}
        onCloseAllTabs={handleCloseAllTabs}
        onCloseLeftTabs={handleCloseLeftTabs}
        onCloseRightTabs={handleCloseRightTabs}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {renderedTabs.map(tab => renderContentPanel(tab, tab.id === localActiveTabId))}
      </div>
      <OnboardingSpotlight
        targetId={activeOnboardingStep ? getOnboardingSpotlightTarget(activeOnboardingStep) : null}
        title={spotlightTitle}
        description={spotlightDescription}
        onDismiss={handleDismissSpotlight}
      />
      <Dialog open={showOrganizeNextStepDialog} onOpenChange={setShowOrganizeNextStepDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tOnboarding('afterOrganizeDialog.title')}</DialogTitle>
            <DialogDescription>{tOnboarding('afterOrganizeDialog.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={handleDismissOrganizeNextStepDialog}
              className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {tOnboarding('afterOrganizeDialog.cancel')}
            </button>
            <button
              onClick={() => void handleAcceptOrganizeNextStepDialog()}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              {tOnboarding('afterOrganizeDialog.confirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TemplateSelectDialog ref={templateDialogRef} onSelect={handleTemplateSelect} />
    </div>
  )
}
