"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatusIndicatorProps {
  /** Header text to display (e.g., "Thinking", "Working") */
  header?: string
  /** Optional details text shown below header */
  details?: string
  /** Optional inline message after elapsed time */
  inlineMessage?: string
  /** Whether the agent is currently running */
  isRunning?: boolean
  /** Start timestamp for elapsed time calculation */
  startTime?: number
  /** Whether to show interrupt hint */
  showInterruptHint?: boolean
  /** Callback when interrupt is clicked */
  onInterrupt?: () => void
  /** Additional CSS classes */
  className?: string
  /** Compact mode - single line only */
  compact?: boolean
}

/**
 * Format elapsed seconds into compact human-readable form
 * Examples: 0s, 59s, 1m 00s, 59m 59s, 1h 00m 00s
 */
function formatElapsedCompact(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes}m ${secs.toString().padStart(2, "0")}s`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return `${hours}h ${minutes.toString().padStart(2, "0")}m ${secs.toString().padStart(2, "0")}s`
}

/**
 * StatusIndicator - A compact animated status display inspired by Codex TUI
 *
 * Features:
 * - Animated shimmer text for header
 * - Real-time elapsed time display
 * - Optional details below header
 * - Interrupt hint
 * - Reduced motion support
 */
export function StatusIndicator({
  header = "Working",
  details,
  inlineMessage,
  isRunning = true,
  startTime,
  showInterruptHint = true,
  onInterrupt,
  className,
  compact = false,
}: StatusIndicatorProps) {
  const [elapsed, setElapsed] = React.useState(0)
  const prefersReducedMotion = React.useRef(
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  )

  // Update elapsed time every second
  React.useEffect(() => {
    if (!isRunning || !startTime) {
      setElapsed(0)
      return
    }

    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }

    updateElapsed()
    const interval = setInterval(updateElapsed, 1000)

    return () => clearInterval(interval)
  }, [isRunning, startTime])

  if (!isRunning) {
    return null
  }

  const formattedElapsed = formatElapsedCompact(elapsed)
  const useAnimation = !prefersReducedMotion.current

  return (
    <div className={cn("w-full", className)}>
      {/* Main status line */}
      <div className="flex items-center gap-2 py-1.5">
        {/* Animated spinner or static bullet */}
        {useAnimation ? (
          <Loader2 className="size-3.5 animate-spin text-blue-500 shrink-0" />
        ) : (
          <span className="size-3.5 flex items-center justify-center text-muted-foreground shrink-0">•</span>
        )}

        {/* Animated header text with shimmer effect */}
        <span
          className={cn(
            "text-sm font-medium",
            useAnimation && "animate-shimmer bg-[length:200%_100%] bg-clip-text text-transparent bg-gradient-to-r from-foreground via-foreground/70 to-foreground"
          )}
        >
          {header}
        </span>

        {/* Elapsed time and interrupt hint */}
        <span className="text-xs text-muted-foreground">
          ({formattedElapsed}
          {showInterruptHint && onInterrupt && (
            <>
              {" • "}
              <button
                onClick={onInterrupt}
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                esc to interrupt
              </button>
            </>
          )}
          )
        </span>

        {/* Inline message */}
        {inlineMessage && (
          <span className="text-xs text-muted-foreground">
            · {inlineMessage}
          </span>
        )}
      </div>

      {/* Details section (non-compact mode only) */}
      {!compact && details && (
        <div className="pl-6 pb-1">
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            └ {details}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * InlineStatusIndicator - A minimal inline status for use in message lists
 * Even more compact than StatusIndicator - just spinner + text on one line
 */
export function InlineStatusIndicator({
  text = "Thinking...",
  isRunning = true,
  startTime,
  className,
}: {
  text?: string
  isRunning?: boolean
  startTime?: number
  className?: string
}) {
  const [elapsed, setElapsed] = React.useState(0)

  React.useEffect(() => {
    if (!isRunning || !startTime) {
      setElapsed(0)
      return
    }

    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }

    updateElapsed()
    const interval = setInterval(updateElapsed, 1000)

    return () => clearInterval(interval)
  }, [isRunning, startTime])

  if (!isRunning) {
    return null
  }

  return (
    <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Loader2 className="size-3.5 animate-spin text-blue-500 shrink-0" />
      <span className="animate-pulse">{text}</span>
      {startTime && (
        <span className="text-xs tabular-nums">
          {formatElapsedCompact(elapsed)}
        </span>
      )}
    </div>
  )
}

export default StatusIndicator
