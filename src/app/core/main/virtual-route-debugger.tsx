'use client';

import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import useArticleStore from '@/stores/article';
import { useSidebarStore } from '@/stores/sidebar';

export function VirtualRouteDebugger() {
  const { activeFilePath, openTabs, activeTabId } = useArticleStore();
  const { centerPanelVisible } = useSidebarStore();
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timestamp}] ${message}`, ...prev]);
  };

  useEffect(() => {
    addLog(`=== 虚拟路由调试器启动 ===`);
    addLog(`activeFilePath: ${activeFilePath || '(空)'}`);
    addLog(`activeTabId: ${activeTabId || '(空)'}`);
    addLog(`centerPanelVisible: ${centerPanelVisible}`);
    addLog(`openTabs: ${openTabs.length} 个`);
  }, []);

  useEffect(() => {
    if (activeFilePath) {
      addLog(`activeFilePath 变化: ${activeFilePath}`);
    }
  }, [activeFilePath]);

  useEffect(() => {
    if (activeTabId) {
      addLog(`activeTabId 变化: ${activeTabId}`);
    }
  }, [activeTabId]);

  useEffect(() => {
    addLog(`openTabs 变化: ${openTabs.length} 个`);
    openTabs.forEach(tab => {
      addLog(`  - ${tab.name} (${tab.path}) [${tab.id}]`);
    });
  }, [openTabs.length, openTabs.map(t => t.id).join(',')]);

  const testVirtualRoute = async (path: string, name: string) => {
    addLog(`=== 测试 ${name} ===`);
    addLog(`设置 activeFilePath: ${path}`);

    try {
      const { setActiveFilePath } = useArticleStore.getState();
      await setActiveFilePath(path);

      // 等待状态更新
      await new Promise(resolve => setTimeout(resolve, 100));

      const newState = useArticleStore.getState();
      addLog(`设置后 activeFilePath: ${newState.activeFilePath || '(空)'}`);
      addLog(`设置后 activeTabId: ${newState.activeTabId || '(空)'}`);
      addLog(`✓ 状态设置成功`);
    } catch (error) {
      addLog(`✗ 错误: ${String(error)}`);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">虚拟路由调试器</h2>
        <Button onClick={() => setLogs([])} variant="outline" size="sm">
          清除日志
        </Button>
      </div>

      {/* 当前状态 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">当前状态</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span>activeFilePath:</span>
            <Badge>{activeFilePath || '(空)'}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span>activeTabId:</span>
            <Badge>{activeTabId || '(空)'}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span>centerPanelVisible:</span>
            <Badge>{centerPanelVisible ? '是' : '否'}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span>openTabs:</span>
            <Badge>{openTabs.length}</Badge>
          </div>
        </div>
      </Card>

      {/* 测试按钮 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">测试虚拟路由</h3>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => testVirtualRoute('lingmo://knowledge-graph', '知识图谱')}>
            测试知识图谱
          </Button>
          <Button onClick={() => testVirtualRoute('lingmo://flashcards', '闪卡')}>
            测试闪卡
          </Button>
          <Button onClick={() => testVirtualRoute('lingmo://memory-manager', '记忆管理')}>
            测试记忆管理
          </Button>
          <Button onClick={() => testVirtualRoute('lingmo://github-stars', 'GitHub管理')}>
            测试GitHub管理
          </Button>
        </div>
      </Card>

      {/* 日志 */}
      <Card className="p-4">
        <h3 className="font-semibold mb-3">调试日志</h3>
        <div className="bg-muted rounded p-3 h-64 overflow-y-auto font-mono text-xs">
          {logs.length === 0 ? (
            <div className="text-muted-foreground">暂无日志</div>
          ) : (
            <div className="space-y-1">
              {logs.map((log, index) => (
                <div key={index}>{log}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default VirtualRouteDebugger;
