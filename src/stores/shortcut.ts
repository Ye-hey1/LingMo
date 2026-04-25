import { create } from 'zustand';
import { Store } from "@tauri-apps/plugin-store";
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import emitter from '@/lib/emitter';

interface Shortcut {
  key: string,
  value: string,
}

interface SettingState {
  shortcuts: Shortcut[],
  initShortcut: () => Promise<void>,
  setShortcut: (key: string, value: string) => Promise<void>,
  resetDefault: (key: string) => Promise<void>,
}

const defaultShortcuts: Shortcut[] = [
  {
    key: "openWindow",
    value: "CommandOrControl+Shift+N"
  },
  {
    key: 'quickRecordText',
    value: 'CommandOrControl+Shift+E'
  }
]

let isInitializing = false

async function bindAllShortcuts(shortcuts: Shortcut[]) {
  await unregisterAll()
  for (const shortcut of shortcuts) {
    if (shortcut.value) {
      try {
        await register(shortcut.value, (event) => {
          if (event.state === 'Pressed') {
            emitter.emit(shortcut.key)
          }
        });
      } catch (error) {
        console.error(`Failed to register shortcut ${shortcut.value}:`, error);
      }
    }
  }
}

const useShortcutStore = create<SettingState>((set, get) => ({
  shortcuts: [],

  initShortcut: async () => {
    if (isInitializing) return
    isInitializing = true
    try {
    const store = await Store.load('store.json');
    // Force overwrite old shortcuts with new defaults to avoid hotkey conflicts
    await store.set('shortcuts', defaultShortcuts)
    set({ shortcuts: defaultShortcuts })
    await bindAllShortcuts(defaultShortcuts)
    } finally {
      isInitializing = false
    }
  },

  setShortcut: async (key: string, value: string) => {
    const store = await Store.load('store.json');
    const newShortcuts = get().shortcuts.map((shortcut) => {
      if (shortcut.key === key) {
        return { ...shortcut, value }
      }
      return shortcut
    })
    await store.set('shortcuts', newShortcuts)
    set({ shortcuts: newShortcuts })
    await bindAllShortcuts(newShortcuts)
  },

  resetDefault: async (key: string) => {
    const store = await Store.load('store.json');
    const newShortcuts = get().shortcuts.map((shortcut) => {
      if (shortcut.key === key) {
        return { ...shortcut, value: defaultShortcuts.find((shortcut) => shortcut.key === key)?.value || '' }
      }
      return shortcut
    })
    await store.set('shortcuts', newShortcuts)
    set({ shortcuts: newShortcuts })
    await bindAllShortcuts(newShortcuts)
  },
}))

export default useShortcutStore