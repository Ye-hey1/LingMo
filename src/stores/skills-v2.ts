'use client'

import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export interface SkillRecord {
  id: string
  name: string
  description: string | null
  source_type: string
  source_ref: string | null
  central_path: string
  content_hash: string | null
  enabled: boolean
  status: string
  update_status: string
  created_at: number
  updated_at: number
}

export interface DiscoveredSkill {
  id: string
  tool_key: string
  found_path: string
  name_guess: string | null
  fingerprint: string | null
  imported: boolean
  discovered_at: number
}

export interface ScenarioRecord {
  id: string
  name: string
  description: string | null
  icon: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

export interface ScanResult {
  discovered: DiscoveredSkill[]
  total_scanned: number
  new_count: number
}

export interface PreviewSkill {
  name: string
  path: string
  description: string | null
}

export interface MarketSkill {
  id: string
  skill_id: string
  name: string
  source: string
  installs: number
}

interface SkillsV2State {
  skills: SkillRecord[]
  discovered: DiscoveredSkill[]
  scenarios: ScenarioRecord[]
  activeScenarioId: string | null
  scenarioSkills: SkillRecord[]
  loading: boolean
  scanning: boolean
  installing: boolean
  previewing: boolean
  previewSkills: PreviewSkill[]
  marketSkills: MarketSkill[]
  marketLoading: boolean
  marketSearchLoading: boolean

  fetchSkills: () => Promise<void>
  deleteSkill: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean) => Promise<void>
  scan: () => Promise<ScanResult>
  fetchDiscovered: () => Promise<void>
  importDiscovered: (id: string) => Promise<SkillRecord>
  fetchScenarios: () => Promise<void>
  createScenario: (name: string, description?: string, icon?: string) => Promise<ScenarioRecord>
  deleteScenario: (id: string) => Promise<void>
  switchScenario: (id: string | null) => Promise<void>
  fetchActiveScenario: () => Promise<void>
  addToScenario: (scenarioId: string, skillId: string) => Promise<void>
  removeFromScenario: (scenarioId: string, skillId: string) => Promise<void>
  fetchScenarioSkills: (scenarioId: string) => Promise<void>
  installFromGit: (url: string, name?: string) => Promise<SkillRecord>
  installFromArchive: (path: string) => Promise<SkillRecord>
  installFromLocalDir: (path: string, name?: string) => Promise<SkillRecord>
  previewGit: (url: string) => Promise<PreviewSkill[]>
  fetchLeaderboard: (board: string) => Promise<MarketSkill[]>
  searchMarket: (query: string, limit?: number) => Promise<MarketSkill[]>
  installFromMarket: (source: string, skillId: string) => Promise<SkillRecord>
}

export const useSkillsV2Store = create<SkillsV2State>((set, get) => ({
  skills: [],
  discovered: [],
  scenarios: [],
  activeScenarioId: null,
  scenarioSkills: [],
  loading: false,
  scanning: false,
  installing: false,
  previewing: false,
  previewSkills: [],
  marketSkills: [],
  marketLoading: false,
  marketSearchLoading: false,

  fetchSkills: async () => {
    set({ loading: true })
    try {
      const skills = await invoke<SkillRecord[]>('skill_v2_get_all')
      set({ skills })
    } finally {
      set({ loading: false })
    }
  },

  deleteSkill: async (id) => {
    await invoke('skill_v2_delete', { id })
    const skills = get().skills.filter(s => s.id !== id)
    set({ skills })
  },

  setEnabled: async (id, enabled) => {
    await invoke('skill_v2_set_enabled', { id, enabled })
    const skills = get().skills.map(s => s.id === id ? { ...s, enabled } : s)
    set({ skills })
  },

  scan: async () => {
    set({ scanning: true })
    try {
      const result = await invoke<ScanResult>('skill_v2_scan')
      set({ discovered: result.discovered })
      return result
    } finally {
      set({ scanning: false })
    }
  },

  fetchDiscovered: async () => {
    const discovered = await invoke<DiscoveredSkill[]>('skill_v2_get_discovered')
    set({ discovered })
  },

  importDiscovered: async (id) => {
    const record = await invoke<SkillRecord>('skill_v2_import_discovered', { discoveredId: id })
    set({
      skills: [record, ...get().skills],
      discovered: get().discovered.map(d => d.id === id ? { ...d, imported: true } : d),
    })
    return record
  },

  fetchScenarios: async () => {
    const scenarios = await invoke<ScenarioRecord[]>('skill_v2_get_scenarios')
    set({ scenarios })
  },

  createScenario: async (name, description, icon) => {
    const record = await invoke<ScenarioRecord>('skill_v2_create_scenario', { name, description, icon })
    set({ scenarios: [...get().scenarios, record] })
    return record
  },

  deleteScenario: async (id) => {
    await invoke('skill_v2_delete_scenario', { id })
    set({
      scenarios: get().scenarios.filter(s => s.id !== id),
      activeScenarioId: get().activeScenarioId === id ? null : get().activeScenarioId,
    })
  },

  switchScenario: async (id) => {
    await invoke('skill_v2_switch_scenario', { scenarioId: id })
    set({ activeScenarioId: id })
    if (id) {
      await get().fetchScenarioSkills(id)
    } else {
      set({ scenarioSkills: [] })
    }
  },

  fetchActiveScenario: async () => {
    const activeScenarioId = await invoke<string | null>('skill_v2_get_active_scenario')
    set({ activeScenarioId })
    if (activeScenarioId) {
      await get().fetchScenarioSkills(activeScenarioId)
    }
  },

  addToScenario: async (scenarioId, skillId) => {
    await invoke('skill_v2_add_to_scenario', { scenarioId, skillId })
    if (get().activeScenarioId === scenarioId) {
      await get().fetchScenarioSkills(scenarioId)
    }
  },

  removeFromScenario: async (scenarioId, skillId) => {
    await invoke('skill_v2_remove_from_scenario', { scenarioId, skillId })
    set({ scenarioSkills: get().scenarioSkills.filter(s => s.id !== skillId) })
  },

  fetchScenarioSkills: async (scenarioId) => {
    const scenarioSkills = await invoke<SkillRecord[]>('skill_v2_get_scenario_skills', { scenarioId })
    set({ scenarioSkills })
  },

  installFromGit: async (url, name) => {
    set({ installing: true })
    try {
      const record = await invoke<SkillRecord>('skill_v2_install_git', { url, name: name ?? null })
      set({ skills: [record, ...get().skills] })
      return record
    } finally {
      set({ installing: false })
    }
  },

  installFromArchive: async (path) => {
    set({ installing: true })
    try {
      const record = await invoke<SkillRecord>('skill_v2_install_archive', { path })
      set({ skills: [record, ...get().skills] })
      return record
    } finally {
      set({ installing: false })
    }
  },

  installFromLocalDir: async (path, name) => {
    set({ installing: true })
    try {
      const record = await invoke<SkillRecord>('skill_v2_install_local_dir', { path, name: name ?? null })
      set({ skills: [record, ...get().skills] })
      return record
    } finally {
      set({ installing: false })
    }
  },

  previewGit: async (url) => {
    set({ previewing: true, previewSkills: [] })
    try {
      const skills = await invoke<PreviewSkill[]>('skill_v2_preview_git', { url })
      set({ previewSkills: skills })
      return skills
    } finally {
      set({ previewing: false })
    }
  },

  fetchLeaderboard: async (board) => {
    set({ marketLoading: true })
    try {
      const skills = await invoke<MarketSkill[]>('skill_v2_fetch_leaderboard', { board })
      set({ marketSkills: skills })
      return skills
    } finally {
      set({ marketLoading: false })
    }
  },

  searchMarket: async (query, limit) => {
    set({ marketSearchLoading: true })
    try {
      const skills = await invoke<MarketSkill[]>('skill_v2_search_skillssh', {
        query,
        limit: limit ?? 60,
      })
      set({ marketSkills: skills })
      return skills
    } finally {
      set({ marketSearchLoading: false })
    }
  },

  installFromMarket: async (source, skillId) => {
    set({ installing: true })
    try {
      const record = await invoke<SkillRecord>('skill_v2_install_from_skillssh', {
        source,
        skillId,
      })
      set({ skills: [record, ...get().skills] })
      return record
    } finally {
      set({ installing: false })
    }
  },
}))
