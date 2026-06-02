'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'
import { ActiveMemoryIllustration } from '@/components/illustrations'

// 中英文双语对照闪卡模块说明页
export default function FlashcardsPage() {
  return (
    <DocsShell currentPath="/flashcards">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / 记忆巩固</p>
            <h1 className="text-3xl font-extrabold tracking-tight">AI 智能闪卡与间隔复习</h1>
            <p className="manual-lead">
              闪卡模块能够自动将你的长篇笔记、视频转写、或零碎草稿，提炼为精密的<strong>主动回忆问答卡牌</strong>。基于科学的间隔重复算法（Spaced Repetition），系统会在你即将遗忘的临界点精准推送复习任务，大幅提高长期记忆效率。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / Memory Consolidation</p>
            <h1 className="text-3xl font-extrabold tracking-tight">AI Smart Flashcards & Spaced Repetition</h1>
            <p className="manual-lead">
              The Flashcard engine dynamically distills your long-form notes, transcriptions, or loose cards into high-precision <strong>active recall question decks</strong>. Leveraging a scientifically proven Spaced Repetition scheduler, the system surfaces cards right before you're about to forget them, maximizing long-term memory retention.
            </p>
          </header>
        }
      />

      {/* 3D 闪卡展示插画 */}
      <div className="w-full my-8 p-6 rounded-2xl border border-[var(--color-border-subtle)] bg-gradient-to-br from-[var(--color-bg-inset)] to-[var(--color-bg-card)]">
        <ActiveMemoryIllustration />
        <div className="mt-4 text-center">
          <DualLang
            zh={<p className="text-xs opacity-75">利用智能卡片体系（Active Recall Cards）进行原子知识点巩固与测验</p>}
            en={<p className="text-xs opacity-75">Utilize the Active Recall card system for atomic knowledge consolidation and testing</p>}
          />
        </div>
      </div>

      <DualLang
        zh={
          <Callout title="闪卡编写黄金法则：保持原子化">
            <p>
              优秀的闪卡应当只考核一个<strong>单一且明确的原子知识点</strong>。如果一张卡片的答案需要背诵一整段长篇大论，它就不适合作为闪卡。太冗长的总结适合留在编辑器里作为参考笔记，而非塞入大脑的提取线索中。
            </p>
          </Callout>
        }
        en={
          <Callout title="The Gold Rule of Flashcards: Keep It Atomic">
            <p>
              A great flashcard should only test **a single, explicit atomic fact**. If a card forces you to memorize a massive paragraph, it fails as a retrieval cue. Excessively long summaries should remain in your editor workspace as notes rather than choking your active recall pipeline.
            </p>
          </Callout>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>闪卡工作台核心功能</h2>}
          en={<h2>Key Workbench Features</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>功能板块</th>
                    <th>核心机制</th>
                    <th>适用场景</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">牌组分类管理</td>
                    <td>创建独立的主题牌组，针对不同学科或开发项目分开归档。</td>
                    <td>把“LeetCode 算法”、“考研英语”及“产品设计原则”独立归档复习。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">AI 拖拽草稿生成</td>
                    <td>把多份 Markdown 笔记一键拖入，自动切分核心术语生成题目草稿。</td>
                    <td>将看完的 3 篇深度博客快速转化为一套测验试卷。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">间隔到期复习</td>
                    <td>基于 SM-2 改进版算法自动调度每天应答的卡牌数量，计算记忆曲线。</td>
                    <td>每日早间 10 分钟快速过滤，稳固高价值知识资产。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">薄弱卡片攻坚</td>
                    <td>独立收录连续回答错误、跳过或掌握程度在 60% 以下的极难概念。</td>
                    <td>重要考试前或技术面试前的定向爆破与概念查漏补缺。</td>
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
                    <th>Module</th>
                    <th>Core Mechanism</th>
                    <th>Best Scenarios</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Deck Taxonomy</td>
                    <td>Create dedicated subject decks, isolating different disciplines or active codebases.</td>
                    <td>Keep "LeetCode Algorithms", "GRE Vocabulary", and "API Protocols" separated.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">AI Drag-and-Drop Generation</td>
                    <td>Drag multiple Markdown documents into the UI to extract term definitions and create draft cards.</td>
                    <td>Quickly transform 3 newly read blog posts into a robust test deck.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Spaced Repetition Review</td>
                    <td>Schedules daily due cards based on an optimized SM-2 memory curve calculator.</td>
                    <td>A quick 10-minute morning routine to solidify high-value knowledge assets.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Weak Card Focus</td>
                    <td>Isolates cards answered incorrectly or with retention scores below 60%.</td>
                    <td>Focused study sessions before critical exams or technical interviews.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>支持的闪卡题型</h2>}
          en={<h2>Supported Card Types</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>题型</th>
                    <th>视觉渲染方式</th>
                    <th>最佳契合内容</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">标准问答卡 (Q&A Card)</td>
                    <td>正面提问，点击或按空格翻转查看详细解析及来源。</td>
                    <td>核心概念定义、算法边界条件、系统设计原则。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">双向匹配卡 (Cloze-Deletion)</td>
                    <td>正反两面均可作为题面，反向推导来源。</td>
                    <td>英汉单词对照、缩写词与全称对应、API 与其主要返回。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">挖空填空题 (Fill-in-the-Blank)</td>
                    <td>句子中用 <code>[...]</code> 遮挡核心变量，查看时显示高亮关键字。</td>
                    <td>经典公式参数、Linux 命令选项、重要历史年份。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">客观选择题 (Multiple Choice)</td>
                    <td>提供由 AI 根据上下文自动生成的混淆干扰项，点击直接判定。</td>
                    <td>易混淆事实辨析、协议状态判定。</td>
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
                    <th>Visual Format</th>
                    <th>Best Matching Content</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Standard Q&A Card</td>
                    <td>Front displays query; click or tap space to flip for detailed answers and links.</td>
                    <td>Concept definitions, algorithmic boundaries, system architecture rules.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Bidirectional Card</td>
                    <td>Allows both sides to function as queries, supporting reverse inference.</td>
                    <td>Jargon pairings, API and return parameter mapping, bilingual terms.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Cloze Deletion</td>
                    <td>Obscures critical keywords inside brackets <code>[...]</code>, revealing highlights.</td>
                    <td>Mathematical formulas, shell arguments, historical years, core variables.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Multiple Choice</td>
                    <td>Presents multiple options with AI-generated distractors, validating answers instantly.</td>
                    <td>Disambiguation of similar facts, protocol state assessments.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>掌握度分级与算法映射</h2>}
          en={<h2>Retention Scoring & Algorithm Mapping</h2>}
        />
        <DualLang
          zh={
            <p>
              在复习卡片时，你对答案的真实掌握表现将直接重写其在 SQLite 中的记忆指数。客观诚实地打分，能让复习节奏更合理：
            </p>
          }
          en={
            <p>
              During reviews, your self-assessment directly recalculates memory indices in SQLite. Honest scoring yields optimized review schedules:
            </p>
          }
        />
        <DualLang
          zh={
            <ul>
              <li><strong>不会 (Forgot / Red)：</strong>完全无法提取核心点，或给出了错误逻辑。卡片将被重置为“薄弱卡”，几分钟内再次出现，强迫大脑建立连接。</li>
              <li><strong>困难 (Hard / Orange)：</strong>能够想起一部分关键词，但过程极其吃力且不流畅。间隔时间会被大幅压缩，并在短期内重新检查。</li>
              <li><strong>记住 (Good / Green)：</strong>能流畅说出 80% 以上核心细节。算法将按照设定的遗忘速率平稳延后复习日期。</li>
              <li><strong>轻松 (Easy / Purple)：</strong>几乎零延迟直接脱口而出。下次复习间隔将被明显拉长，释放复习队列带宽。</li>
            </ul>
          }
          en={
            <ul>
              <li><strong>Forgot (Red):</strong> Complete failure to retrieve core facts. Resets card weight, assigning it as "Weak" to reappear in minutes.</li>
              <li><strong>Hard (Orange):</strong> Stuttering recall, missing half of the details. Slashes spaced intervals, queuing it for early re-evaluation.</li>
              <li><strong>Good (Green):</strong> Fluent recall covering over 80% of details. The scheduler projects regular reviews based on your target memory curve.</li>
              <li><strong>Easy (Purple):</strong> Immediate retrieval without effort. Drastically pushes back future reviews, cleaning your daily queue.</li>
            </ul>
          }
        />
      </div>
    </DocsShell>
  )
}
