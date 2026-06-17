'use client';

import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PanelContainerProps {
  children: React.ReactNode;
  position?: 'left' | 'right';
  width?: string;
  className?: string;
  title?: string;
  hideHeader?: boolean;
  onClose?: () => void;
}

export function PanelContainer({
  children,
  position = 'right',
  width = 'w-80',
  className,
  title = '详情面板',
  hideHeader = false,
  onClose,
}: PanelContainerProps) {
  return (
    <div
      className={cn(
        'absolute top-3 z-30 h-[calc(100%-1.5rem)] overflow-hidden rounded-lg border border-border/70 bg-background/95 shadow-[0_16px_42px_rgba(0,0,0,0.08)] backdrop-blur-md',
        'animate-in duration-200',
        position === 'right' ? 'right-3 slide-in-from-right' : 'left-3 slide-in-from-left',
        width,
        className,
      )}
    >
      {!hideHeader ? (
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={cn(hideHeader ? 'h-full' : 'h-[calc(100%-48px)]', 'overflow-y-auto')}>
        {children}
      </div>
    </div>
  );
}
