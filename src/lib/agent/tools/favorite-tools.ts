import type { Tool } from '../types'

export const favoriteTools: Tool[] = []

export const listFavoritesTool: Tool = {
  name: 'list_favorites',
  description: 'List all favorited files. Returns file paths and names.',
  category: 'note',
  parameters: [],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['read'],
  execute: async () => {
    const { default: useFavoritesStore } = await import('@/stores/favorites')
    const { favorites, initFavorites } = useFavoritesStore.getState()
    await initFavorites()
    const current = useFavoritesStore.getState().favorites

    if (current.length === 0) {
      return {
        success: true,
        message: 'No favorites found.',
        data: [],
      }
    }

    const list = current.map(f => `- ${f.name} (${f.path})`).join('\n')
    return {
      success: true,
      message: `Found ${current.length} favorite(s):\n${list}`,
      data: current,
    }
  },
}

export const addFavoriteTool: Tool = {
  name: 'add_favorite',
  description: 'Add a file to favorites for quick access.',
  category: 'note',
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Path of the file to favorite' },
    { name: 'fileName', type: 'string', required: true, description: 'Display name of the file' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['write'],
  execute: async (params) => {
    const { default: useFavoritesStore } = await import('@/stores/favorites')
    await useFavoritesStore.getState().initFavorites()
    const store = useFavoritesStore.getState()

    if (store.isFavorite(params.filePath)) {
      return { success: true, message: `File "${params.fileName}" is already in favorites.` }
    }

    await store.addFavorite(params.filePath, params.fileName)
    return { success: true, message: `Added "${params.fileName}" to favorites.` }
  },
}

export const removeFavoriteTool: Tool = {
  name: 'remove_favorite',
  description: 'Remove a file from favorites.',
  category: 'note',
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Path of the file to remove from favorites' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['write'],
  execute: async (params) => {
    const { default: useFavoritesStore } = await import('@/stores/favorites')
    await useFavoritesStore.getState().initFavorites()
    const store = useFavoritesStore.getState()

    if (!store.isFavorite(params.filePath)) {
      return { success: true, message: `File "${params.filePath}" is not in favorites.` }
    }

    await store.removeFavorite(params.filePath)
    return { success: true, message: `Removed "${params.filePath}" from favorites.` }
  },
}

export const toggleFavoriteTool: Tool = {
  name: 'toggle_favorite',
  description: 'Toggle favorite status of a file (add if not favorited, remove if already favorited).',
  category: 'note',
  parameters: [
    { name: 'filePath', type: 'string', required: true, description: 'Path of the file' },
    { name: 'fileName', type: 'string', required: true, description: 'Display name of the file' },
  ],
  requiresConfirmation: false,
  risk: 'low',
  capabilities: ['write'],
  execute: async (params) => {
    const { default: useFavoritesStore } = await import('@/stores/favorites')
    await useFavoritesStore.getState().initFavorites()
    const store = useFavoritesStore.getState()

    const wasFavorite = store.isFavorite(params.filePath)
    await store.toggleFavorite(params.filePath, params.fileName)

    return {
      success: true,
      message: wasFavorite
        ? `Removed "${params.fileName}" from favorites.`
        : `Added "${params.fileName}" to favorites.`,
    }
  },
}

favoriteTools.push(listFavoritesTool, addFavoriteTool, removeFavoriteTool, toggleFavoriteTool)
