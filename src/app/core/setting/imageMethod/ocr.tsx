import { Input } from "@/components/ui/input";
import { FormItem } from "../components/setting-base";
import { useTranslations } from 'next-intl';
import useSettingStore from "@/stores/setting";
import { OpenBroswer } from "@/components/open-broswer";
import { SetDefault } from "./setDefault";

export function OcrSetting() {
  const t = useTranslations('settings.imageMethod.ocr');
  const { tesseractList, setTesseractList } = useSettingStore()

  async function changeHandler(e: React.ChangeEvent<HTMLInputElement>) {
    await setTesseractList(e.target.value)
  }

  return (
    <div className="space-y-8">
      <FormItem title={t('languagePacks')}>
        <Input value={tesseractList} onChange={changeHandler} />
      </FormItem>
      <div>
        <span>
          <OpenBroswer title={t('checkModels')} url="https://tesseract-ocr.github.io/tessdoc/Data-Files#data-files-for-version-400-november-29-2016" />
          {t('modelInstruction')}
        </span>
      </div>
      <SetDefault type="ocr" />
    </div>
  )
}
