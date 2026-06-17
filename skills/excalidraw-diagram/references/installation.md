# 环境适配与文件输出指南

Excalidraw Skill 只分两种环境：**claude.ai 原生渲染** vs **本地文件输出**。后者覆盖 Claude Code、Cursor 及其他一切非 claude.ai 的场景。

---

## 环境识别

**单信号二分**——只看系统 prompt 里有没有 `Primary working directory:`：

```
if 系统 prompt 里有 "Primary working directory: /xxx":
  → 环境 B：本地文件输出（Claude Code / Cursor / 其他本地 IDE）
  → 在当前工作目录复用或新建文件夹，写入 .excalidraw + .png

else:
  → 环境 A：claude.ai / Claude Desktop
  → 调用 create_view（工具名可能是 Excalidraw:create_view，
     也可能是 mcp__<uuid>__create_view，按实际可用工具名来）
```

不要依赖工具名前缀判断——MCP 接入的 UUID 会变，不同版本命名不同。

---

## 环境 A：Claude.ai / Claude Desktop（原生渲染）

已内置 `Excalidraw:create_view` 工具，直接可用。

**Claude.ai 网页版**：
- 打开 claude.ai → 设置 → 连接器 → 搜索 "Excalidraw" → 连接

**Claude Desktop 应用**：
- 打开设置 → 扩展 → 搜索 Excalidraw → 安装

安装完成后，图表在对话气泡里直接渲染，支持流式动画、全屏查看、手动编辑。

---

## 环境 B：本地文件输出（Claude Code / Cursor / 其他）

统一输出 `.excalidraw`（源文件，可编辑）+ `.png`（预览图）两个文件，放在当前目录下的新文件夹里。

### 文件夹命名

从图主题推断一个短 slug：
- 用小写英文 + 短横线：`oauth-flow`、`user-auth`、`system-arch`、`data-pipeline`
- 不超过 30 字符
- 加时间戳避免覆盖：`<slug>-<YYYYMMDD-HHMMSS>/`

例：`oauth-flow-20260423-143022/`

### 目录结构

```
当前工作目录/
└── oauth-flow-20260423-143022/
    ├── diagram.excalidraw     # 源文件
    └── diagram.png            # 预览图
```

迭代修改时生成 `diagram-v2.excalidraw` / `diagram-v2.png`，不要覆盖。

---

## `.excalidraw` 文件格式

完整 JSON 结构：

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [ ...元素数组... ],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridSize": null
  },
  "files": {}
}
```

### 与 `create_view` 格式的差异（重要）

| 项目 | create_view | .excalidraw 文件 |
|---|---|---|
| `cameraUpdate` 伪元素 | 需要（第一个元素） | **不写入文件**，文件里没有这个概念 |
| `restoreCheckpoint` / `delete` 伪元素 | 用于增量修改 | 不写入文件 |
| shape 的 `label` 字段 | 语法糖，自动居中 | **必须**拆成独立 `text` 元素 + `containerId` 绑定 |
| 元素必填字段 | 宽松，有默认值 | 严格，需补全所有字段 |

### 元素必填字段清单

所有元素通用：
```json
{
  "type": "rectangle|ellipse|diamond|arrow|line|text",
  "id": "唯一字符串",
  "x": 数字, "y": 数字,
  "width": 数字, "height": 数字,
  "angle": 0,
  "strokeColor": "#464650",
  "backgroundColor": "transparent",
  "fillStyle": "solid",
  "strokeWidth": 2,
  "strokeStyle": "solid",
  "roughness": 0,
  "opacity": 100,
  "groupIds": [],
  "frameId": null,
  "roundness": null,
  "seed": 1001,
  "version": 1,
  "versionNonce": 1001,
  "isDeleted": false,
  "boundElements": [],
  "updated": 1714000000000,
  "link": null,
  "locked": false
}
```

Text 元素额外字段：
```json
{
  "text": "实际文字",
  "fontSize": 18,
  "fontFamily": 1,
  "textAlign": "center",
  "verticalAlign": "middle",
  "containerId": null,
  "originalText": "实际文字",
  "lineHeight": 1.25,
  "baseline": 16
}
```
- `fontFamily`：1=Virgil（手绘）、2=Helvetica、3=Cascadia
- `containerId`：如果要绑定到某个 shape 内部居中，填 shape 的 id；否则 null
- `baseline` ≈ `fontSize - 2`

Arrow 元素额外字段：
```json
{
  "points": [[0,0], [290,0]],
  "lastCommittedPoint": null,
  "startBinding": null,
  "endBinding": null,
  "startArrowhead": null,
  "endArrowhead": "arrow"
}
```

### 箭头绑定到节点（startBinding / endBinding）

不绑定时箭头与节点脱离——用户移动节点后箭头不跟着走，编辑体验差。**默认要绑定**。

```json
{
  "type": "arrow", "id": "a1",
  "x": 260, "y": 130, "width": 140, "height": 0,
  "points": [[0,0],[140,0]],
  "startBinding": {
    "elementId": "b1",
    "focus": 0,
    "gap": 4,
    "fixedPoint": [1, 0.5]
  },
  "endBinding": {
    "elementId": "b2",
    "focus": 0,
    "gap": 4,
    "fixedPoint": [0, 0.5]
  },
  "endArrowhead": "arrow"
}
```

字段含义：
- `elementId`：绑定到哪个 shape 的 id
- `focus`：箭头在节点边缘的偏移量，`0` 居中，范围 `[-1, 1]`
- `gap`：箭头末端与节点边缘的留白像素，一般 4-8
- `fixedPoint`：**可选**，把绑定锁定到节点的某个固定锚点。值是 `[x, y]` 归一化坐标：
  - `[0.5, 0]` 上中
  - `[0.5, 1]` 下中
  - `[0, 0.5]` 左中
  - `[1, 0.5]` 右中
  - 不写 fixedPoint 时，Excalidraw 会根据箭头方向自动算最近边

**被绑定的 shape** 必须在 `boundElements` 里引用该箭头：
```json
{
  "type": "rectangle", "id": "b1",
  "boundElements": [{ "type": "arrow", "id": "a1" }]
}
```
（`fill-defaults.mjs` 目前不会自动维护这个反向引用——如果要严格的绑定，需要在紧凑 spec 里显式写 `boundElements`。）

Rectangle / ellipse / diamond 没有额外字段，但如果要带 label，要在 `boundElements` 里引用 text：
```json
{
  "type": "rectangle",
  "id": "h-user",
  ...
  "boundElements": [{"type": "text", "id": "t-user"}]
}
```
对应的 text 元素要把 `containerId` 设成 `"h-user"`。

### 朝左的箭头怎么写

`create_view` 里可以用负 width + 负 points，但 .excalidraw 文件里推荐规范写法：
```json
{
  "type": "arrow",
  "x": 100, "y": 276,
  "width": 580, "height": 0,
  "points": [[580, 0], [0, 0]],
  "endArrowhead": "arrow"
}
```
起点在右（x=680 逻辑位置 = x + points[0][0] = 100+580），终点在左（x=100），箭头指向左（`endArrowhead` 在 `points` 数组的最后一个点）。

---

## 共享工具（`<skill-dir>/tools/`）

Skill 根目录下的 `tools/` 提供两个跨项目共享的脚本：

- **`fill-defaults.mjs`**：紧凑 spec → 完整 `.excalidraw`。补全所有必填字段，desugar `label: {...}` 语法糖为独立 text + `containerId` 绑定。
- **`render.mjs`**：`.excalidraw` → PNG。用 Puppeteer + Excalidraw 官方 `exportToCanvas` API。

### 首次安装

```bash
cd <skill-dir>/tools && npm install
```

首次运行 Puppeteer 会下载 ~170MB Chromium（`~/.cache/puppeteer/`），之后复用。

**离线 / 受限网络**：跳过 Chromium 下载，指向系统 Chrome：
```bash
cd <skill-dir>/tools
PUPPETEER_SKIP_DOWNLOAD=1 npm install
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```
`render.mjs` 会自动探测常见系统 Chrome 路径（macOS / Linux / Windows），也尊重 `PUPPETEER_EXECUTABLE_PATH` 环境变量。

### 调用流程

```bash
# Step 1：紧凑 spec → 完整 .excalidraw
node <skill-dir>/tools/fill-defaults.mjs <folder>/diagram.compact.json <folder>/diagram.excalidraw

# Step 2：.excalidraw → PNG
node <skill-dir>/tools/render.mjs <folder>/diagram.excalidraw
```

### 紧凑 spec 示例

Claude 只需要写这些，脚本补全所有其他字段：

```json
{
  "elements": [
    {
      "type": "rectangle", "id": "b1",
      "x": 100, "y": 100, "width": 160, "height": 60,
      "backgroundColor": "#b8d4d4", "roundness": { "type": 3 },
      "label": { "text": "User" }
    },
    {
      "type": "rectangle", "id": "b2",
      "x": 400, "y": 100, "width": 160, "height": 60,
      "backgroundColor": "#548484", "roundness": { "type": 3 },
      "label": { "text": "API", "strokeColor": "#ffffff" }
    },
    {
      "type": "arrow", "id": "a1",
      "x": 260, "y": 130, "width": 140, "height": 0,
      "points": [[0, 0], [140, 0]],
      "strokeColor": "#2c2c2c"
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" }
}
```

对比手写完整 `.excalidraw`（节省 ~70% token）：
- 不用写 `angle`, `seed`, `version`, `versionNonce`, `isDeleted`, `updated`, `link`, `locked`, `groupIds`, `frameId`, `opacity`, `fillStyle`, `strokeWidth`, `strokeStyle`, `roughness`
- 不用手动拆 `label` 成独立 text + 建立 `boundElements` / `containerId` 双向引用
- text 的 `fontFamily`, `textAlign`, `verticalAlign`, `lineHeight`, `baseline`, `originalText` 全部自动

### Fallback（脚本不可用时）

如果 `<skill-dir>/tools/` 没装好（首次使用 + npm install 失败），**保留 `.excalidraw`**，告知用户手动导出：

```
PNG 生成工具尚未就绪，请手动操作：
1. 打开 https://excalidraw.com
2. 左上角菜单 → Open → 选择 diagram.excalidraw
3. 菜单 → Export image → PNG
```

或者用 VS Code / Cursor 的 `pomdtr.excalidraw-editor` 插件打开后右键导出。

> **为什么不用 `npx excalidraw_export`**：它依赖 `canvas@2` 原生模块，在 Node 20+ / Xcode 15+ 下 `<stdlib.h>` 头文件冲突编译失败，已一年多无维护。

---

## 打开 / 编辑 `.excalidraw` 文件

| 方式 | 步骤 |
|---|---|
| **excalidraw.com 网页版** | 左上角菜单 → Open → 选择 .excalidraw 文件 |
| **VS Code 插件** | 安装 `pomdtr.excalidraw-editor` → 直接双击文件打开 |
| **Cursor 插件** | 同上，装 `pomdtr.excalidraw-editor` |
| **Obsidian 插件** | 安装 Excalidraw 插件 → 在 vault 里打开 .excalidraw 文件 |

---

## 完整示例：最小 `.excalidraw` 文件

两个矩形 + 一条箭头 + 箭头 label：

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [
    {
      "type": "rectangle", "id": "b1",
      "x": 100, "y": 100, "width": 160, "height": 60,
      "angle": 0, "strokeColor": "#464650", "backgroundColor": "#b8d4d4",
      "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
      "roughness": 0, "opacity": 100,
      "groupIds": [], "frameId": null, "roundness": {"type": 3},
      "seed": 1001, "version": 1, "versionNonce": 1001,
      "isDeleted": false, "boundElements": [{"type": "text", "id": "t1"}],
      "updated": 1714000000000, "link": null, "locked": false
    },
    {
      "type": "text", "id": "t1",
      "x": 130, "y": 119, "width": 100, "height": 22,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent",
      "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
      "roughness": 0, "opacity": 100,
      "groupIds": [], "frameId": null, "roundness": null,
      "seed": 1002, "version": 1, "versionNonce": 1002,
      "isDeleted": false, "boundElements": [],
      "updated": 1714000000000, "link": null, "locked": false,
      "text": "Start", "fontSize": 18, "fontFamily": 1,
      "textAlign": "center", "verticalAlign": "middle",
      "containerId": "b1", "originalText": "Start",
      "lineHeight": 1.25, "baseline": 16
    },
    {
      "type": "rectangle", "id": "b2",
      "x": 400, "y": 100, "width": 160, "height": 60,
      "angle": 0, "strokeColor": "#464650", "backgroundColor": "#548484",
      "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
      "roughness": 0, "opacity": 100,
      "groupIds": [], "frameId": null, "roundness": {"type": 3},
      "seed": 1003, "version": 1, "versionNonce": 1003,
      "isDeleted": false, "boundElements": [{"type": "text", "id": "t2"}],
      "updated": 1714000000000, "link": null, "locked": false
    },
    {
      "type": "text", "id": "t2",
      "x": 430, "y": 119, "width": 100, "height": 22,
      "angle": 0, "strokeColor": "#ffffff", "backgroundColor": "transparent",
      "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
      "roughness": 0, "opacity": 100,
      "groupIds": [], "frameId": null, "roundness": null,
      "seed": 1004, "version": 1, "versionNonce": 1004,
      "isDeleted": false, "boundElements": [],
      "updated": 1714000000000, "link": null, "locked": false,
      "text": "End", "fontSize": 18, "fontFamily": 1,
      "textAlign": "center", "verticalAlign": "middle",
      "containerId": "b2", "originalText": "End",
      "lineHeight": 1.25, "baseline": 16
    },
    {
      "type": "arrow", "id": "a1",
      "x": 260, "y": 130, "width": 140, "height": 0,
      "angle": 0, "strokeColor": "#2c2c2c", "backgroundColor": "transparent",
      "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
      "roughness": 0, "opacity": 100,
      "groupIds": [], "frameId": null, "roundness": {"type": 2},
      "seed": 1005, "version": 1, "versionNonce": 1005,
      "isDeleted": false, "boundElements": [],
      "updated": 1714000000000, "link": null, "locked": false,
      "points": [[0, 0], [140, 0]],
      "lastCommittedPoint": null,
      "startBinding": null, "endBinding": null,
      "startArrowhead": null, "endArrowhead": "arrow"
    }
  ],
  "appState": {
    "viewBackgroundColor": "#ffffff",
    "gridSize": null
  },
  "files": {}
}
```

---

## 常见问题

**Q：`.excalidraw` 打开后元素错位 / 看不到？**
检查元素坐标是否离原点太远（如都在 x > 5000）。用 excalidraw.com 打开后按 `Shift+1` 重置视角到画布内容。

**Q：文字在容器里没居中？**
检查：(1) text 元素的 `containerId` 是否指向 shape.id；(2) shape 的 `boundElements` 是否包含 `{"type": "text", "id": <text.id>}`；(3) text 的 `textAlign: "center"` 和 `verticalAlign: "middle"` 是否正确。

**Q：Puppeteer 安装失败 / Chromium 下载超时？**
走方式 2，只给用户 `.excalidraw` 文件和手动导出说明，不要反复重试阻塞对话。

**Q：为什么不用 `npx excalidraw_export`？**
它绑定 `canvas@2` 原生模块，在 Node 20+ / Xcode 15+ 下编译失败（`<stdlib.h>` 头文件冲突），已经一年多无更新。Puppeteer 方案不依赖原生编译。

**Q：用户明确说"只要 .png" 或"只要 .excalidraw"？**
按用户指示来，默认两个都生成。
