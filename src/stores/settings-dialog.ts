import { create } from "zustand";

import useSettingStore from "@/stores/setting";

export type SettingsDialogPage =
  | "about"
  | "general"
  | "chat"
  | "editor"
  | "record"
  | "sync"
  | "imageHosting"
  | "ai"
  | "rag"
  | "mcp"
  | "skills"
  | "prompt"
  | "memories"
  | "template"
  | "file"
  | "shortcuts"
  | "imageMethod"
  | "audio"
  | "webSearch"
  | "dev";

const DEFAULT_SETTINGS_PAGE: SettingsDialogPage = "about";

const VALID_SETTINGS_PAGES = new Set<SettingsDialogPage>([
  "about",
  "general",
  "chat",
  "editor",
  "record",
  "sync",
  "imageHosting",
  "ai",
  "rag",
  "mcp",
  "skills",
  "prompt",
  "memories",
  "template",
  "file",
  "shortcuts",
  "imageMethod",
  "audio",
  "webSearch",
  "dev",
]);

function normalizeSettingsPage(page?: string): SettingsDialogPage {
  if (page && VALID_SETTINGS_PAGES.has(page as SettingsDialogPage)) {
    return page as SettingsDialogPage;
  }

  return DEFAULT_SETTINGS_PAGE;
}

interface SettingsDialogState {
  isOpen: boolean;
  currentPage: SettingsDialogPage;
  open: (page?: SettingsDialogPage) => void;
  close: () => void;
  setCurrentPage: (page: SettingsDialogPage) => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  isOpen: false,
  currentPage: normalizeSettingsPage(useSettingStore.getState().lastSettingPage),
  open: (page) =>
    set(() => {
      const targetPage = normalizeSettingsPage(page ?? useSettingStore.getState().lastSettingPage);
      void useSettingStore.getState().setLastSettingPage(targetPage);

      return {
        isOpen: true,
        currentPage: targetPage,
      };
    }),
  close: () => set({ isOpen: false }),
  setCurrentPage: (page) => {
    const targetPage = normalizeSettingsPage(page);
    void useSettingStore.getState().setLastSettingPage(targetPage);
    set({ currentPage: targetPage });
  },
}));
