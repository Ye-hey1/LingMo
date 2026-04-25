'use client'

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

type MobileSheetMode = 'ai' | 'image-src' | 'image-alt' | 'table-align' | 'table-more' | null

interface MobileEditorMoreSheetProps {
  open: boolean
  mode: MobileSheetMode
  imageSrc: string
  imageAlt: string
  onOpenChange: (open: boolean) => void
  onImageSrcChange: (value: string) => void
  onImageAltChange: (value: string) => void
  onSubmitImageSrc: () => void
  onSubmitImageAlt: () => void
  onAction: (action: string) => void
}

function ActionButton({ label, onClick, destructive = false }: { label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      className={`w-full rounded-xl border px-3 py-3 text-left text-sm ${destructive ? 'border-destructive/30 text-destructive' : 'border-border text-foreground'}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function MobileEditorMoreSheet({
  open,
  mode,
  imageSrc,
  imageAlt,
  onOpenChange,
  onImageSrcChange,
  onImageAltChange,
  onSubmitImageSrc,
  onSubmitImageAlt,
  onAction,
}: MobileEditorMoreSheetProps) {
  const titleMap: Record<Exclude<MobileSheetMode, null>, string> = {
    ai: 'AI 处理',
    'image-src': '编辑图片地址',
    'image-alt': '编辑图片说明',
    'table-align': '表格对齐',
    'table-more': '更多表格操作',
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[80vh]">
        <DrawerHeader>
          <DrawerTitle>{mode ? titleMap[mode] : '更多操作'}</DrawerTitle>
        </DrawerHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-6">
          {mode === 'ai' && (
            <>
              <ActionButton label="润色选中文本" onClick={() => onAction('ai-polish')} />
              <ActionButton label="精简选中文本" onClick={() => onAction('ai-concise')} />
              <ActionButton label="扩写选中文本" onClick={() => onAction('ai-expand')} />
            </>
          )}

          {mode === 'image-src' && (
            <>
              <Input value={imageSrc} onChange={(event) => onImageSrcChange(event.target.value)} placeholder="输入图片地址" />
              <Button onClick={onSubmitImageSrc}>保存地址</Button>
            </>
          )}

          {mode === 'image-alt' && (
            <>
              <Input value={imageAlt} onChange={(event) => onImageAltChange(event.target.value)} placeholder="输入图片说明" />
              <Button onClick={onSubmitImageAlt}>保存说明</Button>
            </>
          )}

          {mode === 'table-align' && (
            <>
              <ActionButton label="左对齐" onClick={() => onAction('align-left')} />
              <ActionButton label="居中对齐" onClick={() => onAction('align-center')} />
              <ActionButton label="右对齐" onClick={() => onAction('align-right')} />
            </>
          )}

          {mode === 'table-more' && (
            <>
              <ActionButton label="在上方插入行" onClick={() => onAction('add-row-before')} />
              <ActionButton label="在下方插入行" onClick={() => onAction('add-row-after')} />
              <ActionButton label="在左侧插入列" onClick={() => onAction('add-column-before')} />
              <ActionButton label="在右侧插入列" onClick={() => onAction('add-column-after')} />
              <ActionButton label="删除当前行" onClick={() => onAction('delete-row')} destructive />
              <ActionButton label="删除当前列" onClick={() => onAction('delete-column')} destructive />
              <ActionButton label="删除整个表格" onClick={() => onAction('delete-table')} destructive />
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export default MobileEditorMoreSheet
