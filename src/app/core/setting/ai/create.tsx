import { useState } from "react"
import { useTranslations } from "next-intl"
import { useLocalStorage } from "react-use"
import { v4 } from "uuid"
import { Store } from "@tauri-apps/plugin-store"
import { Plus, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import useSettingStore from "@/stores/setting"

import { AiConfig } from "../config"

interface CreateConfigProps {
  hasCustomModels?: boolean
  onConfigCreated?: (configId: string) => void
  className?: string
}

export default function CreateConfig({ hasCustomModels = false, onConfigCreated, className }: CreateConfigProps) {
  const t = useTranslations("settings.ai")
  const { setAiModelList } = useSettingStore()
  const [, setSelectedAiConfig] = useLocalStorage<string>("ai-config-selected", "")
  const [creating, setCreating] = useState(false)

  const createCustomConfig = async () => {
    if (creating) return
    setCreating(true)
    try {
      const store = await Store.load("store.json")
      const aiModelList = (await store.get<AiConfig[]>("aiModelList")) || []

      const id = v4()
      const newConfig: AiConfig = {
        key: id,
        title: t("custom"),
        baseURL: "",
        templateSource: "custom",
        modelType: "chat",
        temperature: 0.7,
        topP: 1,
        enabled: true,
      }

      const updatedList = [newConfig, ...aiModelList]
      await store.set("aiModelList", updatedList)
      await store.save()

      setAiModelList(updatedList)
      setSelectedAiConfig(id)
      onConfigCreated?.(id)
    } finally {
      setCreating(false)
    }
  }

  const createButton = (
    <Button onClick={createCustomConfig} disabled={creating}>
      <Plus />
      {creating ? "创建中..." : "自定义模型配置"}
    </Button>
  )

  if (hasCustomModels) {
    return <div className={cn("mb-6", className)}>{createButton}</div>
  }

  return (
    <Card className={cn("mb-6", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          {t("createSection.title")}
        </CardTitle>
        <CardDescription>{t("createSection.descWithoutModels")}</CardDescription>
      </CardHeader>
      <CardContent>{createButton}</CardContent>
    </Card>
  )
}