'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Download, FileImage, FileCode, FileJson, Loader2 } from 'lucide-react';
import { useGraphStore } from '../store/graph-store';

type ExportFormat = 'png' | 'svg' | 'json';

// ==================== 导出工具函数 ====================

/** 导出为 JSON */
function exportToJSON(filename: string, nodes: any[], edges: any[]) {
  const data = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    metadata: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
    },
    nodes: nodes.map(node => ({
      id: node.id,
      type: node.nodeType,
      label: node.nodeLabel,
      color: node.nodeColor,
      size: node.nodeSize,
      properties: node.nodeProperties,
      metadata: node.nodeMetadata,
      connections: node.connections,
    })),
    edges: edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      weight: edge.weight,
      confidence: edge.confidence,
      metadata: edge.metadata,
    })),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `${filename}.json`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

// ==================== 主组件 ====================

export function ExportDialog() {
  const [format, setFormat] = useState<ExportFormat>('json');
  const [filename, setFilename] = useState('knowledge-graph');
  const [isExporting, setIsExporting] = useState(false);

  const {
    showExportDialog,
    toggleExportDialog,
    filteredNodes,
    filteredEdges,
  } = useGraphStore();

  // 执行导出
  const handleExport = async () => {
    setIsExporting(true);
    
    try {
      // 模拟延迟
      await new Promise(resolve => setTimeout(resolve, 500));
      
      switch (format) {
        case 'json':
          exportToJSON(filename, filteredNodes, filteredEdges);
          break;
        case 'png':
        case 'svg':
          // PNG/SVG 导出需要 ECharts 实例支持
          // 这里先只支持 JSON 导出
          exportToJSON(filename, filteredNodes, filteredEdges);
          break;
      }
      
      // 导出成功后关闭对话框
      toggleExportDialog();
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={showExportDialog} onOpenChange={toggleExportDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导出图谱</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 文件名 */}
          <div>
            <Label className="text-sm font-medium mb-2 block">文件名</Label>
            <Input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="knowledge-graph"
            />
          </div>

          {/* 导出格式 */}
          <div>
            <Label className="text-sm font-medium mb-2 block">导出格式</Label>
            <RadioGroup value={format} onValueChange={(value) => setFormat(value as ExportFormat)}>
              <div className="flex items-center space-x-2 p-2 rounded hover:bg-accent">
                <RadioGroupItem value="json" id="json" />
                <Label htmlFor="json" className="flex items-center gap-2 cursor-pointer flex-1">
                  <FileJson className="h-4 w-4 text-orange-500" />
                  <div>
                    <div className="font-medium">JSON 数据</div>
                    <div className="text-xs text-muted-foreground">完整数据，可导入恢复</div>
                  </div>
                </Label>
              </div>
              
              <div className="flex items-center space-x-2 p-2 rounded hover:bg-accent opacity-50">
                <RadioGroupItem value="png" id="png" disabled />
                <Label htmlFor="png" className="flex items-center gap-2 cursor-pointer flex-1">
                  <FileImage className="h-4 w-4 text-blue-500" />
                  <div>
                    <div className="font-medium">PNG 图片</div>
                    <div className="text-xs text-muted-foreground">即将支持</div>
                  </div>
                </Label>
              </div>
              
              <div className="flex items-center space-x-2 p-2 rounded hover:bg-accent opacity-50">
                <RadioGroupItem value="svg" id="svg" disabled />
                <Label htmlFor="svg" className="flex items-center gap-2 cursor-pointer flex-1">
                  <FileCode className="h-4 w-4 text-green-500" />
                  <div>
                    <div className="font-medium">SVG 矢量图</div>
                    <div className="text-xs text-muted-foreground">即将支持</div>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* 导出统计 */}
          <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
            <div>将导出 {filteredNodes.length} 个节点，{filteredEdges.length} 条边</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={toggleExportDialog}>
            取消
          </Button>
          <Button onClick={handleExport} disabled={isExporting || !filename.trim()}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                导出中...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                导出
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
