# Knowledge Graph 3D Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the ECharts-based knowledge graph with simulated 3D effects, smooth sphere-like dragging, beautiful bubble labels, and comprehensive node info popups.

**Architecture:** Build on existing ECharts graph implementation, adding CSS 3D transforms for depth, custom drag handlers for inertial scrolling, enhanced label styling, and a detail panel component for node information.

**Tech Stack:** ECharts, React, TypeScript, Tailwind CSS, Zustand

---

## File Structure

### Files to Create
- `src/app/core/main/knowledge/components/node-detail-popup.tsx` - Node info popup component
- `src/app/core/main/knowledge/hooks/use-inertial-drag.ts` - Custom hook for sphere-like dragging

### Files to Modify
- `src/app/core/main/knowledge/components/echarts-graph.tsx` - Main graph component (3D effects, labels, interactions)
- `src/app/core/main/knowledge/store/graph-store.ts` - Store updates for new interactions
- `src/app/core/main/knowledge/components/toolbar.tsx` - Add 3D toggle button

### Files to Delete
- `src/app/core/main/knowledge/knowledge-graph.tsx` - Canvas version (replaced by ECharts)
- `src/app/core/main/knowledge/quadtree.ts` - Canvas-specific dependency
- `src/app/core/main/knowledge/keyword-cluster-canvas.tsx` - Canvas-specific component
- `src/app/core/main/knowledge/keyword-cluster-data.ts` - Canvas-specific data
- `src/app/core/main/knowledge/keyword-cluster-data.spec.mjs` - Canvas-specific test
- `src/app/core/main/knowledge/keyword-cluster-data.js` - Canvas-specific data
- `src/app/core/main/knowledge/keyword-cluster-detail-panel.tsx` - Canvas-specific panel
- `src/app/core/main/knowledge/detail-panel.tsx` - Old detail panel (replaced by new popup)

---

## Task 1: Delete Canvas Version and Clean Up

**Covers:** S1 (Remove Canvas implementation)

**Files:**
- Delete: `src/app/core/main/knowledge/knowledge-graph.tsx`
- Delete: `src/app/core/main/knowledge/quadtree.ts`
- Delete: `src/app/core/main/knowledge/keyword-cluster-canvas.tsx`
- Delete: `src/app/core/main/knowledge/keyword-cluster-data.ts`
- Delete: `src/app/core/main/knowledge/keyword-cluster-data.spec.mjs`
- Delete: `src/app/core/main/knowledge/keyword-cluster-data.js`
- Delete: `src/app/core/main/knowledge/keyword-cluster-detail-panel.tsx`
- Delete: `src/app/core/main/knowledge/detail-panel.tsx`

- [ ] **Step 1: Delete Canvas-specific files**

```bash
# Navigate to project root
cd "C:\Users\colin\Desktop\AI demo\LingMo"

# Delete Canvas version and dependencies
rm src/app/core/main/knowledge/knowledge-graph.tsx
rm src/app/core/main/knowledge/quadtree.ts
rm src/app/core/main/knowledge/keyword-cluster-canvas.tsx
rm src/app/core/main/knowledge/keyword-cluster-data.ts
rm src/app/core/main/knowledge/keyword-cluster-data.spec.mjs
rm src/app/core/main/knowledge/keyword-cluster-data.js
rm src/app/core/main/knowledge/keyword-cluster-detail-panel.tsx
rm src/app/core/main/knowledge/detail-panel.tsx
```

- [ ] **Step 2: Update index.tsx exports**

Remove exports for deleted components from `src/app/core/main/knowledge/index.tsx`:

```typescript
// Remove these lines:
export { KeywordClusterCanvas } from './keyword-cluster-canvas';
export { KeywordClusterDetailPanel } from './keyword-cluster-detail-panel';
export { DetailPanel } from './detail-panel';
```

- [ ] **Step 3: Check for remaining imports**

Search for any remaining imports of deleted files:

```bash
grep -r "keyword-cluster" src/app/core/main/knowledge/ --include="*.tsx" --include="*.ts"
grep -r "quadtree" src/app/core/main/knowledge/ --include="*.tsx" --include="*.ts"
grep -r "detail-panel" src/app/core/main/knowledge/ --include="*.tsx" --include="*.ts"
```

- [ ] **Step 4: Remove any found imports**

If grep finds imports, remove them from the respective files.

- [ ] **Step 5: Verify TypeScript compilation**

```bash
cd "C:\Users\colin\Desktop\AI demo\LingMo"
npx tsc --noEmit --pretty 2>&1 | Select-String -Pattern "error TS" | Select-Object -First 10
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove Canvas-based knowledge graph implementation"
```

---

## Task 2: Add Simulated 3D Effects to Nodes

**Covers:** S2 (3D depth and visual effects)

**Files:**
- Modify: `src/app/core/main/knowledge/components/echarts-graph.tsx:559-671`

- [ ] **Step 1: Update node itemStyle for 3D effect**

In `echarts-graph.tsx`, update the node itemStyle in the `getOption` function:

```typescript
// Find this section (around line 602-620):
itemStyle: {
  color: {
    type: 'radial',
    x: 0.4,
    y: 0.35,
    r: 0.65,
    colorStops: [
      { offset: 0, color: withAlpha(color, 1) },
      { offset: 0.4, color: withAlpha(color, 0.95) },
      { offset: 0.7, color: withAlpha(color, 0.82) },
      { offset: 1, color: withAlpha(mixColors(color, '#000000', 0.15), 0.68) },
    ],
  },
  borderColor: isSelected ? theme.foreground : isHovered ? withAlpha(theme.foreground, 0.8) : withAlpha(color, 0.4),
  borderWidth: isSelected ? 3 : isHovered ? 2.5 : 0.8,
  shadowBlur: isSelected ? 42 : isHovered ? 32 : 6 + importance * 16,
  shadowColor: withAlpha(color, isSelected ? 0.55 : isHovered ? 0.42 : 0.12 + importance * 0.1),
  opacity: isDimmed ? 0.25 : 1,
},

// Replace with enhanced 3D effect:
itemStyle: {
  color: {
    type: 'radial',
    x: 0.35,
    y: 0.3,
    r: 0.7,
    colorStops: [
      { offset: 0, color: withAlpha(mixColors(color, '#ffffff', 0.2), 1) },
      { offset: 0.3, color: withAlpha(color, 1) },
      { offset: 0.6, color: withAlpha(color, 0.92) },
      { offset: 0.85, color: withAlpha(mixColors(color, '#000000', 0.1), 0.78) },
      { offset: 1, color: withAlpha(mixColors(color, '#000000', 0.25), 0.55) },
    ],
  },
  borderColor: isSelected 
    ? theme.foreground 
    : isHovered 
      ? withAlpha(theme.foreground, 0.9) 
      : withAlpha(mixColors(color, '#ffffff', 0.3), 0.6),
  borderWidth: isSelected ? 3.5 : isHovered ? 2.8 : 1.2,
  shadowBlur: isSelected ? 48 : isHovered ? 36 : 8 + importance * 20,
  shadowOffsetX: 2 + importance * 3,
  shadowOffsetY: 3 + importance * 4,
  shadowColor: withAlpha('#000000', isSelected ? 0.45 : isHovered ? 0.38 : 0.18 + importance * 0.12),
  opacity: isDimmed ? 0.2 : 1,
},
```

- [ ] **Step 2: Add 3D container perspective**

Add CSS perspective to the graph container:

```typescript
// Find the return statement (around line 992-1008):
return (
  <div
    className="relative h-full w-full touch-none bg-background"
    onWheel={handleWheel}
  >
    <ReactECharts ... />
  </div>
);

// Replace with:
return (
  <div
    className="relative h-full w-full touch-none bg-background"
    style={{ perspective: '1200px', perspectiveOrigin: '50% 50%' }}
    onWheel={handleWheel}
  >
    <div style={{ transformStyle: 'preserve-3d', transform: 'rotateX(2deg)' }}>
      <ReactECharts ... />
    </div>
  </div>
);
```

- [ ] **Step 3: Verify visual effect**

Run the development server and check the knowledge graph:

```bash
cd "C:\Users\colin\Desktop\AI demo\LingMo"
pnpm run dev
```

Open the knowledge graph and verify:
- Nodes have 3D-like appearance with shadows
- Gradient gives depth illusion
- Hover effect shows "lift" effect

- [ ] **Step 4: Commit**

```bash
git add src/app/core/main/knowledge/components/echarts-graph.tsx
git commit -m "feat: add simulated 3D effects to knowledge graph nodes"
```

---

## Task 3: Implement Sphere-Like Inertial Dragging

**Covers:** S3 (Smooth sphere-like drag behavior)

**Files:**
- Create: `src/app/core/main/knowledge/hooks/use-inertial-drag.ts`
- Modify: `src/app/core/main/knowledge/components/echarts-graph.tsx`

- [ ] **Step 1: Create inertial drag hook**

Create `src/app/core/main/knowledge/hooks/use-inertial-drag.ts`:

```typescript
import { useCallback, useRef, useEffect } from 'react';

interface InertialDragOptions {
  onDrag: (deltaX: number, deltaY: number) => void;
  onDragStart?: () => void;
  onDragEnd?: (velocityX: number, velocityY: number) => void;
  friction?: number;
  maxVelocity?: number;
}

export function useInertialDrag({
  onDrag,
  onDragStart,
  onDragEnd,
  friction = 0.92,
  maxVelocity = 25,
}: InertialDragOptions) {
  const isDragging = useRef(false);
  const lastPosition = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const animationFrame = useRef<number>(0);
  const lastTime = useRef(0);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return; // Only left click
    
    isDragging.current = true;
    lastPosition.current = { x: event.clientX, y: event.clientY };
    lastTime.current = Date.now();
    velocity.current = { x: 0, y: 0 };
    
    onDragStart?.();
    
    // Stop any ongoing animation
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = 0;
    }
  }, [onDragStart]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (!isDragging.current) return;
    
    const currentTime = Date.now();
    const deltaTime = Math.max(1, currentTime - lastTime.current);
    
    const deltaX = event.clientX - lastPosition.current.x;
    const deltaY = event.clientY - lastPosition.current.y;
    
    // Calculate velocity (pixels per millisecond)
    velocity.current = {
      x: (deltaX / deltaTime) * 16, // Normalize to ~60fps
      y: (deltaY / deltaTime) * 16,
    };
    
    // Clamp velocity
    const speed = Math.sqrt(velocity.current.x ** 2 + velocity.current.y ** 2);
    if (speed > maxVelocity) {
      velocity.current.x = (velocity.current.x / speed) * maxVelocity;
      velocity.current.y = (velocity.current.y / speed) * maxVelocity;
    }
    
    onDrag(deltaX, deltaY);
    
    lastPosition.current = { x: event.clientX, y: event.clientY };
    lastTime.current = currentTime;
  }, [onDrag, maxVelocity]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current) return;
    
    isDragging.current = false;
    onDragEnd?.(velocity.current.x, velocity.current.y);
    
    // Start inertial animation
    const animate = () => {
      const speed = Math.sqrt(velocity.current.x ** 2 + velocity.current.y ** 2);
      
      if (speed < 0.5) {
        velocity.current = { x: 0, y: 0 };
        return;
      }
      
      onDrag(velocity.current.x, velocity.current.y);
      
      velocity.current.x *= friction;
      velocity.current.y *= friction;
      
      animationFrame.current = requestAnimationFrame(animate);
    };
    
    animationFrame.current = requestAnimationFrame(animate);
  }, [onDragEnd, onDrag, friction]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

  return {
    onMouseDown: handleMouseDown,
    onMouseMove: handleMouseMove,
    onMouseUp: handleMouseUp,
    onMouseLeave: handleMouseUp,
  };
}
```

- [ ] **Step 2: Integrate inertial drag into EChartsGraph**

In `echarts-graph.tsx`, add the hook and integrate it:

```typescript
// Add import at top:
import { useInertialDrag } from '../hooks/use-inertial-drag';

// Add state for pan offset:
const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

// Add inertial drag handler:
const handleDrag = useCallback((deltaX: number, deltaY: number) => {
  setPanOffset(prev => ({
    x: prev.x + deltaX,
    y: prev.y + deltaY,
  }));
}, []);

const dragHandlers = useInertialDrag({
  onDrag: handleDrag,
  friction: 0.94,
  maxVelocity: 30,
});

// Update the container div to use drag handlers:
return (
  <div
    className="relative h-full w-full touch-none bg-background"
    style={{ perspective: '1200px', perspectiveOrigin: '50% 50%' }}
    onWheel={handleWheel}
    {...dragHandlers}
  >
    <div 
      style={{ 
        transformStyle: 'preserve-3d', 
        transform: `rotateX(2deg) translate(${panOffset.x}px, ${panOffset.y}px)`,
        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
      }}
    >
      <ReactECharts ... />
    </div>
  </div>
);
```

- [ ] **Step 3: Reset pan on fit view**

Update the fitView function to also reset pan offset:

```typescript
// Find fitView in store and add reset:
fitView: () => {
  set({ zoom: 0.86 });
  // Also reset pan offset in component
},
```

In the component, add effect to reset pan when zoom changes significantly:

```typescript
useEffect(() => {
  // Reset pan when fit view is triggered (zoom resets to 0.86)
  if (zoom === 0.86) {
    setPanOffset({ x: 0, y: 0 });
  }
}, [zoom]);
```

- [ ] **Step 4: Test dragging behavior**

Run development server and test:
- Click and drag should move the graph
- Release should continue with inertia
- Movement should decelerate smoothly
- Double-click or fit view should reset position

```bash
pnpm run dev
```

- [ ] **Step 5: Commit**

```bash
git add src/app/core/main/knowledge/hooks/use-inertial-drag.ts
git add src/app/core/main/knowledge/components/echarts-graph.tsx
git commit -m "feat: implement sphere-like inertial dragging for knowledge graph"
```

---

## Task 4: Enhance Label Styling with Bubble Design

**Covers:** S4 (Beautiful bubble labels)

**Files:**
- Modify: `src/app/core/main/knowledge/components/echarts-graph.tsx:621-646`

- [ ] **Step 1: Update label configuration**

In `echarts-graph.tsx`, update the label section in node configuration:

```typescript
// Find the label section (around line 621-646):
label: {
  show: labelVisible,
  position: isTopicNode
    ? symbolSize >= 28 ? 'inside' : 'right'
    : role === 'hub' || symbolSize >= 44 ? 'inside' : 'right',
  formatter: '{b}',
  fontSize: labelFontSize,
  fontWeight: isSelected || role === 'hub' || (isTopicNode && symbolSize >= 28) || symbolSize >= 44 ? 600 : 500,
  color: isDimmed
    ? 'rgba(115, 115, 115, 0.38)'
    : isTopicNode && symbolSize >= 28
      ? theme.foreground
      : symbolSize >= 44
      ? theme.foreground
      : withAlpha(color, isTopicNode ? 0.85 : 0.94),
  distance: isTopicNode ? 2 : 4,
  overflow: 'truncate',
  width: isTopicNode
    ? (isSelected || isHovered ? 160 : Math.max(52, Math.min(115, 48 + importance * 62)))
    : (isSelected || isHovered ? 200 : Math.max(90, Math.min(168, 76 + importance * 82))),
  backgroundColor: 'transparent',
  borderColor: 'transparent',
  borderWidth: 0,
  borderRadius: 6,
  padding: 0,
},

// Replace with bubble-style label:
label: {
  show: labelVisible,
  position: isTopicNode
    ? symbolSize >= 28 ? 'inside' : 'right'
    : role === 'hub' || symbolSize >= 44 ? 'inside' : 'right',
  formatter: (params: any) => {
    const name = params.name || '';
    // Truncate long names for display
    return name.length > 12 ? name.slice(0, 11) + '…' : name;
  },
  fontSize: labelFontSize,
  fontWeight: isSelected || role === 'hub' || (isTopicNode && symbolSize >= 28) || symbolSize >= 44 ? 600 : 500,
  color: isDimmed
    ? 'rgba(115, 115, 115, 0.38)'
    : isSelected || isHovered
      ? theme.foreground
      : withAlpha(theme.foreground, 0.92),
  distance: 6,
  overflow: 'truncate',
  width: isTopicNode
    ? (isSelected || isHovered ? 140 : Math.max(48, Math.min(100, 44 + importance * 50)))
    : (isSelected || isHovered ? 160 : Math.max(70, Math.min(130, 60 + importance * 60))),
  backgroundColor: isDimmed 
    ? 'transparent' 
    : isSelected || isHovered
      ? withAlpha(theme.surface, 0.95)
      : withAlpha(theme.surface, 0.82),
  borderColor: isDimmed
    ? 'transparent'
    : isSelected 
      ? withAlpha(theme.foreground, 0.6)
      : isHovered
        ? withAlpha(theme.foreground, 0.4)
        : withAlpha(theme.border, 0.5),
  borderWidth: isSelected ? 1.5 : isHovered ? 1 : 0.5,
  borderRadius: 8,
  padding: isSelected || isHovered ? [4, 10] : [3, 8],
  shadowBlur: isSelected ? 12 : isHovered ? 8 : 0,
  shadowColor: withAlpha('#000000', isSelected ? 0.2 : isHovered ? 0.15 : 0),
  shadowOffsetY: 2,
},
```

- [ ] **Step 2: Update emphasis label for better hover state**

```typescript
// Find emphasis section and update label:
emphasis: {
  // ... existing itemStyle ...
  label: {
    show: true,
    fontSize: 14,
    fontWeight: 700,
    color: theme.foreground,
    backgroundColor: withAlpha(theme.surface, 0.96),
    borderColor: withAlpha(theme.foreground, 0.5),
    borderWidth: 1.5,
    borderRadius: 10,
    padding: [6, 14],
    shadowBlur: 15,
    shadowColor: withAlpha('#000000', 0.25),
    shadowOffsetY: 3,
    distance: 8,
  },
},
```

- [ ] **Step 3: Test label appearance**

Run dev server and verify:
- Labels have bubble-like background
- Long labels are truncated with ellipsis
- Hover state shows enhanced bubble
- No long rectangular text boxes

```bash
pnpm run dev
```

- [ ] **Step 4: Commit**

```bash
git add src/app/core/main/knowledge/components/echarts-graph.tsx
git commit -m "feat: enhance node labels with bubble-style design"
```

---

## Task 5: Create Node Detail Popup Component

**Covers:** S5 (Comprehensive node info popup)

**Files:**
- Create: `src/app/core/main/knowledge/components/node-detail-popup.tsx`

- [ ] **Step 1: Create the popup component**

Create `src/app/core/main/knowledge/components/node-detail-popup.tsx`:

```typescript
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X, FileText, Link2, Hash, ExternalLink, Copy, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { GraphNode } from '../store/graph-store';

interface NodeDetailPopupProps {
  node: GraphNode;
  relatedNodes: Array<{ node: GraphNode; edgeLabel: string }>;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  onCopyPath: (path: string) => void;
  onSelectNode: (nodeId: string) => void;
}

const NODE_TYPE_ICONS: Record<string, React.ReactNode> = {
  note: <FileText className="h-4 w-4" />,
  concept: <Brain className="h-4 w-4" />,
  person: <span className="text-sm">👤</span>,
  project: <span className="text-sm">📁</span>,
  tag: <Hash className="h-4 w-4" />,
};

const NODE_TYPE_LABELS: Record<string, string> = {
  note: '笔记',
  concept: '概念',
  person: '人物',
  project: '项目',
  tag: '标签',
};

const NODE_TYPE_COLORS: Record<string, string> = {
  note: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  concept: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  person: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  project: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  tag: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
};

export function NodeDetailPopup({
  node,
  relatedNodes,
  onClose,
  onOpenNote,
  onCopyPath,
  onSelectNode,
}: NodeDetailPopupProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(onClose, 200); // Wait for animation
  }, [onClose]);

  const nodeType = node.nodeType || 'note';
  const nodeKind = node.kind || 'note';
  const connections = node.connections || 0;
  const path = node.nodeProperties?.path;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm transition-opacity duration-200',
        isVisible ? 'opacity-100' : 'opacity-0'
      )}
      onClick={handleClose}
    >
      <div
        className={cn(
          'relative w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl transition-all duration-200',
          isVisible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', NODE_TYPE_COLORS[nodeType])}>
              {NODE_TYPE_ICONS[nodeType]}
            </div>
            <div>
              <h3 className="text-lg font-semibold leading-tight">{node.nodeLabel}</h3>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {NODE_TYPE_LABELS[nodeType]}
                </Badge>
                {nodeKind === 'hub' && (
                  <Badge variant="default" className="text-xs bg-amber-500">
                    核心节点
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Separator className="my-4" />

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <div className="text-2xl font-bold">{connections}</div>
            <div className="text-xs text-muted-foreground">连接数</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <div className="text-2xl font-bold">{node.nodeProperties?.noteCount ?? 0}</div>
            <div className="text-xs text-muted-foreground">关联笔记</div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <div className="text-2xl font-bold">{node.nodeProperties?.chunkCount ?? 0}</div>
            <div className="text-xs text-muted-foreground">RAG切块</div>
          </div>
        </div>

        {/* Keywords */}
        {node.nodeProperties?.keyword && (
          <>
            <Separator className="my-4" />
            <div>
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">关键词</h4>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-xs">
                  {node.nodeProperties.keyword}
                </Badge>
                {node.nodeProperties?.clusterLabel && (
                  <Badge variant="secondary" className="text-xs">
                    {node.nodeProperties.clusterLabel}
                  </Badge>
                )}
              </div>
            </div>
          </>
        )}

        {/* Related Nodes */}
        {relatedNodes.length > 0 && (
          <>
            <Separator className="my-4" />
            <div>
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                关联节点 ({relatedNodes.length})
              </h4>
              <div className="max-h-40 space-y-1.5 overflow-y-auto">
                {relatedNodes.slice(0, 8).map(({ node: relatedNode, edgeLabel }) => (
                  <button
                    key={relatedNode.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-muted"
                    onClick={() => onSelectNode(relatedNode.id)}
                  >
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: relatedNode.nodeColor || '#64748b' }}
                    />
                    <span className="flex-1 truncate text-sm">{relatedNode.nodeLabel}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {edgeLabel}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <Separator className="my-4" />
        <div className="flex gap-2">
          {path && (
            <>
              <Button
                variant="default"
                size="sm"
                className="flex-1"
                onClick={() => onOpenNote(path)}
              >
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                打开笔记
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCopyPath(path)}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleClose}
          >
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export the component**

Add export to `src/app/core/main/knowledge/index.tsx`:

```typescript
export { NodeDetailPopup } from './components/node-detail-popup';
```

- [ ] **Step 3: Commit**

```bash
git add src/app/core/main/knowledge/components/node-detail-popup.tsx
git add src/app/core/main/knowledge/index.tsx
git commit -m "feat: create node detail popup component"
```

---

## Task 6: Integrate Node Click to Show Popup

**Covers:** S5 (Click node shows info popup)

**Files:**
- Modify: `src/app/core/main/knowledge/components/echarts-graph.tsx`

- [ ] **Step 1: Add popup state and imports**

In `echarts-graph.tsx`, add imports and state:

```typescript
// Add import:
import { NodeDetailPopup } from './node-detail-popup';

// Add state for popup:
const [popupNode, setPopupNode] = useState<GraphNode | null>(null);
const [popupRelatedNodes, setPopupRelatedNodes] = useState<Array<{ node: GraphNode; edgeLabel: string }>>([]);
```

- [ ] **Step 2: Update click handler to show popup**

Update the onEvents click handler:

```typescript
// Find onEvents (around line 955-979):
const onEvents = useMemo(() => ({
  click: (params: EChartsEventParams) => {
    if (params.dataType === 'node' && params.data?.id) {
      selectNode(params.data.id);
      selectEdge(null);
    } else if (params.dataType === 'edge' && params.data?.id) {
      selectEdge(params.data.id);
      selectNode(null);
    } else {
      selectNode(null);
      selectEdge(null);
    }
  },
  // ... rest
}), [/* deps */]);

// Replace with:
const onEvents = useMemo(() => ({
  click: (params: EChartsEventParams) => {
    if (params.dataType === 'node' && params.data?.id) {
      const clickedNode = filteredNodes.find(n => n.id === params.data!.id);
      if (clickedNode) {
        // Find related nodes
        const related: Array<{ node: GraphNode; edgeLabel: string }> = [];
        for (const edge of filteredEdges) {
          if (edge.source === clickedNode.id) {
            const targetNode = filteredNodes.find(n => n.id === edge.target);
            if (targetNode) related.push({ node: targetNode, edgeLabel: edge.label });
          }
          if (edge.target === clickedNode.id) {
            const sourceNode = filteredNodes.find(n => n.id === edge.source);
            if (sourceNode) related.push({ node: sourceNode, edgeLabel: edge.label });
          }
        }
        setPopupNode(clickedNode);
        setPopupRelatedNodes(related);
        selectNode(params.data.id);
      }
      selectEdge(null);
    } else if (params.dataType === 'edge' && params.data?.id) {
      selectEdge(params.data.id);
      selectNode(null);
      setPopupNode(null);
    } else {
      selectNode(null);
      selectEdge(null);
      setPopupNode(null);
    }
  },
  mouseover: (params: EChartsEventParams) => {
    if (params.dataType === 'node' && params.data?.id) {
      setHoveredNode(params.data.id);
    }
  },
  mouseout: () => {
    setHoveredNode(null);
  },
  graphRoam: () => {
    setZoom(useGraphStore.getState().zoom);
  },
}), [selectEdge, selectNode, setHoveredNode, setZoom, filteredNodes, filteredEdges]);
```

- [ ] **Step 3: Add helper functions for popup actions**

```typescript
// Add these functions before the return statement:
const handleOpenNote = useCallback(async (path: string) => {
  const useArticleStore = (await import('@/stores/article')).default;
  useArticleStore.getState().setActiveFilePath(path);
  setPopupNode(null);
}, []);

const handleCopyPath = useCallback(async (path: string) => {
  await navigator.clipboard.writeText(path);
  // Could add a toast notification here
}, []);

const handleSelectNodeFromPopup = useCallback((nodeId: string) => {
  selectNode(nodeId);
  // Find and show the new node's popup
  const newNode = filteredNodes.find(n => n.id === nodeId);
  if (newNode) {
    const related: Array<{ node: GraphNode; edgeLabel: string }> = [];
    for (const edge of filteredEdges) {
      if (edge.source === nodeId) {
        const targetNode = filteredNodes.find(n => n.id === edge.target);
        if (targetNode) related.push({ node: targetNode, edgeLabel: edge.label });
      }
      if (edge.target === nodeId) {
        const sourceNode = filteredNodes.find(n => n.id === edge.source);
        if (sourceNode) related.push({ node: sourceNode, edgeLabel: edge.label });
      }
    }
    setPopupNode(newNode);
    setPopupRelatedNodes(related);
  }
}, [selectNode, filteredNodes, filteredEdges]);
```

- [ ] **Step 4: Render the popup in the component**

Update the return statement to include the popup:

```typescript
// Find the return statement and add popup before closing </div>:
return (
  <div
    className="relative h-full w-full touch-none bg-background"
    style={{ perspective: '1200px', perspectiveOrigin: '50% 50%' }}
    onWheel={handleWheel}
    {...dragHandlers}
  >
    <div 
      style={{ 
        transformStyle: 'preserve-3d', 
        transform: `rotateX(2deg) translate(${panOffset.x}px, ${panOffset.y}px)`,
        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
      }}
    >
      <ReactECharts ... />
    </div>

    {/* Node Detail Popup */}
    {popupNode && (
      <NodeDetailPopup
        node={popupNode}
        relatedNodes={popupRelatedNodes}
        onClose={() => setPopupNode(null)}
        onOpenNote={handleOpenNote}
        onCopyPath={handleCopyPath}
        onSelectNode={handleSelectNodeFromPopup}
      />
    )}
  </div>
);
```

- [ ] **Step 5: Test popup functionality**

Run dev server and test:
- Click on a node shows popup
- Popup displays node info, stats, related nodes
- Click related node navigates to it
- Open note button works
- Copy path button works
- Click outside or X closes popup

```bash
pnpm run dev
```

- [ ] **Step 6: Commit**

```bash
git add src/app/core/main/knowledge/components/echarts-graph.tsx
git commit -m "feat: integrate node click to show detail popup"
```

---

## Task 7: Update Store for New Interactions

**Covers:** S6 (Settings and state management)

**Files:**
- Modify: `src/app/core/main/knowledge/store/graph-store.ts`

- [ ] **Step 1: Add 3D mode toggle to store**

In `graph-store.ts`, add to the state interface:

```typescript
// Find the GraphState interface and add:
interface GraphState {
  // ... existing fields ...
  enable3D: boolean;
  enableInertialDrag: boolean;
  
  // ... existing actions ...
  toggle3D: () => void;
  toggleInertialDrag: () => void;
}
```

- [ ] **Step 2: Add default values and implementations**

```typescript
// Find the create call and add:
export const useGraphStore = create<GraphState>((set, get) => ({
  // ... existing defaults ...
  enable3D: true,
  enableInertialDrag: true,
  
  // ... existing actions ...
  toggle3D: () => set(state => ({ enable3D: !state.enable3D })),
  toggleInertialDrag: () => set(state => ({ enableInertialDrag: !state.enableInertialDrag })),
}));
```

- [ ] **Step 3: Update toolbar to include 3D toggle**

In `toolbar.tsx`, add a toggle button:

```typescript
// Add import:
import { Box } from 'lucide-react';

// Add to the toolbar buttons (after layout options):
<ToolbarButton
  label="3D效果"
  active={enable3D}
  onClick={toggle3D}
>
  <Box className="h-4 w-4" />
</ToolbarButton>
```

- [ ] **Step 4: Use store values in EChartsGraph**

In `echarts-graph.tsx`, consume the store values:

```typescript
// Add to destructured store values:
const {
  // ... existing ...
  enable3D,
  enableInertialDrag,
} = useGraphStore();

// Use enable3D in the container style:
<div
  style={{ 
    perspective: enable3D ? '1200px' : 'none', 
    perspectiveOrigin: '50% 50%' 
  }}
>
  <div 
    style={{ 
      transformStyle: enable3D ? 'preserve-3d' : 'flat', 
      transform: enable3D 
        ? `rotateX(2deg) translate(${panOffset.x}px, ${panOffset.y}px)`
        : `translate(${panOffset.x}px, ${panOffset.y}px)`,
      transition: isDragging ? 'none' : 'transform 0.1s ease-out',
    }}
  >
```

- [ ] **Step 5: Commit**

```bash
git add src/app/core/main/knowledge/store/graph-store.ts
git add src/app/core/main/knowledge/components/toolbar.tsx
git add src/app/core/main/knowledge/components/echarts-graph.tsx
git commit -m "feat: add 3D mode toggle and store integration"
```

---

## Task 8: Final Testing and Polish

**Covers:** All sections (final verification)

**Files:**
- All modified files

- [ ] **Step 1: Run TypeScript check**

```bash
cd "C:\Users\colin\Desktop\AI demo\LingMo"
npx tsc --noEmit --pretty 2>&1 | Select-String -Pattern "error TS" | Select-Object -First 10
```

Expected: No errors

- [ ] **Step 2: Run linter**

```bash
pnpm run lint
```

Expected: No warnings or errors

- [ ] **Step 3: Run development server**

```bash
pnpm run dev
```

- [ ] **Step 4: Test all features**

Open the knowledge graph and verify:
- [ ] Canvas version is removed, only ECharts works
- [ ] Nodes have 3D-like appearance with shadows
- [ ] Dragging works with inertial scrolling
- [ ] Labels have bubble-style design
- [ ] Clicking nodes shows detail popup
- [ ] Popup shows all required info
- [ ] Related nodes are clickable
- [ ] Open note and copy path work
- [ ] 3D toggle works in toolbar
- [ ] All existing features still work (zoom, filter, search, etc.)

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete knowledge graph 3D enhancement"
```

---

## Summary

This plan enhances the ECharts-based knowledge graph with:
1. ✅ Removal of Canvas version
2. ✅ Simulated 3D effects with CSS transforms
3. ✅ Sphere-like inertial dragging
4. ✅ Bubble-style labels
5. ✅ Comprehensive node detail popup
6. ✅ Settings integration

Total tasks: 8
Estimated time: 45-60 minutes
