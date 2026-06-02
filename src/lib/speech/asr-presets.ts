import type { AiConfig } from '@/app/core/setting/config'

export const OPENLESS_ASR_PRESETS: AiConfig[] = [
  {
    key: 'openless-siliconflow-asr',
    title: 'SiliconFlow SenseVoice',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
    templateKey: 'openless-siliconflow-asr',
    templateSource: 'custom',
    models: [
      {
        id: 'openless-siliconflow-sensevoice',
        model: 'FunAudioLLM/SenseVoiceSmall',
        modelType: 'stt',
      },
    ],
  },
  {
    key: 'openless-zhipu-asr',
    title: 'Zhipu GLM-ASR',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    templateKey: 'openless-zhipu-asr',
    templateSource: 'custom',
    models: [
      {
        id: 'openless-zhipu-glm-asr',
        model: 'glm-asr-2512',
        modelType: 'stt',
      },
    ],
  },
  {
    key: 'openless-groq-asr',
    title: 'Groq Whisper',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyUrl: 'https://console.groq.com/keys',
    templateKey: 'openless-groq-asr',
    templateSource: 'custom',
    models: [
      {
        id: 'openless-groq-whisper-large-v3-turbo',
        model: 'whisper-large-v3-turbo',
        modelType: 'stt',
      },
    ],
  },
  {
    key: 'openless-openai-asr',
    title: 'OpenAI Whisper',
    baseURL: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    templateKey: 'openless-openai-asr',
    templateSource: 'custom',
    models: [
      {
        id: 'openless-openai-whisper-1',
        model: 'whisper-1',
        modelType: 'stt',
      },
    ],
  },
]

export function getAsrPresetModelSelection(config: AiConfig) {
  const model = config.models?.find((item) => item.modelType === 'stt')
  return model?.id || config.key
}

export function getOpenLessAsrPresetKey(config: AiConfig | undefined) {
  if (!config) {
    return ''
  }

  const preset = OPENLESS_ASR_PRESETS.find((item) =>
    config.templateKey === item.key ||
    config.key === item.key ||
    config.key.startsWith(`${item.key}-`)
  )

  return preset?.key || ''
}

export function isOpenLessAsrPresetConfig(config: AiConfig | undefined) {
  return Boolean(getOpenLessAsrPresetKey(config))
}

export function isOpenLessAsrPresetReady(config: AiConfig | undefined) {
  if (!isOpenLessAsrPresetConfig(config)) {
    return false
  }

  const hasSttModel = config?.models?.some((item) =>
    item.modelType === 'stt' && Boolean(item.model?.trim())
  ) || (config?.modelType === 'stt' && Boolean(config.model?.trim()))

  return Boolean(
    config?.enabled !== false &&
    config?.baseURL?.trim() &&
    config?.apiKey?.trim() &&
    hasSttModel
  )
}
