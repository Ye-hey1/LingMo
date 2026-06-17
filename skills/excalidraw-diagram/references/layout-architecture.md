# Architecture 布局模板

架构图：展示系统组成、分层、模块关系的图。**默认分层布局**（从上到下的层，层内水平排列模块）。

---

## 基本结构

```
┌─ Frontend 层 ────────────────────────────────┐
│  [Web App]    [Mobile App]                   │
└──────────────────────────────────────────────┘
         ↓               ↓
┌─ Logic 层 ───────────────────────────────────┐
│  [API Gateway]  [Auth]  [Business Service]   │
└──────────────────────────────────────────────┘
         ↓               ↓             ↓
┌─ Data 层 ────────────────────────────────────┐
│  [PostgreSQL]   [Redis]    [S3]              │
└──────────────────────────────────────────────┘
```

---

## 分层规则

### 层的数量
- **典型 3 层**：Frontend → Logic → Data
- **4-5 层**：加入 Edge（CDN/LB）或 External（3rd party）
- **超过 5 层**：考虑合并或分图

### 层的尺寸
- 层宽度 = canvas 可用宽度（比如 camera 800×600，层宽 720，左右各留 40 边距）
- 层高度 ≥ 160（容纳一行节点 + 层标题 + padding）
- 层间距（层之间）≥ 60

### 层的视觉
层用**背景 zone 矩形**表示：
```json
{
  "type": "rectangle",
  "backgroundColor": "#f5ede0",
  "fillStyle": "solid",
  "opacity": 45,
  "strokeColor": "#d4846a",
  "strokeWidth": 1,
  "roughness": 0,
  "roundness": { "type": 3 }
}
```

层标题用独立 `text` 元素放在 zone 左上角内侧，颜色对应 zone 描边色（Frontend 用 `#d4846a`，Logic 用 `#1a5f5a`，Data 用 `#1a5f5a`）。

---

## 坐标计算

### 标准 3 层架构（camera 800×600）

```
Frontend zone: x=40,  y=60,  width=720, height=140
  层内节点 y 中心 = 100，高 60
  层标题：x=60, y=76

Logic zone:    x=40,  y=240, width=720, height=140
  层内节点 y 中心 = 280
  层标题：x=60, y=256

Data zone:     x=40,  y=420, width=720, height=140
  层内节点 y 中心 = 460
  层标题：x=60, y=436

层间距 = 60px（220→240, 400→420）
```

### 层内节点分布

层内节点水平均匀分布：
```
available_width = zone_width - 80 (左右各 40 padding)
node_count = 该层的节点数
node_width = min(200, (available_width - 40*(node_count-1)) / node_count)
gap = (available_width - node_count * node_width) / (node_count + 1)

第 i 个节点 x = zone_x + 40 + gap + i * (node_width + gap)
节点 y = zone_y + 60  (留出层标题空间)
```

**简化版**（3 个节点，zone width 720）：
```
每个节点 width = 200, height = 60
gap = (720 - 80 - 3*200) / 4 = 40
x 分别为：80, 320, 560（加上 zone_x=40 得 120, 360, 600）
y 统一为 zone_y + 60
```

---

## 节点类型映射

| 概念 | Excalidraw 类型 | 配色 |
|---|---|---|
| UI 组件 / 客户端 | `rectangle` + roundness | 用户青绿（`#b8d4d4` / `#464650`）|
| 服务 / 微服务 | `rectangle` + roundness | 业务蓝（`#c3e0fe` / `#464650`）|
| 数据库 / 存储 | `rectangle` + roundness | 数据米白（`#f5ede0` / `#464650`）|
| 外部服务 / 3rd party | `rectangle`（`strokeStyle: "dashed"`）| 用户青绿 |
| 消息队列 / Bus | `ellipse`（扁椭圆）| 决策桃粉（`#e8c0a8` / `#464650`）|
| 用户 / Actor | `ellipse` | 用户青绿（`#b8d4d4` / `#464650`）|

---

## 跨层连接

跨层连线默认是**从上层节点底部到下层节点顶部**，用直线或 L 形 path。

### 简单连接（一对一）
```json
{
  "type": "arrow",
  "startBinding": { "elementId": "frontend-web", "fixedPoint": [0.5, 1] },
  "endBinding": { "elementId": "logic-gateway", "fixedPoint": [0.5, 0] }
}
```
points 的 y 差 = 下层节点 y - 上层节点底部 y = 60-80px。

### 多对多连接

当一层多个节点都连到下层某个节点（比如所有前端都访问 API Gateway），用"收敛"布局：

```
[Web]   [Mobile]   [API Client]
   \        |         /
    \       |        /
     ↓      ↓       ↓
    [API Gateway]
```

每条箭头独立绘制，endBinding 都指向 Gateway 的顶部中点。

### 跳层连接

如果 Frontend 直接访问 Data（绕过 Logic），用 **L 形 path** 绕过中间层的 zone：

```json
{
  "type": "arrow",
  "x": 100, "y": 120,
  "width": 200, "height": 340,
  "points": [[0,0], [0,340], [200,340]],
  "endArrowhead": "arrow"
}
```

从上层节点底部出发，先向左或向右走到层外侧，再向下走到底层，然后水平进入目标节点。

---

## 标准模板：3 层经典架构

camera 800×600，3 层 × 3 节点。

```json
[
  { "type": "cameraUpdate", "width": 800, "height": 600, "x": 0, "y": 0 },

  { "type": "rectangle", "id": "zone-fe",
    "x": 40, "y": 60, "width": 720, "height": 140,
    "backgroundColor": "#f5ede0", "fillStyle": "solid", "opacity": 45,
    "strokeColor": "#d4846a", "strokeWidth": 1, "roughness": 0, "roundness": { "type": 3 } },
  { "type": "text", "id": "zt-fe",
    "x": 60, "y": 76, "text": "Frontend 层", "fontSize": 16,
    "strokeColor": "#d4846a" },

  { "type": "rectangle", "id": "n-web",
    "x": 120, "y": 120, "width": 160, "height": 60,
    "backgroundColor": "#b8d4d4", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "Web App", "fontSize": 16 } },
  { "type": "rectangle", "id": "n-mobile",
    "x": 320, "y": 120, "width": 160, "height": 60,
    "backgroundColor": "#b8d4d4", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "Mobile App", "fontSize": 16 } },
  { "type": "rectangle", "id": "n-admin",
    "x": 520, "y": 120, "width": 160, "height": 60,
    "backgroundColor": "#b8d4d4", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "Admin", "fontSize": 16 } },

  { "type": "rectangle", "id": "zone-logic",
    "x": 40, "y": 240, "width": 720, "height": 140,
    "backgroundColor": "#d8eaea", "fillStyle": "solid", "opacity": 45,
    "strokeColor": "#1a5f5a", "strokeWidth": 1, "roughness": 0, "roundness": { "type": 3 } },
  { "type": "text", "id": "zt-logic",
    "x": 60, "y": 256, "text": "Logic 层", "fontSize": 16,
    "strokeColor": "#1a5f5a" },

  { "type": "rectangle", "id": "n-gateway",
    "x": 120, "y": 300, "width": 160, "height": 60,
    "backgroundColor": "#c3e0fe", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "API Gateway", "fontSize": 16 } },
  { "type": "rectangle", "id": "n-auth",
    "x": 320, "y": 300, "width": 160, "height": 60,
    "backgroundColor": "#c3e0fe", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "Auth Service", "fontSize": 16 } },
  { "type": "rectangle", "id": "n-business",
    "x": 520, "y": 300, "width": 160, "height": 60,
    "backgroundColor": "#c3e0fe", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "Business Logic", "fontSize": 16 } },

  { "type": "rectangle", "id": "zone-data",
    "x": 40, "y": 420, "width": 720, "height": 140,
    "backgroundColor": "#d8eaea", "fillStyle": "solid", "opacity": 20,
    "strokeColor": "#1a5f5a", "strokeWidth": 1, "roughness": 0, "roundness": { "type": 3 } },
  { "type": "text", "id": "zt-data",
    "x": 60, "y": 436, "text": "Data 层", "fontSize": 16,
    "strokeColor": "#1a5f5a" },

  { "type": "rectangle", "id": "n-pg",
    "x": 120, "y": 480, "width": 160, "height": 60,
    "backgroundColor": "#f5ede0", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "PostgreSQL", "fontSize": 16 } },
  { "type": "rectangle", "id": "n-redis",
    "x": 320, "y": 480, "width": 160, "height": 60,
    "backgroundColor": "#f5ede0", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "Redis", "fontSize": 16 } },
  { "type": "rectangle", "id": "n-s3",
    "x": 520, "y": 480, "width": 160, "height": 60,
    "backgroundColor": "#f5ede0", "fillStyle": "solid",
    "strokeColor": "#464650", "roughness": 0, "roundness": { "type": 3 },
    "label": { "text": "S3", "fontSize": 16 } },

  { "type": "arrow", "id": "a-web-gw",
    "x": 200, "y": 180, "width": 0, "height": 120,
    "points": [[0,0],[0,120]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "roughness": 0,
    "startBinding": { "elementId": "n-web", "fixedPoint": [0.5, 1] },
    "endBinding": { "elementId": "n-gateway", "fixedPoint": [0.5, 0] } },
  { "type": "arrow", "id": "a-mobile-gw",
    "x": 400, "y": 180, "width": -200, "height": 120,
    "points": [[0,0],[-200,120]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "roughness": 0,
    "startBinding": { "elementId": "n-mobile", "fixedPoint": [0.5, 1] },
    "endBinding": { "elementId": "n-gateway", "fixedPoint": [0.5, 0] } },
  { "type": "arrow", "id": "a-gw-auth",
    "x": 280, "y": 330, "width": 40, "height": 0,
    "points": [[0,0],[40,0]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "roughness": 0,
    "startBinding": { "elementId": "n-gateway", "fixedPoint": [1, 0.5] },
    "endBinding": { "elementId": "n-auth", "fixedPoint": [0, 0.5] } },
  { "type": "arrow", "id": "a-gw-biz",
    "x": 280, "y": 340, "width": 240, "height": -10,
    "points": [[0,0],[240,-10]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "roughness": 0,
    "startBinding": { "elementId": "n-gateway", "fixedPoint": [1, 0.5] },
    "endBinding": { "elementId": "n-business", "fixedPoint": [0, 0.5] } },
  { "type": "arrow", "id": "a-biz-pg",
    "x": 600, "y": 360, "width": -400, "height": 120,
    "points": [[0,0],[-400,120]], "endArrowhead": "arrow",
    "strokeColor": "#1a5f5a", "roughness": 0, "strokeStyle": "dashed",
    "startBinding": { "elementId": "n-business", "fixedPoint": [0.5, 1] },
    "endBinding": { "elementId": "n-pg", "fixedPoint": [0.5, 0] } },
  { "type": "arrow", "id": "a-biz-redis",
    "x": 600, "y": 360, "width": -200, "height": 120,
    "points": [[0,0],[-200,120]], "endArrowhead": "arrow",
    "strokeColor": "#1a5f5a", "roughness": 0, "strokeStyle": "dashed",
    "startBinding": { "elementId": "n-business", "fixedPoint": [0.5, 1] },
    "endBinding": { "elementId": "n-redis", "fixedPoint": [0.5, 0] } }
]
```

---

## 特殊场景

### 微服务架构（同层多服务）

同层节点数超过 4 个时：
- 降低节点 width 到 140-160
- 或分两行排布（层高度加到 240）
- 或合并小节点成一个"Service Group"

### 包含外部服务

外部服务放在图的**右侧或顶部**，用虚线边框（`strokeStyle: "dashed"`）区分：

```
[Frontend] ... [Auth Service] ··→ [Auth0]  ← 外部
                                   (虚线框)
```

### 包含消息队列

消息队列横跨多个服务时，画成一个扁长的 ellipse 放在服务之间：

```
[Service A]  ──→ ( Message Queue ) ──→  [Service B]
                       (ellipse)
```

---

## camera 策略

| 层数 × 层内最大节点数 | camera | 说明 |
|---|---|---|
| 3 × ≤ 3 | L (800×600) | 标准 3 层架构 |
| 3 × 4 | L 或 XL | 节点变窄 |
| 4 × 3 | XL (1200×900) | 字号 ≥ 18 |
| 5 × 3+ 或 3 × 5+ | XXL (1600×1200) | 字号 ≥ 21 |

通常一个大架构图先用 XL/XXL 全景，**不用多镜头 pan**——架构图更适合静态展示而不是分段叙述。

---

## 常见错误

| 错误 | 修正 |
|---|---|
| zone 压在节点下方（opacity 不够）| opacity 用 30-40，太低看不见，太高遮挡节点 |
| 层高度太小，节点贴边 | 层高度至少 140 = 节点高 60 + 层标题 16 + padding 40+|
| 跨层箭头穿过无关节点 | 用 L 形 path 绕到层的侧边 |
| 节点过多导致水平挤压 | 分两行，或换 XL/XXL camera |
| 层标题和节点重叠 | 节点 y 至少是 zone_y + 60，给标题留空间 |
