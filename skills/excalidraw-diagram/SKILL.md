---
name: excalidraw-diagram
description: 使用 Excalidraw 在对话中渲染手绘风格的图表（流程图、架构图、时序图等）。当用户说"画图"、"画流程图"、"画架构图"、"用 Excalidraw 画"、"把这个可视化"、"画出来看看"、"把 Mermaid 转成 Excalidraw"、"帮我画一下"、"更新图表"时，必须使用此 Skill。支持从自然语言、Mermaid 代码、结构化数据、手绘草图生成图表，也支持多轮迭代修改。
---

# Excalidraw Diagram Skill

用 Excalidraw 在对话中渲染可交互、可编辑的手绘风格图表。适合架构讨论、流程说明、概念解释等需要"可视化但又不必过度精确"的场景。

---

## 工作流总览

```
步骤 0 → 环境识别（见 references/installation.md）
步骤 1 → 读取 Excalidraw 元素规范（read_me，仅环境 A，每个会话只调用一次）
步骤 2 → 识别输入类型（Mermaid / 结构化 / 图片 / 自然语言 / 代码）
步骤 3 → 识别图类型（flowchart / architecture / sequence / mindmap / state）
步骤 4 → 按需确认（结构 / 图类型 / 规模）—— 见"确认策略"章节
步骤 5 → 读取对应 layout reference + color-system
步骤 6 → 计算布局（尺寸、camera、坐标）
步骤 7 → 按 z-order 组装 elements 数组
步骤 8 → 输出（按环境选择：inline 渲染 / 文件输出）
步骤 8.5 → （仅 Mermaid 快速通道）AI 语义上色 + 风格 pass（list-elements → mapping → apply-styles）
步骤 9 → 事后提示用户可以如何调整
```

### 步骤 0：环境识别

**单信号二分**——只看系统 prompt 里有没有 `Primary working directory:`：

| 信号 | 环境 | 输出方式 |
|---|---|---|
| **没有** Primary working directory | **A** Claude.ai / Claude Desktop | 调用 `create_view`（工具名可能是 `Excalidraw:create_view` 或 `mcp__<uuid>__create_view`，按实际可用工具来），图在聊天气泡里流式渲染 |
| **有** Primary working directory | **B** Claude Code / Cursor / 其他本地环境 | 在当前工作目录下写入 `.excalidraw` + `.png`（即使 `create_view` 工具可用也不要调用——本地环境里它不会在聊天里显示任何东西） |

不要依赖工具名前缀判断：不同版本 MCP 接入方式不同，UUID 会变。

如果用户问"为什么没有图"或"怎么安装"，引导他们查看 `references/installation.md`。

---

## 步骤 1：读取元素规范

**仅环境 A** 在本会话内首次画图时调用一次 `Excalidraw:read_me`。它返回：
- 颜色规范（本 skill 的 color-system.md 已与之对齐）
- 元素格式（type / id / x / y / width / height / label / points / binding）
- camera 约束（必须 4:3，5 个标准尺寸之一）
- z-order 规则（背景 → 节点 → label → 箭头）

**不要重复调用**——同一会话多次画图，`read_me` 的返回内容不会变。如果不确定本会话是否已调用过（上下文被截断等），重新调用也无妨，只是多花一点 token。

**环境 B 跳过此步**——文件输出模式下不需要 `read_me`，元素格式参见 `references/installation.md` 里的 `.excalidraw` 文件模板，配色和约束本 skill 的其他 reference 已经覆盖。

---

## 步骤 2：识别输入类型

| 输入特征 | 路径 | 处理方式 |
|---|---|---|
| 有 ` ```mermaid ` 代码块或 Mermaid 语法 | **A. Mermaid** | 环境 B 优先用 `tools/mermaid-to-excalidraw.mjs`（调用 mermaid 官方布局引擎，对大图最准）；环境 A 或脚本失败时按 `references/mermaid-mapping.md` 手工转换 |
| 有 YAML/JSON 节点列表 | **B. 结构化** | 直接映射，不需要提炼 |
| 用户上传了手绘图片或截图 | **C. 图片识别** | 视觉识别 → 输出中间结构 → 必须确认 → 渲染 |
| 用户贴了代码/文档 | **D. 提炼** | 先抽取关系 → 必须确认 |
| 纯自然语言描述 | **E. 自然语言** | 节点数 ≤ 6 且结构清晰时直接映射；否则先在脑内搭 Mermaid 骨架再走路径 A |

**Mermaid 中间格式的判定规则**：满足以下任一条件就先搭 Mermaid 骨架——节点数 > 6、有多条分支（if/else 超过 2 路）、或结构歧义较大（比如"画 CI/CD 流程"不确定颗粒度时）。路径 D 提炼代码/文档时也走同一规则。中间格式对齐用户确认后再渲染，避免画完了再大改。

**⚠️ Mermaid 节点标签换行**：flowchart 节点标签内换行必须用 `<br/>`，**不能**用 `\n`（`\n` 是两个字面字符，会被原样渲染出来）。例：
```
A{"判断条件<br/>第二行"}
B["很长的标签<br/>折成两行"]
```
`mermaid-to-excalidraw.mjs` 已内置兜底：**仅对 flowchart 族**（flowchart/graph/classDiagram/stateDiagram/erDiagram）自动把源码里的 `\n` 替换为 `<br/>`；sequenceDiagram、gantt、journey 等以 `\n` 作官方换行符的图类型不会被改写。写 Mermaid 时直接用各自的换行语法更可靠。

**⚠️ 标签里避免裸 `/`**：mermaid 在解析节点标签时会把 `/` 当作分隔符，导致 `格式 / 非空` 被切成多行。改用全角 `／` 或拆成两段（`格式 + 非空`）。

### 路径 C 详细流程：图片识别

1. **视觉识别**：Claude 直接看图，提取节点、连线、文字、分组、图类型
2. **输出中间结构**：用文字列出识别结果，格式如下：
   ```
   我从图里识别到：
   - 图类型：时序图
   - 3 个 actor：User、Tokenizer、LLM
   - 4 条消息：
     1. User → Tokenizer：Send prompt（实线）
     2. Tokenizer → LLM：Convert to tokens（实线）
     3. LLM → Tokenizer：Return next token（虚线）
     4. Tokenizer → User：Show generated word（虚线）
   - 外层有大虚线框，标题 "LLM Generation Flow"
   识别对吗？需要修正哪里？
   ```
3. **等用户确认**：图片识别必须确认，不能直接渲染
4. **用户确认后**：按正常流程渲染

**识别注意事项**：
- 手写中文识别不稳定，识别到中文 label 时在确认信息里单独标出，让用户核对
- 草图里箭头方向不清晰时，在确认信息里写明假设的方向
- 图片里的颜色不强制沿用——按 color-system 的语义色重新映射
- 识别不确定的部分用「？」标注，比如「节点 C（？看不清文字）」

---

## 步骤 3：识别图类型

按用户意图和数据特征选：

| 特征 | 图类型 | 读哪个 reference |
|---|---|---|
| 有步骤 / 决策分支 / 顺序 | **flowchart** | `layout-flowchart.md` |
| 有分层 / 模块关系 / 系统架构 | **architecture** | `layout-architecture.md` |
| 有时间轴 / 消息往返 / 多角色协作 | **sequence** | `layout-sequence.md` |
| 中心辐射 / 概念整理 / 头脑风暴 | **mindmap** | `layout-mindmap.md` |
| 有状态转换 / 事件触发 / 生命周期 | **state** | `layout-state.md` |
| 流程归因 / 多因素汇聚到一个成果 | **fishbone**（石川图） | `layout-fishbone.md`（手工 spec 路径） |

ER 图和类图暂不支持（mermaid-to-excalidraw 上游库对这两类图会 fallback 到 SVG，
且因 line→arrow 错误升级导致输出结构损坏）；遇到 ER 时用 architecture 替代表达实体关系，
遇到类图时用 flowchart 用矩形列出方法名。

---

## 步骤 4：确认策略

**核心原则**：渲染/写文件**之前**把不确定的事**合并成一轮**问完，之后不再问。

### 确认强度（按输入类型）

| 输入 | 确认 |
|---|---|
| Mermaid / 结构化 YAML-JSON | 不确认，直接画 |
| 清晰自然语言 | 中等——合并一轮确认图类型和规模 |
| 模糊自然语言 / 代码提炼 | 必确认结构（"什么算节点"要对齐） |
| 手绘草图 | 必确认（OCR 可能错，先用文字列识别结果） |

### 一定要确认的事

- 结构理解（除非输入已是明确结构）
- 图类型有歧义（如"画 OAuth"既能是时序图也能是流程图）
- 分图策略（节点 > 15 或深度 > 8）

### 不用确认的事

坐标 / 间距 / 字号 / camera / 箭头方向 / z-order / 默认配色 / ID 命名——全部按 reference 默认。

### 合并确认的写法

```
我准备这样画：
结构：5 节点 + 1 决策点（用户、登录页、API、数据库、Session；成功/失败分支）
图类型：垂直流程图    规模：L
没问题说"开画"，要改告诉我哪里。
```

单一歧义用 `ask_user_input_v0`（**仅环境 A**）给 2-3 个选项；环境 B 直接用文字列选项。

### 事后

画完加一句轻量提示（"要调整风格/加节点/改配色告诉我"），**不要**主动问"满意吗"。

---

## 步骤 5 & 6：布局和坐标

读 `references/layout-common.md` 拿通用约束（尺寸下限、间距、camera 档位表、字符宽度估算），再读对应的 `layout-<type>.md` 拿图类型专属模板。

**最常踩的三条硬线**：
- labeled box ≥ 120×60，label fontSize ≥ 16（中文也一样）
- 节点间距 ≥ 40px，层间距 ≥ 60px
- camera 必须是 5 个 4:3 预设之一：`400×300 / 600×450 / 800×600 / 1200×900 / 1600×1200`

---

## 步骤 7：组装 elements 数组

### z-order 硬性要求（仅两条）

1. **背景 zone 矩形必须最先**——它是唯一需要垫底的元素，否则会遮住节点
2. **`cameraUpdate` 在环境 A 中必须第一个**——相机先到位

其他元素（节点、label、箭头、装饰）的相对顺序不影响视觉效果：箭头是透明背景，叠在节点上没问题；节点 label 通过 `containerId` 或 `label` 字段绑定，不依赖数组位置。

### 推荐顺序（非强制）

```
cameraUpdate（仅环境 A）
背景 zone 矩形
节点 shape + 其 label（环境 A 用 label 字段；环境 B 拆成独立 text + containerId）
箭头 + 箭头 label
装饰性元素
```

### 流式渲染顺序（仅环境 A 关心）

`create_view` 按数组顺序**边发边渲染**，体验最好的写法是：画完一个节点立刻画从它出发的箭头，用户能跟着图"长出来"。这与 z-order 不冲突——只要 zone 在最前、cameraUpdate 第一就好，节点和箭头穿插排列完全可以。

环境 B 写整个文件，数组顺序只影响 z-index（zone 垫底即可），无流式顺序约束。

---

## 步骤 8：输出

按环境选择分支。

### 环境 A：调用 create_view

完整的 elements 数组作为 `elements` 参数传给 `Excalidraw:create_view`。

**迭代修改**时使用 checkpoint 机制：
```
上次返回的 checkpointId 记下来。
下次修改时：
[
  {"type": "restoreCheckpoint", "id": "<checkpointId>"},
  {"type": "delete", "ids": "<要删的 id 逗号分隔>"},
  ...新增或替换的 elements...
]
```

**不要**重用已删除的 id——替换节点一律用新 id。

### 环境 B：文件输出

**绝不调用 `create_view`**——即使工具可用，在本地环境里它不会显示任何东西，会让用户困惑。

**核心思路**：Claude 只写**紧凑 spec**（核心字段 + `label` 语法糖），skill 自带的 `tools/fill-defaults.mjs` 补全所有必填字段和 text 拆分，`tools/render.mjs` 跑 Puppeteer 出 PNG。**Claude 不手写那 15+ 个 housekeeping 字段**。

#### 共享工具

Skill 根目录下的 `tools/` 是跨项目共享的：一次 `npm install` 后所有会话复用。具体路径通常是 `~/.claude/skills/excalidraw-diagram/tools/`，也可能是本项目开发目录下的 `tools/`。

首次使用前确保依赖已装：
```bash
cd <skill-dir>/tools && npm install
```

#### Mermaid 快速通道（推荐，优先于手工 spec）

输入是 Mermaid 代码块时，优先跳过 `fill-defaults.mjs`，直接用
`mermaid-to-excalidraw.mjs` 让 mermaid 自己的布局引擎算坐标——对节点数多的
大图远比手写紧凑 spec 准确：

```bash
# 1. 把 mermaid 存成 .mmd
printf '%s\n' "$MERMAID_SRC" > <folder>/diagram.mmd

# 2. 一步转成 .excalidraw（坐标来自 mermaid，不需要 Claude 算）
node <skill-dir>/tools/mermaid-to-excalidraw.mjs \
  <folder>/diagram.mmd <folder>/diagram.excalidraw

# 3. 渲染 PNG（同下）
node <skill-dir>/tools/render.mjs <folder>/diagram.excalidraw

# 4. 清理中间文件，只保留 .excalidraw 和 .png
rm <folder>/diagram.mmd
```

如果 mermaid 语法不受官方库支持、或用户要求严格按本 skill 配色风格控制细节，
再回落到下面的"紧凑 spec"手工通道。

**⚠️ Mermaid 路径必跑的色彩/风格 pass**：`mermaid-to-excalidraw.mjs` 只做几何
转换，颜色/roughness/fillStyle 留的是 mermaid 默认灰白。生成 `.excalidraw` 后
**必须**接一轮 AI 语义上色，否则图不符合 skill 预设：

**⚠️ ID 一致性铁律**：`mermaid-to-excalidraw.mjs` 每次跑都会**重新生成随机 ID**（nanoid）。一旦你修改了 `.mmd` 源文件、调过转换器代码、或因为任何原因重跑了 `mermaid-to-excalidraw.mjs`，**之前的 `elements.json` 和 `mapping.json` 就全部作废**——必须重跑 `list-elements.mjs` 并重写 `mapping.json` 里的 ID。否则 `apply-styles.mjs` 会 0 命中（仍打印 "Applied to N elements" 但实际没改任何颜色），渲染出来的图全部是默认灰白。判断方法：apply-styles 后 `grep '"backgroundColor": "transparent"' diagram.excalidraw | wc -l` 如果等于矩形/菱形数量，说明 ID 没匹配上。

```bash
# 1. 让脚本列出所有节点/子图/箭头（给 AI 看的紧凑 JSON）
node <skill-dir>/tools/list-elements.mjs \
  <folder>/diagram.excalidraw > <folder>/elements.json

# 2. Claude 读 elements.json + color-system.md，写 mapping.json：
#    {
#      "style":    "sketch-soft",                # sketch-soft（默认，抖线+色块）/ sketch（hachure）/ formal（精确）
#      "elements": { "<id>": "service", ... },   # 节点语义，可选值见下方"判语义的指导"
#      "arrows":   { "<id>": "main", ... }       # main / success / error / return / async
#    }

# 3. 把语义写回（颜色、text 对比色、roughness、fillStyle 一次全改）
node <skill-dir>/tools/apply-styles.mjs \
  <folder>/diagram.excalidraw <folder>/mapping.json

# 4. 再跑 render.mjs 出 PNG
node <skill-dir>/tools/render.mjs <folder>/diagram.excalidraw

# 5. 清理中间文件，只保留 .excalidraw 和 .png
rm <folder>/diagram.mmd <folder>/elements.json <folder>/mapping.json
```

**判语义的指导**（AI 自行根据节点 text + 在 subgraph 中的位置决定）：

- text 含"用户/Client/外部 API/第三方" → `input`
- text 含 Service/Handler/Controller/Agent/流程动作 → `service`
- text 含 DB/Cache/File/Store/表名/数据结构 → `data`
- text 含 if/判断/分流/Gateway → `decision`
- 成功/输出/返回结果 → `success`
- 错误/异常/失败分支 → `error`
- 实在分不清 → `neutral`（透明底）
- 外层 subgraph 按层：UI/前端 → `zone-frontend`，业务/逻辑 → `zone-logic`，数据/存储 → `zone-data`
- 没有明确语义但要区分节点（"每个节点不同颜色"/叙事图）→ `palette-1..9` 顺序排

**风格默认 `sketch-soft`**（`roughness: 2 + solid + Excalifont + strokeWidth 2`，
手绘抖线 + 色块保留语义色）。用户说"正式/文档风/精确"→ `formal`；说"草稿/xkcd 风/斜纹"→ `sketch`。

#### 输出流程（手工 spec 通道）

1. **确定目标文件夹**（先查复用，再新建）：
   - 在当前工作目录下查 `./<slug>-*/diagram.excalidraw`——如果 slug 匹配本次主题，复用**最新的那个文件夹**（避免堆叠一堆时间戳文件夹）
   - 否则新建 `<slug>-<YYYYMMDD-HHMMSS>/`。slug：小写英文 + 短横线，≤ 30 字符，如 `oauth-flow`、`user-auth`、`system-arch`
2. **写紧凑 spec** → `<folder>/diagram.compact.json`（格式见下方）
3. **填默认值**：
   ```bash
   node <skill-dir>/tools/fill-defaults.mjs \
     <folder>/diagram.compact.json <folder>/diagram.excalidraw
   ```
4. **渲染 PNG**：
   ```bash
   node <skill-dir>/tools/render.mjs <folder>/diagram.excalidraw
   ```
   失败（puppeteer 未装 / Chromium 下载超时 / 系统无 Chrome）→ **保留 `.excalidraw`**，提示用户去 excalidraw.com 或 VS Code `pomdtr.excalidraw-editor` 打开手动导出，**不要反复重试**。
5. **清理中间文件**：
   ```bash
   rm <folder>/diagram.compact.json
   ```
6. **返回用户**：
   ```
   已保存到 ./oauth-flow-20260423-143022/：
   - diagram.excalidraw（可在 excalidraw.com / VS Code 插件打开编辑）
   - diagram.png（预览图）
   ```

#### 紧凑 spec 格式

和环境 A 传给 `create_view` 的 elements 数组**几乎一样**，区别：
- **保留** `label: {text, fontSize?, strokeColor?}` 语法糖——脚本会自动拆成独立 text + `containerId` 绑定
- **不要**写 `cameraUpdate` / `restoreCheckpoint` / `delete` 伪元素（脚本会过滤，但不要依赖）
- **不用**手写 `angle`, `seed`, `version`, `versionNonce`, `isDeleted`, `updated`, `link`, `locked`, `groupIds`, `frameId`, `opacity`, `lineHeight`, `baseline`, `originalText` 等——脚本会填
- 尺寸规划仍按步骤 5/6 的 camera 表作为**内容 bounding box 上限**（文件里没 camera 概念，但别让内容溢出，否则 PNG 会超大）
- 箭头绑定字段 `startBinding` / `endBinding` 的写法见 `references/installation.md`

顶层 JSON 可以是：
```json
{ "elements": [...], "appState": { "viewBackgroundColor": "#ffffff" } }
```
或直接裸数组 `[...]`——两种都接受。

#### 迭代修改

复用上次文件夹，新版本写 `diagram-v2.compact.json` → `diagram-v2.excalidraw` → `diagram-v2.png`。环境 B 没有 checkpoint 增量机制，每次整份重写 spec。

---

## 步骤 9：事后提示

画完后简短提示用户可以如何修改，内容尽量短，不要长篇大论。参考：

```
如果想调整可以告诉我：
- 加节点 / 删节点 / 改文字
- 换风格（更正式 / 更草图）
- 改配色 / 改方向（水平⇄垂直）
```

---

## 风格档位

用户可能会说"正式一点"、"草图就行"。按这张表切档：

| 档位 | roughness | fillStyle | fontFamily | strokeWidth | 适用 |
|---|---|---|---|---|---|
| **sketch-soft（默认）** | 2 | solid | 5 (Excalifont) | 2 | 手绘抖线 + 色块保留语义色 |
| sketch | 2 | hachure | 5 (Excalifont) | 2 | 草稿感更强、xkcd 风、斜纹填充 |
| formal | 0 | solid | 2 (Helvetica) | 1 | 技术文档、PPT、"精确感" |

**默认用 sketch-soft**。用户说"正式/文档风/精确"→ `formal`；说"草稿/xkcd/斜纹"→ `sketch`。

sketch-soft 是默认档位的原因：Excalidraw 本身就是手绘风工具；抖线传达"讨论/未定稿/邀请
修改"的气质，而 solid 填充保留色块的语义识别度（不像 hachure 斜纹会盖掉颜色）。
中文会 fallback 到系统字（Excalifont 无 CJK），这是已知权衡，详见 `color-system.md`。

---

## 通用约束检查清单（输出前自检）

**两种环境都要检查**：
- [ ] 所有 label fontSize ≥ 16（title ≥ 20）
- [ ] 所有 labeled box ≥ 120×60
- [ ] 元素 ID 全局唯一
- [ ] z-order：背景 zone 矩形在最前（环境 A 中 `cameraUpdate` 之后），其他顺序灵活
- [ ] 同列/同行元素坐标不重叠（间距 ≥ 40px）
- [ ] 没用 emoji（Excalidraw 字体不渲染）
- [ ] 中文 label 的 fontSize ≥ 16
- [ ] **节点文字颜色**：浅色背景（包括决策橙、错误粉、pastel 扩展色板）一律 `#1e1e1e`；深色背景（`#548484`、`#1a5f5a` 等）用 `#ffffff`
- [ ] **自由选色时**只从 color-system.md 的语义色或扩展色板里取色，禁止高饱和度原色填充节点（典型禁用色：`#8b5cf6` 纯紫、`#22c55e` 纯绿、`#3b82f6` 纯蓝、`#ef4444` 纯红）

**仅环境 A**：
- [ ] camera 尺寸是 400×300 / 600×450 / 800×600 / 1200×900 / 1600×1200 之一
- [ ] 第一个元素是 `cameraUpdate`
- [ ] 没有重用删除过的 id
- [ ] 箭头 binding 用了 fixedPoint（`[0.5, 0]` 等四方向值）
- [ ] 所有 labeled shape 显式设置了 `label.strokeColor`

**仅环境 B**：
- [ ] 写的是**紧凑 spec** `diagram.compact.json`，不是手写完整 `.excalidraw`
- [ ] spec 里不含 `cameraUpdate` / `restoreCheckpoint` / `delete` 伪元素
- [ ] 调用了 `tools/fill-defaults.mjs` 生成最终 `.excalidraw`
- [ ] 已尝试调用 `tools/render.mjs` 生成 PNG；失败时保留 `.excalidraw` 并给出手动导出指引
- [ ] 箭头默认带 `startBinding` / `endBinding`（移动节点时箭头会跟）
- [ ] 文件夹：优先复用同 slug 已有文件夹 + 写 `diagram-v2.*`；没有才新建 `<slug>-<YYYYMMDD-HHMMSS>/`
- [ ] 内容 bounding box 在 camera 表对应尺寸内，不要溢出

---

## 最容易踩的坑

| 问题 | 预防措施 |
|---|---|
| 箭头穿过无关节点 | 用 L 形 path 绕路（path 多段） |
| label 溢出 box | 按字符数估宽，长文字加宽 box |
| camera 非 4:3 变形 | 严格用 5 个预设之一 |
| 重用已删除 id | 替换节点一律用新 id |
| 深色 stroke + 深色 fill 不可读 | 按 color-system 的对比度表来 |
| 大图全塞一个相机 | 超过 15 节点考虑分图或 XXL |

---

## 引用文件

根据图类型按需读取：

- `references/installation.md` — 环境识别 + 共享工具 + 文件格式 + 绑定字段
- `references/color-system.md` — 语义 → 颜色映射表（所有图类型都需要）
- `references/layout-common.md` — 通用布局约束（尺寸、间距、camera、字符宽度）
- `references/layout-flowchart.md` — 流程图布局模板
- `references/layout-architecture.md` — 架构图分层模板
- `references/layout-sequence.md` — 时序图模板
- `references/layout-mindmap.md` — 思维导图模板
- `references/layout-state.md` — 状态机模板
- `references/layout-fishbone.md` — 鱼骨图模板（手工 spec 路径）
- `references/mermaid-mapping.md` — Mermaid → Excalidraw 转换规则

**读取策略**：每次画图读 SKILL.md + `color-system.md` + `layout-common.md` + 1 个对应的 `layout-<type>.md`。环境 B 首次使用额外读 `installation.md`（了解共享工具和绑定字段）。
