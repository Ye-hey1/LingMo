# State Machine 布局模板

状态机：展示系统在不同状态之间如何转换的图。适合 UI 页面路由、订单状态流转、Agent 工作流、连接状态等场景。

---

## 基本结构

```
● → [空闲] ──用户点击──→ [加载中] ──成功──→ [完成]
              ↑                │               │
              └────失败────────┘               │
                                               ↓
                                            [关闭] → ◉
```

---

## 特殊节点

| 节点 | 含义 | Excalidraw 画法 |
|---|---|---|
| `●` 初始点 | 状态机的起点 | 小实心圆（ellipse，深色填充，无 label）|
| `◉` 终止点 | 最终状态 | 小圆 + 外层圆圈（两个 ellipse 叠加）|
| `[状态]` | 普通状态 | rectangle + roundness |
| `<判断>` | 分支决策（可选）| diamond |

### 初始点画法

```json
{ "type": "ellipse", "id": "init",
  "x": 95, "y": 95, "width": 30, "height": 30,
  "backgroundColor": "#2c2c2c", "fillStyle": "solid",
  "strokeColor": "#464650", "roughness": 0 }
```

### 终止点画法（双圆）

```json
{ "type": "ellipse", "id": "end-outer",
  "x": 88, "y": 88, "width": 44, "height": 44,
  "backgroundColor": "transparent", "fillStyle": "solid",
  "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0 },
{ "type": "ellipse", "id": "end-inner",
  "x": 96, "y": 96, "width": 28, "height": 28,
  "backgroundColor": "#2c2c2c", "fillStyle": "solid",
  "strokeColor": "#464650", "roughness": 0 }
```

---

## 状态节点配色

状态节点按**功能语义**配色，不按数据流方向：

| 状态类型 | backgroundColor | strokeColor | 示例 |
|---|---|---|---|
| 初始 / 待机 | `#b8d4d4` | `#464650` | 空闲、待命、初始化 |
| 进行中 / 活跃 | `#c3e0fe` | `#464650` | 加载中、处理中、运行中 |
| 等待 / 暂停 | `#f5ede0` | `#464650` | 等待输入、暂停、挂起 |
| 成功 / 完成 | `#548484` | `#464650` | 完成、成功、已确认 |
| 错误 / 失败 | `#ffc9c9` | `#464650` | 失败、超时、拒绝 |
| 中间过渡 | `#e8c0a8` | `#464650` | 审核中、待确认 |

---

## 坐标计算

### 布局方向

**水平流（推荐，状态少于 5 个）**：
```
y 固定（单行）= 200
x 步长 = 状态宽度 + 100（箭头空间）
```

**垂直流（状态多或有循环）**：
```
x 固定（主线）= 300
y 步长 = 状态高度 + 80
```

**网格布局（复杂状态机，5+ 状态）**：
```
每行 3 个状态，列间距 280，行间距 180
从左上角开始，按逻辑顺序排布
```

### 标准节点尺寸

```
普通状态节点：width=180, height=60
长文字状态：width=220, height=60
初始/终止圆点：width=30, height=30（外圆 44×44）
```

---

## 转换箭头

### 单向转换（主流程）

```json
{
  "type": "arrow",
  "strokeColor": "#2c2c2c",
  "strokeWidth": 2,
  "roughness": 0,
  "endArrowhead": "arrow",
  "label": { "text": "触发条件", "fontSize": 14 }
}
```

### 自循环（状态内部动作）

状态保持不变但触发某个动作时使用，画成从节点出发又回到自身的小弧：

```json
{
  "type": "arrow",
  "x": 节点右边x, "y": 节点y,
  "points": [[0,0],[40,0],[40,-50],[0,-50]],
  "endArrowhead": "arrow",
  "strokeColor": "#9ab8c0",
  "strokeWidth": 1.5,
  "roughness": 0,
  "label": { "text": "心跳", "fontSize": 13 }
}
```

### 返回/错误转换

用红色描边的虚线箭头，视觉上区分"异常路径"：

```json
{
  "strokeStyle": "dashed",
  "strokeColor": "#b85050",
  "strokeWidth": 1.5
}
```

---

## 标准模板：订单状态机（水平布局）

camera 1200×900，6 个状态横向铺开。

```json
[
  { "type": "cameraUpdate", "width": 1200, "height": 900, "x": -30, "y": -30 },

  { "type": "text", "id": "title",
    "x": 400, "y": 20, "text": "订单状态机", "fontSize": 22,
    "strokeColor": "#1a5f5a" },

  { "type": "ellipse", "id": "init",
    "x": 45, "y": 185, "width": 30, "height": 30,
    "backgroundColor": "#2c2c2c", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0 },

  { "type": "arrow", "id": "a-init",
    "x": 75, "y": 200, "width": 55, "height": 0,
    "points": [[0,0],[55,0]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "strokeWidth": 2, "roughness": 0 },

  { "type": "rectangle", "id": "n-pending",
    "x": 130, "y": 170, "width": 160, "height": 60,
    "backgroundColor": "#b8d4d4", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "待付款", "fontSize": 16 } },

  { "type": "arrow", "id": "a-pay",
    "x": 290, "y": 200, "width": 80, "height": 0,
    "points": [[0,0],[80,0]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "strokeWidth": 2, "roughness": 0,
    "label": { "text": "付款", "fontSize": 13 },
    "startBinding": { "elementId": "n-pending", "fixedPoint": [1, 0.5] },
    "endBinding": { "elementId": "n-paid", "fixedPoint": [0, 0.5] } },

  { "type": "rectangle", "id": "n-paid",
    "x": 370, "y": 170, "width": 160, "height": 60,
    "backgroundColor": "#c3e0fe", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "已付款", "fontSize": 16 } },

  { "type": "arrow", "id": "a-ship",
    "x": 530, "y": 200, "width": 80, "height": 0,
    "points": [[0,0],[80,0]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "strokeWidth": 2, "roughness": 0,
    "label": { "text": "发货", "fontSize": 13 },
    "startBinding": { "elementId": "n-paid", "fixedPoint": [1, 0.5] },
    "endBinding": { "elementId": "n-shipped", "fixedPoint": [0, 0.5] } },

  { "type": "rectangle", "id": "n-shipped",
    "x": 610, "y": 170, "width": 160, "height": 60,
    "backgroundColor": "#c3e0fe", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "已发货", "fontSize": 16 } },

  { "type": "arrow", "id": "a-deliver",
    "x": 770, "y": 200, "width": 80, "height": 0,
    "points": [[0,0],[80,0]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "strokeWidth": 2, "roughness": 0,
    "label": { "text": "签收", "fontSize": 13 },
    "startBinding": { "elementId": "n-shipped", "fixedPoint": [1, 0.5] },
    "endBinding": { "elementId": "n-done", "fixedPoint": [0, 0.5] } },

  { "type": "rectangle", "id": "n-done",
    "x": 850, "y": 170, "width": 160, "height": 60,
    "backgroundColor": "#548484", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "已完成", "fontSize": 16 } },

  { "type": "arrow", "id": "a-end",
    "x": 1010, "y": 200, "width": 55, "height": 0,
    "points": [[0,0],[55,0]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "strokeWidth": 2, "roughness": 0 },

  { "type": "ellipse", "id": "end-outer",
    "x": 1058, "y": 178, "width": 44, "height": 44,
    "backgroundColor": "transparent", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0 },
  { "type": "ellipse", "id": "end-inner",
    "x": 1066, "y": 186, "width": 28, "height": 28,
    "backgroundColor": "#2c2c2c", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0 },

  { "type": "arrow", "id": "a-cancel",
    "x": 210, "y": 170, "width": 0, "height": -90,
    "points": [[0,0],[0,-90],[630,-90],[630,0]], "endArrowhead": "arrow",
    "strokeColor": "#b85050", "strokeWidth": 1.5, "roughness": 0, "strokeStyle": "dashed",
    "label": { "text": "取消", "fontSize": 13 },
    "endBinding": { "elementId": "n-cancel", "fixedPoint": [0.5, 0] } },

  { "type": "rectangle", "id": "n-cancel",
    "x": 690, "y": 340, "width": 160, "height": 60,
    "backgroundColor": "#ffc9c9", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "已取消", "fontSize": 16 } }
]
```

---

## 复杂状态机的处理

### 超过 8 个状态

- 分层布局：把状态按"阶段"分组，每组用 zone 背景框起来
- 每组 3-4 个状态，zone 颜色对应该阶段的语义色
- 组间用更粗的箭头连接（`strokeWidth: 3`）

### 并行状态

如果系统可以同时处于多个状态（并发），用**虚线分隔线**表示并发区域：

```json
{ "type": "arrow", "id": "fork-line",
  "x": 节点右边x, "y": 区域顶部y,
  "width": 0, "height": 区域高度,
  "points": [[0,0],[0,区域高度]],
  "endArrowhead": null,
  "strokeColor": "#2c2c2c", "strokeWidth": 3,
  "strokeStyle": "solid" }
```

---

## camera 策略

| 状态数 | 布局 | camera |
|---|---|---|
| ≤ 4 | 单行水平 | L (800×600) |
| 5-7 | 单行水平 | XL (1200×900) |
| 8-12 | 两行或网格 | XL (1200×900) |
| 13+ | 分组 + zone | XXL (1600×1200) |

---

## 流式绘制顺序

1. `cameraUpdate`
2. 标题 text
3. 初始点（`●`）
4. 初始点 → 第一个状态的箭头
5. 依次：状态节点 → 出发的转换箭头 → 下一个状态节点
6. 异常/回退路径（最后画，通常绕道，画在主流程之后）
7. 终止点（`◉`）

---

## 常见错误

| 错误 | 修正 |
|---|---|
| 初始点没有画 | 状态机必须有 `●` 起点 |
| 所有箭头都是同色 | 主流程用深色实线，回退/错误用红色虚线 |
| 自循环箭头起终点坐标写错 | points 里用 L 形路径，终点回到起点附近 |
| 状态太多挤在一起 | 超过 8 个改用网格布局或分组 |
| 终止点漏画内层圆 | 双圆两个 ellipse 要叠加，内圆居中于外圆 |
