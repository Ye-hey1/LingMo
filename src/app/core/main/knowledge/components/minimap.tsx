'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { useGraphStore, type GraphNode } from '../store/graph-store';

interface MinimapProps {
  width?: number;
  height?: number;
}

const NODE_TYPE_COLORS: Record<string, string> = {
  note: '#3b82f6',
  concept: '#10b981',
  person: '#f59e0b',
  project: '#8b5cf6',
  tag: '#ec4899',
};

export function Minimap({ width = 160, height = 120 }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    filteredNodes,
    filteredEdges,
    selectedNode,
    hoveredNode,
    selectNode,
  } = useGraphStore();

  const getNodeColor = useCallback((node: GraphNode) => {
    return node.nodeColor || NODE_TYPE_COLORS[node.nodeType] || '#71717a';
  }, []);

  const drawMinimap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || filteredNodes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of filteredNodes) {
      const x = (node as any).x ?? 0;
      const y = (node as any).y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const padding = 20;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const scaleX = width / (maxX - minX);
    const scaleY = height / (maxY - minY);
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (width - (maxX - minX) * scale) / 2;
    const offsetY = (height - (maxY - minY) * scale) / 2;

    const toMinimapX = (x: number) => (x - minX) * scale + offsetX;
    const toMinimapY = (y: number) => (y - minY) * scale + offsetY;

    ctx.strokeStyle = 'rgba(100, 116, 139, 0.12)';
    ctx.lineWidth = 0.4;
    for (const edge of filteredEdges) {
      const sourceNode = filteredNodes.find(n => n.id === edge.source);
      const targetNode = filteredNodes.find(n => n.id === edge.target);
      if (!sourceNode || !targetNode) continue;

      const x1 = toMinimapX((sourceNode as any).x ?? 0);
      const y1 = toMinimapY((sourceNode as any).y ?? 0);
      const x2 = toMinimapX((targetNode as any).x ?? 0);
      const y2 = toMinimapY((targetNode as any).y ?? 0);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    for (const node of filteredNodes) {
      const x = toMinimapX((node as any).x ?? 0);
      const y = toMinimapY((node as any).y ?? 0);
      const isSelected = selectedNode === node.id;
      const isHovered = hoveredNode === node.id;
      const radius = isSelected ? 3.5 : isHovered ? 3 : 2.2;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = getNodeColor(node);
      ctx.fill();

      if (isSelected || isHovered) {
        ctx.strokeStyle = isSelected ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }, [filteredNodes, filteredEdges, selectedNode, hoveredNode, width, height, getNodeColor]);

  useEffect(() => {
    drawMinimap();
  }, [drawMinimap]);

  const handleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || filteredNodes.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of filteredNodes) {
      const nx = (node as any).x ?? 0;
      const ny = (node as any).y ?? 0;
      minX = Math.min(minX, nx);
      minY = Math.min(minY, ny);
      maxX = Math.max(maxX, nx);
      maxY = Math.max(maxY, ny);
    }

    const padding = 20;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const scaleX = width / (maxX - minX);
    const scaleY = height / (maxY - minY);
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (width - (maxX - minX) * scale) / 2;
    const offsetY = (height - (maxY - minY) * scale) / 2;

    const worldX = (x - offsetX) / scale + minX;
    const worldY = (y - offsetY) / scale + minY;

    let closestNode: GraphNode | null = null;
    let closestDistance = Infinity;

    for (const node of filteredNodes) {
      const nx = (node as any).x ?? 0;
      const ny = (node as any).y ?? 0;
      const distance = Math.sqrt((nx - worldX) ** 2 + (ny - worldY) ** 2);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestNode = node;
      }
    }

    if (closestNode && closestDistance < 30) {
      selectNode(closestNode.id);
    }
  }, [filteredNodes, width, height, selectNode]);

  if (filteredNodes.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-3 right-3 z-20 overflow-hidden rounded-lg border border-border bg-background/95 shadow-lg backdrop-blur-sm"
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="cursor-pointer"
        onClick={handleClick}
      />
    </div>
  );
}
