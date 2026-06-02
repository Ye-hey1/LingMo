import { DocsShell } from '@/components/docs-shell'

export default function ArchitecturePage() {
  return (
    <DocsShell currentPath="/architecture">
      <h1>项目结构</h1>
      <p>这一页面向维护者，帮助你理解 LingMo 主程序和文档站的目录分工。</p>

      <h2>根目录</h2>
      <pre><code>{`LingMo/
  src/                 # Next.js 前端与核心业务 UI
  src-tauri/           # Tauri v2 / Rust 桌面端
  messages/            # 多语言文案
  public/              # 静态资源
  scripts/             # 工程脚本
  skills/              # 本地 Skills 能力包
  docs/                # 独立文档站
  package.json         # 主程序脚本与依赖`}</code></pre>

      <h2>主程序核心目录</h2>
      <table>
        <thead>
          <tr><th>目录</th><th>职责</th></tr>
        </thead>
        <tbody>
          <tr><td><code>src/app/core/main</code></td><td>主工作台，包含聊天、编辑器、文件树、记录、知识图谱、闪卡等。</td></tr>
          <tr><td><code>src/app/core/setting</code></td><td>设置页，管理 AI、同步、记录、知识库、MCP、Skills 等配置。</td></tr>
          <tr><td><code>src/db</code></td><td>SQLite 数据访问层。</td></tr>
          <tr><td><code>src/lib</code></td><td>AI、RAG、同步、GitHub 项目整理、视频转写、微信公众号转换等业务工具。</td></tr>
          <tr><td><code>src/stores</code></td><td>Zustand 状态管理。</td></tr>
          <tr><td><code>src/components</code></td><td>跨模块复用组件。</td></tr>
        </tbody>
      </table>

      <h2>文档站结构</h2>
      <pre><code>{`docs/
  app/                 # 文档页面
  components/          # 文档站组件
  lib/docs.ts          # 导航结构
  next.config.mjs      # 静态导出配置
  package.json         # 文档站独立依赖与脚本`}</code></pre>

      <h2>参考 learn-claude-code 的方式</h2>
      <p>本仓库采用类似“内容模块 + 独立 Web 展示层”的组织方式：主项目继续负责应用本身，<code>docs</code> 只负责使用文档展示。这样后续新增教程、截图、视频或 FAQ 时，不会影响桌面应用构建。</p>
    </DocsShell>
  )
}
