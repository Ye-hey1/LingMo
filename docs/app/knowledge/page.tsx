'use client'

import { DocsShell } from '@/components/docs-shell'
import { Callout } from '@/components/callout'
import { DualLang, T } from '@/components/translation'
import { HybridSearchIllustration } from '@/components/illustrations'

// 中英文双语对照知识库模块说明页
export default function KnowledgePage() {
  return (
    <DocsShell currentPath="/knowledge">
      <DualLang
        zh={
          <header className="manual-intro">
            <p className="manual-eyebrow">核心功能 / 知识增强</p>
            <h1 className="text-3xl font-extrabold tracking-tight">RAG 知识库与智能检索</h1>
            <p className="manual-lead">
              LingMo 的知识库模块让 AI 能够深度融合你的<strong>本地私有笔记</strong>来提供可信回答。该机制能够在提问时先从本地仓库中召回相关的文字片段，再将其作为强背景信息交给 AI 汇总，彻底杜绝了大模型的幻觉现象。
            </p>
          </header>
        }
        en={
          <header className="manual-intro">
            <p className="manual-eyebrow">Core Features / Knowledge Enhancement</p>
            <h1 className="text-3xl font-extrabold tracking-tight">RAG Knowledge Base & Smart Retrieval</h1>
            <p className="manual-lead">
              LingMo's Knowledge Base integration allows the AI to securely access your <strong>local private notebooks</strong> to deliver grounded, reliable answers. By retrieving relevant document snippets from local folders and feeding them to the AI as secure context, it effectively eliminates LLM hallucinations.
            </p>
          </header>
        }
      />

      {/* RAG 混合检索三层叠镜插画 */}
      <div className="w-full my-8 p-6 rounded-2xl border border-[var(--color-border-subtle)] bg-gradient-to-br from-[var(--color-bg-inset)] to-[var(--color-bg-card)]">
        <HybridSearchIllustration />
        <div className="mt-4 text-center">
          <DualLang
            zh={<p className="text-xs opacity-75">向量相似度 (Vector) + 词频命中 (BM25) + 模糊重排 (Hybrid Rerank) 三层智能搜索召回体系</p>}
            en={<p className="text-xs opacity-75">Three-tier intelligent search retrieval system combining Vector Similarity, Word Frequency (BM25), and Hybrid Reranking</p>}
          />
        </div>
      </div>

      <DualLang
        zh={
          <Callout title="知识输入的基本定理：质量优于数量">
            <p>
              知识库检索的召回率与原始笔记的文件结构、标题精细度紧密相关。干净的 Markdown 文件、分明的标题段落以及高信息密度的词汇，其语义检索召回质量显著超越庞大、冗余的草稿堆。
            </p>
          </Callout>
        }
        en={
          <Callout title="Fundamental Theorem of Knowledge Input: Quality over Quantity">
            <p>
              The accuracy of knowledge base retrieval correlates heavily with original document structures and header precisions. Clean Markdown files, clear heading demarcations, and high-information-density terminology deliver significantly better recall rates than massive, chaotic scrap yards.
            </p>
          </Callout>
        }
      />

      <div className="my-8">
        <DualLang
          zh={<h2>知识库是如何运行的</h2>}
          en={<h2>How the Knowledge Retrieval Works</h2>}
        />
        <DualLang
          zh={
            <ol className="space-y-3">
              <li><strong>文档解析与流式切块：</strong>主动扫描你的工作区文件夹，读取所有合格文本，自动移除噪声，切分成信息内聚的 <code>Chunk</code> 段落。</li>
              <li><strong>高维向量表征 (Embedding)：</strong>将切块片段送入本地或云端嵌入模型，转化为表示高维语义特征的浮点向量。</li>
              <li><strong>多路混合检索 (Hybrid Search)：</strong>用户提问后，系统并行触发三路召回：语义向量相似度匹配、传统 BM25 精确字命中、以及抗错别字的 Rust Fuzzy Matcher。</li>
              <li><strong>重排过滤器 (Rerank)：</strong>运用深度重排模型（Reranker）分析多路召回的候选片段，重新评分排序，筛选出排名前五的黄金上下文。</li>
              <li><strong>情境合成回答 (Synthesis)：</strong>把整理妥当的片段及来源以强提示词形式塞给 AI 模型，实现真正的“基于事实答复”。</li>
            </ol>
          }
          en={
            <ol className="space-y-3">
              <li><strong>Document Parsing & Chunking:</strong> Scans active workspace directories, reads allowed files, strips away noise, and slices contents into cohesive paragraphs (<code>Chunks</code>).</li>
              <li><strong>High-Dimensional Vectorization (Embedding):</strong> Feeds sliced text chunks into local or cloud Embedding models, generating floating-point vectors representing rich semantics.</li>
              <li><strong>Parallel Hybrid Retrieval:</strong> Once a query lands, three retrieval channels fire concurrently: Vector Semantic Similarity, legacy BM25 precise keyword filters, and a typo-resistant Rust Fuzzy Matcher.</li>
              <li><strong>Context Reranking:</strong> Feeds retrieved candidates through a deep Rerank model, evaluating context relevance to score and yield the top 5 gold snippets.</li>
              <li><strong>Grounded Text Synthesis:</strong> Packages retrieved contexts and file anchors into structured system prompts, forcing the LLM to deliver fact-based responses.</li>
            </ol>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>核心检索概念说明</h2>}
          en={<h2>Key Retrieval Terminology</h2>}
        />
        <DualLang
          zh={
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>概念名称</th>
                    <th>核心机制</th>
                    <th>最擅长召回的目标</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Embedding 向量表征</td>
                    <td>将任意自然语言编码为密集向量，基于余弦距离度量语义相似度。</td>
                    <td>“如何安装”这类的同义词、意图理解、跨语种语义关联。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">BM25 词频计算</td>
                    <td>基于词频（TF）和逆文档频率（IDF）打分的概率检索机制。</td>
                    <td>专属名词、特定 API 函数名（如 <code>useLang</code>）、产品型号或时间数字。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Fuzzy Matcher 模糊匹配</td>
                    <td>利用编辑距离和字符间距判定打分的超轻量 Rust 检索器。</td>
                    <td>包含错别字、拼写漏字母、或缩写简称的模糊搜索。</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Rerank 混合重排</td>
                    <td>使用交叉编码器（Cross-Encoder）计算查询句与候选句的绝对相关度。</td>
                    <td>在大量粗筛候选片段中，精准挑出语义完全契合的答案切块。</td>
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
                    <th>Term</th>
                    <th>Core Mechanism</th>
                    <th>Best Suited For</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-semibold">Embedding Vectors</td>
                    <td>Encodes natural languages into dense vectors, computing semantic distances.</td>
                    <td>Synonym mapping, conceptual questions (e.g., "how to"), cross-lingual queries.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">BM25 Scoring</td>
                    <td>Probability-based index scoring reflecting term frequency (TF) and inverse document frequency (IDF).</td>
                    <td>Proper nouns, explicit API symbols (e.g., <code>useLang</code>), versions, or timestamps.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Fuzzy Matcher</td>
                    <td>Ultra-lightweight Rust logic determining relevance based on edit distances and character spacing.</td>
                    <td>Typo-tolerant queries, incomplete keywords, or colloquial abbreviations.</td>
                  </tr>
                  <tr>
                    <td className="font-semibold">Rerank Filters</td>
                    <td>Evaluates absolute query-candidate pairs using deep Cross-Encoders to recalculate scores.</td>
                    <td>Pinpointing highly relevant answers from vast lists of preliminary coarse-screened results.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          }
        />
      </div>

      <div className="my-8">
        <DualLang
          zh={<h2>知识库管理建议</h2>}
          en={<h2>Best Practices for Index Management</h2>}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
            <DualLang
              zh={
                <>
                  <h4 className="mt-0 text-emerald-500 font-bold">🟢 强烈推荐进行索引的材料</h4>
                  <ul className="text-xs space-y-1.5 mt-2 opacity-90">
                    <li>长期归档维护的个人知识百科卡片或 Wiki</li>
                    <li>精简提炼过的技术文档、核心业务说明书、项目汇报</li>
                    <li>经典论文的逐段批注与结构化解读</li>
                    <li>从临时记录中精心整合并打好标签的高价值 Markdown</li>
                  </ul>
                </>
              }
              en={
                <>
                  <h4 className="mt-0 text-emerald-500 font-bold">🟢 Highly Recommended for Indexing</h4>
                  <ul className="text-xs space-y-1.5 mt-2 opacity-90">
                    <li>Permanently archived personal encyclopedias, wikis, and structured cards</li>
                    <li>Polished specifications, central operational books, and project briefs</li>
                    <li>Paragraph-by-paragraph reviews and academic paper annotations</li>
                    <li>High-value, tagged Markdown notes condensed from temporary clips</li>
                  </ul>
                </>
              }
            />
          </div>
          <div className="p-5 rounded-xl border-rose-500/20 bg-rose-500/5 border">
            <DualLang
              zh={
                <>
                  <h4 className="mt-0 text-rose-500 font-bold">🔴 不推荐直接投入索引的材料</h4>
                  <ul className="text-xs space-y-1.5 mt-2 opacity-90">
                    <li>处于剧烈修改中、带有大量 TODO 的草稿笔记，会导致频繁重算索引</li>
                    <li>纯扫描无 OCR 图层的大体积 PDF，语义层无法直接被分词读取</li>
                    <li>完全无标题结构、充斥着无意义碎碎念或长会话记录的文件</li>
                    <li>包含大量敏感密码、私钥等高度敏感文本</li>
                  </ul>
                </>
              }
              en={
                <>
                  <h4 className="mt-0 text-rose-500 font-bold">🔴 Not Recommended for Direct Indexing</h4>
                  <ul className="text-xs space-y-1.5 mt-2 opacity-90">
                    <li>Frequently modified draft notes, which prompt costly incremental index re-calculations</li>
                    <li>Scanned PDFs lacking OCR data, rendering text extraction impossible</li>
                    <li>Notes lacking structure or containing excessively long raw conversations</li>
                    <li>Files hosting plain-text credentials, passwords, or private key pairs</li>
                  </ul>
                </>
              }
            />
          </div>
        </div>
      </div>
    </DocsShell>
  )
}
