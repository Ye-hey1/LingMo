'use client'

import React from 'react'

// 首页 Hero 交互式流光插画
export function HeroBannerIllustration() {
  return (
    <div className="illustration-wrapper hero-illustration">
      <div className="illustration-glow-bg" />
      <svg className="illustration-svg" viewBox="0 0 800 400" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* 定义流光渐变和滤镜 */}
        <defs>
          <radialGradient id="brainGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="stream1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id="stream2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.2" />
          </linearGradient>
          <filter id="premium-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* 动态流动线条 */}
        <path d="M 150 100 Q 280 80, 400 200" stroke="url(#stream1)" strokeWidth="2" strokeDasharray="6 6" className="flow-path-1" />
        <path d="M 150 300 Q 280 320, 400 200" stroke="url(#stream2)" strokeWidth="2" strokeDasharray="8 4" className="flow-path-2" />
        <path d="M 650 100 Q 520 80, 400 200" stroke="url(#stream2)" strokeWidth="2" strokeDasharray="5 5" className="flow-path-3" />
        <path d="M 650 300 Q 520 320, 400 200" stroke="url(#stream1)" strokeWidth="2" strokeDasharray="4 6" className="flow-path-4" />

        {/* 辅助网格和连接线 */}
        <line x1="150" y1="100" x2="150" y2="300" stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="650" y1="100" x2="650" y2="300" stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="150" y1="200" x2="650" y2="200" stroke="var(--line)" strokeWidth="0.5" strokeDasharray="10 10" />

        {/* 中心大脑核心节点 */}
        <circle cx="400" cy="200" r="80" fill="url(#brainGlow)" className="core-glow" />
        <circle cx="400" cy="200" r="45" fill="var(--content-bg)" stroke="var(--accent)" strokeWidth="3" className="core-node" filter="url(#premium-blur)" />
        <circle cx="400" cy="200" r="28" fill="var(--accent)" className="core-node-inner" />
        {/* 大脑内抽象科技符号 */}
        <path d="M 390 195 L 400 185 L 410 195 L 400 205 Z" fill="#ffffff" className="core-symbol" />
        <path d="M 392 205 H 408 M 396 211 H 404" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />

        {/* 收集端卡片节点 */}
        {/* 左上: 记录与输入 */}
        <g className="illust-node illust-node-hover" transform="translate(110, 70)">
          <rect width="80" height="60" rx="12" fill="var(--content-bg)" stroke="var(--line)" strokeWidth="1.5" className="card-bg" />
          <text x="40" y="35" textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="700">记录</text>
          <circle cx="40" cy="15" r="4" fill="#3b82f6" />
        </g>

        {/* 左下: 网页/视频/语音 */}
        <g className="illust-node illust-node-hover" transform="translate(110, 270)">
          <rect width="80" height="60" rx="12" fill="var(--content-bg)" stroke="var(--line)" strokeWidth="1.5" className="card-bg" />
          <text x="40" y="35" textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="700">资料</text>
          <circle cx="40" cy="15" r="4" fill="#10b981" />
        </g>

        {/* 右上: 智能 AI/Agent */}
        <g className="illust-node illust-node-hover" transform="translate(610, 70)">
          <rect width="80" height="60" rx="12" fill="var(--content-bg)" stroke="var(--line)" strokeWidth="1.5" className="card-bg" />
          <text x="40" y="35" textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="700">AI 协同</text>
          <circle cx="40" cy="15" r="4" fill="var(--accent)" />
        </g>

        {/* 右下: 闪卡与知识沉淀 */}
        <g className="illust-node illust-node-hover" transform="translate(610, 270)">
          <rect width="80" height="60" rx="12" fill="var(--content-bg)" stroke="var(--line)" strokeWidth="1.5" className="card-bg" />
          <text x="40" y="35" textAnchor="middle" fill="var(--ink)" fontSize="13" fontWeight="700">闪卡</text>
          <circle cx="40" cy="15" r="4" fill="#8b5cf6" />
        </g>
      </svg>
    </div>
  )
}

// AI 模块 ReAct 闭环动画插画
export function ReActAgentIllustration() {
  return (
    <div className="illustration-wrapper react-illustration">
      <div className="react-loop-container">
        {/* Thought 思考卡片 */}
        <div className="react-card thought-card">
          <div className="react-card-badge bg-blue-500/10 text-blue-500">THOUGHT</div>
          <h4>AI 思考 (Reasoning)</h4>
          <p>分析用户意图，拆解当前任务，规划下一步应当调用的工具与策略。</p>
          <div className="pulse-dot" />
        </div>

        {/* 循环流光箭头 1 */}
        <div className="react-connector c1">
          <div className="glow-runner r1" />
        </div>

        {/* Action 执行卡片 */}
        <div className="react-card action-card">
          <div className="react-card-badge bg-amber-500/10 text-amber-500">ACTION</div>
          <h4>调用工具 (Acting)</h4>
          <p>调取本地工具集（文件操作、SQLite查询、标签管理、MCP或自定义Skills）。</p>
          <div className="pulse-dot" />
        </div>

        {/* 循环流光箭头 2 */}
        <div className="react-connector c2">
          <div className="glow-runner r2" />
        </div>

        {/* Observation 反馈卡片 */}
        <div className="react-card observation-card">
          <div className="react-card-badge bg-green-500/10 text-green-500">OBSERVATION</div>
          <h4>环境反馈 (Observing)</h4>
          <p>收集工具执行后返回的数据与结果，作为下一次思考的输入源。</p>
          <div className="pulse-dot" />
        </div>

        {/* 循环流光箭头 3 */}
        <div className="react-connector c3">
          <div className="glow-runner r3" />
        </div>

        {/* 中心 Agent 呼吸发光核 */}
        <div className="agent-core">
          <div className="agent-core-pulse" />
          <div className="agent-core-inner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-7 w-7 text-amber-500">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 21l8.982-11.725h-6.257L12.624 3H3.978L9.813 15.904z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

// RAG 混合检索三层叠镜插画
export function HybridSearchIllustration() {
  return (
    <div className="illustration-wrapper rag-illustration">
      <div className="rag-3d-scene">
        {/* 第一层: Vector Search */}
        <div className="rag-layer vector-layer">
          <span className="rag-layer-title text-blue-500">Vector Search 向量检索 (权重 0.7)</span>
          <div className="rag-layer-content flex items-center justify-between">
            <span className="font-mono text-xs opacity-60">doc_chunk = [0.12, -0.45, 0.89...]</span>
            <div className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping" />
              <span className="h-2 w-2 rounded-full bg-blue-500" />
            </div>
          </div>
          <div className="rag-layer-grid" />
        </div>

        {/* 层间连接线 1 */}
        <div className="layer-beam beam-1" />

        {/* 第二层: BM25 Search */}
        <div className="rag-layer bm25-layer">
          <span className="rag-layer-title text-emerald-500">BM25 词频检索 (权重 0.1)</span>
          <div className="rag-layer-content flex items-center justify-between">
            <span className="font-mono text-xs opacity-60">TF-IDF score = log(N/df) * tf</span>
            <div className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
          </div>
          <div className="rag-layer-grid" />
        </div>

        {/* 层间连接线 2 */}
        <div className="layer-beam beam-2" />

        {/* 第三层: Fuzzy Search */}
        <div className="rag-layer fuzzy-layer">
          <span className="rag-layer-title text-purple-500">Fuzzy 模糊检索 (权重 0.2)</span>
          <div className="rag-layer-content flex items-center justify-between">
            <span className="font-mono text-xs opacity-60">Rust fuzzy-matcher (Rayon)</span>
            <div className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-purple-500" />
            </div>
          </div>
          <div className="rag-layer-grid" />
        </div>

        {/* 最底层的融合结果卡片 */}
        <div className="rag-result-card">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="text-xs font-bold text-amber-500">HYBRID RERANK RESULT</span>
          </div>
          <h5 className="text-sm font-bold m-0 mb-1">精准召回的笔记片段</h5>
          <p className="text-xs opacity-70 m-0">双重重排过滤器融合向量语义与词频，提取高价值本地笔记窗口...</p>
          <div className="result-glow" />
        </div>
      </div>
    </div>
  )
}

// 闪卡与记忆主动回忆插画
export function ActiveMemoryIllustration() {
  return (
    <div className="illustration-wrapper flashcard-illustration">
      <div className="flashcard-3d-container">
        {/* 底层卡片 2 */}
        <div className="flashcard-3d-card card-back-2">
          <div className="flex justify-between items-center opacity-40 mb-4">
            <span className="text-[10px] uppercase font-bold tracking-widest">DECK: 编程进阶</span>
            <span className="text-[10px] opacity-60">薄弱卡片</span>
          </div>
          <div className="h-2 w-16 bg-var-line rounded opacity-40 mb-2" />
          <div className="h-4 w-full bg-var-line rounded opacity-30" />
        </div>

        {/* 中层卡片 1 */}
        <div className="flashcard-3d-card card-back-1">
          <div className="flex justify-between items-center opacity-70 mb-4">
            <span className="text-[10px] uppercase font-bold tracking-widest">DECK: 系统架构</span>
            <span className="text-[10px] text-amber-500 font-bold">待复习</span>
          </div>
          <h5 className="text-sm font-bold m-0 mb-2 opacity-80">什么是 ReAct Agent 的核心思想？</h5>
          <div className="h-2 w-24 bg-var-line rounded opacity-50" />
        </div>

        {/* 顶层最亮卡片 (支持交互翻转) */}
        <div className="flashcard-3d-card card-front">
          <div className="flashcard-badge-row">
            <span className="flashcard-tag text-purple-500 bg-purple-500/10">ACTIVE RECALL</span>
            <span className="flashcard-status-dot green" />
          </div>
          
          <div className="flashcard-body-content">
            <h4 className="card-question">费曼追问：如何通俗解释 RAG 机制？</h4>
            <div className="divider-line" />
            <div className="card-answer-preview">
              <span className="text-xs opacity-60">点击卡片或按下空格查看 AI 诊断追问逻辑...</span>
              <div className="feynman-ask bg-amber-500/5 border border-amber-500/10 rounded-lg p-2.5 mt-2">
                <span className="text-xs text-amber-500 font-bold block mb-1">AI 深度追问：</span>
                <span className="text-xs opacity-80">“如果检索出来的片段包含错误或冲突信息，RAG 系统该如何处理？”</span>
              </div>
            </div>
          </div>

          <div className="flashcard-footer">
            <span className="text-[10px] opacity-50">记忆指数: 89%</span>
            <span className="text-[10px] text-purple-500 font-bold">今天已复习</span>
          </div>
        </div>
      </div>
    </div>
  )
}
