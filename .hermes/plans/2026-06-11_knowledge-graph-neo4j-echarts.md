# LingMo 知识图谱重构计划 - Neo4j + ECharts 版本

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 使用 Neo4j + ECharts 重构 LingMo 知识图谱模块，实现专业级图可视化

**Architecture:** Tauri Backend (Rust) → Neo4j Driver → Neo4j Database，Frontend (Next.js) → ECharts Graph

**Tech Stack:** Neo4j 5.x, ECharts 5.x, Tauri, Next.js, Zustand, TypeScript

---

## 一、环境准备

### Task 1.1: 安装 Neo4j Desktop

**Objective:** 在本地安装并配置 Neo4j Desktop

**Step 1: 下载 Neo4j Desktop**

访问 https://neo4j.com/download/ 下载 Neo4j Desktop

**Step 2: 安装并创建数据库**

1. 安装 Neo4j Desktop
2. 创建新项目 "LingMo"
3. 添加本地数据库：
   - Name: `lingmo-graph`
   - Version: `5.x` (最新稳定版)
   - Password: `lingmo123` (或自定义)

**Step 3: 安装 APOC 插件**

在数据库管理页面 → Plugins → 安装 APOC

**Step 4: 启动数据库**

点击 "Start" 启动数据库，确认状态为 "Active"

**Step 5: 验证连接**

打开 Neo4j Browser (http://localhost:7474)，执行：

```cypher
RETURN "Neo4j is working!" AS message
```

---

### Task 1.2: 创建 Neo4j 数据模型

**Objective:** 设计知识图谱的节点和关系类型

**文件:**
- Create: `src-tauri/src/neo4j/schema.cypher`

**Step 1: 创建约束和索引**

```cypher
// schema.cypher

// 节点唯一性约束
CREATE CONSTRAINT note_id IF NOT EXISTS
FOR (n:Note) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT concept_id IF NOT EXISTS
FOR (c:Concept) REQUIRE c.id IS UNIQUE;

CREATE CONSTRAINT person_id IF NOT EXISTS
FOR (p:Person) REQUIRE p.id IS UNIQUE;

CREATE CONSTRAINT project_id IF NOT EXISTS
FOR (p:Project) REQUIRE p.id IS UNIQUE;

CREATE CONSTRAINT tag_id IF NOT EXISTS
FOR (t:Tag) REQUIRE t.id IS UNIQUE;

// 索引
CREATE INDEX note_title IF NOT EXISTS
FOR (n:Note) ON (n.title);

CREATE INDEX note_created IF NOT EXISTS
FOR (n:Note) ON (n.createdAt);

CREATE INDEX node_label IF NOT EXISTS
FOR (n) ON (n.nodeLabel);

// 全文索引 (用于搜索)
CREATE FULLTEXT INDEX node_search IF NOT EXISTS
FOR (n:Note|Concept|Person|Project) ON EACH [n.title, n.content, n.nodeLabel];
```

**Step 2: 定义节点类型**

```cypher
// 节点类型说明

// :Note - 笔记节点
// Properties: id, title, content, filePath, createdAt, updatedAt, wordCount

// :Concept - 概念节点 (从笔记中提取)
// Properties: id, name, description, frequency

// :Person - 人物节点
// Properties: id, name, role, organization

// :Project - 项目节点
// Properties: id, name, status, description

// :Tag - 标签节点
// Properties: id, name, color

// 关系类型
// :REFERENCES - 引用关系 (笔记→笔记)
// :CONTAINS - 包含关系 (笔记→概念)
// :MENTIONS - 提及关系 (笔记→人物)
// :BELONGS_TO - 属于关系 (笔记→项目)
// :HAS_TAG - 标签关系 (笔记→标签)
// :SEMANTIC - 语义相似 (笔记↔笔记, 带权重)
// :WIKILINK - Wiki链接 (笔记↔笔记)
```

---

## 二、Tauri Backend 集成 Neo4j

### Task 2.1: 添加 Neo4j Rust 依赖

**Objective:** 在 Tauri 项目中集成 Neo4j 驱动

**文件:**
- Modify: `src-tauri/Cargo.toml`

**Step 1: 添加依赖**

```toml
# src-tauri/Cargo.toml

[dependencies]
# ... 现有依赖

# Neo4j 驱动
neo4rs = "0.7"  # Neo4j Rust driver

# 异步运行时
tokio = { version = "1", features = ["full"] }

# 序列化
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

**Step 2: 创建 Neo4j 连接模块**

**文件:**
- Create: `src-tauri/src/neo4j/mod.rs`
- Create: `src-tauri/src/neo4j/connection.rs`

```rust
// src-tauri/src/neo4j/connection.rs

use neo4rs::*;
use std::sync::Arc;
use tokio::sync::OnceCell;

static NEO4J: OnceCell<Arc<Graph>> = OnceCell::const_new();

pub async fn get_graph() -> Arc<Graph> {
    NEO4J.get_or_init(|| async {
        let uri = "bolt://localhost:7687";
        let user = "neo4j";
        let pass = "lingmo123"; // 从配置读取
        
        let graph = Graph::new(uri, user, pass).await.unwrap();
        Arc::new(graph)
    }).await.clone()
}

pub async fn init_neo4j() -> Result<(), Box<dyn std::error::Error>> {
    let graph = get_graph().await;
    
    // 执行初始化查询
    let mut result = graph.execute(
        query("RETURN 1 AS test")
    ).await?;
    
    while let Some(row) = result.next().await? {
        let test: i64 = row.get("test")?;
        println!("Neo4j connected! Test: {}", test);
    }
    
    Ok(())
}
```

**Step 3: 创建图谱服务模块**

**文件:**
- Create: `src-tauri/src/neo4j/graph_service.rs`

```rust
// src-tauri/src/neo4j/graph_service.rs

use neo4rs::*;
use serde::{Deserialize, Serialize};
use super::connection::get_graph;

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub node_type: String,
    pub node_label: String,
    pub properties: serde_json::Value,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub label: String,
    pub weight: Option<f64>,
    pub properties: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

pub async fn create_node(node: GraphNode) -> Result<GraphNode, Box<dyn std::error::Error>> {
    let graph = get_graph().await;
    
    let query_str = format!(
        "CREATE (n:{} {{id: $id, nodeLabel: $label, createdAt: datetime()}}) 
         SET n += $props 
         RETURN n",
        node.node_type
    );
    
    let result = graph.execute(
        query(&query_str)
            .param("id", &node.id)
            .param("label", &node.node_label)
            .param("props", &node.properties)
    ).await?;
    
    Ok(node)
}

pub async fn create_edge(edge: GraphEdge) -> Result<GraphEdge, Box<dyn std::error::Error>> {
    let graph = get_graph().await;
    
    let query_str = format!(
        "MATCH (a {{id: $source}}), (b {{id: $target}})
         CREATE (a)-[r:{} {{id: $id, weight: $weight}}]->(b)
         SET r += $props
         RETURN r",
        edge.label
    );
    
    graph.execute(
        query(&query_str)
            .param("id", &edge.id)
            .param("source", &edge.source)
            .param("target", &edge.target)
            .param("weight", &edge.weight.unwrap_or(1.0))
            .param("props", &edge.properties)
    ).await?;
    
    Ok(edge)
}

pub async fn get_graph_data(filters: Option<serde_json::Value>) -> Result<GraphData, Box<dyn std::error::Error>> {
    let graph = get_graph().await;
    
    // 获取所有节点
    let nodes_query = "MATCH (n) WHERE n.deletedAt IS NULL 
                       RETURN n.id AS id, labels(n)[0] AS type, 
                              n.nodeLabel AS label, properties(n) AS props";
    
    let mut nodes = Vec::new();
    let mut result = graph.execute(query(nodes_query)).await?;
    
    while let Some(row) = result.next().await? {
        let node = GraphNode {
            id: row.get("id")?,
            node_type: row.get("type")?,
            node_label: row.get("label")?,
            properties: row.get("props")?,
            x: None,
            y: None,
        };
        nodes.push(node);
    }
    
    // 获取所有边
    let edges_query = "MATCH (a)-[r]->(b) 
                       RETURN r.id AS id, a.id AS source, b.id AS target, 
                              type(r) AS label, r.weight AS weight, 
                              properties(r) AS props";
    
    let mut edges = Vec::new();
    let mut result = graph.execute(query(edges_query)).await?;
    
    while let Some(row) = result.next().await? {
        let edge = GraphEdge {
            id: row.get("id")?,
            source: row.get("source")?,
            target: row.get("target")?,
            label: row.get("label")?,
            weight: row.get("weight")?,
            properties: row.get("props")?,
        };
        edges.push(edge);
    }
    
    Ok(GraphData { nodes, edges })
}

pub async fn find_neighbors(node_id: String, depth: Option<i32>) -> Result<GraphData, Box<dyn std::error::Error>> {
    let graph = get_graph().await;
    let depth = depth.unwrap_or(1);
    
    let query_str = format!(
        "MATCH path = (start {{id: $id}})-[*1..{}]-(neighbor)
         WITH nodes(path) AS ns, relationships(path) AS rs
         UNWIND ns AS n
         WITH DISTINCT n, labels(n)[0] AS type
         RETURN n.id AS id, type, n.nodeLabel AS label, properties(n) AS props",
        depth
    );
    
    // ... 执行查询并返回结果
    
    todo!()
}

pub async fn find_path(source_id: String, target_id: String) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let graph = get_graph().await;
    
    let path_query = "MATCH path = shortestPath((a {id: $source})-[*..10]-(b {id: $target}))
                      RETURN [n IN nodes(path) | n.id] AS path";
    
    let mut result = graph.execute(
        query(path_query)
            .param("source", &source_id)
            .param("target", &target_id)
    ).await?;
    
    if let Some(row) = result.next().await? {
        let path: Vec<String> = row.get("path")?;
        Ok(path)
    } else {
        Ok(vec![])
    }
}

pub async fn search_nodes(search_query: String) -> Result<Vec<GraphNode>, Box<dyn std::error::Error>> {
    let graph = get_graph().await;
    
    let query_str = "CALL db.index.fulltext.queryNodes('node_search', $query)
                     YIELD node, score
                     RETURN node.id AS id, labels(node)[0] AS type,
                            node.nodeLabel AS label, properties(node) AS props,
                            score
                     ORDER BY score DESC
                     LIMIT 20";
    
    let mut nodes = Vec::new();
    let mut result = graph.execute(
        query(query_str).param("query", &search_query)
    ).await?;
    
    while let Some(row) = result.next().await? {
        let node = GraphNode {
            id: row.get("id")?,
            node_type: row.get("type")?,
            node_label: row.get("label")?,
            properties: row.get("props")?,
            x: None,
            y: None,
        };
        nodes.push(node);
    }
    
    Ok(nodes)
}
```

**Step 4: 暴露 Tauri 命令**

**文件:**
- Create: `src-tauri/src/commands/graph_commands.rs`

```rust
// src-tauri/src/commands/graph_commands.rs

use tauri::command;
use crate::neo4j::graph_service::*;

#[command]
pub async fn graph_get_data(filters: Option<serde_json::Value>) -> Result<GraphData, String> {
    get_graph_data(filters).await.map_err(|e| e.to_string())
}

#[command]
pub async fn graph_create_node(node: GraphNode) -> Result<GraphNode, String> {
    create_node(node).await.map_err(|e| e.to_string())
}

#[command]
pub async fn graph_create_edge(edge: GraphEdge) -> Result<GraphEdge, String> {
    create_edge(edge).await.map_err(|e| e.to_string())
}

#[command]
pub async fn graph_find_neighbors(node_id: String, depth: Option<i32>) -> Result<GraphData, String> {
    find_neighbors(node_id, depth).await.map_err(|e| e.to_string())
}

#[command]
pub async fn graph_find_path(source: String, target: String) -> Result<Vec<String>, String> {
    find_path(source, target).await.map_err(|e| e.to_string())
}

#[command]
pub async fn graph_search(query: String) -> Result<Vec<GraphNode>, String> {
    search_nodes(query).await.map_err(|e| e.to_string())
}

#[command]
pub async fn graph_delete_node(node_id: String) -> Result<(), String> {
    // 软删除
    let graph = get_graph().await;
    graph.execute(
        query("MATCH (n {id: $id}) SET n.deletedAt = datetime()")
            .param("id", &node_id)
    ).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn graph_update_node_position(node_id: String, x: f64, y: f64) -> Result<(), String> {
    let graph = get_graph().await;
    graph.execute(
        query("MATCH (n {id: $id}) SET n.x = $x, n.y = $y")
            .param("id", &node_id)
            .param("x", &x)
            .param("y", &y)
    ).await.map_err(|e| e.to_string())?;
    Ok(())
}
```

---

## 三、Frontend ECharts 集成

### Task 3.1: 安装 ECharts 依赖

**Objective:** 在前端项目中集成 ECharts

**Step 1: 安装依赖**

```bash
cd "C:\Users\colin\Desktop\AI demo\LingMo"
pnpm add echarts echarts-for-react
```

**Step 2: 创建 ECharts 图谱组件**

**文件:**
- Create: `src/app/core/main/knowledge/components/echarts-graph.tsx`

```typescript
// components/echarts-graph.tsx
'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { useGraphStore } from '../store/graph-store';

// 节点类型配置
const NODE_CATEGORIES = [
  { name: '笔记', itemStyle: { color: '#3b82f6' }, symbol: 'circle' },
  { name: '概念', itemStyle: { color: '#10b981' }, symbol: 'diamond' },
  { name: '人物', itemStyle: { color: '#f59e0b' }, symbol: 'roundRect' },
  { name: '项目', itemStyle: { color: '#8b5cf6' }, symbol: 'triangle' },
  { name: '标签', itemStyle: { color: '#ec4899' }, symbol: 'pin' },
];

// 边类型配置
const EDGE_STYLES: Record<string, any> = {
  WIKILINK: { color: '#3b82f6', type: 'solid', width: 2 },
  REFERENCES: { color: '#10b981', type: 'dashed', width: 1.5 },
  SEMANTIC: { color: '#f59e0b', type: 'dotted', width: 1 },
  CONTAINS: { color: '#8b5cf6', type: 'solid', width: 1 },
  MENTIONS: { color: '#ec4899', type: 'solid', width: 1 },
  HAS_TAG: { color: '#6b7280', type: 'dashed', width: 1 },
};

interface EChartsGraphProps {
  width: number;
  height: number;
}

export function EChartsGraph({ width, height }: EChartsGraphProps) {
  const chartRef = useRef<ReactECharts>(null);
  const { nodes, edges, selectedNode, selectNode, zoom } = useGraphStore();

  // 转换数据为 ECharts 格式
  const getOption = useCallback(() => {
    const categoryMap = new Map<string, number>();
    NODE_CATEGORIES.forEach((cat, idx) => categoryMap.set(cat.name, idx));

    const echartsNodes = nodes.map(node => ({
      id: node.id,
      name: node.nodeLabel,
      category: categoryMap.get(node.nodeType) || 0,
      symbolSize: node.nodeSize || 30,
      x: node.x,
      y: node.y,
      itemStyle: {
        color: node.nodeColor,
        borderColor: selectedNode === node.id ? '#ffffff' : 'transparent',
        borderWidth: selectedNode === node.id ? 3 : 0,
        shadowBlur: selectedNode === node.id ? 20 : 0,
        shadowColor: node.nodeColor,
      },
      label: {
        show: zoom > 0.8,
        position: 'bottom',
        formatter: '{b}',
        fontSize: 12,
        color: '#e2e8f0',
      },
      tooltip: {
        formatter: (params: any) => {
          const nodeData = nodes.find(n => n.id === params.data.id);
          return `
            <div style="padding: 8px;">
              <div style="font-weight: bold; font-size: 14px;">${params.name}</div>
              <div style="color: #94a3b8; margin-top: 4px;">类型: ${nodeData?.nodeType}</div>
              <div style="color: #94a3b8;">连接数: ${nodeData?.connections || 0}</div>
              ${nodeData?.nodeProperties?.content ? 
                `<div style="margin-top: 8px; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">
                  ${nodeData.nodeProperties.content.substring(0, 100)}...
                </div>` : ''
              }
            </div>
          `;
        }
      }
    }));

    const echartsEdges = edges.map(edge => ({
      source: edge.source,
      target: edge.target,
      lineStyle: {
        color: EDGE_STYLES[edge.label]?.color || '#94a3b8',
        type: EDGE_STYLES[edge.label]?.type || 'solid',
        width: EDGE_STYLES[edge.label]?.width || 1,
        curveness: 0.3,
        opacity: 0.6,
      },
      label: {
        show: false,
        formatter: edge.label,
        fontSize: 10,
        color: '#94a3b8',
      },
      emphasis: {
        lineStyle: { width: 3, opacity: 1 },
        label: { show: true }
      }
    }));

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        borderColor: '#1e293b',
        textStyle: { color: '#e2e8f0' },
      },
      legend: {
        data: NODE_CATEGORIES.map(cat => cat.name),
        textStyle: { color: '#94a3b8' },
        top: 10,
        left: 10,
      },
      animationDuration: 1500,
      animationEasingUpdate: 'quinticInOut',
      series: [{
        type: 'graph',
        layout: 'force',
        data: echartsNodes,
        links: echartsEdges,
        categories: NODE_CATEGORIES,
        roam: true,
        draggable: true,
        force: {
          repulsion: 200,
          gravity: 0.1,
          edgeLength: 150,
          friction: 0.6,
          layoutAnimation: true,
        },
        emphasis: {
          focus: 'adjacency',
          blurScope: 'coordinateSystem',
          itemStyle: {
            borderWidth: 3,
            borderColor: '#ffffff',
            shadowBlur: 20,
          },
          lineStyle: {
            width: 3,
          }
        },
        blur: {
          itemStyle: { opacity: 0.2 },
          lineStyle: { opacity: 0.1 },
        },
        scaleLimit: {
          min: 0.3,
          max: 5,
        },
        labelLayout: {
          hideOverlap: true,
        },
        selectedMode: 'single',
        select: {
          itemStyle: {
            borderWidth: 3,
            borderColor: '#ffffff',
            shadowBlur: 20,
          }
        }
      }]
    };
  }, [nodes, edges, selectedNode, zoom]);

  // 事件处理
  const onEvents = {
    'click': (params: any) => {
      if (params.dataType === 'node') {
        selectNode(params.data.id);
      }
    },
    'dblclick': (params: any) => {
      if (params.dataType === 'node') {
        // 双击展开邻居
        const store = useGraphStore.getState();
        store.loadNeighbors(params.data.id);
      }
    },
    'graphRoam': (params: any) => {
      // 同步缩放状态
      const store = useGraphStore.getState();
      store.setZoom(params.zoom || 1);
    },
  };

  return (
    <ReactECharts
      ref={chartRef}
      option={getOption()}
      style={{ width, height }}
      onEvents={onEvents}
      opts={{ renderer: 'canvas' }}
      notMerge={false}
      lazyUpdate={true}
    />
  );
}
```

---

### Task 3.2: 创建图谱状态管理

**Objective:** 使用 Zustand 管理图谱状态

**文件:**
- Create: `src/app/core/main/knowledge/store/graph-store.ts`

```typescript
// store/graph-store.ts
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

interface GraphNode {
  id: string;
  nodeType: string;
  nodeLabel: string;
  nodeColor?: string;
  nodeSize?: number;
  nodeProperties: Record<string, any>;
  x?: number;
  y?: number;
  connections?: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  weight?: number;
}

interface GraphFilters {
  types?: string[];
  search?: string;
  dateRange?: { start: string; end: string };
}

interface GraphState {
  // 数据
  nodes: GraphNode[];
  edges: GraphEdge[];
  filteredNodes: GraphNode[];
  filteredEdges: GraphEdge[];
  
  // 状态
  selectedNode: string | null;
  selectedEdge: string | null;
  hoveredNode: string | null;
  zoom: number;
  filters: GraphFilters;
  
  // UI
  showDetailPanel: boolean;
  showSearchDialog: boolean;
  showFilterPanel: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  loadGraph: () => Promise<void>;
  loadNeighbors: (nodeId: string, depth?: number) => Promise<void>;
  createNode: (type: string, data: any) => Promise<void>;
  createEdge: (source: string, target: string, type: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  selectNode: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setHoveredNode: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setFilters: (filters: Partial<GraphFilters>) => void;
  searchNodes: (query: string) => Promise<void>;
  toggleDetailPanel: () => void;
  toggleSearchDialog: () => void;
  toggleFilterPanel: () => void;
  clearError: () => void;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  // 初始状态
  nodes: [],
  edges: [],
  filteredNodes: [],
  filteredEdges: [],
  selectedNode: null,
  selectedEdge: null,
  hoveredNode: null,
  zoom: 1,
  filters: {},
  showDetailPanel: false,
  showSearchDialog: false,
  showFilterPanel: false,
  isLoading: false,
  error: null,

  // 加载图数据
  loadGraph: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await invoke<{ nodes: GraphNode[]; edges: GraphEdge[] }>('graph_get_data', {
        filters: get().filters
      });
      
      // 计算连接数
      const connectionCounts = new Map<string, number>();
      data.edges.forEach(edge => {
        connectionCounts.set(edge.source, (connectionCounts.get(edge.source) || 0) + 1);
        connectionCounts.set(edge.target, (connectionCounts.get(edge.target) || 0) + 1);
      });
      
      const nodesWithConnections = data.nodes.map(node => ({
        ...node,
        connections: connectionCounts.get(node.id) || 0,
      }));
      
      set({
        nodes: nodesWithConnections,
        edges: data.edges,
        filteredNodes: nodesWithConnections,
        filteredEdges: data.edges,
        isLoading: false,
      });
    } catch (error) {
      set({ error: String(error), isLoading: false });
    }
  },

  // 加载邻居节点
  loadNeighbors: async (nodeId: string, depth: number = 1) => {
    try {
      const data = await invoke<{ nodes: GraphNode[]; edges: GraphEdge[] }>('graph_find_neighbors', {
        nodeId,
        depth,
      });
      
      set(state => {
        const existingNodeIds = new Set(state.nodes.map(n => n.id));
        const existingEdgeIds = new Set(state.edges.map(e => e.id));
        
        const newNodes = data.nodes.filter(n => !existingNodeIds.has(n.id));
        const newEdges = data.edges.filter(e => !existingEdgeIds.has(e.id));
        
        return {
          nodes: [...state.nodes, ...newNodes],
          edges: [...state.edges, ...newEdges],
          filteredNodes: [...state.filteredNodes, ...newNodes],
          filteredEdges: [...state.filteredEdges, ...newEdges],
        };
      });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  // 创建节点
  createNode: async (type: string, data: any) => {
    try {
      const node: GraphNode = {
        id: crypto.randomUUID(),
        nodeType: type,
        nodeLabel: data.title || data.name || 'Untitled',
        nodeColor: data.color,
        nodeSize: data.size || 30,
        nodeProperties: data,
      };
      
      await invoke('graph_create_node', { node });
      
      set(state => ({
        nodes: [...state.nodes, node],
        filteredNodes: [...state.filteredNodes, node],
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  // 创建边
  createEdge: async (source: string, target: string, type: string) => {
    try {
      const edge: GraphEdge = {
        id: crypto.randomUUID(),
        source,
        target,
        label: type,
        weight: 1,
      };
      
      await invoke('graph_create_edge', { edge });
      
      set(state => ({
        edges: [...state.edges, edge],
        filteredEdges: [...state.filteredEdges, edge],
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  // 删除节点
  deleteNode: async (id: string) => {
    try {
      await invoke('graph_delete_node', { nodeId: id });
      
      set(state => ({
        nodes: state.nodes.filter(n => n.id !== id),
        edges: state.edges.filter(e => e.source !== id && e.target !== id),
        filteredNodes: state.filteredNodes.filter(n => n.id !== id),
        filteredEdges: state.filteredEdges.filter(e => e.source !== id && e.target !== id),
        selectedNode: state.selectedNode === id ? null : state.selectedNode,
      }));
    } catch (error) {
      set({ error: String(error) });
    }
  },

  // 搜索节点
  searchNodes: async (query: string) => {
    if (!query.trim()) {
      set({ filteredNodes: get().nodes, filteredEdges: get().edges });
      return;
    }
    
    try {
      const results = await invoke<GraphNode[]>('graph_search', { query });
      const resultIds = new Set(results.map(n => n.id));
      
      set({
        filteredNodes: results,
        filteredEdges: get().edges.filter(e => resultIds.has(e.source) && resultIds.has(e.target)),
      });
    } catch (error) {
      // 降级到本地搜索
      const filtered = get().nodes.filter(n => 
        n.nodeLabel.toLowerCase().includes(query.toLowerCase())
      );
      const filteredIds = new Set(filtered.map(n => n.id));
      
      set({
        filteredNodes: filtered,
        filteredEdges: get().edges.filter(e => filteredIds.has(e.source) && filteredIds.has(e.target)),
      });
    }
  },

  // 其他 actions
  selectNode: (id) => set({ selectedNode: id, showDetailPanel: !!id }),
  selectEdge: (id) => set({ selectedEdge: id }),
  setHoveredNode: (id) => set({ hoveredNode: id }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),
  setFilters: (filters) => set(state => ({ filters: { ...state.filters, ...filters } })),
  toggleDetailPanel: () => set(state => ({ showDetailPanel: !state.showDetailPanel })),
  toggleSearchDialog: () => set(state => ({ showSearchDialog: !state.showSearchDialog })),
  toggleFilterPanel: () => set(state => ({ showFilterPanel: !state.showFilterPanel })),
  clearError: () => set({ error: null }),
}));
```

---

### Task 3.3: 创建主图谱页面

**Objective:** 重构知识图谱页面组件

**文件:**
- Modify: `src/app/core/main/knowledge/knowledge-graph.tsx`

```typescript
// knowledge-graph.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useGraphStore } from './store/graph-store';
import { EChartsGraph } from './components/echarts-graph';
import { GraphToolbar } from './components/toolbar';
import { DetailPanel } from './components/detail-panel';
import { SearchDialog } from './components/search-dialog';
import { FilterPanel } from './components/filter-panel';
import { Button } from '@/components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';

export function KnowledgeGraphPage() {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const {
    loadGraph,
    showDetailPanel,
    showSearchDialog,
    showFilterPanel,
    isLoading,
    error,
    clearError,
  } = useGraphStore();

  // 加载图数据
  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // 监听窗口大小
  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // 错误提示
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">加载失败</h3>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => { clearError(); loadGraph(); }}>
            重试
          </Button>
        </div>
      </div>
    );
  }

  // 加载状态
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">加载知识图谱...</span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-background">
      {/* ECharts 图谱 */}
      <EChartsGraph width={dimensions.width} height={dimensions.height} />
      
      {/* 工具栏 */}
      <GraphToolbar />
      
      {/* 详情面板 */}
      {showDetailPanel && (
        <div className="absolute right-0 top-0 bottom-0 w-80 border-l bg-background/95 backdrop-blur">
          <DetailPanel />
        </div>
      )}
      
      {/* 搜索对话框 */}
      {showSearchDialog && <SearchDialog />}
      
      {/* 筛选面板 */}
      {showFilterPanel && (
        <div className="absolute left-4 top-16 w-64 border rounded-lg bg-background/95 backdrop-blur p-4">
          <FilterPanel />
        </div>
      )}
    </div>
  );
}
```

---

## 四、功能增强

### Task 4.1: 实现详情面板

**Objective:** 显示选中节点的详细信息

**文件:**
- Create: `src/app/core/main/knowledge/components/detail-panel.tsx`

```typescript
// components/detail-panel.tsx
'use client';

import React from 'react';
import { useGraphStore } from '../store/graph-store';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { X, ExternalLink, Link, Unlink } from 'lucide-react';

export function DetailPanel() {
  const { nodes, edges, selectedNode, selectNode, toggleDetailPanel } = useGraphStore();
  
  const node = nodes.find(n => n.id === selectedNode);
  if (!node) return null;

  // 获取相关边
  const relatedEdges = edges.filter(e => e.source === node.id || e.target === node.id);
  const connectedNodeIds = new Set(
    relatedEdges.flatMap(e => [e.source, e.target]).filter(id => id !== node.id)
  );
  const connectedNodes = nodes.filter(n => connectedNodeIds.has(n.id));

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-semibold">{node.nodeLabel}</h3>
        <Button variant="ghost" size="icon" onClick={toggleDetailPanel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* 基本信息 */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">基本信息</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm">类型</span>
                <Badge variant="secondary">{node.nodeType}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">连接数</span>
                <span className="text-sm font-medium">{node.connections || 0}</span>
              </div>
              {node.nodeProperties?.createdAt && (
                <div className="flex justify-between">
                  <span className="text-sm">创建时间</span>
                  <span className="text-sm">{new Date(node.nodeProperties.createdAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* 自定义属性 */}
          {Object.keys(node.nodeProperties || {}).length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">属性</h4>
              <div className="space-y-2">
                {Object.entries(node.nodeProperties).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-sm text-muted-foreground">{key}</span>
                    <span className="text-sm">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 连接的节点 */}
          {connectedNodes.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                连接节点 ({connectedNodes.length})
              </h4>
              <div className="space-y-2">
                {connectedNodes.map(connected => (
                  <div
                    key={connected.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-accent cursor-pointer"
                    onClick={() => selectNode(connected.id)}
                  >
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: connected.nodeColor }}
                    />
                    <span className="text-sm">{connected.nodeLabel}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关系列表 */}
          {relatedEdges.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                关系 ({relatedEdges.length})
              </h4>
              <div className="space-y-2">
                {relatedEdges.map(edge => {
                  const sourceNode = nodes.find(n => n.id === edge.source);
                  const targetNode = nodes.find(n => n.id === edge.target);
                  return (
                    <div key={edge.id} className="text-sm p-2 bg-muted rounded">
                      <div className="flex items-center gap-1">
                        <span>{sourceNode?.nodeLabel}</span>
                        <span className="text-muted-foreground">→</span>
                        <span>{targetNode?.nodeLabel}</span>
                      </div>
                      <Badge variant="outline" className="mt-1">{edge.label}</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="p-4 border-t space-y-2">
        <Button variant="outline" className="w-full" size="sm">
          <ExternalLink className="h-4 w-4 mr-2" />
          打开笔记
        </Button>
        <Button variant="outline" className="w-full" size="sm">
          <Link className="h-4 w-4 mr-2" />
          添加连接
        </Button>
      </div>
    </div>
  );
}
```

---

### Task 4.2: 实现搜索和筛选

**文件:**
- Create: `src/app/core/main/knowledge/components/search-dialog.tsx`
- Create: `src/app/core/main/knowledge/components/filter-panel.tsx`

---

### Task 4.3: 实现导出功能

**文件:**
- Create: `src/app/core/main/knowledge/utils/export.ts`

```typescript
// utils/export.ts
import * as echarts from 'echarts';

export function exportToPNG(chart: echarts.ECharts, filename: string) {
  const url = chart.getDataURL({
    type: 'png',
    pixelRatio: 2,
    backgroundColor: '#0f172a',
  });
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.png`;
  link.click();
}

export function exportToSVG(chart: echarts.ECharts, filename: string) {
  const url = chart.getDataURL({
    type: 'svg',
  });
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.svg`;
  link.click();
}

export function exportToJSON(nodes: any[], edges: any[], filename: string) {
  const data = { nodes, edges, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.json`;
  link.click();
  
  URL.revokeObjectURL(url);
}
```

---

## 五、数据迁移

### Task 5.1: 从旧格式迁移数据

**Objective:** 将现有的 localStorage 数据迁移到 Neo4j

**文件:**
- Create: `scripts/migrate-to-neo4j.ts`

```typescript
// scripts/migrate-to-neo4j.ts
import { invoke } from '@tauri-apps/api/core';

export async function migrateOldGraphData() {
  // 1. 读取旧的布局缓存
  const oldData = localStorage.getItem('knowledge-graph-layout-cache-v5');
  if (!oldData) {
    console.log('No old data to migrate');
    return;
  }

  const oldNodes = JSON.parse(oldData);
  console.log(`Found ${oldNodes.length} nodes to migrate`);

  // 2. 转换为新格式
  const newNodes = oldNodes.map((old: any) => ({
    id: old.id || crypto.randomUUID(),
    nodeType: mapOldType(old.kind || 'note'),
    nodeLabel: old.label || 'Untitled',
    nodeColor: old.color,
    nodeSize: old.radius || 30,
    nodeProperties: {
      createdAt: old.createdAt,
      modifiedAt: old.modifiedAt,
    },
    x: old.x,
    y: old.y,
  }));

  // 3. 批量创建节点
  for (const node of newNodes) {
    try {
      await invoke('graph_create_node', { node });
      console.log(`Migrated: ${node.nodeLabel}`);
    } catch (error) {
      console.error(`Failed to migrate ${node.nodeLabel}:`, error);
    }
  }

  // 4. 读取旧的语义关系
  const semanticEdges = localStorage.getItem('knowledge-graph-semantic-edges');
  if (semanticEdges) {
    const edges = JSON.parse(semanticEdges);
    for (const edge of edges) {
      try {
        await invoke('graph_create_edge', {
          edge: {
            id: crypto.randomUUID(),
            source: edge.source,
            target: edge.target,
            label: edge.type || 'SEMANTIC',
            weight: edge.weight || 1,
          }
        });
      } catch (error) {
        console.error('Failed to migrate edge:', error);
      }
    }
  }

  console.log('Migration complete!');
}

function mapOldType(kind: string): string {
  const typeMap: Record<string, string> = {
    'current': 'Note',
    'hub': 'Note',
    'linked': 'Note',
    'note': 'Note',
  };
  return typeMap[kind] || 'Note';
}
```

---

## 六、测试验证

### 单元测试

```typescript
// __tests__/graph-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGraphStore } from '../store/graph-store';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('GraphStore', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [],
      edges: [],
      selectedNode: null,
    });
  });

  it('should load graph data', async () => {
    const mockData = {
      nodes: [
        { id: '1', nodeType: 'Note', nodeLabel: 'Test Note', nodeProperties: {} },
      ],
      edges: [],
    };
    
    vi.mocked(invoke).mockResolvedValue(mockData);
    
    await useGraphStore.getState().loadGraph();
    
    const state = useGraphStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].nodeLabel).toBe('Test Note');
  });

  it('should select node', () => {
    useGraphStore.getState().selectNode('1');
    
    const state = useGraphStore.getState();
    expect(state.selectedNode).toBe('1');
    expect(state.showDetailPanel).toBe(true);
  });
});
```

### 集成测试

```bash
# 启动 Neo4j
# 启动 Tauri 开发服务器
pnpm tauri dev

# 运行测试
pnpm test

# 类型检查
pnpm typecheck
```

---

## 七、预期效果

| 功能 | 旧版本 | 新版本 (Neo4j + ECharts) |
|------|--------|--------------------------|
| **存储** | localStorage | Neo4j 图数据库 |
| **可视化** | 手写 Canvas | ECharts 专业图表 |
| **节点类型** | 4种 | 5种 (可扩展) |
| **搜索** | 无 | 全文索引搜索 |
| **导出** | 无 | PNG/SVG/JSON |
| **性能** | O(n²) | Neo4j 优化查询 |
| **交互** | 基础 | 高亮/聚焦/拖拽 |
| **扩展性** | 差 | 优秀 |

---

## 八、执行顺序

1. ✅ 安装 Neo4j Desktop
2. ✅ 创建数据模型和约束
3. ✅ 实现 Tauri Neo4j 驱动
4. ✅ 实现图谱服务 API
5. ✅ 集成 ECharts 组件
6. ✅ 实现状态管理
7. ✅ 重构主页面
8. ✅ 实现详情面板
9. ✅ 实现搜索筛选
10. ✅ 实现导出功能
11. ✅ 数据迁移
12. ✅ 测试验证

---

**Plan complete. Ready to execute using subagent-driven-development.**
