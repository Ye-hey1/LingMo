import type { ProjectAgentTarget } from "../lib/tauri";
import { cn } from "../utils";

function shortLabel(displayName: string, key: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  const word = words[0] || key;
  return word.slice(0, 2).toUpperCase();
}

type DotState = "synced" | "available" | "orphan";

interface Props {
  assignedAgents: string[];
  agentDisplayNames?: Record<string, string>;
  targets: ProjectAgentTarget[];
  limit?: number;
  size?: "sm" | "md";
  className?: string;
}

export function ProjectAgentDots({ assignedAgents, agentDisplayNames = {}, targets, limit, size = "md", className }: Props) {
  const assignedSet = new Set(assignedAgents);
  const availableKeys = new Set(targets.filter((t) => t.installed && t.enabled).map((t) => t.key));

  const dots: { key: string; displayName: string; state: DotState }[] = [];

  for (const target of targets) {
    if (!target.installed || !target.enabled) continue;
    dots.push({
      key: target.key,
      displayName: target.display_name,
      state: assignedSet.has(target.key) ? "synced" : "available",
    });
  }

  for (const agentKey of assignedAgents) {
    if (availableKeys.has(agentKey)) continue;
    const known = targets.find((t) => t.key === agentKey);
    dots.push({
      key: agentKey,
      displayName: known?.display_name || agentDisplayNames[agentKey] || agentKey,
      state: "orphan",
    });
  }

  const visible = typeof limit === "number" ? dots.slice(0, limit) : dots;
  const hiddenCount = dots.length - visible.length;

  const dim = size === "sm"
    ? "h-[16px] w-[16px] text-[8px]"
    : "h-[18px] w-[18px] text-[9px]";

  const stateClass: Record<DotState, string> = {
    synced: "border-transparent bg-[var(--color-text-primary)] text-[var(--color-bg)]",
    available: "border-border-subtle bg-surface-hover text-faint",
    orphan: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };

  const stateTitle: Record<DotState, string> = {
    synced: " · assigned",
    available: " · available",
    orphan: " · assigned · agent unavailable",
  };

  return (
    <div className={cn("flex items-center gap-[2px]", className)}>
      {visible.map((dot) => (
        <span
          key={dot.key}
          title={`${dot.displayName}${stateTitle[dot.state]}`}
          className={cn(
            "inline-flex select-none items-center justify-center rounded-[4px] border font-mono font-semibold tracking-tight transition-colors",
            dim,
            stateClass[dot.state],
          )}
        >
          {shortLabel(dot.displayName, dot.key)}
        </span>
      ))}
      {hiddenCount > 0 && (
        <span
          title={`+${hiddenCount} more agents`}
          className={cn(
            "inline-flex select-none items-center justify-center rounded-[4px] border border-border-subtle bg-surface-hover font-mono font-semibold text-faint",
            dim,
          )}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}
