import { Input } from "@/components/ui/input";
import { useTranslations } from 'next-intl';
import useSettingStore from "@/stores/setting";
import { OpenBroswer } from "@/components/open-broswer";
import { SetDefault } from "./setDefault";
import { ScanText, Languages } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from "@/components/ui/item";
import { getInstalledOcrProviders, type OcrProviderPackage } from "@/lib/ocr-packages";

export function OcrSetting() {
  const t = useTranslations('settings.imageMethod.ocr');
  const { tesseractList, setTesseractList } = useSettingStore()
  const [providers, setProviders] = useState<OcrProviderPackage[]>([])
  const [loading, setLoading] = useState(true)
  const provider = providers[0]

  async function refreshProviders() {
    try {
      setProviders(await getInstalledOcrProviders())
    } catch (error) {
      console.warn('Failed to load OCR providers:', error)
      setProviders([])
    } finally {
      setLoading(false)
    }
  }

  async function changeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    await setTesseractList(e.target.value)
  }

  useEffect(() => {
    void refreshProviders()
  }, [])

  return (
    <>
      <Item variant="outline" className="max-md:flex-col max-md:items-start">
        <ItemMedia variant="icon"><ScanText className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('title')}</ItemTitle>
          <ItemDescription className="line-clamp-none">
            {provider ? t('desc') : t('noProviders')}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="max-md:w-full max-md:justify-start">
          <Badge variant={provider ? 'secondary' : 'outline'}>
            {loading ? t('checking') : provider ? t('ready') : t('unavailable')}
          </Badge>
          <SetDefault type="ocr" />
        </ItemActions>
        {provider && (
          <ItemFooter className="mt-1 border-t pt-3 text-xs text-muted-foreground max-md:flex-col max-md:items-start">
            <span>{t('provider')}: {provider.name || provider.id}</span>
            <span>{[provider.platform, provider.version || t('unknownVersion')].filter(Boolean).join(' · ')}</span>
          </ItemFooter>
        )}
      </Item>

      <Item variant="outline" className="max-md:flex-col max-md:items-start">
        <ItemMedia variant="icon"><Languages className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('languagePacks')}</ItemTitle>
          <ItemDescription className="line-clamp-none">{t('languageDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="w-80 max-md:w-full">
          <Input
            className="w-full"
            value={tesseractList}
            placeholder={t('languagePlaceholder')}
            onChange={changeHandler}
          />
        </ItemActions>
        <ItemFooter className="mt-1 border-t pt-3 text-xs text-muted-foreground max-md:flex-col max-md:items-start">
          <span>{t('modelInstruction')}</span>
          <OpenBroswer
            title={t('checkModels')}
            url="https://tesseract-ocr.github.io/tessdoc/Data-Files#data-files-for-version-400-november-29-2016"
          />
        </ItemFooter>
      </Item>
    </>
  )
}
