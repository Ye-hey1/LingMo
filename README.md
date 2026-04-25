# LingMo

LingMo 是一款专注于记录、写作与 AI 辅助整理的跨平台 Markdown 笔记应用。项目基于 Next.js、React、Tauri 和 SQLite 构建，目标是把碎片化记录、知识库检索、AI 对话和本地写作流程整合到一个轻量桌面应用中。

## 功能特性

- **Markdown 笔记**：使用本地 Markdown 文件作为主要内容载体，便于迁移和长期保存。
- **AI 对话**：支持接入兼容 OpenAI API 的模型服务，用于问答、总结、改写和辅助写作。
- **RAG 知识库**：支持向量检索、BM25 与模糊检索混合召回，帮助从本地笔记中查找相关上下文。
- **碎片记录**：支持快速记录文本、图片、待办等零散信息，并进一步整理成正式笔记。
- **MCP 与 Skills**：支持工具扩展和技能管理，便于按场景扩展 AI 能力。
- **多端同步**：提供 GitHub、GitLab、Gitee、S3、WebDAV 等同步相关模块。
- **桌面应用**：基于 Tauri v2，使用 Rust 处理本地能力和高性能任务。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | Next.js 15、React 19、TypeScript、Tailwind CSS |
| 桌面端 | Tauri v2、Rust |
| 数据 | SQLite、本地文件系统 |
| 编辑器 | Tiptap、Markdown |
| AI 能力 | OpenAI 兼容 API、Embedding、Rerank、RAG |
| 扩展能力 | MCP、Skills |

## 本地开发

### 环境要求

- Node.js
- pnpm
- Rust / Cargo
- Tauri 依赖环境

### 安装依赖

```bash
pnpm install
```

### 启动 Web 开发服务

```bash
pnpm dev
```

### 启动 Tauri 开发模式

```bash
pnpm tauri dev
```

### 质量检查

```bash
pnpm check
```

### 构建

```bash
pnpm build
pnpm tauri build
```

## 项目结构

```text
src/
  app/                 # Next.js 页面与主要 UI
  components/          # 通用组件
  db/                  # SQLite 数据访问层
  lib/                 # AI、RAG、同步、MCP、工具函数
  stores/              # Zustand 状态管理
src-tauri/
  src/                 # Tauri/Rust 后端命令与本地能力
  tauri.conf.json      # Tauri 应用配置
messages/              # 多语言文案
public/                # 静态资源
```

## 仓库地址

- GitHub: <https://github.com/Ye-hey1/LingMo>
- Issues: <https://github.com/Ye-hey1/LingMo/issues>
- Releases: <https://github.com/Ye-hey1/LingMo/releases>

## 说明

LingMo 是在开源笔记应用基础上二次开发和定制的项目，当前重点包括品牌替换、RAG 性能优化、AI 请求层稳定性增强以及自有仓库发布流程整理。
