import { GenTemplateRange, TemplateCategory } from '@/stores/setting'

export interface PresetTemplate {
  title: string
  description: string
  content: string
  range: GenTemplateRange
  category: TemplateCategory
}

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    title: '代码笔记',
    description: '以代码为核心的笔记模板',
    content: `# 代码笔记

**主题：**
**日期：** ${new Date().toISOString().split('T')[0]}

## 概述

> 简要描述本次代码笔记的主题和目的

## 代码片段

\`\`\`language
// 在此粘贴代码
\`\`\`

### 说明

-

## 关键点

-

## 参考资料

-`,
    range: GenTemplateRange.All,
    category: TemplateCategory.Note,
  },
  {
    title: '会议纪要',
    description: '记录会议议题、决策和待办事项',
    content: `# 会议纪要

**日期：** ${new Date().toISOString().split('T')[0]}
**地点：**
**参会人：**
**记录人：**

## 会议议题

-

## 讨论内容

### 议题一

-

### 议题二

-

## 决策事项

- [ ]
- [ ]

## 待办事项

| 任务 | 负责人 | 截止日期 |
|------|--------|----------|
|  |  |  |

## 备注

-`,
    range: GenTemplateRange.Today,
    category: TemplateCategory.Work,
  },
  {
    title: '周报',
    description: '本周成果、遇到的问题和下周计划',
    content: `# 周报

**周期：** ${new Date().toISOString().split('T')[0]} 周

## 本周完成

-

## 遇到的问题

-

## 本周收获

-

## 下周计划

- [ ]
- [ ]

## 总结

>`,
    range: GenTemplateRange.Week,
    category: TemplateCategory.Work,
  },
  {
    title: '项目文档',
    description: '项目背景、需求和关键决策记录',
    content: `# 项目文档

**项目名称：**
**负责人：**
**创建日期：** ${new Date().toISOString().split('T')[0]}

## 项目背景

-

## 需求记录

### 功能需求

-

### 非功能需求

-

## 技术决策

| 决策项 | 方案 | 理由 |
|--------|------|------|
|  |  |  |

## 进度跟踪

- [ ]
- [ ]

## 风险与问题

-`,
    range: GenTemplateRange.Month,
    category: TemplateCategory.Work,
  },
  {
    title: '月度总结',
    description: '每月回顾目标完成情况和关键成果',
    content: `# 月度总结

**月份：** ${new Date().toISOString().split('T')[0].slice(0, 7)}

## 月度目标回顾

| 目标 | 完成情况 |
|------|----------|
|  |  |

## 关键成果

-

## 数据统计

| 指标 | 数值 |
|------|------|
|  |  |

## 经验教训

-

## 下月计划

- [ ]
- [ ] `,
    range: GenTemplateRange.Month,
    category: TemplateCategory.Work,
  },
  {
    title: '读书笔记',
    description: '结构化书籍笔记，含摘要和关键要点',
    content: `# 读书笔记

**书名：**
**作者：**
**阅读日期：** ${new Date().toISOString().split('T')[0]}

## 内容摘要

>

## 关键要点

1.
2.
3.

## 精彩引用

>

## 个人思考

-

## 行动清单

- [ ] `,
    range: GenTemplateRange.All,
    category: TemplateCategory.Study,
  },
  {
    title: '学习总结',
    description: '每周学习知识点和进度总结',
    content: `# 学习总结

**主题：**
**周期：** ${new Date().toISOString().split('T')[0]} 周

## 学习内容

-

## 知识梳理

### 核心概念

-

### 公式/定理

-

## 练习与实践

-

## 疑问与待探索

-

## 下周学习计划

- [ ]
- [ ] `,
    range: GenTemplateRange.Week,
    category: TemplateCategory.Study,
  },
  {
    title: '产品分析',
    description: '产品功能、用户反馈和改进建议',
    content: `# 产品分析

**产品名称：**
**分析日期：** ${new Date().toISOString().split('T')[0]}

## 产品概览

-

## 功能分析

| 功能 | 评价 | 备注 |
|------|------|------|
|  |  |  |

## 用户反馈

### 正面反馈

-

### 改进建议

-

## 竞品对比

| 维度 | 本产品 | 竞品A |
|------|--------|-------|
|  |  |  |

## 总结与建议

-`,
    range: GenTemplateRange.All,
    category: TemplateCategory.Study,
  },
  {
    title: '日记',
    description: '每日思考、情绪和亮点记录',
    content: `# 日记

**日期：** ${new Date().toISOString().split('T')[0]}
**天气：**
**心情：**

## 今日亮点

-

## 所思所想

>

## 今日收获

-

## 明日计划

- [ ] `,
    range: GenTemplateRange.Today,
    category: TemplateCategory.Life,
  },
  {
    title: '旅行记录',
    description: '行程安排、景点描述和旅行推荐',
    content: `# 旅行记录

**目的地：**
**日期：** ${new Date().toISOString().split('T')[0]}
**同行人：**

## 行程概览

| 时间 | 活动 | 备注 |
|------|------|------|
|  |  |  |

## 景点记录

###

-

## 美食推荐

| 名称 | 位置 | 评价 |
|------|------|------|
|  |  |  |

## 花费记录

| 项目 | 金额 |
|------|------|
|  | ¥ |

## 旅行建议

-`,
    range: GenTemplateRange.All,
    category: TemplateCategory.Life,
  },
  {
    title: '创意灵感',
    description: '收集和扩展创意想法',
    content: `# 创意灵感

**灵感主题：**
**记录日期：** ${new Date().toISOString().split('T')[0]}

## 灵感来源

-

## 核心想法

>

## 关联拓展

-

## 实施思路

1.
2.
3.

## 参考资料

-`,
    range: GenTemplateRange.All,
    category: TemplateCategory.Creative,
  },
  {
    title: '头脑风暴',
    description: '发散思维和关联分析',
    content: `# 头脑风暴

**主题：**
**日期：** ${new Date().toISOString().split('T')[0]}

## 主题定义

>

## 想法收集

1.
2.
3.
4.
5.

## 分类整理

### 类别一

-

### 类别二

-

## 优先级排序

| 排名 | 想法 | 可行性 | 影响力 |
|------|------|--------|--------|
| 1 |  |  |  |

## 行动计划

- [ ]
- [ ] `,
    range: GenTemplateRange.All,
    category: TemplateCategory.Creative,
  },
]
