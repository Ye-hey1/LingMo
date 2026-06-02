import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'

export default function QuickStartPage() {
  return (
    <DocsShell currentPath="/quick-start">
      <DualLang
        zh={
          <>
            <h1>快速开始</h1>
            <p className="manual-lead text-base opacity-90 leading-relaxed mb-6">
              这一页帮你完成从安装、启动、创建工作区到写下第一篇笔记的最短路径。
            </p>
          </>
        }
        en={
          <>
            <h1>Quick Start</h1>
            <p className="manual-lead text-base opacity-90 leading-relaxed mb-6">
              This page guides you through the shortest path from environment setup, installation, workspace creation, to writing your very first note.
            </p>
          </>
        }
      />

      <h2><T zh="准备环境" en="Environment Prerequisites" /></h2>
      <DualLang
        zh={<p>本地开发和桌面运行需要以下环境：</p>}
        en={<p>Desktop execution and local development require the following prerequisites:</p>}
      />
      
      <DualLang
        zh={
          <table>
            <thead>
              <tr>
                <th>工具</th>
                <th>用途</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Node.js</td><td>运行 Next.js 前端和构建脚本。</td></tr>
              <tr><td>pnpm</td><td>安装前端依赖。</td></tr>
              <tr><td>Rust / Cargo</td><td>构建 Tauri 桌面端。</td></tr>
              <tr><td>Tauri 系统依赖</td><td>提供原生窗口、文件系统、数据库等能力。</td></tr>
            </tbody>
          </table>
        }
        en={
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Node.js</td><td>Runs the Next.js frontend application and build scripts.</td></tr>
              <tr><td>pnpm</td><td>Manages frontend packages and dependency structures.</td></tr>
              <tr><td>Rust / Cargo</td><td>Builds the high-performance Tauri desktop core.</td></tr>
              <tr><td>Tauri SysDeps</td><td>Enables native windowing, file system APIs, and local DB capabilities.</td></tr>
            </tbody>
          </table>
        }
      />

      <h2><T zh="安装依赖" en="Install Dependencies" /></h2>
      <pre><code>{`pnpm install`}</code></pre>

      <h2><T zh="启动桌面开发模式" en="Launch Desktop Dev Server" /></h2>
      <pre><code>{`pnpm tauri dev`}</code></pre>
      <DualLang
        zh={<p>完整功能依赖 Tauri 桌面运行时。只运行 <code>pnpm dev</code> 时，浏览器里只能看到受限预览。</p>}
        en={<p>Complete capability set requires the Tauri desktop runtime environment. Running <code>pnpm dev</code> alone provides only a restricted browser preview.</p>}
      />

      <Callout title={<T zh="为什么不是直接打开网页？" en="Why Not Simply Load a Webpage?" />} tone="warning">
        <DualLang
          zh={<p>LingMo 需要本地文件系统、SQLite 数据库、全局快捷键、原生窗口和本地模型工具调用能力。这些能力由 Tauri 提供，普通浏览器没有完整权限。</p>}
          en={<p>LingMo demands low-level local filesystem access, SQLite storage, global hotkeys, native window frames, and local tool invocation. Ordinary browsers lack permissions for these native integrations, which are enabled through Tauri.</p>}
        />
      </Callout>

      <h2><T zh="创建或选择工作区" en="Create or Open a Workspace" /></h2>
      <DualLang
        zh={
          <ol>
            <li>首次进入后，在文件区选择一个本地文件夹作为工作区。</li>
            <li>工作区内的 Markdown、图片、PDF、图表等文件会显示在文件树中。</li>
            <li>建议为不同用途建立独立文件夹，例如 <code>Inbox</code>、<code>Projects</code>、<code>Reading</code>、<code>Archive</code>。</li>
          </ol>
        }
        en={
          <ol>
            <li>Upon your first launch, select a local directory in the file view to serve as your workspace.</li>
            <li>All Markdown notes, images, PDFs, and charts inside the workspace will pop up in the file explorer.</li>
            <li>We recommend organizing separate folders for different goals, e.g., <code>Inbox</code>, <code>Projects</code>, <code>Reading</code>, and <code>Archive</code>.</li>
          </ol>
        }
      />

      <h2><T zh="写第一篇笔记" en="Draft Your First Note" /></h2>
      <DualLang
        zh={
          <ol>
            <li>在文件树中新建 Markdown 文件。</li>
            <li>在编辑器中输入正文，使用标题、列表、表格、代码块组织内容。</li>
            <li>需要 AI 辅助时，可在右侧聊天区提问，或在编辑器中使用 <code>/</code> 命令。</li>
            <li>需要导出时，可以从编辑器导出菜单选择 Markdown、HTML 或 PDF。</li>
          </ol>
        }
        en={
          <ol>
            <li>Create a new Markdown file within the workspace file tree.</li>
            <li>Edit body text inside the central editor workspace, organizing content with headings, lists, tables, and code snippets.</li>
            <li>For AI prompts, chat in the right sidebar workspace, or trigger inline slash commands <code>/</code>.</li>
            <li>For delivery, select Markdown, static HTML, or styled PDF formats from the export menu.</li>
          </ol>
        }
      />

      <h2><T zh="建议优先配置的功能" en="Recommended Primary Customization" /></h2>
      <DualLang
        zh={
          <table>
            <thead>
              <tr><th>配置项</th><th>位置</th><th>配置建议</th></tr>
            </thead>
            <tbody>
              <tr><td>AI 模型</td><td>设置 → AI</td><td>配置 OpenAI 兼容服务，解锁聊天、整理、转写总结等能力。</td></tr>
              <tr><td>记录工具栏</td><td>设置 → 记录</td><td>保留自己常用的文本、链接、截图、录音、待办按钮。</td></tr>
              <tr><td>知识库</td><td>设置 → 知识库</td><td>配置 Embedding 和 Rerank 模型后再建立索引。</td></tr>
              <tr><td>同步</td><td>设置 → 同步</td><td>如果要跨设备使用，先配置私有同步仓库或对象存储。</td></tr>
            </tbody>
          </table>
        }
        en={
          <table>
            <thead>
              <tr><th>Configuration</th><th>Location</th><th>Strategic Suggestions</th></tr>
            </thead>
            <tbody>
              <tr><td>AI Models</td><td>Settings → AI</td><td>Hook OpenAI-compatible API endpoints to unlock chat, synthesis, and transcription.</td></tr>
              <tr><td>Capture Bar</td><td>Settings → Capture</td><td>Retain frequently used buttons for text, links, screenshots, audio, and tasks.</td></tr>
              <tr><td>Knowledge Base</td><td>Settings → Knowledge</td><td>Configure Embedding and Rerank model endpoints before initiating index builds.</td></tr>
              <tr><td>Sync Setup</td><td>Settings → Sync</td><td>Set up private Git repositories or S3 buckets if cross-device replication is desired.</td></tr>
            </tbody>
          </table>
        }
      />

      <h2><T zh="新人首发推荐工作流" en="Recommended Workflow for Beginners" /></h2>
      <DualLang
        zh={
          <ol>
            <li>创建工作区，并新建一篇 Markdown 笔记。</li>
            <li>配置 Chat 模型，确认右侧聊天能正常回答。</li>
            <li>打开记录页，分别试一次文本、链接、截图、录音和待办。</li>
            <li>把几条记录合并成一篇笔记，理解“收集 → 整理 → 写作”的流程。</li>
            <li>配置知识库 Embedding，给常用文件夹建立索引。</li>
            <li>用 <code>/生成闪卡</code> 从当前笔记生成卡片，再打开闪卡工作台复习。</li>
            <li>打开活跃度中心，查看今日活动和同步页签。</li>
            <li>配置同步平台，先上传所有文件，再上传记录和配置。</li>
          </ol>
        }
        en={
          <ol>
            <li>Create a new workspace and draft an initial Markdown note inside it.</li>
            <li>Configure your Chat model endpoint and verify the right chat sidebar replies correctly.</li>
            <li>Visit the Capture interface to try text inputs, link scraping, screenshots, audio, and tasks.</li>
            <li>Select multiple temporary entries and merge them into a single note to comprehend "Capture → Organize → Write".</li>
            <li>Set up semantic embeddings, indexing your most active folders.</li>
            <li>Trigger <code>/flashcard</code> inside a note to generate quizzes, reviewing them in the Flashcards workbook.</li>
            <li>Check the Activity dashboard to inspect metrics, sync grids, and logs.</li>
            <li>Set up synchronization backup nodes, uploading files, temporary cards, and configurations.</li>
            <li>Enable periodic auto-sync, instructing LingMo to daemonize file edits in background loops.</li>
          </ol>
        }
      />

      <h2><T zh="哪些功能需要额外配置" en="Features Requiring Additional Configurations" /></h2>
      <DualLang
        zh={
          <table>
            <thead>
              <tr><th>功能</th><th>需要配置</th><th>不配置时会怎样</th></tr>
            </thead>
            <tbody>
              <tr><td>AI 对话、整理、总结</td><td>Chat 模型</td><td>只能使用非 AI 的基础编辑和记录功能。</td></tr>
              <tr><td>知识库 RAG</td><td>Embedding，可选 Rerank</td><td>AI 不能稳定引用你的本地笔记。</td></tr>
              <tr><td>录音 / 视频转写</td><td>STT 模型，视频兜底需要 yt-dlp 和 ffmpeg</td><td>只能保存音频或读取公开视频字幕。</td></tr>
              <tr><td>截图总结</td><td>OCR 或视觉模型</td><td>只能保存原图，无法自动识别内容。</td></tr>
              <tr><td>GitHub 项目整理</td><td>GitHub Token 可选</td><td>没有 Token 时 API 限额更低，会走普通网页解析兜底。</td></tr>
              <tr><td>同步备份</td><td>GitHub、Gitee、GitLab、Gitea、S3 或 WebDAV</td><td>数据只保存在本地。</td></tr>
              <tr><td>Agent 外部工具</td><td>MCP 服务和 Skills</td><td>Agent 只能使用内置能力。</td></tr>
            </tbody>
          </table>
        }
        en={
          <table>
            <thead>
              <tr><th>Capability</th><th>Requires Setup</th><th>Fallback Behaviors (Without Configuration)</th></tr>
            </thead>
            <tbody>
              <tr><td>AI Dialogue & Synthesis</td><td>Chat Model</td><td>Restricted to legacy local editing and non-AI raw text capture.</td></tr>
              <tr><td>Knowledge Base RAG</td><td>Embedding & Rerank</td><td>AI defaults to general training patterns, failing to ground on local notes.</td></tr>
              <tr><td>Audio/Video STT</td><td>STT API (plus yt-dlp & ffmpeg)</td><td>Limited to raw audio storage and reading pre-existing subtitles.</td></tr>
              <tr><td>Screenshot OCR</td><td>OCR or Multimodal API</td><td>Stores original graphical assets without optical semantic search parsing.</td></tr>
              <tr><td>GitHub Parsing</td><td>Optional GitHub Token</td><td>Hits standard anonymous API rate limits, failing back to standard page scraping.</td></tr>
              <tr><td>Data Synchronization</td><td>GitHub, GitLab, S3, WebDAV</td><td>Data remains locked to the local computer storage.</td></tr>
              <tr><td>MCP Agentic Extension</td><td>MCP Server & Skills config</td><td>Agent operates solely on baseline integrated tools.</td></tr>
            </tbody>
          </table>
        }
      />
    </DocsShell>
  )
}
