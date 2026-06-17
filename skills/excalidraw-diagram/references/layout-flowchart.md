# Flowchart 布局模板

流程图：有明确步骤、顺序、决策分支的图。**默认垂直方向**（从上到下）。

---

## 基本结构

```
     [起点]
        ↓
     [步骤 1]
        ↓
    < 决策? >───→ [分支步骤]
        ↓
     [步骤 2]
        ↓
     [终点]
```

---

## 坐标计算

### 主流程（单条纵线）

```
主流程 x 中心 = canvas_width / 2
每个节点中心 x 相同，垂直对齐

起始 y = 80
节点间 y 步长 = node_height + 60 (至少 120px)
```

### 节点尺寸

```
默认 labeled box：
  width: 200
  height: 60

长文字（label > 8 字）：
  width: 240 或更宽（按字符数估算）
  height: 60

决策节点 (diamond)：
  width: 180
  height: 100（diamond 比 rectangle 需要更高）
```

### 分支

决策点两侧分出分支：
```
决策 diamond 的 x 为中心
左分支 x = 决策 x - 280
右分支 x = 决策 x + 280

分支步骤 y = 决策 y + 120
分支步骤完成后需要合流或终止：
  - 合流：两分支 y 步长相同，之后箭头汇入主流程
  - 终止：分支直接走到终点节点
```

---

## 节点类型映射

| 概念 | Excalidraw 类型 | 语义色 |
|---|---|---|
| 起点 / 终点 | `ellipse` | 用户青绿（`#b8d4d4` / `#464650`）或成功青（`#548484`，label `#e8e0d8`）|
| 普通步骤 | `rectangle` + `roundness: {type: 3}` | 业务蓝（`#c3e0fe` / `#464650`，默认）|
| 决策 / 分支 | `diamond` | 决策桃粉（`#e8c0a8` / `#464650`，label `#6b3a2a`）|
| 输入 / 输出 | `rectangle` + `roundness: {type: 3}` | 用户青绿（`#b8d4d4` / `#464650`）|
| 数据操作 | `rectangle` + `roundness: {type: 3}` | 数据米白（`#f5ede0` / `#464650`）|
| 成功终点 | `ellipse` | 成功青（`#548484` / `#464650`，label `#e8e0d8`）|
| 错误终点 | `ellipse` / `rectangle` | 错误粉（`#ffc9c9` / `#464650`，label `#6b1a1a`）|

**注意**：diamond 不能用 `roundness`，它本身就是锐角形状。

---

## 标准模板：3-8 节点垂直流程

假设 camera 800×600，主线 x 居中。

```json
[
  { "type": "cameraUpdate", "width": 800, "height": 600, "x": 0, "y": 0 },

  { "type": "ellipse", "id": "n-start",
    "x": 300, "y": 40, "width": 200, "height": 60,
    "backgroundColor": "#d8eaea", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0,
    "label": { "text": "开始", "fontSize": 18 } },

  { "type": "arrow", "id": "a-1",
    "x": 400, "y": 100, "width": 0, "height": 40,
    "points": [[0,0],[0,40]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "roughness": 0,
    "startBinding": { "elementId": "n-start", "fixedPoint": [0.5, 1] },
    "endBinding": { "elementId": "n-step1", "fixedPoint": [0.5, 0] } },

  { "type": "rectangle", "id": "n-step1",
    "x": 300, "y": 140, "width": 200, "height": 60,
    "backgroundColor": "#c3e0fe", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "处理数据", "fontSize": 16 } },

  { "type": "arrow", "id": "a-2",
    "x": 400, "y": 200, "width": 0, "height": 40,
    "points": [[0,0],[0,40]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "roughness": 0,
    "startBinding": { "elementId": "n-step1", "fixedPoint": [0.5, 1] },
    "endBinding": { "elementId": "n-decision", "fixedPoint": [0.5, 0] } },

  { "type": "diamond", "id": "n-decision",
    "x": 310, "y": 240, "width": 180, "height": 100,
    "backgroundColor": "#e8c0a8", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0,
    "label": { "text": "验证通过?", "fontSize": 16, "strokeColor": "#6b3a2a" } },

  { "type": "arrow", "id": "a-3",
    "x": 400, "y": 340, "width": 0, "height": 40,
    "points": [[0,0],[0,40]], "endArrowhead": "arrow",
    "strokeColor": "#2d5c5c", "roughness": 0,
    "label": { "text": "是", "fontSize": 14 },
    "startBinding": { "elementId": "n-decision", "fixedPoint": [0.5, 1] },
    "endBinding": { "elementId": "n-end", "fixedPoint": [0.5, 0] } },

  { "type": "ellipse", "id": "n-end",
    "x": 300, "y": 380, "width": 200, "height": 60,
    "backgroundColor": "#548484", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0,
    "label": { "text": "完成", "fontSize": 18, "strokeColor": "#ffffff" } }
]
```

---

## 决策分支的处理

### 双分支（Y 型）

```
       < 决策? >
      是 /    \ 否
       ↓      ↓
    [步骤A]  [步骤B]
```

坐标示例（决策在 x=400，y=300）：
- 决策 diamond: x=310, y=240（中心 400, 290）
- 左分支（是）: x=100, y=400
- 右分支（否）: x=540, y=400
- 箭头 label "是" 在左箭头上，"否" 在右箭头上
- 左箭头用 `#1a5f5a`（成功绿），右箭头用 `#b85050`（失败红）

### 分支合流

如果两个分支最后都要合并到后续步骤：
```
    [步骤A]  [步骤B]
       \    /
        ↓  ↓
       [后续]
```

合流节点的 x 回到主流程中线（400）。两条箭头从分支的底部中点，指向合流节点的顶部中点。

---

## 超过 8 节点怎么办

### 方案 A：继续向下（推荐）
增大 camera 到 XL (1200×900) 或 XXL (1600×1200)，节点继续纵向排列。
注意 XL 下字号不能低于 18，XXL 下不能低于 21。

### 方案 B：换成横向
如果节点多但分支少，可以改成左→右：
```
[起点] → [步骤1] → [步骤2] → ... → [终点]
```
x 步长 = 240, y 固定。

### 方案 C：分图
超过 15 节点强烈建议拆分——见 SKILL.md "确认策略"章节。

---

## camera 策略

| 节点数 | camera | 推荐 |
|---|---|---|
| 3-5 | L (800×600) | 单镜头 |
| 6-8 | L (800×600) | 单镜头，稍拥挤 |
| 9-12 | XL (1200×900) | 单镜头，字号 ≥ 18 |
| 13-15 | XL (1200×900) | 先 L 聚焦起点，末尾 XL 全景 |
| > 15 | XXL 或分图 | 见 SKILL.md |

camera 的 x 通常是 0 或 -40（留左边距），y 通常是 -40（留上边距）。

---

## 箭头 binding 速查

```
fixedPoint 四方向：
  顶部中点   [0.5, 0]
  底部中点   [0.5, 1]
  左边中点   [0, 0.5]
  右边中点   [1, 0.5]
```

垂直流程中：
- 从节点向下出发：`fixedPoint: [0.5, 1]`
- 到达下方节点：`fixedPoint: [0.5, 0]`

水平流程中：
- 从节点向右出发：`fixedPoint: [1, 0.5]`
- 到达右侧节点：`fixedPoint: [0, 0.5]`

---

## 流式绘制顺序（z-order）

严格按这个顺序输出 elements：

1. `cameraUpdate`
2. 起点节点
3. 起点 → 步骤1 的箭头
4. 步骤1 节点
5. 步骤1 → 步骤2 的箭头
6. 步骤2 节点
7. ... 依此类推
8. 终点节点

**不要**把所有节点画完再画所有箭头，会让流式动画看起来像"先生成框，后连线"，体验不好。

---

## 常见错误

| 错误 | 修正 |
|---|---|
| 节点 y 重叠（间距 < 120） | y 步长改为 `node_height + 60` |
| label 被截断（文字超框）| 增大 width 或缩小 fontSize（但 ≥ 16）|
| diamond 里的文字贴边 | diamond 的 height 至少 100，width 至少 180 |
| 合流箭头错位 | 确保合流点 x 回到主流程中线 |
| 分支标签（是/否）落到节点上 | 把 label 放在箭头较长的位置，或缩短到单字 |
