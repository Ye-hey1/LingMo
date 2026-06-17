# Sequence 布局模板

时序图：展示多个角色之间按时间顺序传递消息的图。**垂直方向**（从上到下是时间流逝）。

---

## 基本结构

```
 [User]    [Client]   [API]    [DB]      ← Actor headers（顶部）
   │         │         │        │         
   │ login   │         │        │        ← Message 1
   │────────→│         │        │
   │         │ auth    │        │        ← Message 2
   │         │────────→│        │
   │         │         │ query  │        ← Message 3
   │         │         │───────→│
   │         │         │←·······│        ← Return（虚线）
   │         │←········│        │
   │←────────│         │        │
   ↓         ↓         ↓        ↓         ← lifeline（虚线延伸）
```

---

## 坐标计算

### Actor 列布局

```
Actor 数量 N = 2 ~ 6（超过 6 个换架构图）
列宽 = 180-220
第 i 个 actor 的 x 中心：
  actor_spacing = 200
  actor_i_center_x = 80 + i * actor_spacing  (i 从 0 开始)
```

举例（4 个 actor，camera 800×600）：
- actor 0 center: x = 80，header x = 80-70 = 10
- actor 1 center: x = 280
- actor 2 center: x = 480
- actor 3 center: x = 680

如果 actor 超过 4 个，camera 必须升级到 XL (1200×900)。

### Header 节点

每个 actor 的顶部 header（一个 rectangle）：
```
width: 140
height: 50
y: 40 (统一)
x: actor_center_x - 70
```

### Lifeline（生命线）

从 header 底部向下延伸的**虚线**（不是箭头）：
```
{
  "type": "arrow",
  "x": actor_center_x,
  "y": 90 (header 底部),
  "width": 0,
  "height": lifeline_height,  // 覆盖到最后一条消息下方
  "points": [[0,0],[0,lifeline_height]],
  "strokeStyle": "dashed",
  "strokeColor": "#b0b0b0",
  "strokeWidth": 1,
  "endArrowhead": null
}
```

### 消息

消息是**水平箭头**，从 source actor 的 lifeline 到 target actor 的 lifeline：
```
第 k 条消息 y = 130 + k * 50   (k 从 0 开始)
source x = source_actor_center_x
target x = target_actor_center_x
width = target_x - source_x（可为负，表示从右往左）
```

消息间距 ≥ 50px，如果有 label 的消息可以加到 60-70px。

### Return 消息（返回值）

用虚线 + 小箭头：
```json
{
  "type": "arrow",
  "strokeStyle": "dashed",
  "strokeColor": "#06b6d4",
  ...
}
```

---

## Actor 类型映射

| 概念 | Header 颜色 | 典型 |
|---|---|---|
| 人类用户 | 用户青绿（`#b8d4d4` / `#464650`）| User, Customer, Admin |
| 前端 / 客户端 | 用户青绿（`#b8d4d4` / `#464650`）| Web, Mobile App |
| 服务 / 后端 | 业务蓝（`#c3e0fe` / `#464650`）| API, Service, Worker |
| 数据库 / 存储 | 数据米白（`#f5ede0` / `#464650`）| DB, Redis, S3 |
| 外部系统 | 决策桃粉（`#e8c0a8` / `#464650`）| 3rd party API |

---

## 标准模板：4 actor × 6 消息

camera 800×600。

```json
[
  { "type": "cameraUpdate", "width": 800, "height": 600, "x": 0, "y": 0 },

  { "type": "text", "id": "title",
    "x": 280, "y": 10, "text": "用户登录时序图", "fontSize": 20,
    "strokeColor": "#1e1e1e" },

  { "type": "rectangle", "id": "h-user",
    "x": 10, "y": 40, "width": 140, "height": 50,
    "backgroundColor": "#b8d4d4", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0,
    "roundness": { "type": 3 },
    "label": { "text": "User", "fontSize": 16 } },
  { "type": "arrow", "id": "ll-user",
    "x": 80, "y": 90, "width": 0, "height": 400,
    "points": [[0,0],[0,400]],
    "strokeStyle": "dashed", "strokeColor": "#9ab8c0",
    "strokeWidth": 1, "endArrowhead": null },

  { "type": "rectangle", "id": "h-client",
    "x": 210, "y": 40, "width": 140, "height": 50,
    "backgroundColor": "#b8d4d4", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0,
    "roundness": { "type": 3 },
    "label": { "text": "Web Client", "fontSize": 16 } },
  { "type": "arrow", "id": "ll-client",
    "x": 280, "y": 90, "width": 0, "height": 400,
    "points": [[0,0],[0,400]],
    "strokeStyle": "dashed", "strokeColor": "#9ab8c0",
    "strokeWidth": 1, "endArrowhead": null },

  { "type": "rectangle", "id": "h-api",
    "x": 410, "y": 40, "width": 140, "height": 50,
    "backgroundColor": "#c3e0fe", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0,
    "roundness": { "type": 3 },
    "label": { "text": "API", "fontSize": 16 } },
  { "type": "arrow", "id": "ll-api",
    "x": 480, "y": 90, "width": 0, "height": 400,
    "points": [[0,0],[0,400]],
    "strokeStyle": "dashed", "strokeColor": "#9ab8c0",
    "strokeWidth": 1, "endArrowhead": null },

  { "type": "rectangle", "id": "h-db",
    "x": 610, "y": 40, "width": 140, "height": 50,
    "backgroundColor": "#f5ede0", "fillStyle": "solid",
    "strokeColor": "#464650", "strokeWidth": 2, "roughness": 0,
    "roundness": { "type": 3 },
    "label": { "text": "Database", "fontSize": 16 } },
  { "type": "arrow", "id": "ll-db",
    "x": 680, "y": 90, "width": 0, "height": 400,
    "points": [[0,0],[0,400]],
    "strokeStyle": "dashed", "strokeColor": "#9ab8c0",
    "strokeWidth": 1, "endArrowhead": null },

  { "type": "arrow", "id": "m1",
    "x": 80, "y": 140, "width": 200, "height": 0,
    "points": [[0,0],[200,0]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "strokeWidth": 2, "roughness": 0,
    "label": { "text": "输入账号密码", "fontSize": 14 } },

  { "type": "arrow", "id": "m2",
    "x": 280, "y": 190, "width": 200, "height": 0,
    "points": [[0,0],[200,0]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "strokeWidth": 2, "roughness": 0,
    "label": { "text": "POST /login", "fontSize": 14 } },

  { "type": "arrow", "id": "m3",
    "x": 480, "y": 240, "width": 200, "height": 0,
    "points": [[0,0],[200,0]], "endArrowhead": "arrow",
    "strokeColor": "#2c2c2c", "strokeWidth": 2, "roughness": 0,
    "label": { "text": "SELECT user", "fontSize": 14 } },

  { "type": "arrow", "id": "m4",
    "x": 680, "y": 290, "width": -200, "height": 0,
    "points": [[0,0],[-200,0]], "endArrowhead": "arrow",
    "strokeStyle": "dashed", "strokeColor": "#1a5f5a",
    "strokeWidth": 2, "roughness": 0,
    "label": { "text": "user row", "fontSize": 14 } },

  { "type": "arrow", "id": "m5",
    "x": 480, "y": 340, "width": -200, "height": 0,
    "points": [[0,0],[-200,0]], "endArrowhead": "arrow",
    "strokeStyle": "dashed", "strokeColor": "#1a5f5a",
    "strokeWidth": 2, "roughness": 0,
    "label": { "text": "200 + token", "fontSize": 14 } },

  { "type": "arrow", "id": "m6",
    "x": 280, "y": 390, "width": -200, "height": 0,
    "points": [[0,0],[-200,0]], "endArrowhead": "arrow",
    "strokeStyle": "dashed", "strokeColor": "#1a5f5a",
    "strokeWidth": 2, "roughness": 0,
    "label": { "text": "显示首页", "fontSize": 14 } }
]
```

---

## 消息类型

### 同步调用（实线）
```
source ────→ target
```
`strokeStyle: "solid"`，箭头 `"arrow"`。

### 异步触发（实线 + 空心箭头）
```
source ────▷ target
```
`endArrowhead: "triangle"`。

### 返回值（虚线）
```
source ←···· target
```
`strokeStyle: "dashed"`，方向从返回源指向接收方。

### 自调用（回到自己）

一个消息从 actor 发给自己：
```
actor ─┐
       │
       ←─┘
```
用 L 形 path：
```json
{
  "type": "arrow",
  "x": actor_x, "y": msg_y,
  "width": 40, "height": 30,
  "points": [[0,0], [40,0], [40,30], [0,30]],
  "endArrowhead": "arrow",
  "label": { "text": "validate", "fontSize": 14 }
}
```

---

## 生命周期段（Activation Bar）

可选的增强：在 actor 被激活的时段画一个窄矩形覆盖在 lifeline 上：

```json
{
  "type": "rectangle",
  "x": actor_center_x - 6,
  "y": start_msg_y,
  "width": 12,
  "height": end_msg_y - start_msg_y,
  "backgroundColor": "#d0bfff",
  "fillStyle": "solid",
  "strokeColor": "#8b5cf6",
  "strokeWidth": 1
}
```

MVP 版本可以省略 activation bar，只画 lifeline + 消息。

---

## 备注框（Note）

时序图常有"note"说明某段逻辑，画成小黄框：

```json
{
  "type": "rectangle",
  "backgroundColor": "#fff3bf",
  "fillStyle": "solid",
  "strokeColor": "#f59e0b",
  "strokeWidth": 1,
  "roundness": { "type": 3 },
  "opacity": 80,
  "label": { "text": "注意：此处需要验证 JWT", "fontSize": 14 }
}
```

通常跨 1-2 个 actor，高度 30-40。

---

## camera 策略

| Actor 数 × 消息数 | camera | 说明 |
|---|---|---|
| 2-3 × ≤ 5 | L (800×600) | 简单时序 |
| 4 × 6-8 | L (800×600) | 标准，字号 ≥ 14 |
| 4-5 × 10+ | XL (1200×900) | 消息多时需要增加高度 |
| 5-6 × 12+ | XXL (1600×1200) | 复杂时序 |
| > 6 actor | 分图 | 按子流程拆分 |

消息多时，**lifeline 高度**要够长，覆盖到最后一条消息的 y 位置 + 30px。

---

## 流式绘制顺序

1. `cameraUpdate`
2. 标题 text（可选）
3. 对每个 actor，依次：
   - header rectangle
   - lifeline arrow（虚线）
4. 按消息时间顺序依次画 message arrow
5. Notes（如有）

注意：每个 actor 的 header + lifeline 一起画，而不是所有 header 一起画完再画所有 lifeline。这样流式动画看起来是"每个角色出现时自带生命线"，更自然。

---

## 常见错误

| 错误 | 修正 |
|---|---|
| lifeline 长度不够，最后的消息没有"垂线"可连 | lifeline height 覆盖到 last_msg_y + 30 |
| 消息 label 和箭头重叠 | 缩短 label 或加宽消息 y 间距 |
| 返回消息用了实线 | return 一律用 `strokeStyle: "dashed"` |
| actor 列间距太窄挤压 label | 间距 ≥ 200，必要时升级 camera |
| 超过 6 个 actor | 拆分时序图，或换成架构图 |
