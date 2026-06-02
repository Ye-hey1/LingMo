'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'
import { ActiveMemoryIllustration } from '@/components/illustrations'

// 中英文双语对照学习模块说明页
export default function LearningPage() {
  return (
    <DocsShell currentPath="/learning">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / 主动学习</p>
            <h1 className="text-3xl font-extrabold tracking-tight">费曼学习法与主动回忆</h1>
            <p className="manual-lead">
              LingMo 的学习模块致力于帮助你<strong>深度诊断并强化对知识的理解</strong>，而非被动阅读。系统将复习能力分为两套核心引擎：基于间隔重复算法的“复习闪卡”，以及基于苏格拉底式发问的“费曼追问”。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / Active Learning</p>
            <h1 className="text-3xl font-extrabold tracking-tight">Feynman Diagnostics & Active Recall</h1>
            <p className="manual-lead">
              LingMo's Learning module focuses on <strong>diagnosing and reinforcing your deep understanding</strong>, rather than encouraging passive reading. The system divides learning workflows into two core engines: Spaced Recall "Flashcards" and Socratic "Feynman Dialogues".
            </p>
          </header>
        }
      />

      {/* 3D 主动回忆科技插画 */}
      <div className="w-full my-8 p-6 rounded-2xl border border-[var(--color-border-subtle)] bg-gradient-to-br from-[var(--color-bg-inset)] to-[var(--color-bg-card)]">
        <ActiveMemoryIllustration />
        <div className="mt-4 text-center">
          <DualLang
            zh={<p className="text-xs opacity-75">费曼追问深度自测卡片与 SM-2 间隔记忆复习流</p>}
            en={<p className="text-xs opacity-75">Feynman active diagnostic cards and SM-2 spaced repetition review workflows</p>}
          />
        </div>
      </div>

      <DualLang
        zh={
          <Callout title="费曼第一定律：不要自我欺骗">
            <p>
              “费曼学习法”的核心在于尝试向他人（或 AI）用最浅显直白的语言解释一个高深概念。当你无法在不堆砌专业术语的前提下讲清一个逻辑时，就说明你还没能真正彻底地掌握它。
            </p>
          </Callout>
        }
        en={
          <Callout title="Feynman's First Law: Do Not Fool Yourself">
            <p>
              The core of the "Feynman Technique" lies in attempting to explain a complex concept to others (or AI) using the simplest possible language. When you cannot articulate a concept without relying on dense jargon, you have not fully mastered it.
            </p>
          </Callout>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>核心学习机制对比</h2>}
          en={<h2>Comparison of Learning Mechanisms</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>学习机制</th>
                    <th>主要解决的痛点</th>
                    <th>最适合的内容载体</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">复习闪卡 (Flashcards)</td>
                    <td>“记不住、容易忘、临考心慌”，需要强化记忆提取线索。</td>
                    <td>专业定义、编程指令、公式、步骤、选择题等原子事实。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">费曼追问 (Feynman Inquiries)</td>
                    <td>“以为自己懂了，却无法深入讲解”，存在认知逻辑盲区。</td>
                    <td>哲学理论、技术底层架构、复杂算法机制、商业论证模型。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">视频/语音转译 (STT Learn)</td>
                    <td>“看完了几小时视频课，脑中空无一物”，缺乏输出沉淀。</td>
                    <td>学术公开课、技术访谈、核心会议记录及外语讲座。</td>
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
                    <th>Mechanism</th>
                    <th>Target Issues</th>
                    <th>Best Suited For</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Flashcards</td>
                    <td>"Forgetfulness, cognitive decay, exam panic" — strengthens long-term memory retrieval.</td>
                    <td>Jargons, coding parameters, formulas, workflow steps, structural facts.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Feynman Diagnostics</td>
                    <td>"Assuming full comprehension but unable to articulate" — resolves logical blindspots.</td>
                    <td>Philosophical theories, technical system designs, complex algorithms, business models.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">STT Transcriptions</td>
                    <td>"Finishing a multi-hour lecture video but retaining nothing" — bridges input and output.</td>
                    <td>Academic open lectures, developer interviews, meeting minutes, foreign languages.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>苏格拉底式费曼追问流程</h2>}
          en={<h2>The Socratic Feynman Diagnostic Workflow</h2>}
        />
        <DualLang
          zh={
            <p>
              当你使用 <code>/费曼追问</code> 指令后，AI 不会直接给出答案，而是会化身“刁钻的追问者”，对你的自白进行多重追击，帮助发现认知死角。
            </p>
          }
          en={
            <p>
              When triggering the <code>/Feynman</code> dialog command, the AI stops giving direct explanations. Instead, it plays a "stubborn Socratic examiner" to audit your answers, helping you expose logical loop holes.
            </p>
          }
        />
        <DualLang
          zh={
            <ol className="space-y-2.5">
              <li><strong>自选概念启动：</strong>在编辑器内敲击 <code>/费曼追问</code>，选择或输入一个你想自测的概念（例如“TCP 三次握手”）。</li>
              <li><strong>拒绝复制背诵：</strong>系统要求你完全用自己的话解释它。AI 会主动筛除课本标准的套话，只审查你的逻辑。</li>
              <li><strong>认知漏洞审查：</strong>AI 会扫描你的文字，寻找“跳步推理”、“概念混淆”、“缺乏现实用例”和“适用边界不清”等常见认知硬伤。</li>
              <li><strong>连续互动追问：</strong>针对薄弱处，AI 会抛出 1-3 轮深刻的挑战性问题（例如：“如果在第二次握手时丢包会怎样？”），引导你层层剖析。</li>
              <li><strong>打分与薄弱点诊断：</strong>测试结束后，AI 会从概念、机制、实例、边界等维度给出客观评分，并生成复习诊断卡。</li>
            </ol>
          }
          en={
            <ol className="space-y-2.5">
              <li><strong>Concept Initialization:</strong> Enter <code>/Feynman</code> in the editor and choose a target concept you wish to test (e.g., "TCP 3-way handshake").</li>
              <li><strong>Rejecting Textbook Quotes:</strong> The engine forces you to explain in your own plain words, ignoring standard copy-pasted definitions.</li>
              <li><strong>Logical Audit Scan:</strong> AI analyzes your explanation, detecting logic gaps, missing edge cases, and terminology confusion.</li>
              <li><strong>Multi-round Socratic Queries:</strong> Proactively fires 1-3 rounds of follow-up challenges based on your answers (e.g., "What happens if the second handshake packet is lost?").</li>
              <li><strong>Grading & Diagnostics:</strong> Concludes with granular scores across accuracy, mechanism, examples, and limits, logging diagnostic card items.</li>
            </ol>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>费曼追问模式分级</h2>}
          en={<h2>Feynman Diagnostic Intensity Levels</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>模式名称</th>
                    <th>追问深度与轮次</th>
                    <th>最适合的演练场景</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold text-blue-500">快速温故 (Quick Mode)</td>
                    <td>1-2 轮轻快互动，快速归纳弱点</td>
                    <td>考前或技术面试前的应急查漏补缺</td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-amber-500">标准探究 (Standard Mode)</td>
                    <td>3 轮交互，全方位覆盖概念、例子和边界</td>
                    <td>日常阅读完核心著作或技术文档后的深度总结</td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-rose-500">严厉审查 (Stubborn Mode)</td>
                    <td>4-5 轮追根究底，严防逻辑跳步与概念含混</td>
                    <td>攻克关键技术架构或编写高精学术论文前的极限自测</td>
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
                    <th>Level</th>
                    <th>Interactive Depth</th>
                    <th>Target Scenarios</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold text-blue-500">Quick Mode</td>
                    <td>1-2 rapid turns, summarizing weaknesses fast</td>
                    <td>Emergency review check-ups right before exams or job interviews</td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-amber-500">Standard Mode</td>
                    <td>3 solid turns analyzing concepts, boundaries, and use cases</td>
                    <td>Routine summaries after completing a core textbook or a developer manual</td>
                  </tr>
                  <tr>
                    <td className="font-semibold text-rose-500">Stubborn Mode</td>
                    <td>4-5 rigorous rounds probing logical steps and caveats</td>
                    <td>Ultimate stress testing before leading key system designs or research papers</td>
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
