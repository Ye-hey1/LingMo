'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, FileText, Lightbulb, Sparkles, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyGraphStateProps {
  hasNotes: boolean;
  hasVectors: boolean;
  noteCount: number;
  onGenerateVectors: () => void;
  onCreateNote: () => void;
  onRefresh: () => void;
  isLoading?: boolean;
}

type EmptyStateType = 'no-notes' | 'no-vectors' | 'insufficient-data' | 'loading-failed';

export function EmptyGraphState({
  hasNotes,
  hasVectors,
  noteCount,
  onGenerateVectors,
  onCreateNote,
  onRefresh,
  isLoading = false,
}: EmptyGraphStateProps) {
  const getStateType = (): EmptyStateType => {
    if (!hasNotes) return 'no-notes';
    if (hasNotes && !hasVectors) return 'no-vectors';
    if (noteCount < 3) return 'insufficient-data';
    return 'loading-failed';
  };

  const stateType = getStateType();

  const states = {
    'no-notes': {
      icon: <FileText className="h-12 w-12" />,
      title: '开始构建知识图谱',
      description: '知识图谱需要基于您的笔记内容来生成关系网络。创建您的第一篇笔记开始探索吧！',
      primaryAction: {
        label: '创建笔记',
        icon: <Sparkles className="h-4 w-4 mr-2" />,
        onClick: onCreateNote,
        variant: 'default' as const,
      },
      secondaryAction: undefined,
      tips: [
        '笔记中的关键词会自动成为图谱节点',
        '相关联的笔记会建立连接关系',
        '图谱会随着笔记增加而不断丰富',
      ],
    },

    'no-vectors': {
      icon: <Zap className="h-12 w-12" />,
      title: '生成知识图谱数据',
      description: '检测到您有笔记内容，但还没有生成向量嵌入。点击下方按钮为所有笔记生成智能向量数据。',
      primaryAction: {
        label: '生成向量数据',
        icon: <Sparkles className="h-4 w-4 mr-2" />,
        onClick: onGenerateVectors,
        variant: 'default' as const,
      },
      secondaryAction: {
        label: '刷新',
        icon: <Zap className="h-4 w-4 mr-2" />,
        onClick: onRefresh,
        variant: 'outline' as const,
      },
      tips: [
        '向量生成需要一些时间，请耐心等待',
        '生成过程中可以在笔记中继续工作',
        '首次生成可能需要几分钟时间',
      ],
    },

    'insufficient-data': {
      icon: <Lightbulb className="h-12 w-12" />,
      title: '需要更多笔记内容',
      description: `当前有 ${noteCount} 篇笔记，建议至少创建 3-5 篇笔记后再生成知识图谱，这样能展现更丰富的关系网络。`,
      primaryAction: {
        label: '继续创建笔记',
        icon: <FileText className="h-4 w-4 mr-2" />,
        onClick: onCreateNote,
        variant: 'default' as const,
      },
      secondaryAction: {
        label: '强制生成图谱',
        onClick: onGenerateVectors,
        variant: 'outline' as const,
      },
      tips: [
        `建议先创建 3-5 篇相关主题的笔记`,
        '笔记内容尽量详细和丰富',
        '使用双链 [[笔记名]] 建立笔记间关联',
      ],
    },

    'loading-failed': {
      icon: <AlertCircle className="h-12 w-12 text-destructive" />,
      title: '知识图谱加载失败',
      description: '加载图谱数据时遇到问题。这可能是数据库连接问题或数据不完整导致的。',
      primaryAction: {
        label: '重新加载',
        icon: <Zap className="h-4 w-4 mr-2" />,
        onClick: onRefresh,
        variant: 'default' as const,
      },
      secondaryAction: {
        label: '生成向量数据',
        onClick: onGenerateVectors,
        variant: 'outline' as const,
      },
      tips: [
        '检查是否有足够的笔记内容',
        '尝试重新生成向量数据',
        '如果问题持续，请检查数据库状态',
      ],
    },
  };

  const currentState = states[stateType];

  return (
    <div className="relative z-[1] flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* 主卡片 */}
        <div className="mb-6 rounded-lg border border-border bg-background p-8 shadow-sm">
          {/* 图标 */}
          <div className="mb-6 flex justify-center">
            <div className={cn(
              "flex h-20 w-20 items-center justify-center rounded-full",
              stateType === 'loading-failed'
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary"
            )}>
              {currentState.icon}
            </div>
          </div>

          {/* 标题和描述 */}
          <div className="mb-8 text-center">
            <h2 className="mb-3 text-2xl font-semibold text-foreground">
              {currentState.title}
            </h2>
            <p className="text-base text-muted-foreground leading-relaxed">
              {currentState.description}
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              variant={currentState.primaryAction.variant}
              onClick={currentState.primaryAction.onClick}
              disabled={isLoading}
              className="min-w-[140px]"
            >
              {isLoading ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  处理中...
                </>
              ) : (
                currentState.primaryAction.icon
              )}
              {currentState.primaryAction.label}
            </Button>

            {currentState.secondaryAction && (
              <Button
                size="lg"
                variant={currentState.secondaryAction.variant}
                onClick={currentState.secondaryAction.onClick}
                disabled={isLoading}
                className="min-w-[140px]"
              >
                {'icon' in currentState.secondaryAction && currentState.secondaryAction.icon}
                {currentState.secondaryAction.label}
              </Button>
            )}
          </div>
        </div>

        {/* 提示卡片 */}
        <div className="rounded-lg border border-border/50 bg-muted/30 p-6">
          <h3 className="mb-4 text-sm font-medium text-foreground">
            💡 知识图谱小贴士
          </h3>
          <ul className="space-y-2.5">
            {currentState.tips.map((tip, index) => (
              <li key={index} className="flex items-start text-sm text-muted-foreground">
                <span className="mr-2.5 mt-0.5 flex-shrink-0 h-1.5 w-1.5 rounded-full bg-primary" />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 额外说明 */}
        {stateType === 'no-vectors' && (
          <div className="mt-4 rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 p-4">
            <div className="flex items-start gap-3">
              <Lightbulb className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                  向量数据说明
                </p>
                <p className="text-blue-700 dark:text-blue-300 leading-relaxed">
                  向量嵌入是通过 AI 技术分析笔记内容的语义特征，使知识图谱能够智能地发现笔记之间的深层关联。
                  生成的数据存储在本地，不会上传到云端。
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default EmptyGraphState;
