import {
  BotMessageSquare,
  LayoutTemplate,
  ScanText,
  Store,
  UserRoundCog,
  Drama,
  FolderOpen,
  DatabaseBackup,
  ImageUp,
  FileCog,
  Book,
  KeyboardIcon,
  Volume2,
  Settings,
  Puzzle,
  Sparkles,
  MessageSquare,
  PenTool,
  Globe2,
  Brain,
} from "lucide-react"

const baseConfig = [
  {
    icon: <Store className="size-4 md:size-6" />,
    anchor: 'about',
    group: 'overview',
  },
  {
    icon: <Settings className="size-4 md:size-6" />,
    anchor: 'general',
    group: 'overview',
  },
  {
    icon: <MessageSquare className="size-4 md:size-6" />,
    anchor: 'chat',
    group: 'workspace',
  },
  {
    icon: <FileCog className="size-4 md:size-6" />,
    anchor: 'editor',
    group: 'workspace',
  },
  {
    icon: <PenTool className="size-4 md:size-6" />,
    anchor: 'record',
    group: 'workspace',
  },
  {
    icon: <FolderOpen className="size-4 md:size-6" />,
    anchor: 'file',
    group: 'workspace',
  },
  {
    icon: <KeyboardIcon className="size-4 md:size-6" />,
    anchor: 'shortcuts',
    group: 'workspace',
  },
  {
    icon: <BotMessageSquare className="size-4 md:size-6" />,
    anchor: 'ai',
    group: 'aiKnowledge',
  },
  {
    icon: <Book className="size-4 md:size-6" />,
    anchor: 'rag',
    group: 'aiKnowledge',
  },
  {
    icon: <Brain className="size-4 md:size-6" />,
    anchor: 'memories',
    group: 'aiKnowledge',
  },
  {
    icon: <Puzzle className="size-4 md:size-6" />,
    anchor: 'mcp',
    group: 'aiKnowledge',
  },
  {
    icon: <Sparkles className="size-4 md:size-6" />,
    anchor: 'skills',
    group: 'aiKnowledge',
  },
  {
    icon: <Drama className="size-4 md:size-6" />,
    anchor: 'prompt',
    group: 'aiKnowledge',
  },
  {
    icon: <LayoutTemplate className="size-4 md:size-6" />,
    anchor: 'template',
    group: 'aiKnowledge',
  },
  {
    icon: <ScanText className="size-4 md:size-6" />,
    anchor: 'imageMethod',
    group: 'mediaSearch',
  },
  {
    icon: <Volume2 className="size-4 md:size-6" />,
    anchor: 'audio',
    group: 'mediaSearch',
  },
  {
    icon: <Globe2 className="size-4 md:size-6" />,
    anchor: 'webSearch',
    group: 'mediaSearch',
  },
  {
    icon: <ImageUp className="size-4 md:size-6" />,
    anchor: 'imageHosting',
    group: 'syncData',
  },
  {
    icon: <DatabaseBackup className="size-4 md:size-6" />,
    anchor: 'sync',
    group: 'syncData',
  },
  {
    icon: <UserRoundCog className="size-4 md:size-6" />,
    anchor: 'dev',
    group: 'advanced',
  }
]

export default baseConfig

export type ModelType = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | 'rerank';

export interface ModelConfig {
  id: string
  model: string
  modelType: ModelType
  supportsImageInput?: boolean
  temperature?: number
  topP?: number
  contextWindow?: number
  voice?: string
  enableStream?: boolean
}

export interface AiConfig {
  key: string
  title: string
  enabled?: boolean
  apiKey?: string
  baseURL?: string
  templateKey?: string
  templateSource?: 'builtin' | 'remote' | 'custom'
  icon?: string
  apiKeyUrl?: string
  customHeaders?: Record<string, string>
  models?: ModelConfig[]
  // 保持向后兼容
  model?: string
  supportsImageInput?: boolean
  temperature?: number
  topP?: number
  contextWindow?: number
  modelType?: ModelType
  voice?: string
  speed?: number
  enableStream?: boolean
}

export interface Model {
  id: string
  object: string
  created: number
  owned_by: string
}

// Define base AI configuration without translations
const builtinProviderTemplates: AiConfig[] = [
  {
    key: 'chatgpt',
    title: 'ChatGPT',
    baseURL: 'https://api.openai.com/v1',
    icon: 'https://s2.loli.net/2025/06/25/cVMf586WTBYAju4.png',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    models: [
      {
        id: 'openai-whisper-1',
        model: 'whisper-1',
        modelType: 'stt',
      },
    ],
  },
  {
    key: 'siliconflow',
    title: 'SiliconFlow',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    models: [
      {
        id: 'siliconflow-sensevoice-small',
        model: 'FunAudioLLM/SenseVoiceSmall',
        modelType: 'stt',
      },
    ],
  },
  {
    key: 'zhipu',
    title: '智谱 BigModel',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    models: [
      {
        id: 'zhipu-glm-asr-2512',
        model: 'glm-asr-2512',
        modelType: 'stt',
      },
    ],
  },
  {
    key: 'groq',
    title: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyUrl: 'https://console.groq.com/keys',
    models: [
      {
        id: 'groq-whisper-large-v3-turbo',
        model: 'whisper-large-v3-turbo',
        modelType: 'stt',
      },
    ],
  },
  {
    key: 'gemini',
    title: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    icon: 'https://s2.loli.net/2025/06/25/JU2jVxLFsW4lB6S.png',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey'
  },
  {
    key: 'ollama',
    title: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    icon: 'https://s2.loli.net/2025/06/25/legkEpHACDBQ5Xz.png',
  },
  {
    key: 'lmstudio',
    title: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    icon: 'https://s2.loli.net/2025/06/25/IifFV4HTQ9dpGZE.png',
  },
]

function normalizeProviderBaseUrl(baseURL?: string) {
  return (baseURL || '').trim().replace(/\/+$/, '').toLowerCase()
}

export function getBuiltinProviderTemplateMatch(config: AiConfig | undefined) {
  if (!config) {
    return undefined
  }

  if (config.templateKey) {
    const matchedByTemplateKey = builtinProviderTemplates.find((template) => template.key === config.templateKey)
    if (matchedByTemplateKey) {
      return matchedByTemplateKey
    }
  }

  const normalizedBaseURL = normalizeProviderBaseUrl(config.baseURL)
  if (!normalizedBaseURL) {
    return undefined
  }

  return builtinProviderTemplates.find((template) => normalizeProviderBaseUrl(template.baseURL) === normalizedBaseURL)
}

function cloneTemplateModel(model: ModelConfig, existingIds: Set<string>) {
  let id = model.id
  let suffix = 2
  while (existingIds.has(id)) {
    id = `${model.id}-${suffix}`
    suffix += 1
  }

  existingIds.add(id)
  return { ...model, id }
}

export function mergeProviderTemplateModels(config: AiConfig) {
  const template = getBuiltinProviderTemplateMatch(config)
  const templateModels = template?.models?.filter((model) => model.model?.trim()) || []
  if (templateModels.length === 0) {
    return { config, changed: false }
  }

  const existingModels = config.models?.length
    ? config.models.map((model) => ({ ...model }))
    : config.model
      ? [
        {
          id: config.key,
          model: config.model,
          modelType: config.modelType || 'chat',
          supportsImageInput: config.supportsImageInput,
          temperature: config.temperature,
          topP: config.topP,
          contextWindow: config.contextWindow,
          voice: config.voice,
          enableStream: config.enableStream,
        } satisfies ModelConfig,
      ]
      : []

  const existingModelKeys = new Set(
    existingModels.map((model) => `${model.modelType}:${model.model.trim().toLowerCase()}`)
  )
  const existingIds = new Set(existingModels.map((model) => model.id))
  const missingModels = templateModels
    .filter((model) => !existingModelKeys.has(`${model.modelType}:${model.model.trim().toLowerCase()}`))
    .map((model) => cloneTemplateModel(model, existingIds))

  if (missingModels.length === 0 && config.models?.length) {
    return { config, changed: false }
  }

  return {
    config: {
      ...config,
      models: [...existingModels, ...missingModels],
    },
    changed: true,
  }
}

const baseAiConfig = builtinProviderTemplates

export { baseAiConfig, builtinProviderTemplates }
