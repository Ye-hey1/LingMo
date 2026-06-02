'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'

// 中英文双语对照记录模块说明页
export default function CapturePage() {
  return (
    <DocsShell currentPath="/capture">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / 碎片整理</p>
            <h1 className="text-3xl font-extrabold tracking-tight">知识收集箱与中转站</h1>
            <p className="manual-lead">
              记录模块是 LingMo 统一承接万物碎片的<strong>知识收集 inbox</strong>。无论是转瞬即逝的灵感、待读网页、系统截图、课堂录音还是待办事项，你都可以先将其不加分类地塞入中转站，后续再借助 AI 进行聚类整合。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / Fragment Ingestion</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Knowledge Inbox & Holding Station</h1>
            <p className="manual-lead">
              The Capture module serves as LingMo's unified **Knowledge Inbox** for all ephemeral information fragments. Be it fleeting inspirations, bookmarks, screenshots, voicemails, or simple tasks, you can instantly throw them into the holding inbox and let AI assist with categorization and consolidation later.
            </p>
          </header>
        }
      />

      <DualLang
        zh={
          <Callout title="高效收集守则：收集时绝不犹豫分类">
            <p>
              知识整理最大的敌人是收集时的心理负担。如果你在记下一句话时还要纠结分类到哪个文件夹、打什么标签，你就会放弃记录。在中转站里，<strong>先留住信息，定期再整理</strong>。
            </p>
          </Callout>
        }
        en={
          <Callout title="Rule of Efficient Capture: Never Categorize While Collecting">
            <p>
              The greatest enemy of knowledge management is cognitive friction during ingestion. If you have to hesitate on directory structures or tags before saving a sentence, you will skip logging it. Inside the holding inbox, **preserve the information first, and clean up periodically**.
            </p>
          </Callout>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>支持的碎片记录类型</h2>}
          en={<h2>Supported Capture Types</h2>}
        />
        
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>记录类型</th>
                    <th>最适合捕获的内容</th>
                    <th>推荐的 AI 整理动作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">✍️ 纯文本 (Text)</td>
                    <td>灵感突发、阅读摘录、会议备忘、一句话日记。</td>
                    <td>一键合并至已有笔记，或让 Agent 梳理大纲。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">🔗 智能链接 (Smart Link)</td>
                    <td>GitHub 仓库、公众号、B站或 YouTube 视频。</td>
                    <td>后台触发无感网页抓取，生成带元数据的高级结构卡片。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">📸 系统截图 (Screenshot)</td>
                    <td>幻灯片画面、代码片段、书籍内页、软件报错截图。</td>
                    <td>调用视觉多模态模型执行 OCR 及图表核心信息提取。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">🎙️ 语音录音 (Voice Memo)</td>
                    <td>个人思路口述、课堂讨论、访谈纪要、外语对话。</td>
                    <td>调用 STT 语音转文字模型生成时间戳对齐的字幕文本。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">📂 本地附件 (File Ingest)</td>
                    <td>PDF 报告、图片素材、TXT 或 JSON 数据。</td>
                    <td>作为素材存储，支持快速唤起多模态问答。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">✅ 快捷待办 (Quick Todo)</td>
                    <td>必须执行、跟进或稍后处理的紧急行动项。</td>
                    <td>在标题指示器上直接追踪，完成后一键自动归档。</td>
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
                    <th>Type</th>
                    <th>Best Suited For</th>
                    <th>Recommended AI Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">✍️ Rich Text</td>
                    <td>Fleeting ideas, book excerpts, meeting highlights, quick journals.</td>
                    <td>Instantly merge to active documents or ask the Agent to structure outlines.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">🔗 Smart Links</td>
                    <td>GitHub repos, WeChat articles, Bilibili or YouTube video URLs.</td>
                    <td>Triggers background scraping, yielding comprehensive metadata cards.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">📸 Screenshots</td>
                    <td>Presentation slides, code blocks, book pages, software error outputs.</td>
                    <td>Calls visual Multimodal models to process OCR and summarize charts.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">🎙️ Voice Memos</td>
                    <td>Verbal brainstorming, lectures, interviews, verbal conversations.</td>
                    <td>Triggers STT voice-to-text conversion to generate time-aligned texts.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">📂 Local Files</td>
                    <td>PDF reports, asset images, plain TXT or JSON data sheets.</td>
                    <td>Kept as asset attachments, supporting immediate multimodal Q&As.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">✅ Quick Todos</td>
                    <td>Immediate actions or follow-ups that must be tracked.</td>
                    <td>Monitored via top headers, support one-click archiving upon completion.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>智能链接的高级后台解析</h2>}
          en={<h2>Advanced Link Crawling Specifications</h2>}
        />
        <DualLang
          zh={
            <p>
              当你粘贴链接到 LingMo 并关闭窗口后，系统会在后台启动多路异步爬虫，针对特定的源提供针对性的结构化生成：
            </p>
          }
          en={
            <p>
              When saving web links in LingMo, the system boots asynchronous crawlers to yield custom structural notes based on target domains:
            </p>
          }
        />
        <DualLang
          zh={
            <ul>
              <li><strong>GitHub 仓库链接：</strong>自动获取仓库简介、主要开发技术栈（Languages）、README 结构、核心功能特性、本地一键克隆与运行指令，并自动添加 <code>#开源项目</code> 标签。</li>
              <li><strong>微信公众号文章：</strong>智能剔除排版样式、动态插画、广告噪音等杂物，提取干净的图文正文并完美转化为带图 Markdown 文档。</li>
              <li><strong>B站 / YouTube 视频：</strong>自动抓取或生成其匹配的音频通道，触发 STT 音频转译，产出带精确时间轴的音视频对照卡，并在首页 Bento 卡片上显示核心总结。</li>
              <li><strong>普通通用网页：</strong>解析 Meta 信息，抓取标题、站点简介并提取语义密度最高的核心正文段落。</li>
            </ul>
          }
          en={
            <ul>
              <li><strong>GitHub Repository Links:</strong> Automatically fetches descriptions, programming languages, README catalogs, core capabilities, setup scripts, appending the <code>#open-source</code> tag.</li>
              <li><strong>WeChat Articles:</strong> Filters out styles, dynamic gifs, and promotional noise, creating clean Markdown copies populated with embedded images.</li>
              <li><strong>Bilibili / YouTube Videos:</strong> Pulls audio layers, initiates STT decoding, writes time-stamped dialogues, and indexes core takeaways on Bento grids.</li>
              <li><strong>Generic Web Pages:</strong> Reads metadata fields, extracts titles, authors, and crawls high-density main-body sections.</li>
            </ul>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>推荐的知识整理流</h2>}
          en={<h2>Recommended Inbox Review Routine</h2>}
        />
        <DualLang
          zh={
            <ol className="space-y-2.5">
              <li><strong>快速扔入：</strong>用快捷键或底部栏，把阅读中的网页、闪现的灵感、会议的声音在第一时间丢进 Inbox。</li>
              <li><strong>定期清空：</strong>设定一个周期（如每天睡前或每周五），打开记录管理面板，只看“待处理”部分。</li>
              <li><strong>AI 过滤与合并：</strong>将不重要的琐事直接删去；选择 3-5 条高度相关的文本碎片，命令 AI 将其合并为一篇高水平的技术选型或读书笔记。</li>
              <li><strong>打标与沉淀：</strong>将整理妥当的 Markdown 移动到 <code>Reading/</code> 或 <code>Projects/</code> 工作区，顺手开启知识库 RAG 索引，完成一次完美的输入到知识内化的闭环。</li>
            </ol>
          }
          en={
            <ol className="space-y-2.5">
              <li><strong>Throw Instantly:</strong> Send active browser pages, raw thoughts, or voices into the Inbox via hotkeys in seconds.</li>
              <li><strong>Periodic Purge:</strong> Set a routine (e.g., daily check-ins or weekly reviews), navigating to the Capture workspace and focusing only on "Pending" cards.</li>
              <li><strong>AI Filtering & Merger:</strong> Trash low-value records; multi-select 3-5 highly correlated text clips and ask the AI to merge them into a comprehensive note.</li>
              <li><strong>Indexing & Persistence:</strong> Move structured notes into <code>Reading/</code> or <code>Projects/</code> directories, enabling RAG indexes to complete the knowledge internalization loop.</li>
            </ol>
          }
        />
      </div>
    </DocsShell>
  )
}
