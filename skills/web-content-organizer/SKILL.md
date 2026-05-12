---
name: web-content-organizer
description: Use this skill when organizing captured web pages, extracted URL content, web clips, articles, documentation pages, GitHub repositories, product pages, or messy copied webpage text into clean notes, summaries, tags, and knowledge-base ready Markdown.
metadata:
  version: 1.0.0
  author: LingMo
allowed-tools: web_extract web_fetch web_search read_marks update_mark create_mark safe_write_file
userInvocable: true
---

# Web Content Organizer

Use this skill when the user asks to read, summarize, save, clean up, classify, or turn a web page into a record or note.

## Preferred Workflow

1. If the task includes a URL, use `web_extract` first.
2. If `web_extract` fails or returns too little content, use `web_fetch` as a fallback.
3. If the user needs current context around the page, use `web_search` before writing the final note.
4. Preserve the source URL in every saved or generated result.
5. Do not invent missing facts. Mark uncertain details as "待核验".

## Output Shape

When organizing web content, prefer this Markdown structure:

```markdown
# <页面标题>

> 来源：<URL>
> 整理时间：<YYYY-MM-DD HH:mm>

## 摘要
用 3-5 句话说明这篇内容讲什么、为什么有价值。

## 关键点
- 关键点 1
- 关键点 2
- 关键点 3

## 可行动信息
- 可以直接执行或后续跟进的事项。

## 术语与实体
- 术语/实体：一句话解释。

## 待核验
- 需要二次确认的事实、数据、价格、发布日期或版本信息。

## 原文整理
保留正文中真正有价值的段落，删除导航、广告、页脚、重复声明和无关链接。
```

## Cleaning Rules

- Remove navigation, login prompts, cookie notices, ads, duplicated footers, copyright blocks, and unrelated recommendations.
- Keep headings, lists, code blocks, tables, links, and citations when they carry useful information.
- For GitHub pages, extract project purpose, installation method, usage example, architecture hints, license, and risks.
- For documentation pages, extract concepts, API names, parameters, examples, constraints, and version-sensitive details.
- For product or vendor pages, extract pricing, feature limits, API capability, privacy/security notes, and integration steps.
- If content looks incomplete, say so and recommend browser-rendered extraction or manual verification.
