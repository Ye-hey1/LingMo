'use client'

import { Bot, MessageCircle, Telescope, Zap, Shield, ArrowRight, Play, Settings } from 'lucide-react'
import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'
import { ReActAgentIllustration } from '@/components/illustrations'

// 中英文双语对照 AI 页面
export default function AiPage() {
  return (
    <DocsShell currentPath="/ai">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / AI 协同</p>
            <h1 className="text-3xl font-extrabold tracking-tight">AI 对话、Agent 与深度研究</h1>
            <p className="manual-lead">
              LingMo 的 AI 服务划分为三种不同的交互模态：<strong>Chat 对话</strong>、<strong>Agent 执行</strong> 和 <strong>Deep Research 深度研究</strong>。它们共享统一的右侧交互面板，但采用了截然不同的推理引擎与任务处理范式。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / AI Collaboration</p>
            <h1 className="text-3xl font-extrabold tracking-tight">AI Chat, Agent & Deep Research</h1>
            <p className="manual-lead">
              LingMo's AI services are divided into three distinct interaction modalities: <strong>Chat</strong>, <strong>Agent</strong>, and <strong>Deep Research</strong>. They share a unified right-side chat panel but employ completely different reasoning engines and task execution paradigms.
            </p>
          </header>
        }
      />

      {/* 科技插画展示本地 Agent 闭环运行逻辑 */}
      <div className="w-full my-8 p-6 rounded-2xl border border-[var(--color-border-subtle)] bg-gradient-to-br from-[var(--color-bg-inset)] to-[var(--color-bg-card)]">
        <ReActAgentIllustration />
        <div className="mt-4 text-center">
          <DualLang
            zh={<p className="text-xs opacity-75">基于 ReAct (Reason-Act) 架构的本地 Agent 工具链自主闭环逻辑</p>}
            en={<p className="text-xs opacity-75">Autonomous closed-loop logic of the local Agent toolchain based on the ReAct (Reason-Act) architecture</p>}
          />
        </div>
      </div>

      <DualLang
        zh={
          <Callout title="核心工作流金律：先选模式，再写 Prompt">
            <p>
              在提问之前，明确你的任务类型有助于选择正确的 AI 模态。如果你需要短小的文本修改或翻译，<strong>Chat</strong> 最快；如果需要操作本地文件、提取闪卡或调用 MCP，<strong>Agent</strong> 最强；如果需要联网核对事实或生成深度市场报告，<strong>Deep Research</strong> 是不二之选。
            </p>
          </Callout>
        }
        en={
          <Callout title="Core Workflow Rule: Select Mode First, Then Write Your Prompt">
            <p>
              Before sending your prompt, clarifying the nature of your task will help you select the appropriate AI modality. For short text edits or quick translations, <strong>Chat</strong> is the fastest. For operating on local files, extracting flashcards, or running MCP tools, <strong>Agent</strong> is the most capable. For online fact-checking or generating long-form reports, <strong>Deep Research</strong> is the definitive choice.
            </p>
          </Callout>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>三种模态的深度对比</h2>}
          en={<h2>Detailed Mode Comparison</h2>}
        />
        
        <DualLang
          zh={
            <div className="ai-mode-detail-grid">
              <article>
                <div className="flex items-center gap-2 mb-2 text-blue-500">
                  <MessageCircle className="h-5 w-5" />
                  <h3 className="m-0 text-lg">Chat 对话</h3>
                </div>
                <p className="text-sm opacity-90">最直接的高速问答通道，专注于处理当前上下文或局部文本。</p>
                <ul className="text-xs space-y-1.5 mt-2 opacity-85">
                  <li>概念解释、翻译、拼写检查与段落改写</li>
                  <li>精准遵循本地编辑器选区、当前对话或单文件输入</li>
                  <li>轻量响应，不具备主动读写本地文件系统的权限</li>
                </ul>
              </article>
              <article>
                <div className="flex items-center gap-2 mb-2 text-amber-500">
                  <Bot className="h-5 w-5" />
                  <h3 className="m-0 text-lg">Agent 智能体</h3>
                </div>
                <p className="text-sm opacity-90">工具驱动型任务执行引擎，擅长多步骤协作与本地工作区管理。</p>
                <ul className="text-xs space-y-1.5 mt-2 opacity-85">
                  <li>主动扫描、搜索、读取与重写多份本地 Markdown 文档</li>
                  <li>动态调度内置卡片算法、Tauri 文件管理器及第三方 MCP</li>
                  <li>写入与执行等敏感行为会自动触发红绿灯式安全确认</li>
                </ul>
              </article>
              <article>
                <div className="flex items-center gap-2 mb-2 text-emerald-500">
                  <Telescope className="h-5 w-5" />
                  <h3 className="m-0 text-lg">Deep Research</h3>
                </div>
                <p className="text-sm opacity-90">基于联网多源验证的报告生成引擎，用于事实调研。</p>
                <ul className="text-xs space-y-1.5 mt-2 opacity-85">
                  <li>主动发起交互式追问以精确锚定未知领域和目标范围</li>
                  <li>递归式搜索、信息筛选及证据级别打分评估</li>
                  <li>自动输出极富学术深度的 Markdown 报告与研究会话</li>
                </ul>
              </article>
            </div>
          }
          en={
            <div className="ai-mode-detail-grid">
              <article>
                <div className="flex items-center gap-2 mb-2 text-blue-500">
                  <MessageCircle className="h-5 w-5" />
                  <h3 className="m-0 text-lg">Chat Mode</h3>
                </div>
                <p className="text-sm opacity-90">The most direct high-speed Q&A pathway, focusing on processing local contexts or selected snippets.</p>
                <ul className="text-xs space-y-1.5 mt-2 opacity-85">
                  <li>Explaining concepts, translation, grammar polishing, and local revisions</li>
                  <li>Adhering strictly to current editor selections, dialogue threads, or active files</li>
                  <li>Lightweight footprints, lacking direct permissions to write or read external folders</li>
                </ul>
              </article>
              <article>
                <div className="flex items-center gap-2 mb-2 text-amber-500">
                  <Bot className="h-5 w-5" />
                  <h3 className="m-0 text-lg">Agent Mode</h3>
                </div>
                <p className="text-sm opacity-90">Tool-driven execution engine, specializing in multi-step workflows and workspace file coordination.</p>
                <ul className="text-xs space-y-1.5 mt-2 opacity-85">
                  <li>Scanning, searching, reading, and overwriting local Markdown notebook structures</li>
                  <li>Orchestrating internal spaced recall calculators, Tauri systems, and third-party MCPs</li>
                  <li>Critical write or execute events automatically trigger safety verification modals</li>
                </ul>
              </article>
              <article>
                <div className="flex items-center gap-2 mb-2 text-emerald-500">
                  <Telescope className="h-5 w-5" />
                  <h3 className="m-0 text-lg">Deep Research</h3>
                </div>
                <p className="text-sm opacity-90">Fact-oriented report generation engine fueled by multi-source verification and online searches.</p>
                <ul className="text-xs space-y-1.5 mt-2 opacity-85">
                  <li>Initiating interactive inquiries to clarify ambiguous areas and parameters</li>
                  <li>Recursive web querying, context synthesis, and source reliability scoring</li>
                  <li>Delivering highly detailed Markdown investigation reports and session history JSONs</li>
                </ul>
              </article>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>核心决策矩阵</h2>}
          en={<h2>Decision Matrix</h2>}
        />
        
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>衡量维度</th>
                    <th>Chat 对话</th>
                    <th>Agent 智能体</th>
                    <th>Deep Research 深度研究</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">核心设计使命</td>
                    <td>即时文本转换与极速问答</td>
                    <td>操纵本地工作区，达成确定的业务状态</td>
                    <td>跨越未知领域进行全面信息归纳</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">上下文依赖源</td>
                    <td>当前选中段落、当页笔记、单次对话历史</td>
                    <td>多处关联笔记、RAG 向量索引、卡片库</td>
                    <td>澄清会话日志、全球网页文献、可验证证据链</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">工具调用能力</td>
                    <td>无本地工具执行权</td>
                    <td>内置文件树/闪卡 API，无限拓展外部 MCP</td>
                    <td>搜索引擎、网页解析器，支持深度递归链</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">任务可见性</td>
                    <td>仅显示流式生成文本</td>
                    <td>显示决策树（Thought）、RAG片段与确认框</td>
                    <td>显示研究阶段、递归查询路径及可信度评估</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">典型成果物</td>
                    <td>一段解释、修订后的 Markdown 片段</td>
                    <td>创建新文档、更新知识卡片、添加标签</td>
                    <td>包含详尽来源引用和证据打分的综合调研报告</td>
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
                    <th>Dimension</th>
                    <th>Chat</th>
                    <th>Agent</th>
                    <th>Deep Research</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Core Mission</td>
                    <td>Instant text transformation and rapid Q&A</td>
                    <td>Manipulate local workspace to reach solid state changes</td>
                    <td>Navigate unknown fields to aggregate verified reports</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Context Sources</td>
                    <td>Active selection, active document, single chat history</td>
                    <td>Multi-file scopes, RAG vectors, recall registers</td>
                    <td>Clarification dialogue logs, global web citations, evidence chains</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Tool Access</td>
                    <td>No local tool execution authority</td>
                    <td>Native FS/Editor hooks, arbitrary external MCP gateways</td>
                    <td>Web search, HTML scrapers with recursive depth</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Process Display</td>
                    <td>Fluid text stream only</td>
                    <td>Thought logs, active tool details, and authorization prompts</td>
                    <td>Phase trackers, query histories, accessed URLs, and confidence scores</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Deliverables</td>
                    <td>Explanations, summaries, or modified code blocks</td>
                    <td>Updated notes, newly generated flashcards, tag modifications</td>
                    <td>Formal Markdown reports (.md) with exhaustive citations and sources</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>本地 Agent 的工具集成与联动</h2>}
          en={<h2>Local Agent Tool Integrations</h2>}
        />
        <DualLang
          zh={
            <p>
              Agent 是 LingMo 的核心生产力引擎。它拥有丰富的本地调用协议，可以读取中转站卡片，操纵文件树，并在发生关键写操作前弹出确认面板，保障开发数据绝对安全。
            </p>
          }
          en={
            <p>
              The Agent stands as the central productivity hub in LingMo. Backed by local coordination protocols, it can crawl intermediate storage boxes, restructure notes in your folder tree, and pop up authorization windows before executing hazardous changes to keep your data safe.
            </p>
          }
        />

        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>联动模块</th>
                    <th>工具调用机制</th>
                    <th>典型应用场景</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">临时收集箱</td>
                    <td>读取碎片草稿、批量解析多格式附件或录音文本</td>
                    <td>一键将散落在中转箱的 10 条草稿聚合成结构清晰的笔记</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">编辑器交互</td>
                    <td>实时读取或覆盖当前编辑器，进行格式化及内容填充</td>
                    <td>给选中的复杂段落自动生成对应的 Mermaid 架构流程图</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">模型上下文 (MCP)</td>
                    <td>将配置完毕的外部 MCP 接口无缝纳入智能体的工具列表</td>
                    <td>让 AI 读取系统环境变量，执行特定的本地脚本</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">复习闪卡 API</td>
                    <td>自动化解析高价值笔记，抽离 Q&A 题目并同步到复习系统</td>
                    <td>在完成某项技术调研后，命令 Agent 自动提取 5 个概念测试卡片</td>
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
                    <th>Target Module</th>
                    <th>Tool Calling Mechanism</th>
                    <th>Classic Use Cases</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Capture Inbox</td>
                    <td>Accessing raw cards, batch reading multiple formats or voicemails</td>
                    <td>Synthesize 10 loose pieces of code clips into an organized catalog page</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Editor Hooks</td>
                    <td>Reading or writing into the active Markdown canvas directly</td>
                    <td>Generate a professional Mermaid workflow diagram for the selected text</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">MCP Nodes</td>
                    <td>Inject configured MCP servers seamlessly into the Agent's tool pool</td>
                    <td>Allow the Agent to audit system variables or execute specific local scripts</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Recall Registers</td>
                    <td>Parsing premium notes, extracting quizzes, and updating databases</td>
                    <td>Command the Agent to draft 5 concept cards immediately after a learning run</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>深度研究策略选择</h2>}
          en={<h2>Deep Research Strategy Categories</h2>}
        />
        <DualLang
          zh={
            <p>
              为了满足不同深度的信息采掘，Deep Research 能够针对不同任务自适应调整搜索层次与可信度过滤策略：
            </p>
          }
          en={
            <p>
              To fulfill various requirements for information acquisition, Deep Research adapts its crawling scope and credibility filters based on tasks:
            </p>
          }
        />
        
        <DualLang
          zh={
            <ul>
              <li><strong>快速综述 (Quick Summary)：</strong>追求极速反馈，搜集 2-3 个核心权威源并迅速生成结构化大纲。</li>
              <li><strong>行业研究 (Market Analysis)：</strong>跨越时间轴的广域扫描，融合对立观点与限制条件，生成全面的商业画布。</li>
              <li><strong>学术检索 (Academic Literature)：</strong>严格审查 ArXiv、PubMed 等权威库，重点关注评估模型、局限声明与比对图表。</li>
              <li><strong>技术评估 (Technical Evaluation)：</strong>分析 GitHub commits、官方 API 文档及依赖树，提供落地架构对比。</li>
            </ul>
          }
          en={
            <ul>
              <li><strong>Quick Summary:</strong> Aims for rapid turnarounds, querying 2-3 highly authoritative sources to synthesize structured summaries.</li>
              <li><strong>Market Analysis:</strong> Wide-scope scanning over timeline structures, combining conflicting viewpoints and caveats for business models.</li>
              <li><strong>Academic Literature:</strong> Rigid audits of ArXiv, PubMed, and databases, emphasizing metric benchmarks and sample variables.</li>
              <li><strong>Technical Evaluation:</strong> Scanning GitHub issues, official API specs, and dependency trees to deliver implementation reports.</li>
            </ul>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>提示词最佳实践</h2>}
          en={<h2>Prompting Best Practices</h2>}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)]">
            <h4 className="mt-0 text-sm font-bold text-blue-500">Chat 对话提示词</h4>
            <pre className="text-xs p-2.5 rounded bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] overflow-x-auto whitespace-pre-wrap">
              {`请将选中的段落翻译成地道的英文，并以表格形式展示 3 种可替换的句型。`}
            </pre>
          </div>
          <div className="p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)]">
            <h4 className="mt-0 text-sm font-bold text-amber-500">Agent 智能体提示词</h4>
            <pre className="text-xs p-2.5 rounded bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] overflow-x-auto whitespace-pre-wrap">
              {`扫描最近七天的“写作”文件夹，找出包含“RAG优化”概念的全部文件，将它们关联的双链补齐，并更新关系图谱。`}
            </pre>
          </div>
          <div className="p-4 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)]">
            <h4 className="mt-0 text-sm font-bold text-emerald-500">深度研究提示词</h4>
            <pre className="text-xs p-2.5 rounded bg-[var(--color-bg-card)] border border-[var(--color-border-subtle)] overflow-x-auto whitespace-pre-wrap">
              {`联网调研 Next.js 15 的 PPR 渲染机制在复杂企业级后台中的适用性、局限及典型优化案例，并生成一份详细的技术评估报告。`}
            </pre>
          </div>
        </div>
      </div>
    </DocsShell>
  )
}
