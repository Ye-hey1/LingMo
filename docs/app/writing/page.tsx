'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'

// 中英文双语对照写作模块说明页
export default function WritingPage() {
  return (
    <DocsShell currentPath="/writing">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / 内容沉淀</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Markdown 写作空间与资料管理</h1>
            <p className="manual-lead">
              写作空间以本地 **Markdown 工作区**为核心。它是你长期积累、深度整理、批注 PDF、渲染脑图、调用 AI 扩写并最终分发知识的核心生产力画卷。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / Content Solidification</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Markdown Writing Space & Files</h1>
            <p className="manual-lead">
              The Writing module centers around your local **Markdown workspace**. It serves as the primary canvas where you perform long-term synthesis, annotate PDFs, render charts, call AI copilots, and ultimately distribute structured knowledge.
            </p>
          </header>
        }
      />

      <DualLang
        zh={
          <Callout title="本地优先的设计哲学：你的数据你做主">
            <p>
              LingMo 坚守“本地优先 (Local-First)”设计。所有的笔记都是通用的 Markdown 文件，所有的插画、图表、附件都存放在你本地的硬盘文件夹中。即使软件停止运行，你的资料也永远属于你，能被任何现代文本编辑器无损读取。
            </p>
          </Callout>
        }
        en={
          <Callout title="Local-First Philosophy: Own Your Data Forever">
            <p>
              LingMo remains committed to a "Local-First" architecture. Your notes are stored as standard Markdown files, and all drawings, tables, and PDF attachments sit securely on your local hard drive. Even if you stop using LingMo, your assets are fully yours, readable by any text editor.
            </p>
          </Callout>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>极其自由的工作区文件树</h2>}
          en={<h2>Workspace File Tree Capabilities</h2>}
        />
        <DualLang
          zh={
            <p>
              左侧的工作区文件管理器并不只是一个死板的文件列表。它经过专门重构，融合了以下高频操作：
            </p>
          }
          en={
            <p>
              The left file sidebar is far more than a static directory viewer. It is fully interactive, optimizing high-frequency operations:
            </p>
          }
        />
        <DualLang
          zh={
            <ul>
              <li><strong>文件和文件夹拖拽：</strong>支持完全的拖动移动、快速右键克隆、软删除以及批量重命名。</li>
              <li><strong>常用收藏 (Pin)：</strong>一键将跨深层路径的文件或文件夹钉在文件树顶部，省去层层跳转的时间。</li>
              <li><strong>多格式支持：</strong>不仅能打开并流畅阅读 Markdown，还可以直接双击唤起 PDF 阅读器、浏览图片或运行专用的可视化交互白板（Whiteboard）。</li>
              <li><strong>安全导出链：</strong>轻松一键将富文本 Markdown 编译转化为排版极度奢华的 PDF 或静态 HTML，便于向团队分发成果。</li>
            </ul>
          }
          en={
            <ul>
              <li><strong>Interactive File Tree:</strong> Supports drag-and-drop reorganization, rapid right-click cloning, secure soft trashing, and batch renaming.</li>
              <li><strong>Favorites (Pin):</strong> Lock deep-nested documents or directories to the top of your sidebar, skipping manual tree expansions.</li>
              <li><strong>Rich Asset Support:</strong> Seamlessly renders Markdown files, opens high-performance PDF viewers, previews assets, and launches interactive visual whiteboards.</li>
              <li><strong>Premium Exports:</strong> Easily convert Markdown drafts into beautifully styled PDFs or static HTML files ready for immediate distribution.</li>
            </ul>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>卓越的 Markdown 编辑体验</h2>}
          en={<h2>Premium Markdown Editor Features</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>编辑特性</th>
                    <th>工作机制</th>
                    <th>为写作带来的增益</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">📐 完善的格式支持</td>
                    <td>原生支持标准的标题、代码块、LaTeX 公式、任务列表、Mermaid 流程图。</td>
                    <td>在一个编辑器中流畅写完包含复杂公式和架构图的专业技术方案。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">⚡ 斜杠命令 (Slash Command)</td>
                    <td>敲击 <code>/</code> 即可快速呼出快捷操作：插入代码、生成表格、唤醒 AI 解释。</td>
                    <td>让双手永远停留在主键盘区，保持心流状态。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">🧭 侧边大纲悬浮</td>
                    <td>实时提取文本 Heading 层级，自动渲染高对比悬浮大纲树。</td>
                    <td>万字长文轻松一键跳转，掌握通篇逻辑脉络。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">📖 PDF 协同批注</td>
                    <td>开启分屏模式，左侧看 PDF 论文，右侧做笔记，拖拽文字自动带引用链接。</td>
                    <td>学术阅读与重点归纳无缝咬合，快速理清论文脉络。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
          en={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Mechanism</th>
                    <th>Value Added</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">📐 Rich Layout Compatibility</td>
                    <td>Native compatibility for LaTeX equations, complex code fences, Mermaid charts, and checklists.</td>
                    <td>Draft professional engineering briefs populated with live charts and math in a single workspace.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">⚡ Slash Commands</td>
                    <td>Pressing <code>/</code> instantly displays quick insertion tools, templates, or AI models.</td>
                    <td>Keep your hands securely on the keyboard, protecting your writing flow state.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">🧭 Floating Outline Tree</td>
                    <td>Real-time parsing of Heading tags, rendering a high-contrast floating outline sidebar.</td>
                    <td>Seamless navigation across long articles with single-click heading jumps.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">📖 Split PDF Annotations</td>
                    <td>Split views with PDFs on the left and notes on the right; drag texts to append anchored back-links.</td>
                    <td>Bridges literature review directly into Markdown notes, keeping references intact.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>推荐的本地工作区目录结构</h2>}
          en={<h2>Recommended Directory Architecture</h2>}
        />
        <DualLang
          zh={
            <p>
              为了最大化释放 RAG 知识检索与 Agent 分类整理的威力，我们强烈推荐使用以下这套逻辑结构来规范你的本地工作目录：
            </p>
          }
          en={
            <p>
              To unleash the full power of RAG retrieval and Agent organization, we highly recommend organizing your local workspace as follows:
            </p>
          }
        />
        <pre className="text-xs p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] overflow-x-auto whitespace-pre">
          {`Workspace/
  ├── Inbox/          # 临时收集箱：存放中转站合并来的原始材料与灵感草稿 (Temporary Raw Materials)
  ├── Reading/        # 深度阅读箱：论文精读、名著摘录及音视频转写卡片 (Academic & Literature Notes)
  ├── Projects/       # 项目画卷：进行中的业务方案、API 设计与任务流程图 (Active Codebase Briefs)
  ├── Research/       # 深度调研区：Deep Research 生成的权威行业研究报告 (Research Reports)
  └── Archive/        # 历史归档区：低频查看但不可随意删除的只读知识沉淀 (Cold Read-Only Vault)`}
        </pre>
      </div>
    </DocsShell>
  )
}
