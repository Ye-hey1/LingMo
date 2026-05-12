"use client";

import dynamic from "next/dynamic";
import { Settings, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";

import { SettingTab } from "@/app/core/setting/components/setting-tab";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSettingsDialogStore, type SettingsDialogPage } from "@/stores/settings-dialog";

const pageLoadingFallback = () => (
  <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-muted-foreground">
    Loading...
  </div>
);

const settingsPageComponents: Record<SettingsDialogPage, ComponentType> = {
  about: dynamic(() => import("@/app/core/setting/about/page"), { loading: pageLoadingFallback, ssr: false }),
  general: dynamic(() => import("@/app/core/setting/general/page"), { loading: pageLoadingFallback, ssr: false }),
  chat: dynamic(() => import("@/app/core/setting/chat/page"), { loading: pageLoadingFallback, ssr: false }),
  editor: dynamic(() => import("@/app/core/setting/editor/page"), { loading: pageLoadingFallback, ssr: false }),
  record: dynamic(() => import("@/app/core/setting/record/page"), { loading: pageLoadingFallback, ssr: false }),
  sync: dynamic(() => import("@/app/core/setting/sync/page"), { loading: pageLoadingFallback, ssr: false }),
  imageHosting: dynamic(() => import("@/app/core/setting/imageHosting/page"), { loading: pageLoadingFallback, ssr: false }),
  ai: dynamic(() => import("@/app/core/setting/ai/page"), { loading: pageLoadingFallback, ssr: false }),
  rag: dynamic(() => import("@/app/core/setting/rag/page"), { loading: pageLoadingFallback, ssr: false }),
  mcp: dynamic(() => import("@/app/core/setting/mcp/page"), { loading: pageLoadingFallback, ssr: false }),
  skills: dynamic(() => import("@/app/core/setting/skills/page"), { loading: pageLoadingFallback, ssr: false }),
  prompt: dynamic(() => import("@/app/core/setting/prompt/page"), { loading: pageLoadingFallback, ssr: false }),
  memories: dynamic(() => import("@/app/core/setting/memories/page"), { loading: pageLoadingFallback, ssr: false }),
  template: dynamic(() => import("@/app/core/setting/template/page"), { loading: pageLoadingFallback, ssr: false }),
  file: dynamic(() => import("@/app/core/setting/file/page"), { loading: pageLoadingFallback, ssr: false }),
  shortcuts: dynamic(() => import("@/app/core/setting/shortcuts/page"), { loading: pageLoadingFallback, ssr: false }),
  imageMethod: dynamic(() => import("@/app/core/setting/imageMethod/page"), { loading: pageLoadingFallback, ssr: false }),
  audio: dynamic(() => import("@/app/core/setting/audio/page"), { loading: pageLoadingFallback, ssr: false }),
  webSearch: dynamic(() => import("@/app/core/setting/webSearch/page"), { loading: pageLoadingFallback, ssr: false }),
  dev: dynamic(() => import("@/app/core/setting/dev/page"), { loading: pageLoadingFallback, ssr: false }),
};

export function SettingsDialog() {
  const { isOpen, currentPage, close, setCurrentPage } = useSettingsDialogStore();
  const tCommon = useTranslations("common");
  const ActivePage = settingsPageComponents[currentPage];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (!open ? close() : undefined)}>
      <DialogContent
        showCloseButton={false}
        className="z-[10001] flex h-[min(88vh,820px)] w-[min(1220px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden border border-border/80 bg-background p-0 shadow-2xl"
      >
        <DialogTitle className="sr-only">{tCommon("settings")}</DialogTitle>
        <div className="flex min-h-0 w-full">
          <SettingTab currentPage={currentPage} onNavigate={(anchor) => setCurrentPage(anchor as SettingsDialogPage)} />
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between border-b bg-muted/15 px-5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Settings className="size-4 text-muted-foreground" />
                <span>{tCommon("settings")}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 rounded-md"
                aria-label="Close"
                onClick={close}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              <ActivePage />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
