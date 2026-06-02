'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang } from '@/components/translation'

// 中英文双语对照记忆管理说明页
export default function MemoryPage() {
  return (
    <DocsShell currentPath="/memory">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / 上下文沉淀</p>
            <h1 className="text-3xl font-extrabold tracking-tight">会话与记忆管理</h1>
            <p className="manual-lead">
              记忆管理用于集中查看和整理 AI 会话上下文。它不仅能够保存 LingMo 内部的聊天，还可以读取 Claude Code、Codex CLI、OpenCode 等外部工具的会话记录，把高价值的讨论无缝导出为 Markdown 笔记。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / Context Preservation</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Session & Memory Management</h1>
            <p className="manual-lead">
              Memory Management centers on consolidating and cleaning your AI conversation history. Beyond capturing native LingMo chats, it reads sessions from external CLI tools like Claude Code, Codex CLI, and OpenCode, transforming high-value logic discussions into Markdown notes.
            </p>
          </header>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>功能入口与路径</h2>}
          en={<h2>Entry Points & Navigation</h2>}
        />
        <DualLang
          zh={
            <ul className="space-y-2.5">
              <li><strong>侧边栏导航：</strong>左侧竖栏 → “记忆”图标，即可进入会话记忆管理工作区。</li>
              <li><strong>活跃度关联：</strong>在活跃度中心的主页签中，点击“记忆”直接跳转至沉淀的会话历史。</li>
              <li><strong>控制底栏：</strong>工作区底部的工具栏支持切换数据源、过滤项目、一键导出会话。</li>
              <li><strong>高级路径：</strong>在设置中指定外部 AI 工具（如 Claude Code 等）的会话文件夹路径。</li>
            </ul>
          }
          en={
            <ul className="space-y-2.5">
              <li><strong>Sidebar Navigation:</strong> Left-hand vertical bar -&gt; "Memory" icon launches the full dashboard workspace.</li>
              <li><strong>Activity Integration:</strong> Click on historical conversation clusters in the Activity dashboard to jump to transcripts.</li>
              <li><strong>Action Toolbar:</strong> Located at the bottom of the session detail view, offering datasource filters, tags, and exports.</li>
              <li><strong>Advanced Paths:</strong> Bind your native Claude Code or Codex home directory inside settings for unified reading.</li>
            </ul>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>多平台会话来源</h2>}
          en={<h2>Multi-Platform Sources</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>来源</th>
                    <th>说明</th>
                    <th>最适合的业务场景</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">LingMo</td>
                    <td>应用内部 Chat、Agent、深度研究等交互会话。</td>
                    <td>把本地 AI 的对话沉淀为系统知识、待办或周报草稿。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Claude Code</td>
                    <td>自动读取 Claude Code 的本地历史会话目录。</td>
                    <td>回查复杂编码任务、技术方案选型和多步骤工具调用详情。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Codex CLI</td>
                    <td>加载 Codex 本地会话及项目配置路径。</td>
                    <td>回顾命令排障、研发记录及具体模块实现的上下文。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">OpenCode</td>
                    <td>读取 OpenCode 数据库或本地会话文件。</td>
                    <td>统一管理外部编码助手的上下文，使其能被本地知识库检索。</td>
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
                    <th>Source</th>
                    <th>Integration Method</th>
                    <th>Primary Use Case</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">LingMo</td>
                    <td>Native chat windows, agents, and deep research transcripts.</td>
                    <td>Turn ad-hoc brainstorming and explanations into structured documents.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Claude Code</td>
                    <td>Reads Claude Code's local JSON/YAML conversation caches.</td>
                    <td>Audit code refactoring debates, terminal outputs, and tool operations.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Codex CLI</td>
                    <td>Loads Codex CLI local state and project caches.</td>
                    <td>Review past commands, error debugging sessions, and implementation logs.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">OpenCode</td>
                    <td>Parses OpenCode local DB or transcript logs.</td>
                    <td>Unify developer assistance tools into a single local retrieval source.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>列表与交互能力</h2>}
          en={<h2>Interactive Controls & Operations</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>功能模块</th>
                    <th>支持的操作与能力描述</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">搜索与筛选</td>
                    <td>支持模糊搜索标题或消息正文；可根据数据源、工作项目、创建时间进行快速筛选。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">列表视图调节</td>
                    <td>提供舒适模式与紧凑列表的秒级切换，方便快速浏览和精细化编辑。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">重命名与别名</td>
                    <td>支持使用 AI 自动提炼标题，或手动重命名会话别名（如“修复列表排序 Bug”）。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">消息级管理</td>
                    <td>可在详情页按角色（用户、助手、思考、工具）筛选，甚至能对消息编辑或回滚历史。</td>
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
                    <th>Feature Area</th>
                    <th>Interactive Operations & Utility</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Query & Filter</td>
                    <td>Fuzzy search across titles or message blocks; filters by data source, active folder, or date range.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Density Toggle</td>
                    <td>Switch between cozy card views and high-density tables for efficient browsing.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Refinement & Alias</td>
                    <td>Utilize AI to generate summaries, or type custom tags for developer-friendly lookup.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Message-Level Control</td>
                    <td>Filter transcripts by role (User, Assistant, Thought, Tool), edit texts, and restore history versions.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>知识沉淀与导出</h2>}
          en={<h2>Knowledge Export & Consolidation</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>操作类型</th>
                    <th>生成产物与输出格式</th>
                    <th>适用场景</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">单会话导出</td>
                    <td>生成包含目标、事实、决策、代码和待办的精美 Markdown 文件。</td>
                    <td>单个问题的排查或方案设计对话的终结。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">多会话主题聚合</td>
                    <td>将多个不同时间跨度的会话提炼整合为一篇统一的专题文档。</td>
                    <td>某项功能需要跨天多轮次跟进研发的场景。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">同步至 memory-notes</td>
                    <td>将选定会话转化成工作区笔记，直接进入本地知识库检索范围。</td>
                    <td>需要将 AI 讨论结果作为长期文档供后续 RAG 随时参考。</td>
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
                    <th>Action</th>
                    <th>Target Output Format</th>
                    <th>Ideal Scenario</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Export Single Session</td>
                    <td>Generates a clean Markdown file with goals, decisions, code blocks, and next actions.</td>
                    <td>Wrapping up a successful bug-fixing thread or concept design session.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Multi-Session Aggregation</td>
                    <td>Synthesizes multiple sessions under a unified topic into one consolidated document.</td>
                    <td>Wrapping up a feature development workflow that spanned multiple days.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Save to `memory-notes`</td>
                    <td>Converts transcript summaries into notes within your primary file system for RAG lookup.</td>
                    <td>Building a long-term personal knowledge base using AI-generated wisdom.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>高级路径与常见问题排查</h2>}
          en={<h2>Path Bindings & Troubleshooting</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>现象/设置项</th>
                    <th>推荐配置或排查流程</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Claude home / Codex home</td>
                    <td>必须在“设置 → 记忆”中填写正确的本地环境路径（例如 <code>~/.config/claude-code</code>）。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">未读取到外部会话</td>
                    <td>确保对应 CLI 软件已生成会话缓存；检查当前进程对目标文件夹是否拥有读取权限。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">编辑消息想回退</td>
                    <td>在会话详情中展开“修改历史”，选择需要的旧版本消息节点一键“恢复”。</td>
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
                    <th>Setting / Symptom</th>
                    <th>Resolution & Guide</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Claude Home / Codex Home Paths</td>
                    <td>Map the exact absolute path to your CLI directories inside settings (e.g., <code>~/.config/claude-code</code>).</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">External Sessions Not Appearing</td>
                    <td>Ensure target CLIs are writing to local cache paths, and verify LingMo has read permissions to those dirs.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Revert Message Edit</td>
                    <td>Click "Edit History" on the modified message card, select a prior snapshot, and click "Restore".</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <DualLang
        zh={
          <Callout title="使用建议" tone="success">
            <p>
              不需要把每次与 AI 的琐碎聊天都保存下来。建议重点筛选具有“决策价值”、“排错链路”、“命令参数”或“核心算法结论”的会话导出至本地库中，保证您的知识库质量处于高水准。
            </p>
          </Callout>
        }
        en={
          <Callout title="Pro Tip" tone="success">
            <p>
              Avoid exporting mundane conversations. Focus on sessions containing key architectural decisions, debug sequences, terminal scripts, or structural algorithms. Keep your knowledge base premium and focused.
            </p>
          </Callout>
        }
      />
    </DocsShell>
  )
}
