'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'

// 中英文双语对照活跃度中心说明页
export default function ActivityPage() {
  return (
    <DocsShell currentPath="/activity">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / 学习看板</p>
            <h1 className="text-3xl font-extrabold tracking-tight">活跃度中心与知识复盘</h1>
            <p className="manual-lead">
              活跃度中心是你的个人<strong>学习与产出数据看板</strong>。它系统归纳你收集的碎片、编辑的文档、发起的高价值 AI 对话及同步历史，并通过 <code>/今日回顾</code> 等斜杠命令，自动编译出高水准的阶段复盘文档。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / Learning Dashboard</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Activity Center & Knowledge Review</h1>
            <p className="manual-lead">
              The Activity Center serves as your personal **learning and productivity dashboard**. It structures your captured fragments, active documents, high-value AI threads, and sync histories. Through commands like <code>/today</code>, it compiles professional review logs instantly.
            </p>
          </header>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>数据看板维度与价值</h2>}
          en={<h2>Metrics & Review Dimensions</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>指标分类</th>
                    <th>监控动作</th>
                    <th>带来的核心价值</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">📥 收集箱 (Capture)</td>
                    <td>监控新增的文本、链接、语音及待办卡片。</td>
                    <td>了解碎片输入源是否充足，哪些还没有合并整理。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">✍️ 写作轴 (Writing)</td>
                    <td>监控 Markdown 文档的新增、修改、PDF批注。</td>
                    <td>反映数据是否真正沉淀为长期知识，而不是只囤积垃圾。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">🤖 AI 对话 (AI Dialogues)</td>
                    <td>汇总 Chat, Agent 及 Deep Research 模型会话。</td>
                    <td>找出已形成深度结论但仍零散分布的智能资产。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">☁️ 同步体检 (Sync Checks)</td>
                    <td>监控 GitHub、S3 或 WebDAV 数据传输状态。</td>
                    <td>确保本地工作区 100% 安全备份，规避丢失风险。</td>
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
                    <th>Metric Zone</th>
                    <th>Monitored Actions</th>
                    <th>Core Value Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">📥 Ingestion</td>
                    <td>Logs new text, link, recording, and task cards.</td>
                    <td>Track input flows, flagging which items await organization.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">✍️ Writing</td>
                    <td>Tracks document creations, modifications, and PDF annotation loops.</td>
                    <td>Confirms whether assets are solidifying into notes rather than junk piles.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">🤖 AI Conversations</td>
                    <td>Aggregates Chat, Agent, and Deep Research dialogue records.</td>
                    <td>Exposes high-value conclusions that deserve formal write-ups.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">☁️ Backup Auditing</td>
                    <td>Monitors Git, S3, or WebDAV connectivity and file transfer counts.</td>
                    <td>Ensures 100% database durability, eliminating data loss anxieties.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>知识复盘命令规范</h2>}
          en={<h2>Review Slash Commands Specs</h2>}
        />
        <DualLang
          zh={
            <p>
              在编辑器中敲击斜杠命令即可自动抓取活跃度数据，快速编排高能复盘笔记：
            </p>
          }
          en={
            <p>
              Run slash commands directly in your editor workspace to retrieve activity data and compile reviews:
            </p>
          }
        />
        <DualLang
          zh={
            <ul>
              <li><strong><code>/今日回顾</code> (Today Review)：</strong>快速提炼今日一句话感悟、已推进要事、认知卡点与明日攻坚点。</li>
              <li><strong><code>/本周回顾</code> (Weekly KPT)：</strong>生成标准的 KPT（Keep-Problem-Try）模型回顾，梳理值得延续的行为、遭遇的问题与下周尝试。</li>
              <li><strong><code>/知识盘点</code> (Knowledge Audit)：</strong>近 30 天高频输入聚类。把收集的音视频、网页通过 AI 重新映射出可整理的专题。</li>
              <li><strong><code>/月度复盘</code> (Monthly STAR)：</strong>生成 STAR 模型报告。分析月度核心产出、目标偏差率、以及长期决策优化。</li>
            </ul>
          }
          en={
            <ul>
              <li><strong><code>/today</code> (Today Review):</strong> Summarizes today's one-liners, accomplished milestones, mental roadblocks, and tomorrow's focus.</li>
              <li><strong><code>/weekly</code> (Weekly KPT):</strong> Renders standard KPT (Keep-Problem-Try) review grids to maintain best practices and solve system blockers.</li>
              <li><strong><code>/audit</code> (Knowledge Audit):</strong> Clusters high-frequency inputs from 30 days. Maps audio, links, and text cards into cohesive topic notes.</li>
              <li><strong><code>/monthly</code> (Monthly STAR):</strong> Generates STAR-style monthly reports, calculating objectives variances, risks, and next-phase plans.</li>
            </ul>
          }
        />
      </div>
    </DocsShell>
  )
}
