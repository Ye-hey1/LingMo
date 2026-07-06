import { Store } from '@tauri-apps/plugin-store'

export type StructuredExtractionMode = 'off' | 'manual' | 'onSave' | 'onIdle'

export interface StructuredSemanticExtractionSettings {
  mode: StructuredExtractionMode
  maxBlocks: number
  idleSeconds: number
  cooldownMinutes: number
  maxNotesPerRun: number
  dailyLimit: number
  costWarningAccepted: boolean
  privacyWarningAccepted: boolean
  model?: string
}

export const DEFAULT_STRUCTURED_SEMANTIC_EXTRACTION_SETTINGS: StructuredSemanticExtractionSettings = {
  mode: 'manual',
  maxBlocks: 40,
  idleSeconds: 20,
  cooldownMinutes: 60,
  maxNotesPerRun: 3,
  dailyLimit: 20,
  costWarningAccepted: false,
  privacyWarningAccepted: false,
  model: '',
}

function asMode(value: unknown): StructuredExtractionMode {
  return value === 'off' || value === 'manual' || value === 'onSave' || value === 'onIdle' ? value : 'manual'
}

function asBoundedInt(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.floor(numeric)))
}

export async function getStructuredSemanticExtractionSettings(): Promise<StructuredSemanticExtractionSettings> {
  const store = await Store.load('store.json')
  return {
    mode: asMode(await store.get('structuredExtractionMode')),
    maxBlocks: asBoundedInt(await store.get('structuredExtractionMaxBlocks'), 40, 1, 200),
    idleSeconds: asBoundedInt(await store.get('structuredExtractionIdleSeconds'), 20, 1, 600),
    cooldownMinutes: asBoundedInt(await store.get('structuredExtractionCooldownMinutes'), 60, 0, 10080),
    maxNotesPerRun: asBoundedInt(await store.get('structuredExtractionMaxNotesPerRun'), 3, 1, 20),
    dailyLimit: asBoundedInt(await store.get('structuredExtractionDailyLimit'), 20, 0, 500),
    costWarningAccepted: (await store.get('structuredExtractionCostWarningAccepted')) === true,
    privacyWarningAccepted: (await store.get('structuredExtractionPrivacyWarningAccepted')) === true,
    model: String(await store.get('structuredExtractionModel') || ''),
  }
}

export async function setStructuredSemanticExtractionSetting<K extends keyof StructuredSemanticExtractionSettings>(
  key: K,
  value: StructuredSemanticExtractionSettings[K],
) {
  const store = await Store.load('store.json')
  const storageKey = `structuredExtraction${key[0].toUpperCase()}${String(key).slice(1)}`
  await store.set(storageKey, value)
  await store.save()
}
