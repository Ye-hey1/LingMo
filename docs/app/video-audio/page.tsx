'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'

// 中英文双语对照音视频模块说明页
export default function VideoAudioPage() {
  return (
    <DocsShell currentPath="/video-audio">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / 音频转译</p>
            <h1 className="text-3xl font-extrabold tracking-tight">音视频转写与双语时间线</h1>
            <p className="manual-lead">
              视频语音模块支持将现场录音、网络视频链接深度解析转译。通过 STT 语音解码引擎，为你的学术公开课、长篇技术沙龙或语音备忘提供分秒精确的对照字幕和提炼总结。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / Audio Transcription</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Audio/Video Transcription & Timelines</h1>
            <p className="manual-lead">
              The Video & Audio parsing layer converts live recordings and video URLs into text streams. Using high-accuracy STT engines, it delivers second-aligned timelines and structural takeaways for online lectures and team briefings.
            </p>
          </header>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>转译与总结核心工作流</h2>}
          en={<h2>Transcription & Summary Workflow</h2>}
        />
        <DualLang
          zh={
            <ol className="space-y-2.5">
              <li><strong>多路提取：</strong>优先捕获平台内自带的官方中文或英文字幕。若无字幕，自动唤醒后台 <code>yt-dlp</code> 执行音频多流提取。</li>
              <li><strong>高保真切片：</strong>使用本地 <code>ffmpeg</code> 动态判定静音区间并切割音频，确保转译并发效率最大化。</li>
              <li><strong>多模态 STT 解码：</strong>将处理后的语音分段推送至已配置的 STT（语音转文字）模型，还原带情绪和口语纠偏的文字。</li>
              <li><strong>生成多维大纲：</strong>根据段落逻辑大纲、专业术语定义及可行动待办（Todos），形成系统的视频学习备忘卡片。</li>
            </ol>
          }
          en={
            <ol className="space-y-2.5">
              <li><strong>Multi-channel Crawling:</strong> Prefers official localized subtitles. Lacking these, it runs a <code>yt-dlp</code> background hook to extract audio layers.</li>
              <li><strong>Lossless Audio Slicing:</strong> Commands local <code>ffmpeg</code> binaries to partition tracks based on silence analysis, optimizing speed.</li>
              <li><strong>Multimodal STT Decoding:</strong> Feeds chunks into high-precision STT engines, correcting colloquial stutterings into readables.</li>
              <li><strong>Multi-Dimensional Summary:</strong> Yields structural headers, key concepts, and actionable task checklists to complete your review card.</li>
            </ol>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>基础系统依赖配置</h2>}
          en={<h2>System Dependencies Requirements</h2>}
        />
        
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>底层依赖</th>
                    <th>工作任务</th>
                    <th>安装与排查建议</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">STT 模型 API</td>
                    <td>对下载或录制的本地音频进行语音转文本的深度运算。</td>
                    <td>推荐使用 Openai Whisper 兼容接口或国内高性价比大模型。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">yt-dlp 脚本</td>
                    <td>多平台视频无感下载，音频层独立捕获。</td>
                    <td>保持定期运行 <code>yt-dlp -U</code> 以适配最新的播放防盗链限制。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">ffmpeg 二进制</td>
                    <td>负责音频格式转换、长音轨自动断点分片及体积压缩。</td>
                    <td>确保将 ffmpeg 所在目录的绝对路径手动追加到了系统的环境变量 <code>PATH</code> 中。</td>
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
                    <th>Dependency</th>
                    <th>Operational Purpose</th>
                    <th>Setup & Diagnostics</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">STT Model API</td>
                    <td>Translates decoded voice feeds into structured text formats.</td>
                    <td>Prefers OpenAI Whisper-compatible endpoints or customized high-speed local models.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">yt-dlp Script</td>
                    <td>Performs media downloads and audio stream capturing across major video portals.</td>
                    <td>Regularly run <code>yt-dlp -U</code> to adapt to changing commercial streaming encryptions.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">ffmpeg Binary</td>
                    <td>Performs media format conversions, silent-interval partitionings, and compression.</td>
                    <td>Ensure the absolute path to your ffmpeg binary folder is added to system environment <code>PATH</code> variable.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>
    </DocsShell>
  )
}
