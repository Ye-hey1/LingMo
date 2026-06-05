'use client';
import { ImageIcon } from "lucide-react"
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { SettingType } from '../components/setting-base';
import { VlmSetting } from "./vlm";
import useSettingStore from "@/stores/setting";

export default function ImageMethod() {
  const t = useTranslations('settings.imageMethod');
  const { setEnableImageRecognition, setPrimaryImageMethod } = useSettingStore()

  // 默认启用识别 + VLM 模型识别（不再暴露开关和 Tabs）
  useEffect(() => {
    setEnableImageRecognition(true)
    setPrimaryImageMethod('vlm')
  }, [setEnableImageRecognition, setPrimaryImageMethod])

  return (
    <SettingType id="sync" icon={<ImageIcon />} title={t('title')} desc={t('desc')}>
      <VlmSetting />
    </SettingType>
  )
}
