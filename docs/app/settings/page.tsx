'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang } from '@/components/translation'

// 中英文双语对照配置说明页
export default function SettingsPage() {
  return (
    <DocsShell currentPath="/settings">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">配置与管理 / 个性化控制</p>
            <h1 className="text-3xl font-extrabold tracking-tight">应用设置指南</h1>
            <p className="manual-lead">
              设置页面是掌控 LingMo 应用行为的核心枢纽。你可在此自定义界面排版、AI 模型参数、本地知识库检索、多媒体转录及同步灾备方式。首次使用时无需全部配置，先开启工作区与核心 AI 模型即可满足绝大多数日常场景。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Config & Admin / Personalization</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Application Settings</h1>
            <p className="manual-lead">
              The Settings dashboard serves as the central control room for LingMo. Here, customize UI themes, AI providers, local knowledge base metrics, media transcription codecs, and cloud backup portals. Beginners only need to bind a workspace and a core AI model to get fully operational.
            </p>
          </header>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>设置页入口与集成</h2>}
          en={<h2>Where to Access Settings</h2>}
        />
        <DualLang
          zh={
            <ul className="space-y-2.5">
              <li><strong>主菜单配置入口：</strong>点击主界面左下角的“设置”齿轮按钮以打开完整仪表盘。</li>
              <li><strong>聊天区模型列表：</strong>在对话输入框上方点击当前模型名称，可快捷跳转至“默认模型与提供商”配置页。</li>
              <li><strong>多处功能关联：</strong>整理记录、知识库检索、同步、MCP 与 Skills 面板中均含有跳转到对应设置项的快捷链接。</li>
            </ul>
          }
          en={
            <ul className="space-y-2.5">
              <li><strong>Main Sidebar Gear:</strong> Tap the Settings icon in the bottom-left corner of the main container.</li>
              <li><strong>Model Selector Dropdown:</strong> Tap the active model tag above the message input area to jump straight to LLM settings.</li>
              <li><strong>Inline Shortcut Links:</strong> Found on the Capture, Knowledge Base, Sync, MCP, and Skills pages to configure specific settings locally.</li>
            </ul>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>核心推荐首发配置</h2>}
          en={<h2>Initial Setup Recommendations</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>配置项</th>
                    <th>主要解决的问题</th>
                    <th>配置建议</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">通用 (General)</td>
                    <td>界面语言、暗黑/明亮主题切换、字体大小及组件密度。</td>
                    <td>首先调顺阅读与编辑环境的视觉观感。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">AI 模型提供商</td>
                    <td>为聊天、提取、总结、闪卡等高级 AI 能力接入 API 渠道。</td>
                    <td>至少配置一个稳定的高性价比主力对话模型。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">文件路径管理</td>
                    <td>指定 Markdown 笔记存放的主目录及媒体附件目录。</td>
                    <td>绑定常用的本地笔记工作区，以开始构建双向引用。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">云端备份与同步</td>
                    <td>避免本地硬盘损坏或需要跨设备无缝阅读。</td>
                    <td>配齐 Git (GitHub/Gitee) 或 S3 凭据以自动保存。</td>
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
                    <th>Config Section</th>
                    <th>Problem Solved</th>
                    <th>Practical Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">General</td>
                    <td>Languages, dark/light themes, zoom metrics, and font configurations.</td>
                    <td>Tailor the environment to your preferred writing comfort first.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">AI Providers</td>
                    <td>Connects API pipelines for chats, prompts, flashcards, and summary loops.</td>
                    <td>Bind at least one reliable and cost-effective Chat API.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">File Paths</td>
                    <td>Selects your primary Markdown workspace and assets subdirectory.</td>
                    <td>Bind your target notes root folder to begin active bidirectional linking.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Sync & Backup</td>
                    <td>Mitigates local hardware faults and enables multi-device continuity.</td>
                    <td>Set up Gitee/GitHub repositories or S3 buckets for real-time saving.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>详细配置项大底图</h2>}
          en={<h2>Settings Blueprint</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>配置分类</th>
                    <th>核心控制功能</th>
                    <th>影响范围及系统模块</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">AI & 默认模型</td>
                    <td>绑定 OpenAI / Anthropic / DeepSeek / Ollama 等渠道与 API Key，设定主聊天与分析模型。</td>
                    <td>聊天区、智能 Agent 问答、记录总结、闪卡生成和音频转译总结。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">编辑器 (Editor)</td>
                    <td>调整内容宽度限制、代码块高亮、AI 辅助行内补全、提交行为（保存时自动清理）。</td>
                    <td>Markdown 双向编辑视图、文档大纲侧栏及 PDF 导出渲染。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">知识库 (Knowledge Base)</td>
                    <td>设定 Embedding / Rerank 模型端点、自定义检索切片大小（Chunk Size）与相似度阈值。</td>
                    <td>RAG 检索应答、历史上下文召回精度和相似文档互联。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">MCP & Skills</td>
                    <td>配置外部 Tool Servers (MCP) 连接端口与脚本环境；激活或禁用本地 Skill 开发技能包。</td>
                    <td>AI Agent 拥有的工具集和专业执行方法流程。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">图床与音视频</td>
                    <td>绑定 GitHub / PicGo / S3 托管图片；指定 ffmpeg/yt-dlp 执行程序以支持音视频转写。</td>
                    <td>本地录音转文字 (STT)、视频直接转译及 Markdown 贴图外链。</td>
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
                    <th>Settings Tab</th>
                    <th>Core Features Under Control</th>
                    <th>Affected Modules</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">AI & Default Models</td>
                    <td>Binds OpenAI, Anthropic, DeepSeek, Ollama, etc. API Keys and default model tags.</td>
                    <td>Chat windows, ReAct agents, capture summarizers, flashcard generators, and STT logic.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Editor</td>
                    <td>Configures markdown view margins, syntax themes, inline completions, and save triggers.</td>
                    <td>Visual markdown editing layout, document outlines, and PDF generation.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Knowledge Base</td>
                    <td>Defines active Embedding/Rerank targets, chunk sizes, and similarity cutoff thresholds.</td>
                    <td>RAG query relevance, history context recall accuracy, and linked notes suggestions.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">MCP & Skills</td>
                    <td>Links external Model Context Protocol (MCP) servers and toggles custom execution skills.</td>
                    <td>Tool kits available to AI Agents and specialized processing loops.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Assets & STT</td>
                    <td>Pairs image uploads via S3/PicGo; points to native ffmpeg/yt-dlp binaries for media work.</td>
                    <td>Speech-to-text (STT) conversions, direct video transcription, and remote image hosting.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>配置常见故障排除</h2>}
          en={<h2>Configuration Diagnostics</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>常见配置问题</th>
                    <th>可能原因</th>
                    <th>建议解决方案</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">AI 报错 401 / 连接超时</td>
                    <td>API Key 填写有误或网络受限。</td>
                    <td>仔细核对 Token 凭据；如果是国内网络访问，需配置代理或自定义 Base URL。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">知识库检索不到最新笔记</td>
                    <td>新写入的笔记未完成增量向量化。</td>
                    <td>进入“知识库”控制页点击“重建索引”，或者在设置中降低向量化批处理的延迟时间。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">音频/视频文件无法转写</td>
                    <td>缺少本地依赖或选错 STT 模型。</td>
                    <td>验证系统 PATH 环境变量中是否已正确安装并包含 <code>ffmpeg</code>；在音频设置里进行连通性测试。</td>
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
                    <th>Symptom</th>
                    <th>Potential Root Cause</th>
                    <th>Recommended Action</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">API Error 401 / Timeout</td>
                    <td>Invalid credentials or network blocking.</td>
                    <td>Double-check API Keys. Provide an alternative proxy endpoint in the Base URL field if needed.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">RAG Missing Recent Notes</td>
                    <td>Incremental embedding process has not run or failed.</td>
                    <td>Click "Rebuild Index" inside the Knowledge dashboard, or reduce the index builder trigger interval.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">STT / Audio Transcribe Fails</td>
                    <td>System missing binaries or misconfigured STT engine.</td>
                    <td>Ensure <code>ffmpeg</code> is installed in your local system PATH; perform diagnostic checks in Audio settings.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <DualLang
        zh={
          <Callout title="系统配置忠告" tone="warning">
            <p>
              请妥善保管好您的 API Key 以及同步密钥凭据。由于 LingMo 采用 100% 本地优先物理架构，所有的关键配置都以加密密文存放在你的本地磁盘文件夹中，我们绝不会在任何云端服务器收集你的隐私配置。
            </p>
          </Callout>
        }
        en={
          <Callout title="Data Privacy Notice" tone="warning">
            <p>
              Please safeguard your API Keys and sync credentials. Because LingMo operates on a 100% local-first architecture, all settings remain encrypted and stored locally. No settings data is collected on external servers.
            </p>
          </Callout>
        }
      />
    </DocsShell>
  )
}
