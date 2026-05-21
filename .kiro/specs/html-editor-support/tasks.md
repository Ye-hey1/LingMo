# Implementation Plan: HTML Editor Support

## Overview

为 LingMo 笔记应用添加 HTML 文件编辑支持，包括 CodeMirror 代码编辑模式和 sandbox iframe 预览模式。实现遵循现有编辑器组件模式（markdown、diagram、pdf），复用已有的文件读写和 Tab 管理机制。

## Tasks

- [x] 1. 安装依赖并修改文件路由
  - [x] 1.1 安装 CodeMirror 相关依赖
    - 执行 `pnpm add codemirror @codemirror/lang-html @codemirror/view @codemirror/state`
    - 项目已有 `@codemirror/commands`，新增 HTML 语言支持和核心包
    - _Requirements: 2.1, 2.2_

  - [x] 1.2 修改 EditorLayout 文件路由逻辑
    - 在 `src/app/core/main/editor/editor-layout.tsx` 中：
    - 新增 `HTML_EXTENSIONS = new Set(['html', 'htm'])` 常量
    - 从 `MARKDOWN_EXTENSIONS` 集合中移除 `'html'`
    - 在 `getItemType` 函数中添加 HTML 扩展名检查（在 MARKDOWN_EXTENSIONS 检查之前）
    - 返回类型联合中添加 `'html'`
    - _Requirements: 1.1, 1.2_

- [x] 2. 实现 HTML 编辑器核心组件
  - [x] 2.1 创建 HtmlPreview 预览组件
    - 创建 `src/app/core/main/editor/html/html-preview.tsx`
    - 实现 `HtmlPreviewProps { content: string }` 接口
    - 使用 `<iframe srcDoc={content} sandbox="allow-same-origin">` 渲染
    - 不包含 `allow-scripts`、`allow-popups`、`allow-forms` 权限
    - 添加 `title="HTML Preview"` 无障碍属性
    - _Requirements: 3.1, 3.2_

  - [x] 2.2 创建 HtmlCodeEditor 代码编辑组件
    - 创建 `src/app/core/main/editor/html/html-code-editor.tsx`
    - 实现 `HtmlCodeEditorProps { content: string; onChange: (value: string) => void }` 接口
    - 配置 CodeMirror 6：`basicSetup`、`html()` 语言模式、`lineWrapping`
    - 通过 `EditorView.updateListener` 监听文档变更并调用 `onChange`
    - 设置编辑器高度 100%，scroller overflow auto
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.3 创建 HtmlEditor 主容器组件
    - 创建 `src/app/core/main/editor/html/html-editor.tsx`
    - 实现 `HtmlEditorProps { filePath: string; tabContentsRef: RefObject<Record<string, string>> }` 接口
    - 管理内部状态：`mode: 'code' | 'preview'`（默认 `'code'`）、`content: string`
    - 从 `useArticleStore` 获取 `currentArticle` 初始化内容
    - 实现 Mode Toggle 切换控件（代码/预览按钮）
    - 根据 `mode` 条件渲染 `HtmlCodeEditor` 或 `HtmlPreview`
    - 内容变更时调用 `saveCurrentArticle` 触发防抖保存
    - _Requirements: 2.3, 2.4, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 2.4 编写 Property Test: HTML 文件路由正确性
    - **Property 1: HTML 文件路由正确性**
    - 使用 `fast-check` 生成随机文件路径和扩展名
    - 验证 `.html`/`.htm` 扩展名返回 `'html'`，其他扩展名不返回 `'html'`
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 2.5 编写 Property Test: 编辑器内容状态同步
    - **Property 3: 编辑器内容状态同步**
    - 使用 `fast-check` 生成随机字符串作为文档变更
    - 验证 CodeMirror `onChange` 回调接收到完整的更新后文档内容
    - **Validates: Requirements 2.3**

  - [ ]* 2.6 编写 Property Test: 预览模式反映当前内容
    - **Property 4: 预览模式反映当前内容**
    - 使用 `fast-check` 生成随机 HTML 内容
    - 验证预览模式下 iframe 的 `srcdoc` 属性等于当前内容字符串
    - **Validates: Requirements 3.1, 3.3**

- [x] 3. Checkpoint - 确保核心组件正常工作
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 集成到 EditorLayout 并实现 Tab 管理
  - [x] 4.1 在 EditorLayout 中集成 HtmlEditor
    - 在 `editor-layout.tsx` 顶部添加 `HtmlEditor` 的 dynamic import
    - 在 `renderContentPanel` 函数中添加 `itemType === 'html'` 的渲染分支
    - 传入 `filePath={tab.path}` 和 `tabContentsRef={tabContentsRef}` props
    - 使用 `<Suspense>` 包裹，与其他编辑器组件模式一致
    - _Requirements: 1.1, 1.3, 5.1, 5.2_

  - [x] 4.2 实现 Tab 切换时的状态恢复
    - 在 `HtmlEditor` 中监听 `filePath` 变化，重新从 `currentArticle` 加载内容
    - 利用 `tabContentsRef` 缓存当前编辑内容，Tab 切回时恢复
    - 确保模式状态（code/preview）在 Tab 切换时保留
    - _Requirements: 5.3, 4.5_

  - [ ]* 4.3 编写 Property Test: 模式切换保留编辑内容
    - **Property 5: 模式切换保留编辑内容**
    - 使用 `fast-check` 生成随机 HTML 内容
    - 模拟 code → preview → code 切换，验证内容不变
    - **Validates: Requirements 4.2, 4.3, 4.5**

  - [ ]* 4.4 编写单元测试
    - 测试 HtmlEditor 默认以 code 模式渲染
    - 测试 Mode Toggle 切换后正确渲染对应子组件
    - 测试 iframe sandbox 属性包含 `allow-same-origin` 且不包含 `allow-scripts`
    - _Requirements: 3.2, 4.4_

- [x] 5. Final checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties defined in design document
- Unit tests validate specific examples and edge cases
- 项目使用 TypeScript + Next.js + Tauri 技术栈
- CodeMirror 相关依赖 `@codemirror/commands` 已存在于项目中
- 组件结构遵循现有 `editor/diagram/`、`editor/pdf/` 等目录模式

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "2.6", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4"] }
  ]
}
```
