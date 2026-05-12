import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'

const FAVORITES_KEY = 'favoriteFiles'

export interface FavoriteFile {
  path: string
  name: string
  addedAt: number
}

interface FavoritesState {
  favorites: FavoriteFile[]
  initFavorites: () => Promise<void>
  addFavorite: (path: string, name: string) => Promise<void>
  removeFavorite: (path: string) => Promise<void>
  isFavorite: (path: string) => boolean
  toggleFavorite: (path: string, name: string) => Promise<void>
}

const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: [],

  initFavorites: async () => {
    const store = await Store.load('store.json')
    const favorites = await store.get<FavoriteFile[]>(FAVORITES_KEY) || []
    set({ favorites })
  },

  addFavorite: async (path: string, name: string) => {
    const { favorites } = get()
    if (favorites.some(f => f.path === path)) return

    const newFavorites = [...favorites, { path, name, addedAt: Date.now() }]
    set({ favorites: newFavorites })

    const store = await Store.load('store.json')
    await store.set(FAVORITES_KEY, newFavorites)
    await store.save()
  },

  removeFavorite: async (path: string) => {
    const newFavorites = get().favorites.filter(f => f.path !== path)
    set({ favorites: newFavorites })

    const store = await Store.load('store.json')
    await store.set(FAVORITES_KEY, newFavorites)
    await store.save()
  },

  isFavorite: (path: string) => {
    return get().favorites.some(f => f.path === path)
  },

  toggleFavorite: async (path: string, name: string) => {
    const { favorites, addFavorite, removeFavorite } = get()
    if (favorites.some(f => f.path === path)) {
      await removeFavorite(path)
    } else {
      await addFavorite(path, name)
    }
  },
}))

export default useFavoritesStore
