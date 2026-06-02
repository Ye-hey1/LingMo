'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'

// 中英文双语对照同步与备份说明页
export default function SyncPage() {
  return (
    <DocsShell currentPath="/sync">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / 数据安全</p>
            <h1 className="text-3xl font-extrabold tracking-tight">多端同步与灾备备份</h1>
            <p className="manual-lead">
              同步模块保障你的本地资料库高可用且绝对安全。系统支持将工作区文件、收集记录、标签层级、AI 聊天及模型配置安全推送至云端自建节点，实现顺畅的跨设备流转。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / Data Security</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Multi-Device Sync & Backups</h1>
            <p className="manual-lead">
              The Synchronization engine guarantees high availability and durability for your local database. It safely replicates active files, inbox tags, AI contexts, and preferences to remote hosting portals.
            </p>
          </header>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>支持的同步目标平台</h2>}
          en={<h2>Supported Storage Frameworks</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>同步平台</th>
                    <th>底层传输协议</th>
                    <th>最适合的业务场景</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">🐙 GitHub / Gitee</td>
                    <td>标准 Git 命令行流与 Token 授权 API。</td>
                    <td>纯 Markdown 笔记、代码方案等高密轻量文档库。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">☁️ Amazon S3 兼容协议</td>
                    <td>S3 SDK 分片多并发传输。</td>
                    <td>包含超大 PDF、大量截图附件、音视频多媒体大文件夹。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">💾 WebDAV 协议网盘</td>
                    <td>WebDAV 经典文件挂载标准。</td>
                    <td>自建私有 NAS（如群晖）、坚果云等独立云存储。</td>
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
                    <th>Target Host</th>
                    <th>Transport Protocol</th>
                    <th>Best Applications</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">🐙 GitHub / Gitee</td>
                    <td>Standard Git APIs with secured Personal Access Tokens.</td>
                    <td>Lightweight text notebooks, programming codebases, and configurations.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">☁️ S3 Compatible SDKs</td>
                    <td>S3 SDK with multi-part high-speed parallel file transfers.</td>
                    <td>Workspaces featuring heavy PDF libraries, images, and STT audios.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">💾 WebDAV Server Hooks</td>
                    <td>WebDAV standard HTTP file system mounts.</td>
                    <td>Private NAS nodes (e.g., Synology), Nextcloud, or WebDAV drives.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>新设备初始化完全迁移指南</h2>}
          en={<h2>Clean Device Initialization & Migration Routine</h2>}
        />
        <DualLang
          zh={
            <ol className="space-y-2.5">
              <li><strong>配置远端连接：</strong>在新设备的“设置 → 同步”中，选择与旧电脑完全一致的同步存储源（如同一 GitHub 私有仓库或 S3 存储桶）。</li>
              <li><strong>网络健康度体检：</strong>点击“检查连接”，确保网络握手协议及安全 Token 验证 100% 畅通。</li>
              <li><strong>恢复核心工作区文件：</strong>优先执行“下载所有文件”命令，把云端备份的 Markdown、PDF 图表完全拉取至本地新建的空白文件夹中。</li>
              <li><strong>同步收集卡片数据：</strong>执行“下载记录和配置”，恢复中转收集箱、标签层级及应用配置选项。</li>
              <li><strong>启用自动增量守护：</strong>验证无误后开启自动间隔同步，让 LingMo 在后台自动检测变更并实现秒级备份。</li>
            </ol>
          }
          en={
            <ol className="space-y-2.5">
              <li><strong>Configure Connection:</strong> Navigate to "Settings &rarr; Sync" on your new system, linking the identical target repository or S3 bucket used on your old device.</li>
              <li><strong>Run Network Audits:</strong> Click the connection validation check, ensuring secure tokens and routes are fully authenticated.</li>
              <li><strong>Restore Primary Documents:</strong> Trigger "Download All Files", downloading raw Markdown files, diagrams, and PDFs to your local system folder.</li>
              <li><strong>Retrieve Inbox Configs:</strong> Select "Download Capture & Configs" to load all un-categorized records, tags, and AI custom presets.</li>
              <li><strong>Deploy Automatic Increments:</strong> Enable periodic auto-sync, instructing LingMo to daemonize file edits in background loops.</li>
            </ol>
          }
        />
      </div>
    </DocsShell>
  )
}
