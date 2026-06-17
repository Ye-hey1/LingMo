# Mindmap 布局模板

思维导图：以中心主题为核心，向外辐射分支的图。适合概念整理、知识梳理、头脑风暴。

---

## 基本结构

```
           [分支A]
          /
[中心主题] - [分支B] - [子节点B1]
          \             [子节点B2]
           [分支C]
```

---

## 坐标计算

### 中心节点

```
中心 x = 600, y = 400（camera L 下的画布中心）
中心节点 width = 200, height = 70
```

### 一级分支布局

把 360° 均分给所有一级分支。一级分支数 N 时：

```
每个分支角度 = 360 / N
分支距中心距离 = 220（中心 + 边距 + 分支宽度）

分支 i 的中心坐标：
  angle_i = (360 / N) * i - 90  // 从正上方开始，顺时针
  x_i = center_x + 220 * cos(angle_i °)
  y_i = center_y + 220 * sin(angle_i °)
```

**常用预设**（N=4，camera 800×600）：

| 位置 | x 中心 | y 中心 |
|---|---|---|
| 上 | 600 | 200 |
| 右 | 780 | 400 |
| 下 | 600 | 600 |
| 左 | 420 | 400 |

**常用预设**（N=6，camera 1200×900）：

| 位置 | x 中心 | y 中心 |
|---|---|---|
| 右上 | 800 | 220 |
| 右 | 880 | 450 |
| 右下 | 800 | 680 |
| 左下 | 400 | 680 |
| 左 | 320 | 450 |
| 左上 | 400 | 220 |

### 二级分支

从一级分支节点的边缘向外延伸，距离 160-180px，方向延续一级分支的辐射方向。

```
子节点方向 = 一级分支相对中心的方向（继续向外）
子节点间距 = 80px（垂直方向）
```

### 节点尺寸

| 层级 | width | height | fontSize |
|---|---|---|---|
| 中心 | 200 | 70 | 20 |
| 一级分支 | 160 | 55 | 16 |
| 二级分支 | 140 | 50 | 14 |
| 三级（谨慎使用）| 120 | 44 | 14 |

---

## 节点样式

### 中心节点

用最深的颜色，视觉上最重：

```json
{
  "type": "ellipse",
  "backgroundColor": "#1a5f5a",
  "fillStyle": "solid",
  "strokeColor": "#464650",
  "roughness": 0,
  "label": { "text": "中心主题", "fontSize": 20, "strokeColor": "#ffffff" }
}
```

深色背景必须加 `label.strokeColor: "#e8e0d8"`（暖白），否则默认深色文字在深绿背景上看不清。

### 一级分支

```json
{
  "type": "rectangle",
  "backgroundColor": "#b8d4d4",
  "fillStyle": "solid",
  "strokeColor": "#464650",
  "strokeWidth": 2,
  "roughness": 0,
  "roundness": { "type": 3 }
}
```

### 二级分支（更轻量）

```json
{
  "type": "rectangle",
  "backgroundColor": "#f5ede0",
  "fillStyle": "solid",
  "strokeColor": "#464650",
  "strokeWidth": 1.5,
  "roughness": 0,
  "roundness": { "type": 3 }
}
```

### 连接线

思维导图的连线用**细线，无箭头**，颜色用浅灰：

```json
{
  "type": "arrow",
  "endArrowhead": null,
  "strokeColor": "#9ab8c0",
  "strokeWidth": 1.5,
  "roughness": 0
}
```

中心 → 一级：`strokeWidth: 2`，稍粗。
一级 → 二级：`strokeWidth: 1.5`。
二级 → 三级：`strokeWidth: 1`。

---

## 标准模板：4 个一级分支

camera 800×600，中心在 (400, 300)。

```json
[
  { "type": "cameraUpdate", "width": 800, "height": 600, "x": 0, "y": 0 },

  { "type": "ellipse", "id": "center",
    "x": 310, "y": 265, "width": 180, "height": 70,
    "backgroundColor": "#1a5f5a", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0,
    "label": { "text": "中心主题", "fontSize": 20, "strokeColor": "#ffffff" } },

  { "type": "arrow", "id": "l-top",
    "x": 400, "y": 265, "width": 0, "height": -75,
    "points": [[0,0],[0,-75]], "endArrowhead": null,
    "strokeColor": "#9ab8c0", "strokeWidth": 2, "roughness": 0 },
  { "type": "rectangle", "id": "n-top",
    "x": 320, "y": 140, "width": 160, "height": 55,
    "backgroundColor": "#b8d4d4", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "分支 A", "fontSize": 16 } },

  { "type": "arrow", "id": "l-right",
    "x": 490, "y": 300, "width": 120, "height": 0,
    "points": [[0,0],[120,0]], "endArrowhead": null,
    "strokeColor": "#9ab8c0", "strokeWidth": 2, "roughness": 0 },
  { "type": "rectangle", "id": "n-right",
    "x": 610, "y": 272, "width": 160, "height": 55,
    "backgroundColor": "#b8d4d4", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "分支 B", "fontSize": 16 } },

  { "type": "arrow", "id": "l-bottom",
    "x": 400, "y": 335, "width": 0, "height": 75,
    "points": [[0,0],[0,75]], "endArrowhead": null,
    "strokeColor": "#9ab8c0", "strokeWidth": 2, "roughness": 0 },
  { "type": "rectangle", "id": "n-bottom",
    "x": 320, "y": 410, "width": 160, "height": 55,
    "backgroundColor": "#b8d4d4", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "分支 C", "fontSize": 16 } },

  { "type": "arrow", "id": "l-left",
    "x": 310, "y": 300, "width": -120, "height": 0,
    "points": [[0,0],[-120,0]], "endArrowhead": null,
    "strokeColor": "#9ab8c0", "strokeWidth": 2, "roughness": 0 },
  { "type": "rectangle", "id": "n-left",
    "x": 30, "y": 272, "width": 160, "height": 55,
    "backgroundColor": "#b8d4d4", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "分支 D", "fontSize": 16 } }
]
```

---

## 二级分支示例

从"分支 B"（右侧）向右继续延伸两个子节点：

```json
{ "type": "arrow", "id": "l-b1",
  "x": 770, "y": 285, "width": 80, "height": -40,
  "points": [[0,0],[80,-40]], "endArrowhead": null,
  "strokeColor": "#9ab8c0", "strokeWidth": 1.5, "roughness": 0 },
{ "type": "rectangle", "id": "n-b1",
  "x": 850, "y": 220, "width": 130, "height": 48,
  "backgroundColor": "#f5ede0", "fillStyle": "solid",
  "strokeColor": "#464650", "strokeWidth": 1.5, "roughness": 0, "roundness": { "type": 3 },
  "label": { "text": "子节点 B1", "fontSize": 14 } },

{ "type": "arrow", "id": "l-b2",
  "x": 770, "y": 310, "width": 80, "height": 40,
  "points": [[0,0],[80,40]], "endArrowhead": null,
  "strokeColor": "#9ab8c0", "strokeWidth": 1.5, "roughness": 0 },
{ "type": "rectangle", "id": "n-b2",
  "x": 850, "y": 328, "width": 130, "height": 48,
  "backgroundColor": "#f5ede0", "fillStyle": "solid",
  "strokeColor": "#464650", "strokeWidth": 1.5, "roughness": 0, "roundness": { "type": 3 },
  "label": { "text": "子节点 B2", "fontSize": 14 } }
```

---

## camera 策略

| 一级分支数 × 二级节点数 | camera | 说明 |
|---|---|---|
| 4 × 0 | L (800×600) | 只有一级，很紧凑 |
| 4-6 × 2-3 | XL (1200×900) | 标准思维导图 |
| 6-8 × 3+ | XXL (1600×1200) | 字号 ≥ 21 |
| 分支超密集 | 建议分图 | 每个一级分支单独展开一张图 |

---

## 流式绘制顺序

1. `cameraUpdate`
2. 中心节点（ellipse）
3. 对每个一级分支：
   - 中心 → 分支的连线
   - 分支节点
   - 分支 → 子节点的连线（如有）
   - 子节点（如有）
4. 不要把所有连线画完再画节点

---

## 常见错误

| 错误 | 修正 |
|---|---|
| 分支节点坐标重叠 | 分支间角度要均匀，同侧子节点垂直间距 ≥ 70px |
| 连线穿过其他节点 | 调整分支角度或拉长分支距离 |
| 中心太小，label 被截断 | 中心节点 width ≥ 180，height ≥ 70 |
| 三级以上导致图太密 | 三级节点限制在 2-3 个，更多内容另起一张图 |
| camera 太小，边缘节点被裁 | 先估算最远节点坐标，camera 要留 60px 以上边距 |
