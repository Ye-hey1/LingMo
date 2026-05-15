# Requirements Document

## Introduction

本文档定义了 LingMo 笔记应用中 HTML 格式文件编辑支持功能的需求。该功能允许用户在编辑器中打开 `.html` 文件，并在代码模式（查看/编辑 HTML 源代码）和预览模式（渲染 HTML 并显示效果）之间切换。

## Glossary

- **Editor_Layout**: 编辑器布局组件，负责根据文件类型路由到对应的编辑器组件
- **HTML_Editor**: HTML 编辑器组件，提供代码编辑和预览渲染两种模式
- **Code_Mode**: 代码模式，使用 CodeMirror 显示和编辑 HTML 源代码
- **Preview_Mode**: 预览模式，将 HTML 内容渲染为可视化页面展示
- **Mode_Toggle**: 模式切换控件，允许用户在代码模式和预览模式之间切换
- **File_Store**: 文件存储层，负责通过 Tauri 文件系统插件读写工作区中的文件
- **Sandbox_Frame**: 沙箱 iframe，用于安全地渲染用户 HTML 内容，隔离主应用环境

## Requirements

### Requirement 1: HTML 文件识别与路由

**User Story:** 作为用户，我希望在文件树中点击 `.html` 文件时能够使用专用的 HTML 编辑器打开，以便获得针对 HTML 的编辑和预览体验。

#### Acceptance Criteria

1. WHEN 用户在文件树中选择一个 `.html` 或 `.htm` 扩展名的文件, THE Editor_Layout SHALL 将该文件路由到 HTML_Editor 组件进行展示
2. THE Editor_Layout SHALL 将 `.html` 和 `.htm` 扩展名从现有的 MARKDOWN_EXTENSIONS 集合中移除，归入独立的 HTML 扩展名集合
3. WHEN HTML_Editor 组件加载时, THE File_Store SHALL 读取文件的完整文本内容并传递给 HTML_Editor

### Requirement 2: 代码模式编辑

**User Story:** 作为用户，我希望在代码模式下查看和编辑 HTML 源代码，以便精确控制 HTML 结构和内容。

#### Acceptance Criteria

1. WHEN HTML_Editor 处于代码模式, THE Code_Mode SHALL 使用 CodeMirror 编辑器显示 HTML 源代码
2. WHEN HTML_Editor 处于代码模式, THE Code_Mode SHALL 提供 HTML 语法高亮
3. WHEN 用户在代码模式中修改内容, THE Code_Mode SHALL 实时更新内部状态以保存当前编辑内容
4. WHEN 用户在代码模式中修改内容并触发保存操作, THE File_Store SHALL 将修改后的内容写回原文件路径

### Requirement 3: 预览模式渲染

**User Story:** 作为用户，我希望在预览模式下看到 HTML 渲染后的效果，以便直观地检查页面呈现。

#### Acceptance Criteria

1. WHEN HTML_Editor 处于预览模式, THE Preview_Mode SHALL 在 Sandbox_Frame 中渲染当前 HTML 内容
2. THE Sandbox_Frame SHALL 使用 `sandbox` 属性限制脚本执行和外部资源加载，确保主应用安全
3. WHEN HTML 内容在代码模式中被修改后切换到预览模式, THE Preview_Mode SHALL 显示最新修改后的内容

### Requirement 4: 模式切换

**User Story:** 作为用户，我希望能够在代码模式和预览模式之间自由切换，以便在编辑和预览之间快速迭代。

#### Acceptance Criteria

1. THE HTML_Editor SHALL 在编辑器顶部区域提供 Mode_Toggle 控件
2. WHEN 用户点击 Mode_Toggle 切换到预览模式, THE HTML_Editor SHALL 从代码模式切换到预览模式并渲染当前内容
3. WHEN 用户点击 Mode_Toggle 切换到代码模式, THE HTML_Editor SHALL 从预览模式切换到代码模式并显示当前源代码
4. THE HTML_Editor SHALL 默认以代码模式打开文件
5. WHEN 模式切换发生, THE HTML_Editor SHALL 保留用户在代码模式中的编辑内容不丢失

### Requirement 5: Tab 集成

**User Story:** 作为用户，我希望 HTML 文件能像其他文件类型一样在 Tab 栏中正常管理，以便保持一致的多文件操作体验。

#### Acceptance Criteria

1. WHEN 用户打开一个 HTML 文件, THE Editor_Layout SHALL 在 Tab 栏中创建对应的标签页
2. WHEN 用户关闭 HTML 文件的标签页, THE Editor_Layout SHALL 清理该文件的编辑状态和缓存内容
3. WHEN 用户在多个标签页之间切换回 HTML 文件标签页, THE HTML_Editor SHALL 恢复之前的编辑模式和内容状态
