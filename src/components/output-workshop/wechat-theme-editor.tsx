"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "@/hooks/use-toast"
import {
  BASE_READABLE_STYLES,
  type WechatElementStyle,
  saveCustomWechatTheme,
  type CustomWechatTheme,
} from "@/lib/output-workshop/wechat-styles"
import { renderWechatMarkdown } from "@/lib/output-workshop/wechat-markdown-renderer"

/** 可编辑的元素列表（按常用度排序，配中文标签） */
const EDITABLE_ELEMENTS: Array<{ id: WechatElementStyle; label: string }> = [
  { id: "container", label: "整体容器" },
  { id: "h1", label: "一级标题 H1" },
  { id: "h2", label: "二级标题 H2" },
  { id: "h3", label: "三级标题 H3" },
  { id: "p", label: "正文段落" },
  { id: "strong", label: "加粗" },
  { id: "a", label: "链接" },
  { id: "blockquote", label: "引用" },
  { id: "ul", label: "无序列表" },
  { id: "ol", label: "有序列表" },
  { id: "li", label: "列表项" },
  { id: "code", label: "行内代码" },
  { id: "pre", label: "代码块" },
  { id: "hr", label: "分割线" },
  { id: "img", label: "图片" },
  { id: "table", label: "表格" },
  { id: "th", label: "表头" },
  { id: "td", label: "单元格" },
]

/** 预览用的示例 Markdown（覆盖标题、正文、列表、代码、引用、表格） */
const PREVIEW_MARKDOWN = [
  "# 示例标题",
  "",
  "这是一段正文，用于预览**加粗**、`行内代码`和[链接](https://example.com)的样式效果。",
  "",
  "## 二级标题",
  "",
  "- 列表项一",
  "- 列表项二",
  "",
  "> 这是一段引用文字",
  "",
  "| 列 A | 列 B |",
  "| --- | --- |",
  "| 单元 | 单元 |",
  "",
  "```js",
  'const msg = "代码块预览"',
  "```",
].join("\n")

export interface WechatThemeEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑已有主题时传入；新建时不传 */
  initialTheme?: CustomWechatTheme | null
  /** 保存成功后回调（通常用于刷新模板列表） */
  onSaved?: (themeId: string) => void
}

export function WechatThemeEditor({
  open,
  onOpenChange,
  initialTheme,
  onSaved,
}: WechatThemeEditorProps) {
  const [themeName, setThemeName] = React.useState("")
  // styles 状态：完整的元素样式表
  const [styles, setStyles] = React.useState<Record<WechatElementStyle, string>>(
    BASE_READABLE_STYLES
  )
  const [selectedElement, setSelectedElement] = React.useState<WechatElementStyle>("h2")
  const [cssDraft, setCssDraft] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  // 记录当前编辑的主题 id（编辑已有主题时保留，新建时为空）
  const editingIdRef = React.useRef<string | null>(null)

  // 打开时初始化状态
  React.useEffect(() => {
    if (!open) return
    if (initialTheme) {
      editingIdRef.current = initialTheme.id
      setThemeName(initialTheme.name)
      setStyles({ ...BASE_READABLE_STYLES, ...initialTheme.styles })
    } else {
      editingIdRef.current = null
      setThemeName("")
      setStyles({ ...BASE_READABLE_STYLES })
    }
    setSelectedElement("h2")
  }, [open, initialTheme])

  // 切换选中元素时，同步 CSS 草稿为该元素的当前样式
  React.useEffect(() => {
    setCssDraft(styles[selectedElement] || "")
  }, [selectedElement, styles])

  // 把当前 CSS 草稿提交到 styles 状态（失焦或切换元素时）
  const commitCssDraft = React.useCallback(() => {
    setStyles((prev) => ({ ...prev, [selectedElement]: cssDraft }))
  }, [cssDraft, selectedElement])

  const handleElementChange = (value: WechatElementStyle) => {
    commitCssDraft()
    setSelectedElement(value)
  }

  // 实时预览 HTML（用当前 styles 渲染示例 markdown）
  const previewHtml = React.useMemo(() => {
    return renderWechatMarkdown({ markdown: PREVIEW_MARKDOWN, styles })
  }, [styles])

  const handleSave = async () => {
    const trimmedName = themeName.trim()
    if (!trimmedName) {
      toast({ title: "请输入主题名称", variant: "destructive" })
      return
    }
    // 提交当前编辑中的 CSS 草稿
    const finalStyles = { ...styles, [selectedElement]: cssDraft }
    setSaving(true)
    try {
      const id = saveCustomWechatTheme({
        id: editingIdRef.current || `${trimmedName}-${Date.now()}`,
        name: trimmedName,
        styles: finalStyles,
      })
      toast({ title: "自定义主题已保存", description: trimmedName })
      onSaved?.(id)
      onOpenChange(false)
    } catch (error) {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[min(960px,94vw)] flex-col gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>
            {initialTheme ? "编辑微信主题" : "新建微信主题"}
          </DialogTitle>
          <DialogDescription>
            自定义各元素的 CSS 样式，保存后会出现在「一键排版」模板列表中。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 md:grid-cols-2">
          {/* 左侧：元素选择 + CSS 编辑 */}
          <div className="flex min-h-0 flex-col gap-3 border-b p-4 md:border-b-0 md:border-r">
            <div className="grid gap-1.5">
              <Label htmlFor="wechat-theme-name" className="text-xs">主题名称</Label>
              <Input
                id="wechat-theme-name"
                value={themeName}
                onChange={(e) => setThemeName(e.target.value)}
                placeholder="例如：我的专属主题"
                className="h-8 text-sm"
              />
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">编辑元素</Label>
              <Select value={selectedElement} onValueChange={(v) => handleElementChange(v as WechatElementStyle)}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EDITABLE_ELEMENTS.map((el) => (
                    <SelectItem key={el.id} value={el.id} className="text-sm">
                      {el.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <Label className="text-xs">
                CSS 样式（<code className="font-mono text-[10px]">{selectedElement}</code>）
              </Label>
              <textarea
                value={cssDraft}
                onChange={(e) => setCssDraft(e.target.value)}
                onBlur={commitCssDraft}
                spellCheck={false}
                className="min-h-[180px] flex-1 resize-none rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground [scrollbar-width:thin] focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="font-size: 24px; color: #333; ..."
              />
            </div>
          </div>

          {/* 右侧：实时预览 */}
          <div className="flex min-h-0 flex-col">
            <div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">实时预览</div>
            <ScrollArea className="min-h-0 flex-1 bg-[#f4f5f7]">
              <div
                className="p-4"
                style={{ background: "#fff", minHeight: "100%" }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "保存中…" : "保存主题"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
