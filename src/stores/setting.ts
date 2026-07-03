import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { getVersion } from '@tauri-apps/api/app'
import { AiConfig, builtinProviderTemplates, cleanupConfiguredModels, mergeProviderTemplateModels } from '@/app/core/setting/config'
import { GitlabInstanceType } from '@/lib/sync/gitlab.types'
import { GiteaInstanceType } from '@/lib/sync/gitea.types'
import { CustomThemeColors } from '@/types/theme'
import { applyThemeColors, removeThemeColors } from '@/lib/theme-utils'
import { getNormalizedImageHosting } from '@/lib/image-hosting-config'
import { normalizeSpeechMode } from '@/lib/speech/preferences'
import type { SpeechMode } from '@/lib/speech/types'
import { DEFAULT_OUTLINE_POSITION, normalizeOutlinePosition, type OutlinePosition } from '@/lib/outline-preferences'
import { DEFAULT_REMINDER_SETTINGS } from '@/lib/reminders/types'
import { normalizeProviderConfigTitle } from '@/lib/ai/provider-display'
import { createConfiguredModelSelectionId, matchesConfiguredModelSelection } from '@/lib/ai/model-selection'

const REMOVED_BUILTIN_MODEL_KEYS = new Set([
  'note-gen-free',
  'note-gen-chat',
  'note-gen-embedding',
  'note-gen-vlm',
  'lingmo',
  'lingmo-free',
  'lingmo-pro',
  'lingmo-advanced',
  'lingmo-chat',
  'lingmo-embedding',
  'lingmo-vlm',
])

const MODEL_SELECTION_KEYS = [
  'primaryModel',
  'placeholderModel',
  'completionModel',
  'markDescModel',
  'commitModel',
  'embeddingModel',
  'rerankingModel',
  'imageMethodModel',
  'audioModel',
  'sttModel',
  'condenseModel',
  'inspirationModel',
  'promptEnhancerModel',
  'structuredExtractionModel',
]

type ModelSelectionPredicate = (
  model: {
    id: string
    model: string
    modelType?: string
    supportsImageInput?: boolean
  },
  config: AiConfig
) => boolean

const DEFAULT_MODEL_SLOTS: Array<{
  storeKey: string
  predicate: ModelSelectionPredicate
}> = [
  { storeKey: 'primaryModel', predicate: isChatModel },
  { storeKey: 'placeholderModel', predicate: isChatModel },
  { storeKey: 'completionModel', predicate: isChatModel },
  { storeKey: 'markDescModel', predicate: isChatModel },
  { storeKey: 'commitModel', predicate: isChatModel },
  { storeKey: 'condenseModel', predicate: isChatModel },
  { storeKey: 'inspirationModel', predicate: isChatModel },
  { storeKey: 'structuredExtractionModel', predicate: isChatModel },
  { storeKey: 'embeddingModel', predicate: isEmbeddingModel },
  { storeKey: 'rerankingModel', predicate: isRerankModel },
  { storeKey: 'imageMethodModel', predicate: isVisionChatModel },
  { storeKey: 'audioModel', predicate: isTtsModel },
  { storeKey: 'sttModel', predicate: isSttModel },
]

function isChatModel(model: { modelType?: string }) {
  return model.modelType === 'chat' || !model.modelType
}

function isEmbeddingModel(model: { modelType?: string }) {
  return model.modelType === 'embedding'
}

function isRerankModel(model: { modelType?: string }) {
  return model.modelType === 'rerank'
}

function isVisionChatModel(
  model: { modelType?: string; supportsImageInput?: boolean },
  config: AiConfig
) {
  return isChatModel(model) && (model.supportsImageInput === true || config.supportsImageInput === true)
}

function isTtsModel(model: { modelType?: string }) {
  return model.modelType === 'tts'
}

function isSttModel(model: { modelType?: string }) {
  return model.modelType === 'stt'
}

function isRemovedBuiltinModelId(modelId?: string) {
  if (!modelId) return false
  const normalized = modelId.trim().toLowerCase()

  return (
    REMOVED_BUILTIN_MODEL_KEYS.has(normalized) ||
    normalized.startsWith('note-gen-') ||
    normalized.startsWith('lingmo-advanced') ||
    normalized.startsWith('lingmo-pro')
  )
}

function isRemovedBuiltinAiConfig(config: AiConfig) {
  const key = config.key?.trim().toLowerCase()
  const title = config.title?.trim().toLowerCase() || ''
  const baseURL = config.baseURL?.trim().toLowerCase() || ''

  return (
    isRemovedBuiltinModelId(key) ||
    title === '灵墨' ||
    title === '灵墨 free' ||
    title === '灵墨高级' ||
    title === '灵墨 高级' ||
    title === 'lingmo' ||
    title === 'lingmo advanced' ||
    title === 'lingmo pro' ||
    baseURL.includes('notegen.top')
  )
}

async function removeBuiltinLingMoModelSettings(store: Store) {
  const aiModelList = ((await store.get('aiModelList')) as AiConfig[]) || []

  // 1) 移除已知内置配置
  // 2) 清理幽灵配置：baseURL 匹配官方模板但没有 templateKey 的旧配置
  const officialUrls = new Set<string>()
  for (const tpl of builtinProviderTemplates) {
    const url = tpl.baseURL?.trim().replace(/\/+$/, '').toLowerCase()
    if (url) officialUrls.add(url)
  }
  // 智谱 AI 变体 URL
  const zhipuTpl = builtinProviderTemplates.find(t => t.key === 'zhipu')
  if (zhipuTpl?.baseURL) {
    officialUrls.add(zhipuTpl.baseURL.trim().replace(/\/+$/, '').toLowerCase())
    officialUrls.add(zhipuTpl.baseURL.trim().replace(/\/+$/, '').replace('/api/paas/v4', '/api/coding/paas/v4').toLowerCase())
  }

  const cleanedAiModelList = aiModelList
    .filter((config) => {
      // 保留有 templateKey 或 templateSource 的配置
      if (config.templateKey || config.templateSource === 'builtin' || config.templateSource === 'remote') return true
      // 移除已知内置配置
      if (isRemovedBuiltinAiConfig(config)) return false
      // 幽灵配置：baseURL 匹配官方模板但没有 templateKey
      const normUrl = (config.baseURL || '').trim().replace(/\/+$/, '').toLowerCase()
      if (normUrl && officialUrls.has(normUrl) && !config.templateKey) return false
      // 保留真正的自定义配置
      return true
    })
    .map((config) => cleanupConfiguredModels(mergeProviderTemplateModels(normalizeProviderConfigTitle(config)).config).config)
  let changed = cleanedAiModelList.length !== aiModelList.length ||
    cleanedAiModelList.some((config, index) => JSON.stringify(config) !== JSON.stringify(aiModelList[index]))

  if (changed) {
    await store.set('aiModelList', cleanedAiModelList)
  }

  for (const key of MODEL_SELECTION_KEYS) {
    const currentModel = (await store.get(key)) as string | undefined
    if (isRemovedBuiltinModelId(currentModel)) {
      await store.set(key, '')
      changed = true
    }
  }

  if (changed) {
    await store.save()
  }

  return { aiModelList: cleanedAiModelList, changed }
}

function findConfiguredModelSelection(
  aiModelList: AiConfig[],
  predicate: ModelSelectionPredicate
) {
  for (const config of aiModelList) {
    if (!config.baseURL || isRemovedBuiltinAiConfig(config)) continue

    if (config.models?.length) {
      const model = config.models.find((item) => item.model && predicate(item, config))
      if (model) return createConfiguredModelSelectionId(config.key, model.id)
      continue
    }

    if (config.model && predicate({
      id: config.key,
      model: config.model,
      modelType: config.modelType || 'chat',
      supportsImageInput: config.supportsImageInput,
    }, config)) {
      return config.key
    }
  }

  return ''
}

function hasConfiguredModelSelection(aiModelList: AiConfig[], modelId?: string) {
  if (!modelId || isRemovedBuiltinModelId(modelId)) return false

  for (const config of aiModelList) {
    if (!config.baseURL || isRemovedBuiltinAiConfig(config)) continue

    if (config.models?.length) {
      if (config.models.some((model) => matchesConfiguredModelSelection({
        configKey: config.key,
        modelId: model.id,
        selectionId: modelId,
      }))) return true
      continue
    }

    if (config.key === modelId) return true
  }

  return false
}

async function ensureConfiguredDefaultModelSettings(store: Store, aiModelList: AiConfig[]) {
  const updates: Record<string, string> = {}
  let changed = false

  for (const { storeKey, predicate } of DEFAULT_MODEL_SLOTS) {
    const currentModel = (await store.get(storeKey)) as string | undefined
    if (hasConfiguredModelSelection(aiModelList, currentModel)) {
      continue
    }

    const nextModel = findConfiguredModelSelection(aiModelList, predicate)
    if ((currentModel || '') !== nextModel) {
      await store.set(storeKey, nextModel)
      updates[storeKey] = nextModel
      changed = true
    }
  }

  if (changed) {
    await store.save()
  }

  return updates
}

export enum GenTemplateRange {
  All = 'all',
  Today = 'today',
  Week = 'week',
  Month = 'month',
  ThreeMonth = 'threeMonth',
  Year = 'year',
}

export enum TemplateCategory {
  Note = 'note',
  Work = 'work',
  Study = 'study',
  Life = 'life',
  Creative = 'creative',
}

export interface GenTemplate {
  id: string
  title: string
  status: boolean
  content: string
  range: GenTemplateRange
  category?: TemplateCategory
}

interface SettingState {
  initSettingData: () => Promise<void>

  version: string
  setVersion: () => Promise<void>

  autoUpdate: boolean
  setAutoUpdate: (autoUpdate: boolean) => void

  language: string
  setLanguage: (language: string) => void

  // setting - ai - 当前选择的模型 key
  currentAi: string
  setCurrentAi: (currentAi: string) => void

  aiModelList: AiConfig[]
  setAiModelList: (aiModelList: AiConfig[]) => void

  primaryModel: string
  setPrimaryModel: (primaryModel: string) => Promise<void>

  placeholderModel: string
  setPlaceholderModel: (placeholderModel: string) => Promise<void>

  completionModel: string
  setCompletionModel: (completionModel: string) => Promise<void>

  markDescModel: string
  setMarkDescModel: (markDescModel: string) => Promise<void>

  commitModel: string
  setCommitModel: (commitModel: string) => Promise<void>

  embeddingModel: string
  setEmbeddingModel: (embeddingModel: string) => Promise<void>

  rerankingModel: string
  setRerankingModel: (rerankingModel: string) => Promise<void>

  imageMethodModel: string
  setImageMethodModel: (imageMethodModel: string) => Promise<void>

  audioModel: string
  setAudioModel: (audioModel: string) => Promise<void>

  sttModel: string
  setSttModel: (sttModel: string) => Promise<void>

  textToSpeechMode: SpeechMode
  setTextToSpeechMode: (mode: SpeechMode) => Promise<void>

  speechToTextMode: SpeechMode
  setSpeechToTextMode: (mode: SpeechMode) => Promise<void>

  condenseModel: string
  setCondenseModel: (condenseModel: string) => Promise<void>

  inspirationModel: string
  setInspirationModel: (inspirationModel: string) => Promise<void>

  promptEnhancerModel: string
  setPromptEnhancerModel: (promptEnhancerModel: string) => Promise<void>

  structuredExtractionModel: string
  setStructuredExtractionModel: (structuredExtractionModel: string) => Promise<void>

  tavilyApiKey: string
  setTavilyApiKey: (apiKey: string) => Promise<void>

  tavilySearchDepth: 'basic' | 'advanced'
  setTavilySearchDepth: (depth: 'basic' | 'advanced') => Promise<void>

  serpApiKey: string
  setSerpApiKey: (apiKey: string) => Promise<void>

  exaApiKey: string
  setExaApiKey: (apiKey: string) => Promise<void>

  researchSearchTavilyEnabled: boolean
  setResearchSearchTavilyEnabled: (enabled: boolean) => Promise<void>

  researchSearchSerpApiEnabled: boolean
  setResearchSearchSerpApiEnabled: (enabled: boolean) => Promise<void>

  researchSearchExaEnabled: boolean
  setResearchSearchExaEnabled: (enabled: boolean) => Promise<void>

  researchSearchAnySearchMcpEnabled: boolean
  setResearchSearchAnySearchMcpEnabled: (enabled: boolean) => Promise<void>

  researchSearchFirecrawlMcpEnabled: boolean
  setResearchSearchFirecrawlMcpEnabled: (enabled: boolean) => Promise<void>

  webSearchEnabled: boolean
  setWebSearchEnabled: (enabled: boolean) => Promise<void>

  githubProjectApiToken: string
  setGithubProjectApiToken: (token: string) => Promise<void>

  templateList: GenTemplate[]
  setTemplateList: (templateList: GenTemplate[]) => Promise<void>

  darkMode: string
  setDarkMode: (darkMode: string) => void

  previewTheme: string
  setPreviewTheme: (previewTheme: string) => Promise<void>

  codeTheme: string
  setCodeTheme: (codeTheme: string) => Promise<void>

  tesseractList: string
  setTesseractList: (tesseractList: string) => Promise<void>

  // Github 相关设置
  githubUsername: string
  setGithubUsername: (githubUsername: string) => Promise<void>

  accessToken: string
  setAccessToken: (accessToken: string) => Promise<void>

  jsdelivr: boolean
  setJsdelivr: (jsdelivr: boolean) => void

  useImageRepo: boolean
  setUseImageRepo: (useImageRepo: boolean) => Promise<void>

  autoSync: string
  setAutoSync: (autoSync: string) => Promise<void>

  // 自动拉取相关设置
  autoPullOnOpen: boolean
  setAutoPullOnOpen: (autoPullOnOpen: boolean) => Promise<void>

  autoPullOnSwitch: boolean
  setAutoPullOnSwitch: (autoPullOnSwitch: boolean) => Promise<void>

  // Gitee 相关设置
  giteeAccessToken: string
  setGiteeAccessToken: (giteeAccessToken: string) => void

  giteeAutoSync: string
  setGiteeAutoSync: (giteeAutoSync: string) => Promise<void>

  // Gitlab 相关设置
  gitlabInstanceType: GitlabInstanceType
  setGitlabInstanceType: (instanceType: GitlabInstanceType) => Promise<void>

  gitlabCustomUrl: string
  setGitlabCustomUrl: (customUrl: string) => Promise<void>

  gitlabAccessToken: string
  setGitlabAccessToken: (gitlabAccessToken: string) => void

  gitlabAutoSync: string
  setGitlabAutoSync: (gitlabAutoSync: string) => Promise<void>

  gitlabUsername: string
  setGitlabUsername: (gitlabUsername: string) => Promise<void>

  // Gitea 相关设置
  giteaInstanceType: GiteaInstanceType
  setGiteaInstanceType: (instanceType: GiteaInstanceType) => Promise<void>

  giteaCustomUrl: string
  setGiteaCustomUrl: (customUrl: string) => Promise<void>

  giteaAccessToken: string
  setGiteaAccessToken: (giteaAccessToken: string) => void

  giteaAutoSync: string
  setGiteaAutoSync: (giteaAutoSync: string) => Promise<void>

  giteaUsername: string
  setGiteaUsername: (giteaUsername: string) => Promise<void>

  // 主要备份方式设置
  primaryBackupMethod: 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'
  setPrimaryBackupMethod: (method: 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav') => Promise<void>

  lastSettingPage: string
  setLastSettingPage: (page: string) => Promise<void>

  workspacePath: string
  setWorkspacePath: (path: string) => Promise<void>

  // 工作区历史路径
  workspaceHistory: string[]
  addWorkspaceHistory: (path: string) => Promise<void>
  removeWorkspaceHistory: (path: string) => Promise<void>
  clearWorkspaceHistory: () => Promise<void>

  assetsPath: string
  setAssetsPath: (path: string) => Promise<void>

  // 图床设置
  githubImageAccessToken: string
  setGithubImageAccessToken: (githubImageAccessToken: string) => Promise<void>

  // 自定义仓库名称设置
  githubCustomSyncRepo: string
  setGithubCustomSyncRepo: (repo: string) => Promise<void>

  giteeCustomSyncRepo: string
  setGiteeCustomSyncRepo: (repo: string) => Promise<void>

  gitlabCustomSyncRepo: string
  setGitlabCustomSyncRepo: (repo: string) => Promise<void>

  giteaCustomSyncRepo: string
  setGiteaCustomSyncRepo: (repo: string) => Promise<void>

  githubCustomImageRepo: string
  setGithubCustomImageRepo: (repo: string) => Promise<void>

  // 图片识别设置
  enableImageRecognition: boolean
  setEnableImageRecognition: (enable: boolean) => Promise<void>
  primaryImageMethod: 'ocr' | 'vlm'
  setPrimaryImageMethod: (method: 'ocr' | 'vlm') => Promise<void>

  // 界面缩放设置
  uiScale: number
  setUiScale: (scale: number) => Promise<void>

  // 正文文字大小缩放设置
  contentTextScale: number
  setContentTextScale: (scale: number) => Promise<void>

  // 文件管理器文字大小设置
  fileManagerTextSize: string
  setFileManagerTextSize: (size: string) => Promise<void>

  // 记录文字大小设置
  recordTextSize: string
  setRecordTextSize: (size: string) => Promise<void>

  // 自定义主题颜色设置
  customThemeColors: CustomThemeColors
  setCustomThemeColors: (colors: CustomThemeColors) => Promise<void>
  resetCustomThemeColors: () => Promise<void>

  // 聊天工具栏配置 - PC 端
  chatToolbarConfigPc: ChatToolbarItem[]
  setChatToolbarConfigPc: (config: ChatToolbarItem[]) => Promise<void>

  // 聊天工具栏配置 - 移动端
  chatToolbarConfigMobile: ChatToolbarItem[]
  setChatToolbarConfigMobile: (config: ChatToolbarItem[]) => Promise<void>

  // 记录工具栏配置
  recordToolbarConfig: RecordToolbarItem[]
  setRecordToolbarConfig: (config: RecordToolbarItem[]) => Promise<void>

  // 编辑器撤销/重做按钮显示设置
  showEditorUndoRedo: boolean
  setShowEditorUndoRedo: (show: boolean) => Promise<void>

  centeredContent: boolean
  setCenteredContent: (enabled: boolean) => Promise<void>

  enableOutline: boolean
  setEnableOutline: (enabled: boolean) => Promise<void>

  outlinePosition: OutlinePosition
  setOutlinePosition: (position: OutlinePosition) => Promise<void>

  // 摘要设置
  enableCondense: boolean
  setEnableCondense: (enabled: boolean) => Promise<void>
  keepLatestCount: number
  setKeepLatestCount: (count: number) => Promise<void>
  condenseMaxLength: number
  setCondenseMaxLength: (length: number) => Promise<void>

  // 打字机模式
  typewriterMode: boolean
  setTypewriterMode: (enabled: boolean) => Promise<void>

  // 禅专注模式
  zenMode: boolean
  setZenMode: (enabled: boolean) => Promise<void>

  // 编辑器 AI 灰字补全
  aiCompletionEnabled: boolean
  setAiCompletionEnabled: (enabled: boolean) => Promise<void>

  // 桌面提醒
  reminderEnabled: boolean
  setReminderEnabled: (enabled: boolean) => Promise<void>
  reminderAllowAgentCreate: boolean
  setReminderAllowAgentCreate: (enabled: boolean) => Promise<void>
  reminderDefaultAdvanceMinutes: number
  setReminderDefaultAdvanceMinutes: (minutes: number) => Promise<void>
  reminderShowContext: boolean
  setReminderShowContext: (enabled: boolean) => Promise<void>
  reminderTitlePrefix: string
  setReminderTitlePrefix: (prefix: string) => Promise<void>
}

export interface ChatToolbarItem {
  id: string
  enabled: boolean
  order: number
}

export interface RecordToolbarItem {
  id: string
  enabled: boolean
  order: number
}


const useSettingStore = create<SettingState>((set, get) => ({
  initSettingData: async () => {
    const store = await Store.load('store.json');
    await get().setVersion()

    // 初始化图床配置
    const savedUseImageRepo = await store.get<boolean>('useImageRepo')
    if (savedUseImageRepo !== undefined && savedUseImageRepo !== null) {
      set({ useImageRepo: savedUseImageRepo })
    }

    // 初始化打字机模式
    const savedTypewriterMode = await store.get<boolean>('typewriterMode')
    if (savedTypewriterMode !== undefined && savedTypewriterMode !== null) {
      set({ typewriterMode: savedTypewriterMode })
    }

    // 初始化禅专注模式
    const savedZenMode = await store.get<boolean>('zenMode')
    if (savedZenMode !== undefined && savedZenMode !== null) {
      set({ zenMode: savedZenMode })
    }

    const savedAiCompletionEnabled = await store.get<boolean>('aiCompletionEnabled')
    if (savedAiCompletionEnabled !== undefined && savedAiCompletionEnabled !== null) {
      set({ aiCompletionEnabled: savedAiCompletionEnabled })
    }

    const savedReminderEnabled = await store.get<boolean>('reminderEnabled')
    if (savedReminderEnabled !== undefined && savedReminderEnabled !== null) {
      set({ reminderEnabled: savedReminderEnabled })
    }

    const savedReminderAllowAgentCreate = await store.get<boolean>('reminderAllowAgentCreate')
    if (savedReminderAllowAgentCreate !== undefined && savedReminderAllowAgentCreate !== null) {
      set({ reminderAllowAgentCreate: savedReminderAllowAgentCreate })
    }

    const savedReminderDefaultAdvanceMinutes = await store.get<number>('reminderDefaultAdvanceMinutes')
    if (savedReminderDefaultAdvanceMinutes !== undefined && savedReminderDefaultAdvanceMinutes !== null) {
      set({ reminderDefaultAdvanceMinutes: Math.min(1440, Math.max(0, Math.floor(savedReminderDefaultAdvanceMinutes))) })
    }

    const savedReminderShowContext = await store.get<boolean>('reminderShowContext')
    if (savedReminderShowContext !== undefined && savedReminderShowContext !== null) {
      set({ reminderShowContext: savedReminderShowContext })
    }

    const savedReminderTitlePrefix = await store.get<string>('reminderTitlePrefix')
    if (savedReminderTitlePrefix !== undefined && savedReminderTitlePrefix !== null && savedReminderTitlePrefix.trim()) {
      set({ reminderTitlePrefix: savedReminderTitlePrefix.trim() })
    }

    const { aiModelList: finalAiModelList } = await removeBuiltinLingMoModelSettings(store)
    set({ aiModelList: finalAiModelList })

    const defaultModelUpdates = await ensureConfiguredDefaultModelSettings(store, finalAiModelList)
    Object.entries(defaultModelUpdates).forEach(([key, value]) => {
      set({ [key]: value })
    })

    const currentTextToSpeechMode = await store.get('textToSpeechMode')
    set({ textToSpeechMode: normalizeSpeechMode(currentTextToSpeechMode) })

    const currentSpeechToTextMode = await store.get('speechToTextMode')
    set({ speechToTextMode: normalizeSpeechMode(currentSpeechToTextMode) })

    Object.entries(get()).forEach(async ([key, value]) => {
      const res = await store.get(key)

      if (typeof value === 'function') return
      if (res !== undefined && key !== 'version') {
        if (key === 'templateList') {
          set({ [key]: [] })
          setTimeout(() => {
            set({ [key]: res as GenTemplate[] })
          }, 0);
        } else if (key === 'aiModelList') {
          set({ [key]: finalAiModelList })
        } else if (key === 'recordToolbarConfig') {
          // 确保包含所有工具，如果缺少新工具则自动添加
          const storedConfig = res as RecordToolbarItem[]
          const defaultConfig = value as RecordToolbarItem[]

          // 检查是否有缺失的工具
          const missingTools = defaultConfig.filter(
            defaultItem => !storedConfig.some(stored => stored.id === defaultItem.id)
          )

          if (missingTools.length > 0) {
            // 合并配置：保留用户的顺序和启用状态，添加新工具
            const mergedConfig = [...storedConfig]
            let maxOrder = Math.max(...storedConfig.map(item => item.order), 0)

            missingTools.forEach(tool => {
              mergedConfig.push({ ...tool, order: ++maxOrder })
            })

            await store.set(key, mergedConfig)
            set({ [key]: mergedConfig })
          } else {
            set({ [key]: res as RecordToolbarItem[] })
          }
        } else if (key === 'chatToolbarConfigPc' || key === 'chatToolbarConfigMobile') {
          // 确保聊天工具栏包含所有工具，如果缺少新工具则自动添加
          const storedConfig = res as ChatToolbarItem[]
          const defaultConfig = value as ChatToolbarItem[]

          // 检查是否有缺失的工具
          const missingTools = defaultConfig.filter(
            defaultItem => !storedConfig.some(stored => stored.id === defaultItem.id)
          )

          if (missingTools.length > 0) {
            // 合并配置：保留用户的顺序和启用状态，添加新工具
            const mergedConfig = [...storedConfig]
            let maxOrder = Math.max(...storedConfig.map(item => item.order), 0)

            missingTools.forEach(tool => {
              mergedConfig.push({ ...tool, order: ++maxOrder })
            })

            await store.set(key, mergedConfig)
            set({ [key]: mergedConfig })
          } else {
            set({ [key]: res as ChatToolbarItem[] })
          }
        } else if (key === 'outlinePosition') {
          set({ outlinePosition: normalizeOutlinePosition(res) })
        } else if (key !== 'aiModelList') {
          set({ [key]: res })
        }
      } else {
        await store.set(key, value)
      }
    })
  },

  version: '',
  setVersion: async () => {
    const version = await getVersion()
    set({ version })
  },

  autoUpdate: true,
  setAutoUpdate: (autoUpdate) => set({ autoUpdate }),

  language: '简体中文',
  setLanguage: (language) => set({ language }),

  currentAi: '',
  setCurrentAi: (currentAi) => set({ currentAi }),

  aiModelList: [],
  setAiModelList: (aiModelList) => set({ aiModelList }),

  primaryModel: '',
  setPrimaryModel: async (primaryModel) => {
    if (get().primaryModel === primaryModel) return
    const store = await Store.load('store.json')
    await store.set('primaryModel', primaryModel)
    await store.save()
    set({ primaryModel })
  },

  placeholderModel: '',
  setPlaceholderModel: async (placeholderModel) => {
    if (get().placeholderModel === placeholderModel) return
    const store = await Store.load('store.json');
    await store.set('placeholderModel', placeholderModel)
    set({ placeholderModel })
  },

  completionModel: '',
  setCompletionModel: async (completionModel) => {
    if (get().completionModel === completionModel) return
    const store = await Store.load('store.json');
    await store.set('completionModel', completionModel)
    set({ completionModel })
  },

  markDescModel: '',
  setMarkDescModel: async (markDescModel) => {
    if (get().markDescModel === markDescModel) return
    const store = await Store.load('store.json');
    await store.set('markDescModel', markDescModel)
    set({ markDescModel })
  },

  commitModel: '',
  setCommitModel: async (commitModel) => {
    if (get().commitModel === commitModel) return
    const store = await Store.load('store.json');
    await store.set('commitModel', commitModel)
    set({ commitModel })
  },

  embeddingModel: '',
  setEmbeddingModel: async (embeddingModel) => {
    if (get().embeddingModel === embeddingModel) return
    const store = await Store.load('store.json');
    await store.set('embeddingModel', embeddingModel)
    set({ embeddingModel })
  },

  rerankingModel: '',
  setRerankingModel: async (rerankingModel) => {
    if (get().rerankingModel === rerankingModel) return
    const store = await Store.load('store.json');
    await store.set('rerankingModel', rerankingModel)
    set({ rerankingModel })
  },

  imageMethodModel: '',
  setImageMethodModel: async (imageMethodModel) => {
    if (get().imageMethodModel === imageMethodModel) return
    const store = await Store.load('store.json');
    await store.set('imageMethodModel', imageMethodModel)
    set({ imageMethodModel })
  },

  audioModel: '',
  setAudioModel: async (audioModel) => {
    if (get().audioModel === audioModel) return
    const store = await Store.load('store.json');
    await store.set('audioModel', audioModel)
    set({ audioModel })
  },

  sttModel: '',
  setSttModel: async (sttModel) => {
    if (get().sttModel === sttModel) return
    const store = await Store.load('store.json');
    await store.set('sttModel', sttModel)
    set({ sttModel })
  },

  textToSpeechMode: 'auto',
  setTextToSpeechMode: async (mode) => {
    const normalizedMode = normalizeSpeechMode(mode)
    const store = await Store.load('store.json')
    await store.set('textToSpeechMode', normalizedMode)
    set({ textToSpeechMode: normalizedMode })
  },

  speechToTextMode: 'auto',
  setSpeechToTextMode: async (mode) => {
    const normalizedMode = normalizeSpeechMode(mode)
    const store = await Store.load('store.json')
    await store.set('speechToTextMode', normalizedMode)
    set({ speechToTextMode: normalizedMode })
  },

  condenseModel: '',
  setCondenseModel: async (condenseModel) => {
    if (get().condenseModel === condenseModel) return
    const store = await Store.load('store.json');
    await store.set('condenseModel', condenseModel)
    set({ condenseModel })
  },

  inspirationModel: '',
  setInspirationModel: async (inspirationModel) => {
    if (get().inspirationModel === inspirationModel) return
    const store = await Store.load('store.json');
    await store.set('inspirationModel', inspirationModel)
    set({ inspirationModel })
  },

  promptEnhancerModel: '',
  setPromptEnhancerModel: async (promptEnhancerModel) => {
    if (get().promptEnhancerModel === promptEnhancerModel) return
    const store = await Store.load('store.json');
    await store.set('promptEnhancerModel', promptEnhancerModel)
    set({ promptEnhancerModel })
  },

  structuredExtractionModel: '',
  setStructuredExtractionModel: async (structuredExtractionModel) => {
    if (get().structuredExtractionModel === structuredExtractionModel) return
    const store = await Store.load('store.json')
    await store.set('structuredExtractionModel', structuredExtractionModel)
    await store.save()
    set({ structuredExtractionModel })
  },

  tavilyApiKey: '',
  setTavilyApiKey: async (tavilyApiKey) => {
    const store = await Store.load('store.json')
    await store.set('tavilyApiKey', tavilyApiKey)
    await store.save()
    set({ tavilyApiKey })
  },

  tavilySearchDepth: 'basic',
  setTavilySearchDepth: async (tavilySearchDepth) => {
    const normalizedDepth = tavilySearchDepth === 'advanced' ? 'advanced' : 'basic'
    const store = await Store.load('store.json')
    await store.set('tavilySearchDepth', normalizedDepth)
    await store.save()
    set({ tavilySearchDepth: normalizedDepth })
  },

  serpApiKey: '',
  setSerpApiKey: async (serpApiKey) => {
    const store = await Store.load('store.json')
    await store.set('serpApiKey', serpApiKey)
    await store.save()
    set({ serpApiKey })
  },

  exaApiKey: '',
  setExaApiKey: async (exaApiKey) => {
    const store = await Store.load('store.json')
    await store.set('exaApiKey', exaApiKey)
    await store.save()
    set({ exaApiKey })
  },

  researchSearchTavilyEnabled: true,
  setResearchSearchTavilyEnabled: async (researchSearchTavilyEnabled) => {
    const store = await Store.load('store.json')
    await store.set('researchSearchTavilyEnabled', researchSearchTavilyEnabled)
    await store.save()
    set({ researchSearchTavilyEnabled })
  },

  researchSearchSerpApiEnabled: false,
  setResearchSearchSerpApiEnabled: async (researchSearchSerpApiEnabled) => {
    const store = await Store.load('store.json')
    await store.set('researchSearchSerpApiEnabled', researchSearchSerpApiEnabled)
    await store.save()
    set({ researchSearchSerpApiEnabled })
  },

  researchSearchExaEnabled: false,
  setResearchSearchExaEnabled: async (researchSearchExaEnabled) => {
    const store = await Store.load('store.json')
    await store.set('researchSearchExaEnabled', researchSearchExaEnabled)
    await store.save()
    set({ researchSearchExaEnabled })
  },

  researchSearchAnySearchMcpEnabled: true,
  setResearchSearchAnySearchMcpEnabled: async (researchSearchAnySearchMcpEnabled) => {
    const store = await Store.load('store.json')
    await store.set('researchSearchAnySearchMcpEnabled', researchSearchAnySearchMcpEnabled)
    await store.save()
    set({ researchSearchAnySearchMcpEnabled })
  },

  researchSearchFirecrawlMcpEnabled: true,
  setResearchSearchFirecrawlMcpEnabled: async (researchSearchFirecrawlMcpEnabled) => {
    const store = await Store.load('store.json')
    await store.set('researchSearchFirecrawlMcpEnabled', researchSearchFirecrawlMcpEnabled)
    await store.save()
    set({ researchSearchFirecrawlMcpEnabled })
  },

  webSearchEnabled: false,
  setWebSearchEnabled: async (webSearchEnabled) => {
    const store = await Store.load('store.json')
    await store.set('webSearchEnabled', webSearchEnabled)
    await store.save()
    set({ webSearchEnabled })
  },

  githubProjectApiToken: '',
  setGithubProjectApiToken: async (githubProjectApiToken) => {
    const store = await Store.load('store.json')
    await store.set('githubProjectApiToken', githubProjectApiToken)
    await store.save()
    set({ githubProjectApiToken })
  },

  templateList: [
    {
      id: '0',
      title: '笔记',
      content: `整理成一篇详细完整的笔记。
满足以下格式要求：
- 如果是代码，必须完整保留，不要随意生成。
- 文字复制的内容尽量不要修改，只处理格式化后的内容。`,
      status: true,
      range: GenTemplateRange.All,
      category: TemplateCategory.Note
    },
    {
      id: '1',
      title: '周报',
      content: '最近一周的记录整理成一篇周报，将每条记录形成一句总结，每条不超过50字。',
      status: true,
      range: GenTemplateRange.Week,
      category: TemplateCategory.Work
    }
  ],
  setTemplateList: async (templateList) => {
    set({ templateList })
    const store = await Store.load('store.json')
    await store.set('templateList', templateList)
  },

  darkMode: 'system',
  setDarkMode: (darkMode) => set({ darkMode }),

  previewTheme: 'github',
  setPreviewTheme: async (previewTheme) => {
    const store = await Store.load('store.json')
    await store.set('previewTheme', previewTheme)
    await store.save()
    set({ previewTheme })
  },

  codeTheme: 'github',
  setCodeTheme: async (codeTheme) => {
    const store = await Store.load('store.json')
    await store.set('codeTheme', codeTheme)
    await store.save()
    set({ codeTheme })
  },

  tesseractList: 'eng,chi_sim',
  setTesseractList: async (tesseractList) => {
    const store = await Store.load('store.json')
    await store.set('tesseractList', tesseractList)
    await store.save()
    set({ tesseractList })
  },

  githubUsername: '',
  setGithubUsername: async (githubUsername) => {
    set({ githubUsername })
    const store = await Store.load('store.json');
    await store.set('githubUsername', githubUsername)
    await store.save()
  },

  accessToken: '',
  setAccessToken: async (accessToken) => {
    const store = await Store.load('store.json');
    const hasAccessToken = await store.get('accessToken') === accessToken
    if (!hasAccessToken) {
      await get().setGithubUsername('')
    }
    set({ accessToken })
    await store.set('accessToken', accessToken)
    await store.save()
  },

  jsdelivr: true,
  setJsdelivr: async (jsdelivr: boolean) => {
    set({ jsdelivr })
    const store = await Store.load('store.json');
    await store.set('jsdelivr', jsdelivr)
    await store.save()
  },

  useImageRepo: false,
  setUseImageRepo: async (useImageRepo: boolean) => {
    set({ useImageRepo })
    const store = await Store.load('store.json');
    await store.set('useImageRepo', useImageRepo)
    if (useImageRepo) {
      const normalizedImageHosting = getNormalizedImageHosting(await store.get<string>('mainImageHosting'))
      if (normalizedImageHosting.shouldPersist) {
        await store.set('mainImageHosting', normalizedImageHosting.value)
      }
    }
    await store.save()
  },

  autoSync: 'disabled',
  setAutoSync: async (autoSync: string) => {
    set({ autoSync })
    const store = await Store.load('store.json');
    await store.set('autoSync', autoSync)
    await store.save()
  },

  // 自动拉取相关设置 - 默认关闭
  autoPullOnOpen: false,
  setAutoPullOnOpen: async (autoPullOnOpen: boolean) => {
    set({ autoPullOnOpen })
    const store = await Store.load('store.json');
    await store.set('autoPullOnOpen', autoPullOnOpen)

    // 同步更新 sync-manager 的配置
    try {
      const { getSyncManager } = await import('@/lib/sync/sync-manager')
      const manager = getSyncManager()
      await manager.updateConfig({ autoPullOnOpen })
    } catch {
      // 静默处理
    }
  },

  autoPullOnSwitch: false,
  setAutoPullOnSwitch: async (autoPullOnSwitch: boolean) => {
    set({ autoPullOnSwitch })
    const store = await Store.load('store.json');
    await store.set('autoPullOnSwitch', autoPullOnSwitch)

    // 同步更新 sync-manager 的配置
    try {
      const { getSyncManager } = await import('@/lib/sync/sync-manager')
      const manager = getSyncManager()
      await manager.updateConfig({ autoPullOnSwitch })
    } catch {
      // 静默处理
    }
  },

  lastSettingPage: 'ai',
  setLastSettingPage: async (page: string) => {
    set({ lastSettingPage: page })
    const store = await Store.load('store.json');
    await store.set('lastSettingPage', page)
  },

  workspacePath: '',
  setWorkspacePath: async (path: string) => {
    set({ workspacePath: path })
    const store = await Store.load('store.json');
    await store.set('workspacePath', path)
    
    // 如果路径不为空且不在历史记录中，则添加到历史记录
    if (path && !get().workspaceHistory.includes(path)) {
      await get().addWorkspaceHistory(path)
    }
  },

  // 工作区历史路径管理
  workspaceHistory: [],
  addWorkspaceHistory: async (path: string) => {
    const currentHistory = get().workspaceHistory
    const newHistory = [path, ...currentHistory.filter(p => p !== path)].slice(0, 10) // 最多保存10个历史路径
    set({ workspaceHistory: newHistory })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', newHistory)
    await store.save()
  },
  removeWorkspaceHistory: async (path: string) => {
    const newHistory = get().workspaceHistory.filter(p => p !== path)
    set({ workspaceHistory: newHistory })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', newHistory)
    await store.save()
  },
  clearWorkspaceHistory: async () => {
    set({ workspaceHistory: [] })
    const store = await Store.load('store.json')
    await store.set('workspaceHistory', [])
    await store.save()
  },

  // Gitee 相关设置
  giteeAccessToken: '',
  setGiteeAccessToken: async (giteeAccessToken: string) => {
    set({ giteeAccessToken })
    const store = await Store.load('store.json');
    await store.set('giteeAccessToken', giteeAccessToken)
  },

  giteeAutoSync: 'disabled',
  setGiteeAutoSync: async (giteeAutoSync: string) => {
    set({ giteeAutoSync })
    const store = await Store.load('store.json');
    await store.set('giteeAutoSync', giteeAutoSync)
  },

  // Gitlab 相关设置
  gitlabInstanceType: GitlabInstanceType.OFFICIAL,
  setGitlabInstanceType: async (instanceType: GitlabInstanceType) => {
    const store = await Store.load('store.json')
    await store.set('gitlabInstanceType', instanceType)
    await store.save()
    set({ gitlabInstanceType: instanceType })
  },

  gitlabCustomUrl: '',
  setGitlabCustomUrl: async (customUrl: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabCustomUrl', customUrl)
    await store.save()
    set({ gitlabCustomUrl: customUrl })
  },

  gitlabAccessToken: '',
  setGitlabAccessToken: (gitlabAccessToken: string) => {
    set({ gitlabAccessToken })
  },

  gitlabAutoSync: 'disabled',
  setGitlabAutoSync: async (gitlabAutoSync: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabAutoSync', gitlabAutoSync)
    await store.save()
    set({ gitlabAutoSync })
  },

  gitlabUsername: '',
  setGitlabUsername: async (gitlabUsername: string) => {
    const store = await Store.load('store.json')
    await store.set('gitlabUsername', gitlabUsername)
    await store.save()
    set({ gitlabUsername })
  },

  // Gitea 相关实现
  giteaInstanceType: GiteaInstanceType.OFFICIAL,
  setGiteaInstanceType: async (instanceType: GiteaInstanceType) => {
    const store = await Store.load('store.json')
    await store.set('giteaInstanceType', instanceType)
    await store.save()
    set({ giteaInstanceType: instanceType })
  },

  giteaCustomUrl: '',
  setGiteaCustomUrl: async (customUrl: string) => {
    const store = await Store.load('store.json')
    await store.set('giteaCustomUrl', customUrl)
    await store.save()
    set({ giteaCustomUrl: customUrl })
  },

  giteaAccessToken: '',
  setGiteaAccessToken: (giteaAccessToken: string) => {
    set({ giteaAccessToken })
  },

  giteaAutoSync: 'disabled',
  setGiteaAutoSync: async (giteaAutoSync: string) => {
    set({ giteaAutoSync })
    const store = await Store.load('store.json');
    await store.set('giteaAutoSync', giteaAutoSync)
    await store.save()
  },

  giteaUsername: '',
  setGiteaUsername: async (giteaUsername: string) => {
    const store = await Store.load('store.json')
    await store.set('giteaUsername', giteaUsername)
    await store.save()
    set({ giteaUsername })
  },

  giteaCustomSyncRepo: '',
  setGiteaCustomSyncRepo: async (repo: string) => {
    set({ giteaCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('giteaCustomSyncRepo', repo)
    await store.save()
  },

  // 默认使用 GitHub 作为主要备份方式
  primaryBackupMethod: 'github',
  setPrimaryBackupMethod: async (method: 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav') => {
    const store = await Store.load('store.json')
    await store.set('primaryBackupMethod', method)
    await store.save()
    set({ primaryBackupMethod: method })
  },

  assetsPath: 'assets',
  setAssetsPath: async (path: string) => {
    set({ assetsPath: path })
    const store = await Store.load('store.json');
    await store.set('assetsPath', path)
    await store.save()
  },

  // 图床设置
  githubImageAccessToken: '',
  setGithubImageAccessToken: async (githubImageAccessToken: string) => {
    set({ githubImageAccessToken })
    const store = await Store.load('store.json');
    await store.set('githubImageAccessToken', githubImageAccessToken)
    await store.save()
  },

  // 图片识别设置
  enableImageRecognition: true,
  setEnableImageRecognition: async (enable: boolean) => {
    set({ enableImageRecognition: enable })
    const store = await Store.load('store.json');
    await store.set('enableImageRecognition', enable)
    await store.save()
  },
  primaryImageMethod: 'vlm',
  setPrimaryImageMethod: async (method: 'ocr' | 'vlm') => {
    set({ primaryImageMethod: method })
    const store = await Store.load('store.json');
    await store.set('primaryImageMethod', method)
    await store.save()
  },

  // 界面缩放设置 (75%, 100%, 125%, 150%)
  uiScale: 100,
  setUiScale: async (scale: number) => {
    set({ uiScale: scale })
    const store = await Store.load('store.json');
    await store.set('uiScale', scale)
    await store.save()
    
    // 使用fontSize实现基于rem的缩放
    document.documentElement.style.fontSize = `${scale}%`
  },

  // 正文文字大小缩放设置 (75%, 100%, 125%, 150%)
  contentTextScale: 100,
  setContentTextScale: async (scale: number) => {
    set({ contentTextScale: scale })
    const store = await Store.load('store.json');
    await store.set('contentTextScale', scale)
    await store.save()
  },

  // 文件管理器文字大小设置 (xs, sm, md, lg, xl)
  fileManagerTextSize: 'sm',
  setFileManagerTextSize: async (size: string) => {
    set({ fileManagerTextSize: size })
    const store = await Store.load('store.json');
    await store.set('fileManagerTextSize', size)
    await store.save()
  },

  // 记录文字大小设置 (xs, sm, md, lg, xl)
  recordTextSize: 'sm',
  setRecordTextSize: async (size: string) => {
    set({ recordTextSize: size })
    const store = await Store.load('store.json');
    await store.set('recordTextSize', size)
    await store.save()
  },

  // 自定义主题颜色设置
  customThemeColors: {
    light: {
      background: null,
      foreground: null,
      card: null,
      cardForeground: null,
      primary: null,
      primaryForeground: null,
      secondary: null,
      secondaryForeground: null,
      third: null,
      thirdForeground: null,
      muted: null,
      mutedForeground: null,
      accent: null,
      accentForeground: null,
      border: null,
      shadow: null,
    },
    dark: {
      background: null,
      foreground: null,
      card: null,
      cardForeground: null,
      primary: null,
      primaryForeground: null,
      secondary: null,
      secondaryForeground: null,
      third: null,
      thirdForeground: null,
      muted: null,
      mutedForeground: null,
      accent: null,
      accentForeground: null,
      border: null,
      shadow: null,
    },
  },
  setCustomThemeColors: async (colors: CustomThemeColors) => {
    set({ customThemeColors: colors })
    const store = await Store.load('store.json');
    await store.set('customThemeColors', colors)
    await store.save()

    // 应用主题颜色（同时应用亮色和暗色主题）
    applyThemeColors(colors)
  },
  resetCustomThemeColors: async () => {
    const defaultColors: CustomThemeColors = {
      light: {
        background: null,
        foreground: null,
        card: null,
        cardForeground: null,
        primary: null,
        primaryForeground: null,
        secondary: null,
        secondaryForeground: null,
        third: null,
        thirdForeground: null,
        muted: null,
        mutedForeground: null,
        accent: null,
        accentForeground: null,
        border: null,
        shadow: null,
      },
      dark: {
        background: null,
        foreground: null,
        card: null,
        cardForeground: null,
        primary: null,
        primaryForeground: null,
        secondary: null,
        secondaryForeground: null,
        third: null,
        thirdForeground: null,
        muted: null,
        mutedForeground: null,
        accent: null,
        accentForeground: null,
        border: null,
        shadow: null,
      },
    }
    set({ customThemeColors: defaultColors })
    const store = await Store.load('store.json');
    await store.set('customThemeColors', defaultColors)
    await store.save()

    // 清除自定义主题颜色
    removeThemeColors()
  },

  // 自定义仓库名称设置
  githubCustomSyncRepo: '',
  setGithubCustomSyncRepo: async (repo: string) => {
    set({ githubCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('githubCustomSyncRepo', repo)
    await store.save()
  },

  giteeCustomSyncRepo: '',
  setGiteeCustomSyncRepo: async (repo: string) => {
    set({ giteeCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('giteeCustomSyncRepo', repo)
    await store.save()
  },

  gitlabCustomSyncRepo: '',
  setGitlabCustomSyncRepo: async (repo: string) => {
    set({ gitlabCustomSyncRepo: repo })
    const store = await Store.load('store.json');
    await store.set('gitlabCustomSyncRepo', repo)
    await store.save()
  },

  githubCustomImageRepo: '',
  setGithubCustomImageRepo: async (repo: string) => {
    set({ githubCustomImageRepo: repo })
    const store = await Store.load('store.json');
    await store.set('githubCustomImageRepo', repo)
    await store.save()
  },

  // 聊天工具栏配置 - PC 端
  chatToolbarConfigPc: [
    // 底部工具栏（可排序）
      { id: 'chatModeSelect', enabled: true, order: 0 },
      { id: 'promptEnhancer', enabled: true, order: 1 },
      { id: 'mcpButton', enabled: true, order: 2 },
      { id: 'ragSwitch', enabled: true, order: 3 },
      { id: 'clipboardMonitor', enabled: true, order: 4 },
      { id: 'skillsPopover', enabled: true, order: 5 },
      { id: 'webSearch', enabled: true, order: 6 },
      // 顶部工具栏 - 右侧（不参与排序）
      { id: 'newChat', enabled: true, order: 7 },
  ],
  setChatToolbarConfigPc: async (config: ChatToolbarItem[]) => {
    set({ chatToolbarConfigPc: config })
    const store = await Store.load('store.json');
    await store.set('chatToolbarConfigPc', config)
    await store.save()
  },

  // 聊天工具栏配置 - 移动端
  chatToolbarConfigMobile: [
      { id: 'chatModeSelect', enabled: true, order: 0 },
      { id: 'promptEnhancer', enabled: true, order: 1 },
      { id: 'mcpButton', enabled: true, order: 2 },
      { id: 'ragSwitch', enabled: true, order: 3 },
      { id: 'clipboardMonitor', enabled: true, order: 4 },
      { id: 'skillsPopover', enabled: true, order: 5 },
      { id: 'webSearch', enabled: true, order: 6 },
      { id: 'newChat', enabled: true, order: 7 },
  ],
  setChatToolbarConfigMobile: async (config: ChatToolbarItem[]) => {
    set({ chatToolbarConfigMobile: config })
    const store = await Store.load('store.json');
    await store.set('chatToolbarConfigMobile', config)
    await store.save()
  },

  // 记录工具栏配置
  recordToolbarConfig: [
    { id: 'text', enabled: true, order: 0 },
    { id: 'recording', enabled: true, order: 1 },
    { id: 'scan', enabled: true, order: 2 },
    { id: 'image', enabled: true, order: 3 },
    { id: 'recognition', enabled: true, order: 4 },
    { id: 'link', enabled: true, order: 5 },
    { id: 'file', enabled: true, order: 6 },
    { id: 'todo', enabled: true, order: 7 },
  ],
  setRecordToolbarConfig: async (config: RecordToolbarItem[]) => {
    set({ recordToolbarConfig: config })
    const store = await Store.load('store.json');
    await store.set('recordToolbarConfig', config)
    await store.save()
  },

  // 摘要设置
  enableCondense: true,
  setEnableCondense: async (enabled: boolean) => {
    set({ enableCondense: enabled })
    const store = await Store.load('store.json');
    await store.set('enableCondense', enabled)
    await store.save()
  },

  keepLatestCount: 4,
  setKeepLatestCount: async (count: number) => {
    set({ keepLatestCount: count })
    const store = await Store.load('store.json');
    await store.set('keepLatestCount', count)
    await store.save()
  },

  condenseMaxLength: 100,
  setCondenseMaxLength: async (length: number) => {
    set({ condenseMaxLength: length })
    const store = await Store.load('store.json');
    await store.set('condenseMaxLength', length)
    await store.save()
  },

  // 编辑器撤销/重做按钮显示设置 - 默认开启
  showEditorUndoRedo: true,
  setShowEditorUndoRedo: async (show: boolean) => {
    set({ showEditorUndoRedo: show })
    const store = await Store.load('store.json');
    await store.set('showEditorUndoRedo', show)
    await store.save()
  },

  centeredContent: false,
  setCenteredContent: async (enabled: boolean) => {
    set({ centeredContent: enabled })
    const store = await Store.load('store.json')
    await store.set('centeredContent', enabled)
    await store.save()
  },

  enableOutline: false,
  setEnableOutline: async (enabled: boolean) => {
    set({ enableOutline: enabled })
    const store = await Store.load('store.json')
    await store.set('enableOutline', enabled)
    await store.save()
  },

  outlinePosition: DEFAULT_OUTLINE_POSITION,
  setOutlinePosition: async (position: OutlinePosition) => {
    const normalizedPosition = normalizeOutlinePosition(position)
    set({ outlinePosition: normalizedPosition })
    const store = await Store.load('store.json')
    await store.set('outlinePosition', normalizedPosition)
    await store.save()
  },

  // 打字机模式
  typewriterMode: false,
  setTypewriterMode: async (enabled: boolean) => {
    set({ typewriterMode: enabled })
    const store = await Store.load('store.json');
    await store.set('typewriterMode', enabled)
    await store.save()
  },

  // 禅专注模式
  zenMode: false,
  setZenMode: async (enabled: boolean) => {
    set({ zenMode: enabled })
    const store = await Store.load('store.json');
    await store.set('zenMode', enabled)
    await store.save()
  },

  // 编辑器 AI 灰字补全
  aiCompletionEnabled: true,
  setAiCompletionEnabled: async (enabled: boolean) => {
    set({ aiCompletionEnabled: enabled })
    const store = await Store.load('store.json');
    await store.set('aiCompletionEnabled', enabled)
    await store.save()
  },

  // 桌面提醒
  reminderEnabled: DEFAULT_REMINDER_SETTINGS.reminderEnabled,
  setReminderEnabled: async (enabled: boolean) => {
    set({ reminderEnabled: enabled })
    const store = await Store.load('store.json')
    await store.set('reminderEnabled', enabled)
    await store.save()

    try {
      const { reminderScheduler } = await import('@/lib/reminders/scheduler')
      if (enabled) {
        await reminderScheduler.refresh()
      } else {
        await reminderScheduler.disable()
      }
    } catch (error) {
      console.warn('[SettingStore] Failed to refresh reminder scheduler:', error)
    }
  },

  reminderAllowAgentCreate: DEFAULT_REMINDER_SETTINGS.reminderAllowAgentCreate,
  setReminderAllowAgentCreate: async (enabled: boolean) => {
    set({ reminderAllowAgentCreate: enabled })
    const store = await Store.load('store.json')
    await store.set('reminderAllowAgentCreate', enabled)
    await store.save()
  },

  reminderDefaultAdvanceMinutes: DEFAULT_REMINDER_SETTINGS.reminderDefaultAdvanceMinutes,
  setReminderDefaultAdvanceMinutes: async (minutes: number) => {
    const normalized = Math.min(1440, Math.max(0, Math.floor(Number(minutes) || 0)))
    set({ reminderDefaultAdvanceMinutes: normalized })
    const store = await Store.load('store.json')
    await store.set('reminderDefaultAdvanceMinutes', normalized)
    await store.save()
  },

  reminderShowContext: DEFAULT_REMINDER_SETTINGS.reminderShowContext,
  setReminderShowContext: async (enabled: boolean) => {
    set({ reminderShowContext: enabled })
    const store = await Store.load('store.json')
    await store.set('reminderShowContext', enabled)
    await store.save()
  },

  reminderTitlePrefix: DEFAULT_REMINDER_SETTINGS.reminderTitlePrefix,
  setReminderTitlePrefix: async (prefix: string) => {
    const normalized = prefix.trim() || DEFAULT_REMINDER_SETTINGS.reminderTitlePrefix
    set({ reminderTitlePrefix: normalized })
    const store = await Store.load('store.json')
    await store.set('reminderTitlePrefix', normalized)
    await store.save()
  },
}))

export default useSettingStore
