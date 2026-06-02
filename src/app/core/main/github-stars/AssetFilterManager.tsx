'use client'

import React, { useState, useMemo } from 'react'
import { Plus, Edit3, Trash2, Filter, ChevronDown, ChevronUp, X, Monitor, Apple, Smartphone, Package, Terminal, RotateCcw } from 'lucide-react'
import { useGithubStarsStore } from '@/stores/github-stars'
import { FilterModal } from './FilterModal'
import type { AssetFilter } from '@/types/github-stars'
import { PRESET_FILTERS } from './preset-filters'
import { confirm } from '@tauri-apps/plugin-dialog'
import { toast } from '@/hooks/use-toast'

// 图标映射
const ICON_MAP: Record<string, React.ElementType> = {
  Monitor,
  Apple,
  Smartphone,
  Package,
  Terminal,
}

// 图标名称映射（基于 PRESET_FILTERS 的 id）
const PRESET_ICON_MAP: Record<string, string> = {
  'preset-windows': 'Monitor',
  'preset-macos': 'Apple',
  'preset-linux': 'Terminal',
  'preset-android': 'Smartphone',
  'preset-source': 'Package',
}

// 默认预设筛选器（用于重置）
const DEFAULT_PRESET_FILTERS: AssetFilter[] = PRESET_FILTERS.map(pf => ({
  ...pf,
  isPreset: true,
  icon: PRESET_ICON_MAP[pf.id],
}))

interface AssetFilterManagerProps {
  selectedFilters: string[]
  onFilterToggle: (filterId: string) => void
  onClearFilters: () => void
}

export const AssetFilterManager: React.FC<AssetFilterManagerProps> = ({
  selectedFilters,
  onFilterToggle,
  onClearFilters
}) => {
  const {
    assetFilters,
    addAssetFilter,
    updateAssetFilter,
    deleteAssetFilter
  } = useGithubStarsStore()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingFilter, setEditingFilter] = useState<AssetFilter | undefined>()
  const [isExpanded, setIsExpanded] = useState(false)

  // 归一化 assetFilters：匹配预设标识的项设为 isPreset=true
  const normalizedFilters = useMemo(() => assetFilters.map(f => {
    const isPresetId = PRESET_ICON_MAP[f.id] !== undefined
    if (isPresetId && !f.isPreset) {
      return { ...f, isPreset: true }
    }
    return f
  }), [assetFilters])

  // 分离预设筛选器和自定义筛选器
  const presetFilters = normalizedFilters.filter(f => f.isPreset)
  const customFilters = normalizedFilters.filter(f => !f.isPreset)

  const handleCreateFilter = () => {
    setEditingFilter(undefined)
    setIsModalOpen(true)
  }

  const handleEditFilter = (filter: AssetFilter) => {
    setEditingFilter(filter)
    setIsModalOpen(true)
  }

  const handleDeleteFilter = async (filterId: string) => {
    const confirmed = await confirm(
      '确定要删除这个过滤器吗？',
      {
        title: '删除过滤器',
        kind: 'warning',
        okLabel: '删除',
        cancelLabel: '取消'
      }
    )

    if (!confirmed) return

    deleteAssetFilter(filterId)
    if (selectedFilters.includes(filterId)) {
      onFilterToggle(filterId)
    }
  }

  const handleSaveFilter = (filter: AssetFilter) => {
    if (editingFilter) {
      updateAssetFilter(filter.id, filter)
    } else {
      addAssetFilter(filter)
    }
  }

  const handlePresetToggle = (presetId: string) => {
    onFilterToggle(presetId)
  }

  const handleResetPresets = async () => {
    const confirmed = await confirm(
      '确定要重置所有预设筛选器吗？这将恢复默认设置。',
      {
        title: '重置预设',
        kind: 'warning',
        okLabel: '重置',
        cancelLabel: '取消'
      }
    )

    if (!confirmed) return

    const previousFilters = assetFilters.map(f => ({ ...f }))
    const previousSelected = [...selectedFilters]
    const addedFilterIds: string[] = []

    try {
      const store = useGithubStarsStore.getState()
      presetFilters.forEach(filter => {
        if (store.assetFilters.find(f => f.id === filter.id)) {
          deleteAssetFilter(filter.id)
        }
        if (selectedFilters.includes(filter.id)) {
          onFilterToggle(filter.id)
        }
      })
      DEFAULT_PRESET_FILTERS.forEach(filter => {
        if (!store.assetFilters.find(f => f.id === filter.id)) {
          addAssetFilter(filter)
          addedFilterIds.push(filter.id)
        }
      })
      // 恢复旧的有匹配到的 preset 选择
      previousSelected.forEach(id => {
        if (DEFAULT_PRESET_FILTERS.some(f => f.id === id) && !selectedFilters.includes(id)) {
          onFilterToggle(id)
        }
      })
    } catch (error) {
      console.error('Failed to reset presets:', error)
      const store = useGithubStarsStore.getState()

      addedFilterIds.forEach(id => {
        if (store.assetFilters.find(f => f.id === id)) {
          deleteAssetFilter(id)
        }
      })

      previousFilters.forEach(filter => {
        if (!store.assetFilters.find(f => f.id === filter.id)) {
          addAssetFilter(filter)
        }
      })

      // 清除当前所有选择，并恢复之前的选择
      selectedFilters.forEach(id => onFilterToggle(id))
      previousSelected.forEach(id => onFilterToggle(id))

      toast({
        title: '重置失败',
        description: '重置预设筛选器失败，已恢复之前的状态。',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      {/* Compact Header with Toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center space-x-2 px-3 py-2 bg-muted rounded-lg hover:bg-muted/80 transition-all group"
          title={isExpanded ? '收起过滤器' : '展开过滤器'}
          type="button"
          aria-expanded={isExpanded}
          aria-controls="asset-filter-panel"
        >
          <Filter className={`w-4 h-4 text-muted-foreground transition-transform ${
            isExpanded ? 'text-primary' : ''
          }`} aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">
            资源包过滤器
          </span>
          {selectedFilters.length > 0 && (
            <span className="px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
              {selectedFilters.length}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          )}
        </button>

        <div className="flex items-center space-x-2">
          {selectedFilters.length > 0 && (
            <button
              onClick={onClearFilters}
              className="flex items-center space-x-1 px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted rounded-lg transition-colors"
              title="清除所有筛选"
              type="button"
              aria-label="清除所有筛选"
            >
              <X className="w-3 h-3" aria-hidden="true" />
              <span className="hidden sm:inline">清除所有筛选</span>
            </button>
          )}
          <button
            onClick={handleCreateFilter}
            className="flex items-center space-x-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm"
            title="新建过滤器"
            type="button"
            aria-label="新建过滤器"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">新建</span>
          </button>
        </div>
      </div>

      {/* Expandable Content */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div id="asset-filter-panel" className="space-y-3 pt-2">
            {/* Preset Filters */}
            {presetFilters.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-muted-foreground">
                    预设筛选器 (匹配特定格式资源包)
                  </p>
                  <button
                    onClick={handleResetPresets}
                    className="flex items-center space-x-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    title="重置预设筛选器"
                    type="button"
                    aria-label="重置预设筛选器"
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    <span>重置</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {presetFilters.map(preset => {
                    const Icon = preset.icon ? ICON_MAP[preset.icon] : Filter
                    const isSelected = selectedFilters.includes(preset.id)
                    return (
                      <div
                        key={preset.id}
                        className={`group flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                          isSelected
                            ? 'bg-primary border-transparent text-primary-foreground font-medium'
                            : 'bg-background border-border text-foreground hover:bg-muted'
                        }`}
                      >
                        <button
                          onClick={() => handlePresetToggle(preset.id)}
                          className="flex items-center space-x-1.5"
                          title={preset.keywords.join(', ')}
                          type="button"
                          aria-pressed={isSelected}
                        >
                          {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
                          <span>{preset.name}</span>
                        </button>

                        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ml-1">
                          <button
                            onClick={() => handleEditFilter(preset)}
                            className="p-0.5 rounded hover:bg-white/20 transition-colors"
                            title="编辑"
                            type="button"
                            aria-label="编辑"
                          >
                            <Edit3 className="w-3 h-3" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Custom Filters */}
            {customFilters.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  自定义筛选器
                </p>
                <div className="flex flex-wrap gap-2">
                  {customFilters.map(filter => {
                    const isSelected = selectedFilters.includes(filter.id)
                    return (
                      <div
                        key={filter.id}
                        className={`group flex items-center space-x-2 px-3 py-1.5 rounded-lg border transition-colors ${
                          isSelected
                            ? 'bg-primary border-transparent text-primary-foreground font-medium'
                            : 'bg-background border-border text-foreground hover:bg-muted'
                        }`}
                      >
                        <button
                          onClick={() => onFilterToggle(filter.id)}
                          className="flex items-center space-x-2 flex-1 text-left"
                          aria-pressed={isSelected}
                          aria-label={`${filter.name} (${filter.keywords.join(', ')})`}
                          title={`${filter.name} (${filter.keywords.join(', ')})`}
                          type="button"
                        >
                          <span className="font-medium text-xs">{filter.name}</span>
                          <span className="text-[10px] opacity-75 hidden lg:inline">
                            ({filter.keywords.join(', ')})
                          </span>
                        </button>
                        
                        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEditFilter(filter)}
                            className="p-0.5 rounded hover:bg-white/20 transition-colors"
                            title="编辑"
                            type="button"
                            aria-label="编辑"
                          >
                            <Edit3 className="w-3 h-3" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => handleDeleteFilter(filter.id)}
                            className="p-0.5 rounded hover:bg-white/20 transition-colors text-destructive"
                            title="删除"
                            type="button"
                            aria-label="删除"
                          >
                            <Trash2 className="w-3 h-3" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {presetFilters.length === 0 && customFilters.length === 0 && (
              <div className="text-center py-4 bg-muted/30 rounded-lg border-2 border-dashed border-border">
                <p className="text-xs text-muted-foreground">
                  暂无资源包过滤器，点击“新建”创建
                </p>
              </div>
            )}

            {selectedFilters.length > 0 && (
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  已启用 {selectedFilters.length} 个资产过滤器
                </span>
                <button
                  onClick={onClearFilters}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  type="button"
                  aria-label="清除所有筛选"
                >
                  清除所有筛选
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filter Modal */}
      <FilterModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        filter={editingFilter}
        onSave={handleSaveFilter}
      />
    </div>
  )
}
