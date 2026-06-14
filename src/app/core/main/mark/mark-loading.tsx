'use client'
import { MarkQueue } from "@/stores/mark";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function MarkLoading({ mark }: { mark: MarkQueue }) {
  const [timeNow, setTimeNow] = useState(Date.now())
  const timer = useRef<NodeJS.Timeout>()

  useEffect(() => {
    timer.current = setInterval(() => setTimeNow(Date.now()), 1000)
    return () => clearInterval(timer.current)
  }, []);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground border-b">
      <Loader2 className="size-3 animate-spin shrink-0" />
      <span className="truncate">{mark.progress}</span>
      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/50">{Math.round((timeNow - mark.startTime) / 1000)}s</span>
    </div>
  )
}
