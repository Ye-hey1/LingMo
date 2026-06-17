'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import useArticleStore from '@/stores/article';
import { useSidebarStore } from '@/stores/sidebar';
import { KNOWLEDGE_GRAPH_TAB_PATH } from './knowledge/knowledge-graph-constants';
import { FLASHCARD_TAB_PATH } from './flashcard/flashcard-constants';
import { MEMORY_TAB_PATH } from './memory/memory-constants';
import { GITHUB_STARS_TAB_PATH } from './github-stars/github-stars-constants';

export function DebugVirtualRoutes() {
  const { activeFilePath, setActiveFilePath } = useArticleStore();
  const { centerPanelVisible, toggleCenterPanel } = useSidebarStore();
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs(prev => [`[${timestamp}] ${message}`, ...prev]);
  };

  const testVirtualRoute = async (route: string, routeName: string) => {
    addLog(`=== Testing ${routeName} ===`);
    addLog(`Current activeFilePath: ${activeFilePath}`);
    addLog(`Target route: ${route}`);
    addLog(`centerPanelVisible: ${centerPanelVisible}`);

    try {
      addLog(`Setting activeFilePath to: ${route}`);
      await setActiveFilePath(route);

      // 等待状态更新
      await new Promise(resolve => setTimeout(resolve, 100));

      addLog(`After setActiveFilePath: ${useArticleStore.getState().activeFilePath}`);

      if (!centerPanelVisible) {
        addLog(`centerPanelVisible is false, calling toggleCenterPanel`);
        await toggleCenterPanel();
        await new Promise(resolve => setTimeout(resolve, 100));
        addLog(`After toggleCenterPanel: ${useSidebarStore.getState().centerPanelVisible}`);
      }

      addLog(`✓ ${routeName} route set successfully`);
    } catch (error) {
      addLog(`✗ Error setting ${routeName} route: ${String(error)}`);
    }
  };

  const checkStoreStates = () => {
    const articleState = useArticleStore.getState();
    const sidebarState = useSidebarStore.getState();

    addLog('=== Current Store States ===');
    addLog(`activeFilePath: ${articleState.activeFilePath}`);
    addLog(`openTabs: ${JSON.stringify(articleState.openTabs.map(t => ({ id: t.id, path: t.path, name: t.name })))}`);
    addLog(`activeTabId: ${articleState.activeTabId}`);
    addLog(`centerPanelVisible: ${sidebarState.centerPanelVisible}`);
    addLog(`leftSidebarVisible: ${sidebarState.leftSidebarVisible}`);
    addLog(`rightSidebarVisible: ${sidebarState.rightSidebarVisible}`);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">虚拟路由调试工具</h1>
        <Button onClick={() => setDebugLogs([])} variant="outline">
          清除日志
        </Button>
      </div>

      {/* 当前状态 */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-3">当前状态</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">activeFilePath:</span>
            <Badge variant={activeFilePath ? 'default' : 'secondary'}>
              {activeFilePath || '(空)'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium">centerPanelVisible:</span>
            <Badge variant={centerPanelVisible ? 'default' : 'secondary'}>
              {centerPanelVisible ? '是' : '否'}
            </Badge>
          </div>
        </div>
      </Card>

      {/* 路由测试 */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-3">路由测试</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => testVirtualRoute(KNOWLEDGE_GRAPH_TAB_PATH, '知识图谱')}>
            测试知识图谱
          </Button>
          <Button onClick={() => testVirtualRoute(FLASHCARD_TAB_PATH, '闪卡')}>
            测试闪卡
          </Button>
          <Button onClick={() => testVirtualRoute(MEMORY_TAB_PATH, '记忆管理')}>
            测试记忆管理
          </Button>
          <Button onClick={() => testVirtualRoute(GITHUB_STARS_TAB_PATH, 'GitHub管理')}>
            测试GitHub管理
          </Button>
          <Button onClick={checkStoreStates} variant="outline">
            检查Store状态
          </Button>
        </div>
      </Card>

      {/* 调试日志 */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold mb-3">调试日志</h2>
        <div className="bg-muted rounded p-3 h-64 overflow-y-auto font-mono text-xs">
          {debugLogs.length === 0 ? (
            <div className="text-muted-foreground">暂无日志</div>
          ) : (
            <div className="space-y-1">
              {debugLogs.map((log, index) => (
                <div key={index} className="whitespace-nowrap">
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default DebugVirtualRoutes;
