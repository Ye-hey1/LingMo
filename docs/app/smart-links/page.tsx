'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'

// 中英文双语对照智能链接模块说明页
export default function SmartLinksPage() {
  return (
    <DocsShell currentPath="/smart-links">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / 链接解析</p>
            <h1 className="text-3xl font-extrabold tracking-tight">智能链接解析与项目卡片</h1>
            <p className="manual-lead">
              智能链接解析不止是书签保存。当你输入 URL 后，LingMo 后台会自动爬取核心元数据，针对开源项目、微信文章及多媒体提供地道的结构化生成。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / Link Processing</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Smart Link Crawling & Repos</h1>
            <p className="manual-lead">
              Smart link processing is far more than bookmarking. Upon saving a URL, LingMo automatically crawls main metadata backgrounds, generating rich offline pages for repositories, articles, and media.
            </p>
          </header>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>支持的链接智能卡片类型</h2>}
          en={<h2>Supported Domain Formats</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>解析源</th>
                    <th>提取内容物</th>
                    <th>推荐整理方向</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">GitHub 仓库</td>
                    <td>提取 README、开发语言、架构树、核心功能列表及一键克隆脚本。</td>
                    <td>合并多个项目生成“技术方案对比表”或“开源周刊”。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">微信公众号</td>
                    <td>过滤样式和牛皮癣广告噪音，将文字和图床图片完美转换为带图 Markdown。</td>
                    <td>沉淀为个人本地阅读文献或读书笔记。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">音视频链接</td>
                    <td>抓取多路字幕流，或自动调用 STT 转换语音，输出带时间轴文本。</td>
                    <td>结合 `/生成闪卡` 提纯学术公开课或演讲干货。</td>
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
                    <th>Domain</th>
                    <th>Scraped Materials</th>
                    <th>Best Applications</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">GitHub Repos</td>
                    <td>Pulls README files, languages, modules, capabilities, and clone scripts.</td>
                    <td>Combine projects to draft "Technical Selection Matrices".</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">WeChat Articles</td>
                    <td>Strips styling garbage and side ads, transforming pages to clean Markdowns.</td>
                    <td>Save permanently for offline review libraries.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Audio/Video Links</td>
                    <td>Fetches official subtitles or feeds streams into STT transcription tools.</td>
                    <td>Generate cards out of academic talks or coding lectures.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>链接抓取异常排查</h2>}
          en={<h2>Troubleshooting Ingestion Failures</h2>}
        />
        <DualLang
          zh={
            <ul>
              <li><strong>GitHub API 限流：</strong>默认免鉴权抓取存在频次上限，可在“设置 → 链接解析”中填入你的 GitHub Personal Access Token。</li>
              <li><strong>防爬虫机制拦截：</strong>部分现代商业站点有极强防护。若后台显示抓取超时，可点击记录右侧“手动贴入正文”进行兜底。</li>
              <li><strong>视频无音轨：</strong>国内部分视频平台有防盗链，可确保本地安装了最新版的 <code>yt-dlp</code> 及 <code>ffmpeg</code> 环境。</li>
            </ul>
          }
          en={
            <ul>
              <li><strong>GitHub Rate Limits:</strong> Anonymous API calls face rigid limits. Fill your GitHub Personal Access Token in "Settings &rarr; Links".</li>
              <li><strong>Anti-Crawling Walls:</strong> Commercial portals actively block scripts. Use the right-click "Paste Manually" dialog as a solid fallback.</li>
              <li><strong>No Audio Track:</strong> Commercial streams implement strict DRM locks. Ensure the latest version of <code>yt-dlp</code> and <code>ffmpeg</code> are added to PATH.</li>
            </ul>
          }
        />
      </div>
    </DocsShell>
  )
}
