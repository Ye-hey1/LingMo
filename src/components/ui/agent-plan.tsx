"use client";

import * as React from "react";
import {
  CheckCircle2,
  Circle,
  CircleAlert,
  CircleX,
  ChevronRight,
  Brain,
  Zap,
  Eye,
  Loader2,
  Clock,
  XCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { DiffViewer } from "@/components/ui/diff-viewer";
import { formatConfirmationPreview } from "@/lib/agent";
import type { AgentApprovalScope, AgentEvent } from "@/lib/agent";
import {
  extractVisibleFinalAnswer,
  isInternalAgentInstruction,
  sanitizeVisibleAssistantContent,
} from "@/lib/agent/parse-action-input";
import { isSupportOnlyObservationText, isSupportOnlyToolName } from "@/lib/agent/support-tools";

// Type definitions from existing codebase
interface ToolCall {
  id: string;
  toolName: string;
  params: Record<string, any>;
  result?: {
    success: boolean;
    message?: string;
    data?: any;
    error?: string;
  };
  status: "pending" | "running" | "success" | "error";
  timestamp: number;
}

interface ConfirmationRecord {
  toolName: string;
  params: Record<string, any>;
  status: "pending" | "confirmed" | "cancelled";
  timestamp: number;
  scope?: AgentApprovalScope;
  sessionApprovalType?: "write" | "runtime-script-skill";
  sessionApprovalSkillId?: string;
}

interface ReActStep {
  thought: string;
  action?: {
    tool: string;
    params: Record<string, any>;
  };
  observation?: string;
  duration?: number;
}

// Props for the unified AgentPlan component
interface AgentPlanProps {
  // Mode: 'live' for real-time execution, 'history' for saved history
  mode: "live" | "history";

  // Props for live mode
  isRunning?: boolean;
  isThinking?: boolean;
  currentThought?: string;
  thoughtHistory?: string[];
  completedSteps?: ReActStep[]; // 已完成的完整步骤
  currentAction?: string;
  currentObservation?: string;
  agentEvents?: AgentEvent[];
  toolCalls?: ToolCall[];
  pendingConfirmation?: {
    toolName: string;
    params: Record<string, any>;
    previewParams?: Record<string, any>;
    originalContent?: string;
    modifiedContent?: string;
    filePath?: string;
    canApproveForSession?: boolean;
    sessionApprovalType?: "write" | "runtime-script-skill";
    sessionApprovalSkillId?: string;
    persistentApprovalOptions?: AgentApprovalScope[];
  };
  confirmationHistory?: ConfirmationRecord[];
  currentStepStartTime?: number; // 当前步骤开始时间戳

  // Task plan progress
  taskPlan?: {
    isComplex: boolean;
    steps: Array<{
      description: string;
      tools: string[];
    }>;
    summary: string;
    completedStepIndex: number;
  };

  // Props for history mode
  historyJson?: string;

  // Callbacks for live mode
  onConfirm?: (scope?: AgentApprovalScope) => void;
  onCancel?: () => void;

  // i18n namespace (optional, defaults to 'record.chat.input.agent')
  i18nNs?: string;

  // Embedded mode: render without outer container (for use in combined panels)
  embedded?: boolean;
}

// Internal step representation for unified display
interface DisplayStep {
  id: string;
  thought: string;
  action?: {
    tool: string;
    params: Record<string, any>;
  };
  observation?: string;
  status: "completed" | "in-progress" | "pending" | "need-help" | "failed";
  confirmation?: ConfirmationRecord;
  tools?: string[];
  duration?: number;  // 耗时（毫秒）
}

type TimelineStatus = "completed" | "running" | "waiting" | "failed" | "pending";
type TimelineKind =
  | "planning"
  | "model"
  | "thought"
  | "action"
  | "tool"
  | "observation"
  | "confirmation"
  | "final"
  | "error";

interface TimelineItem {
  id: string;
  kind: TimelineKind;
  title: string;
  description?: string;
  status: TimelineStatus;
  timestamp: number;
  duration?: number;
  detail?: string;
  toolName?: string;
  iteration?: number;
}

const STATUS_LABELS: Record<TimelineStatus, string> = {
  completed: "✓",
  running: "·",
  waiting: "⏳",
  failed: "✗",
  pending: "○",
};

function getShortText(value: unknown, maxLength = 120): string {
  let text: string;

  if (typeof value === "string") {
    text = value;
  } else {
    if (value === undefined || value === null) return "";
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }

  const normalized = sanitizeVisibleAssistantContent(text).replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

export function AgentPlan({
  mode,
  isRunning = false,
  isThinking = false,
  currentThought = "",
  thoughtHistory = [],
  completedSteps = [],
  currentAction = "",
  currentObservation = "",
  agentEvents = [],
  toolCalls = [],
  pendingConfirmation,
  confirmationHistory = [],
  currentStepStartTime,
  taskPlan,
  historyJson,
  onConfirm,
  onCancel,
  i18nNs = "record.chat.input.agent",
  embedded = false,
}: AgentPlanProps) {
  const t = useTranslations(i18nNs);
  const rootT = useTranslations();
  const [expandedTasks, setExpandedTasks] = React.useState<string[]>([]);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const thoughtRefs = React.useRef<Map<string, HTMLParagraphElement>>(new Map());
  const [currentStepDuration, setCurrentStepDuration] = React.useState<number>(0);
  const [showDiff, setShowDiff] = React.useState(true);
  const [autoScrollEnabled, setAutoScrollEnabled] = React.useState(true);

  const scrollStepIntoView = React.useCallback((stepId: string) => {
    if (embedded) return;

    setTimeout(() => {
      const el = document.getElementById(`step-${stepId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }, 50);
  }, [embedded]);

  const extractFinalAnswer = React.useCallback((content: string): string => {
    return extractVisibleFinalAnswer(content) || "";
  }, []);

  const getThoughtBody = React.useCallback((content: string): string => {
    if (!content) return "";

    return sanitizeVisibleAssistantContent(content)
      .replace(/^Thought:\s*/i, "")
      .replace(/^思考[:：]?\s*/i, "")
      .trim();
  }, []);

  const shouldHideThoughtBlock = React.useCallback((thought?: string): boolean => {
    if (!thought) return false;

    const finalAnswer = extractFinalAnswer(thought);
    if (!finalAnswer) return false;

    const thoughtBody = getThoughtBody(thought)
      .replace(/Final Answer[:：][\s\S]*/i, "")
      .replace(/最终答案[:：]?[\s\S]*/i, "")
      .trim();

    if (!thoughtBody) {
      return true;
    }

    const normalizeForCompare = (value: string) =>
      value
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[：:，。、“”"'`]/g, "");

    const normalizedThought = normalizeForCompare(thoughtBody);
    const normalizedAnswer = normalizeForCompare(finalAnswer);

    return !normalizedThought || normalizedAnswer.includes(normalizedThought);
  }, [extractFinalAnswer, getThoughtBody]);

  // 实时更新当前步骤的耗时
  React.useEffect(() => {
    if (mode === "live" && isRunning && currentStepStartTime) {
      // 立即更新一次
      setCurrentStepDuration(Date.now() - currentStepStartTime);

      // 设置定时器，每 100ms 更新一次
      const interval = setInterval(() => {
        setCurrentStepDuration(Date.now() - currentStepStartTime);
      }, 100);

      return () => clearInterval(interval);
    } else {
      setCurrentStepDuration(0);
    }
  }, [mode, isRunning, currentStepStartTime]);

  // Parse history JSON in history mode
  const parseHistory = (): DisplayStep[] => {
    if (mode === "live") {
      return [];
    }

    const trimmedHistoryJson = historyJson?.trim();
    if (!trimmedHistoryJson) {
      return [];
    }

    try {
      const history = JSON.parse(trimmedHistoryJson);

      // Handle new format with steps
      if (history.steps && history.steps.length > 0) {
        return history.steps.map((step: ReActStep, index: number) => {
          const toolCall = history.toolCalls?.[index];
          let status: DisplayStep["status"] = "completed";

          // 优先使用 toolCall 的实际执行状态，而不是通过文本匹配判断
          if (toolCall?.result?.success !== undefined) {
            status = toolCall.result.success ? "completed" : "failed";
          } else if (toolCall?.status) {
            switch (toolCall.status) {
              case "success":
                status = "completed";
                break;
              case "error":
                status = "failed";
                break;
              default:
                // 回退到文本匹配判断
                if (step.observation) {
                  status =
                    step.observation.includes("失败") ||
                    step.observation.includes("错误")
                      ? "failed"
                      : "completed";
                }
            }
          } else if (step.observation) {
            status =
              step.observation.includes("失败") ||
              step.observation.includes("错误")
                ? "failed"
                : "completed";
          } else if (!step.action) {
            // 只有思考没有动作和观察，说明是未完成的步骤
            status = "pending";
          }

          return {
            id: `history-${index}`,
            thought: step.thought,
            action: step.action,
            observation: step.observation,
            status,
            duration: step.duration,
            tools: toolCall ? [toolCall.toolName] : undefined,
          };
        });
      }

      // Handle old format with thought field
      if (history.thought) {
        const thoughts = history.thought.split("\n\n").filter((t: string) => t.trim());
        return thoughts.map((thought: string, index: number) => ({
          id: `history-${index}`,
          thought,
          status: "completed" as const,
        }));
      }

      return [];
    } catch {
      return [];
    }
  };

  // Convert live mode data to DisplayStep format
  const convertLiveData = (): DisplayStep[] => {
    const steps: DisplayStep[] = [];

    // 优先使用 completedSteps（包含完整的步骤信息）
    if (completedSteps && completedSteps.length > 0) {
      // 跟踪已使用的 toolCalls 索引，避免重复匹配
      const usedToolCallIndices = new Set<number>();

      completedSteps.forEach((step, index) => {
        const sanitizedThought = sanitizeVisibleAssistantContent(step.thought || "");
        const sanitizedObservation = isInternalAgentInstruction(step.observation)
          ? undefined
          : sanitizeVisibleAssistantContent(step.observation || "") || step.observation;

        if (
          isSupportOnlyToolName(step.action?.tool) ||
          isSupportOnlyObservationText(step.observation) ||
          (!step.action && !sanitizedThought && !sanitizedObservation)
        ) {
          return;
        }

        const confirmation = confirmationHistory[index];
        let status: DisplayStep["status"] = "completed";

        // 通过工具名称匹配 toolCall（而不是索引匹配）
        // 因为 completedSteps 和 toolCalls 的数量可能不一致
        let toolCall: ToolCall | undefined = undefined;
        if (step.action) {
          // 从后往前查找，优先使用最新的未使用的 toolCall
          for (let i = toolCalls.length - 1; i >= 0; i--) {
            if (!isSupportOnlyToolName(toolCalls[i].toolName) && !usedToolCallIndices.has(i) && toolCalls[i].toolName === step.action.tool) {
              toolCall = toolCalls[i];
              usedToolCallIndices.add(i);
              break;
            }
          }
        }

        // 优先使用 toolCall 的实际执行状态，而不是通过文本匹配判断
        if (toolCall) {
          switch (toolCall.status) {
            case "success":
              status = "completed";
              break;
            case "error":
              status = "failed";
              break;
            case "running":
              status = "in-progress";
              break;
            case "pending":
              status = "pending";
              break;
            default:
              // 如果 toolCall.status 无效，回退到文本匹配判断
              if (sanitizedObservation) {
                status =
                  sanitizedObservation.includes("失败") ||
                  sanitizedObservation.includes("错误")
                    ? "failed"
                    : "completed";
              } else if (!step.action) {
                status = "pending";
              }
          }
        } else if (sanitizedObservation) {
          // 如果没有对应的 toolCall，回退到文本匹配判断
          status =
            sanitizedObservation.includes("失败") ||
            sanitizedObservation.includes("错误")
              ? "failed"
              : "completed";
        } else if (!step.action) {
          status = "pending";
        }

        steps.push({
          id: `completed-${index}`,
          thought: sanitizedThought,
          action: step.action,
          observation: sanitizedObservation,
          status,
          duration: step.duration,
          confirmation,
        });
      });
    } else {
      // 兼容旧的 thoughtHistory 格式
      thoughtHistory.forEach((thought, index) => {
        const sanitizedThought = sanitizeVisibleAssistantContent(thought);
        if (!sanitizedThought) {
          return;
        }

        const confirmation = confirmationHistory[index];
        let status: DisplayStep["status"] = "completed";

        if (confirmation) {
          status =
            confirmation.status === "confirmed" ? "completed" : "failed";
        }

        steps.push({
          id: `thought-history-${index}`,
          thought: sanitizedThought,
          status,
          confirmation,
        });
      });
    }

    // Add current step
    const sanitizedCurrentThought = sanitizeVisibleAssistantContent(currentThought);
    const currentToolName = currentAction?.match(/^(\w+)\(/)?.[1];
    const sanitizedCurrentObservation = isInternalAgentInstruction(currentObservation)
      ? ""
      : isSupportOnlyToolName(currentToolName)
        ? ""
        : sanitizeVisibleAssistantContent(currentObservation);

    if (sanitizedCurrentThought || (currentAction && !isSupportOnlyToolName(currentToolName)) || sanitizedCurrentObservation) {
      let status: DisplayStep["status"] = "in-progress";

      if (pendingConfirmation) {
        status = "need-help";
      } else if (sanitizedCurrentObservation) {
        status = "completed";
      } else if (isThinking && !sanitizedCurrentThought) {
        // 正在等待 AI 生成思考，显示为 pending 状态（会有 loading 效果）
        status = "pending";
      }

      const currentStep: DisplayStep = {
        id: "current",
        thought: sanitizedCurrentThought || "",
        status,
        duration: currentStepDuration, // 使用实时计算的耗时
      };

      if (currentAction && !isSupportOnlyToolName(currentToolName)) {
        // Try to parse action as "toolName(params)" format
        const match = currentAction.match(/^(\w+)\((.*)\)$/);
        if (match) {
          currentStep.action = {
            tool: match[1],
            params: match[2] ? JSON.parse(match[2]) : {},
          };
        }
      }

      if (sanitizedCurrentObservation) {
        currentStep.observation = sanitizedCurrentObservation;
      }

      if (toolCalls.length > 0) {
        currentStep.tools = toolCalls
          .map((tc) => tc.toolName)
          .filter(toolName => !isSupportOnlyToolName(toolName));
      }

      steps.push(currentStep);
    }

    // 如果正在思考但没有当前步骤内容，添加一个 loading 步骤
    if (isThinking && !currentThought && !currentAction && !currentObservation) {
      steps.push({
        id: "thinking-placeholder",
        thought: "",
        status: "pending",
        duration: currentStepDuration, // 使用实时计算的耗时
      });
    }

    return steps;
  };

  const displaySteps: DisplayStep[] =
    mode === "live" ? convertLiveData() : parseHistory();

  // Auto-scroll to bottom when content changes in live mode
  React.useEffect(() => {
    if (mode === "live" && (currentThought || currentObservation) && contentRef.current && autoScrollEnabled) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [currentThought, currentObservation, currentStepDuration, mode, autoScrollEnabled]);

  // Handle scroll to detect if user manually scrolled up
  const handleScroll = React.useCallback(() => {
    if (!contentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScrollEnabled(isAtBottom);
  }, []);

  // Auto-scroll thought paragraph to bottom when content updates
  React.useEffect(() => {
    if (mode === "live" && currentThought) {
      const currentStepEl = thoughtRefs.current.get("current");
      if (currentStepEl && autoScrollEnabled) {
        currentStepEl.scrollTop = currentStepEl.scrollHeight;
      }
    }
  }, [currentThought, mode, autoScrollEnabled]);

  const confirmationPreview = React.useMemo(() => {
    if (!pendingConfirmation) {
      return null;
    }

    return formatConfirmationPreview(
      pendingConfirmation.toolName,
      pendingConfirmation.previewParams ?? pendingConfirmation.params ?? {}
    );
  }, [pendingConfirmation]);

  const translateKey = React.useCallback((key: string, fallback: string) => {
    return rootT.has(key) ? rootT(key) : fallback;
  }, [rootT]);

  const eventTimeline = React.useMemo<TimelineItem[]>(() => {
    if (!agentEvents || agentEvents.length === 0) {
      return [];
    }

    const items: TimelineItem[] = [];
    const modelRequests = new Map<number, TimelineItem>();
    const toolItems = new Map<string, TimelineItem>();
    const confirmationItems = new Map<string, TimelineItem>();

    const pushItem = (item: TimelineItem) => {
      items.push(item);
      return item;
    };

    agentEvents.forEach((event) => {
      const payload = event.payload || {};
      if (payload.internal === true || payload.visibility === "hidden") {
        return;
      }

      const sequence = event.sequence ?? items.length + 1;
      const iterationLabel = event.iteration ? `第 ${event.iteration} 轮` : undefined;

      switch (event.type) {
        case "agent.planning": {
          const plan = payload.plan;
          const stepCount = Array.isArray(plan?.steps) ? plan.steps.length : 0;
          pushItem({
            id: event.id || `planning-${sequence}`,
            kind: "planning",
            title: "拆解任务流程",
            description: stepCount ? `已规划 ${stepCount} 个执行步骤` : "正在判断任务复杂度",
            status: "completed",
            timestamp: event.timestamp,
            detail: plan ? JSON.stringify(plan, null, 2) : undefined,
            iteration: event.iteration,
          });
          break;
        }

        case "model.request.started": {
          const item = pushItem({
            id: event.id || `model-${sequence}`,
            kind: "model",
            title: "请求大模型",
            description: [
              iterationLabel,
              typeof payload.model === "string" ? payload.model : undefined,
              payload.toolCount ? `${payload.toolCount} 个可用工具` : undefined,
            ].filter(Boolean).join(" · ") || "等待模型生成下一步",
            status: "running",
            timestamp: event.timestamp,
            detail: JSON.stringify(payload, null, 2),
            iteration: event.iteration,
          });
          modelRequests.set(event.iteration || sequence, item);
          break;
        }

        case "model.response.received": {
          const key = event.iteration || sequence;
          const item = modelRequests.get(key);
          if (item) {
            item.status = "completed";
            item.duration = typeof payload.duration === "number"
              ? payload.duration
              : event.timestamp - item.timestamp;
            item.description = `${item.description || "模型已响应"} · 已返回`;
            item.detail = JSON.stringify(payload, null, 2);
          } else {
            pushItem({
              id: event.id || `model-response-${sequence}`,
              kind: "model",
              title: "收到模型响应",
              description: iterationLabel,
              status: "completed",
              timestamp: event.timestamp,
              duration: typeof payload.duration === "number" ? payload.duration : undefined,
              detail: JSON.stringify(payload, null, 2),
              iteration: event.iteration,
            });
          }
          break;
        }

        case "thought":
        case "thought.updated": {
          const rawContent = typeof payload.content === "string" ? payload.content : "";
          if (extractVisibleFinalAnswer(rawContent)) {
            return;
          }

          const content = sanitizeVisibleAssistantContent(rawContent);
          if (!content || event.type === "thought.updated") {
            return;
          }
          pushItem({
            id: event.id || `thought-${sequence}`,
            kind: "thought",
            title: "生成执行思路",
            description: getShortText(content),
            status: "completed",
            timestamp: event.timestamp,
            detail: content,
            iteration: event.iteration,
          });
          break;
        }

        case "action":
        case "action.parsed": {
          const toolName = typeof payload.tool === "string" ? payload.tool : "工具";
          if (isSupportOnlyToolName(toolName)) {
            return;
          }
          if (event.type === "action" && items.some(item => item.kind === "action" && item.toolName === toolName && item.iteration === event.iteration)) {
            return;
          }
          pushItem({
            id: event.id || `action-${sequence}`,
            kind: "action",
            title: "确定下一步动作",
            description: toolName,
            status: "completed",
            timestamp: event.timestamp,
            detail: JSON.stringify(payload.params || {}, null, 2),
            toolName,
            iteration: event.iteration,
          });
          break;
        }

        case "tool.execution.started": {
          const toolName = typeof payload.toolName === "string" ? payload.toolName : "工具";
          if (isSupportOnlyToolName(toolName)) {
            return;
          }
          const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : event.id || `tool-${sequence}`;
          const item = pushItem({
            id: event.id || `tool-start-${toolCallId}`,
            kind: "tool",
            title: "执行工具",
            description: toolName,
            status: "running",
            timestamp: event.timestamp,
            detail: JSON.stringify(payload.params || {}, null, 2),
            toolName,
            iteration: event.iteration,
          });
          toolItems.set(toolCallId, item);
          break;
        }

        case "tool.execution.finished": {
          const toolName = typeof payload.toolName === "string" ? payload.toolName : "工具";
          if (isSupportOnlyToolName(toolName)) {
            return;
          }
          const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
          const item = toolItems.get(toolCallId);
          const success = payload.success !== false;
          if (item) {
            item.status = success ? "completed" : "failed";
            item.duration = typeof payload.duration === "number"
              ? payload.duration
              : event.timestamp - item.timestamp;
            item.description = `${toolName} · ${success ? "执行完成" : "执行失败"}`;
            item.detail = JSON.stringify(payload, null, 2);
          } else {
            pushItem({
              id: event.id || `tool-finish-${sequence}`,
              kind: "tool",
              title: "工具执行结果",
              description: toolName,
              status: success ? "completed" : "failed",
              timestamp: event.timestamp,
              duration: typeof payload.duration === "number" ? payload.duration : undefined,
              detail: JSON.stringify(payload, null, 2),
              toolName,
              iteration: event.iteration,
            });
          }
          break;
        }

        case "confirmation.waiting":
        case "approval": {
          if (event.type === "approval" && payload.status !== "requested") {
            return;
          }
          const toolName = typeof payload.toolName === "string" ? payload.toolName : "工具";
          const key = `${event.iteration || 0}:${toolName}:${JSON.stringify(payload.params || {})}`;
          const item = pushItem({
            id: event.id || `confirmation-${sequence}`,
            kind: "confirmation",
            title: "等待用户确认",
            description: toolName,
            status: "waiting",
            timestamp: event.timestamp,
            detail: JSON.stringify(payload.context || payload.params || {}, null, 2),
            toolName,
            iteration: event.iteration,
          });
          confirmationItems.set(key, item);
          break;
        }

        case "confirmation.resolved": {
          const toolName = typeof payload.toolName === "string" ? payload.toolName : "工具";
          const key = `${event.iteration || 0}:${toolName}:${JSON.stringify(payload.params || {})}`;
          const item = confirmationItems.get(key);
          const confirmed = payload.status === "confirmed";
          if (item) {
            item.status = confirmed ? "completed" : "failed";
            item.duration = event.timestamp - item.timestamp;
            item.description = `${toolName} · ${confirmed ? "已确认" : "已取消"}`;
          } else {
            pushItem({
              id: event.id || `confirmation-resolved-${sequence}`,
              kind: "confirmation",
              title: confirmed ? "操作已确认" : "操作已取消",
              description: toolName,
              status: confirmed ? "completed" : "failed",
              timestamp: event.timestamp,
              toolName,
              iteration: event.iteration,
            });
          }
          break;
        }

        case "observation":
        case "observation.created": {
          if (event.type === "observation") {
            return;
          }
          const rawObservation = typeof payload.observation === "string" ? payload.observation : "";
          if (
            isSupportOnlyToolName(String(payload.toolName || "")) ||
            isSupportOnlyObservationText(rawObservation)
          ) {
            return;
          }
          if (isInternalAgentInstruction(rawObservation)) {
            return;
          }

          const observation = sanitizeVisibleAssistantContent(rawObservation);
          if (!observation) {
            return;
          }

          pushItem({
            id: event.id || `observation-${sequence}`,
            kind: "observation",
            title: "读取执行结果",
            description: getShortText(observation),
            status: payload.success === false ? "failed" : "completed",
            timestamp: event.timestamp,
            detail: observation,
            iteration: event.iteration,
          });
          break;
        }

        case "final":
        case "final.answer.rendered":
          if (event.type === "final.answer.rendered") {
            return;
          }
          const finalContent = sanitizeVisibleAssistantContent(String(payload.content || ""));
          pushItem({
            id: event.id || `final-${sequence}`,
            kind: "final",
            title: "整理最终回复",
            description: getShortText(finalContent),
            status: "completed",
            timestamp: event.timestamp,
            detail: finalContent || undefined,
            iteration: event.iteration,
          });
          break;

        case "error":
          pushItem({
            id: event.id || `error-${sequence}`,
            kind: "error",
            title: "执行遇到问题",
            description: getShortText(payload.error || payload.message || payload),
            status: "failed",
            timestamp: event.timestamp,
            detail: JSON.stringify(payload, null, 2),
            iteration: event.iteration,
          });
          break;

        default:
          break;
      }
    });

    const last = items[items.length - 1];
    if (mode === "live" && isRunning && last && last.status === "completed") {
      const hasActiveWaiting = items.some(item => item.status === "waiting");
      if (!hasActiveWaiting && isThinking) {
        items.push({
          id: "live-thinking-tail",
          kind: "model",
          title: "等待模型继续输出",
          description: "正在生成下一步",
          status: "running",
          timestamp: Date.now(),
        });
      }
    }

    return items;
  }, [agentEvents, isRunning, isThinking, mode]);

  const formatFieldValue = React.useCallback((value: unknown) => {
    if (typeof value === "string") {
      return value;
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null ||
      value === undefined
    ) {
      return String(value);
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, []);

  // Don't render if no content in history mode
  if (mode === "history" && displaySteps.length === 0 && eventTimeline.length === 0) {
    return null;
  }

  // Don't render if not running in live mode (unless there's content)
  if (mode === "live" && !isRunning && displaySteps.length === 0 && eventTimeline.length === 0) {
    return null;
  }

  // ---- 简单对话优化：如果没有工具调用，不显示执行流程 ----
  // 检查是否有实际的工具调用（不只是模型请求和思考）
  const hasToolCalls = eventTimeline.some(item =>
    item.kind === "tool" || item.kind === "confirmation" || item.kind === "action"
  );
  const hasCompletedStepsWithActions = displaySteps.some(step =>
    step.action && step.action.tool
  );
  const hasRuntimeFailure =
    eventTimeline.some(item => item.status === "failed") ||
    displaySteps.some(step => step.status === "failed") ||
    toolCalls.some(toolCall => toolCall.status === "error");

  if (mode === "live" && embedded && !pendingConfirmation && !hasRuntimeFailure) {
    return null;
  }

  // 在 live 模式下，如果只是简单对话（没有工具调用），不显示执行流程面板
  // 只显示紧凑的状态指示器
  if (mode === "live" && !hasToolCalls && !hasCompletedStepsWithActions && displaySteps.length <= 1) {
    // 如果正在运行但没有工具调用，只显示简单的加载状态
    if (isRunning) {
      return (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span>{isThinking ? t("thinking") : t("running")}</span>
        </div>
      );
    }
    return null;
  }

  // ---- Agent 简化显示 ----
  // Toggle step expansion
  const toggleStepExpansion = (stepId: string) => {
    // In live mode, prevent collapsing the current (in-progress) step
    if (mode === "live" && isRunning) {
      const currentStepId = displaySteps[displaySteps.length - 1]?.id;
      if (stepId === currentStepId) {
        // Don't allow collapsing the current step - keep it expanded
        return;
      }
    }
    setExpandedTasks((prev) => {
      const isExpanding = !prev.includes(stepId);
      if (isExpanding) {
        // 非嵌入模式下展开时滚动到该步骤
        scrollStepIntoView(stepId);
      }
      return prev.includes(stepId)
        ? prev.filter((id) => id !== stepId)
        : [...prev, stepId];
    });
  };

  // Handle confirmation
  const handleConfirm = (scope: AgentApprovalScope = "once") => {
    if (onConfirm) onConfirm(scope);
  };

  const handleCancel = () => {
    if (onCancel) onCancel();
  };

  // Clean markdown syntax from text
  const cleanMarkdown = (text: string): string => {
    return text
      // Remove bold/italic markers
      .replace(/\*\*\*/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/___/g, '')
      .replace(/__/g, '')
      .replace(/_/g, '')
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove strikethrough
      .replace(/~~/g, '')
      // Remove code blocks and inline code markers
      .replace(/```/g, '')
      .replace(/`/g, '')
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove blockquotes
      .replace(/^>\s+/gm, '')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // Clean up extra whitespace
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Extract title from step content (prioritize observation result, then action, then thought)
  const extractTitle = (step: DisplayStep): string => {
    // 特殊处理 loading 占位符
    if (step.id === "thinking-placeholder" || (!step.thought && !step.action && !step.observation)) {
      return t("thinking");
    }

    // Helper to extract meaningful text from content
    const extractFromContent = (content: string): string => {
      if (!content || !content.trim()) return '';

      const finalAnswer = extractFinalAnswer(content);
      if (finalAnswer) {
        return extractFromContent(finalAnswer);
      }

      // 预处理：移除首尾的代码块标记 ``` 及其周围的空白行
      let processedContent = content.trim();

      // 移除所有 ``` 标记及其所在行
      const lines = processedContent.split('\n');
      const filteredLines = lines.filter(line => {
        const trimmed = line.trim();
        // 跳过 ``` 行（不管是否有语言标识符）
        if (trimmed === '```' || trimmed.startsWith('```')) {
          return false;
        }
        return true;
      });
      processedContent = filteredLines.join('\n').trim();

      // 按行分割并过滤空行
      const contentLines = processedContent.split("\n").map(l => l.trim()).filter(l => l);

      // 尝试从第一行获取
      for (let i = 0; i < Math.min(contentLines.length, 5); i++) {
        const line = contentLines[i];

        if (!line) continue;

        // 如果是标题（## 开头），保留标题格式，移除 # 标记
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
          const titleText = headerMatch[2].trim();
          if (titleText) {
            return titleText.length > 50 ? titleText.substring(0, 50) + "..." : titleText;
          }
        }

        const cleaned = cleanMarkdown(line);
        if (cleaned.length > 0) {
          return cleaned.length > 50 ? cleaned.substring(0, 50) + "..." : cleaned;
        }
      }

      // 如果都没找到，返回第一行有效内容
      const firstValidLine = contentLines.find(l => l && l.length > 0);
      return firstValidLine || '';
    };

    // Use observation first - this contains the actual result of tool execution
    if (step.observation && step.observation.trim()) {
      const title = extractFromContent(step.observation);
      if (title) return title;
    }

    // Use action if available
    if (step.action) {
      const actionText = `${step.action.tool}(...)`;
      if (actionText.length > 50) {
        return actionText.substring(0, 50) + "...";
      }
      return actionText;
    }

    // Use thought if available
    if (step.thought && step.thought.trim()) {
      const title = extractFromContent(step.thought);
      if (title) return title;
    }

    return t("thinking");
  };

  // Get status icon
  const getStatusIcon = (status: DisplayStep["status"]) => {
    switch (status) {
      case "completed":
        return <span className="block size-2 rounded-full bg-muted-foreground/30" />;
      case "in-progress":
        return <Loader2 className="size-3.5 animate-spin text-muted-foreground/45" />;
      case "need-help":
        return <CircleAlert className="size-3.5 text-muted-foreground/65" />;
      case "failed":
        return <CircleX className="size-3.5 text-destructive/75" />;
      case "pending":
        return <Loader2 className="size-3.5 animate-spin text-muted-foreground/45" />;
      default:
        return <span className="block size-2 rounded-full border border-muted-foreground/30" />;
    }
  };

  const getTimelineIcon = (item: TimelineItem) => {
    if (item.status === "running") {
      return <Loader2 className="size-3 animate-spin text-muted-foreground/45" />;
    }
    if (item.status === "waiting") {
      return <CircleAlert className="size-3 text-muted-foreground/65" />;
    }
    if (item.status === "failed") {
      return <CircleX className="size-3 text-destructive/75" />;
    }
    return <span className="block size-1.5 rounded-full bg-muted-foreground/30" />;
  };

  // 格式化耗时显示
  const formatDuration = (duration?: number): string => {
    if (duration === undefined || duration === null) return "";
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
    const minutes = Math.floor(duration / 60000);
    const seconds = ((duration % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  };

  const renderTimeline = () => {
    if (eventTimeline.length === 0) {
      return null;
    }

    const hasWaiting = eventTimeline.some(item => item.status === "waiting");
    const hasFailed = eventTimeline.some(item => item.status === "failed");

    if (mode === "live" && embedded && !hasWaiting && !hasFailed) {
      return null;
    }

    // 计算总体状态
    const hasRunning = eventTimeline.some(item => item.status === "running");
    const completedCount = eventTimeline.filter(item => item.status === "completed").length;
    const totalDuration = eventTimeline.reduce((sum, item) => sum + (item.duration || 0), 0);

    // 默认折叠状态 - 用户需要点击展开查看详情
    const isTimelineExpanded = expandedTasks.includes("timeline-root");

    return (
      <div className="mb-1.5 rounded-md border border-border/20 bg-muted/8 px-2.5 py-1">
        {/* 紧凑的折叠头部 */}
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left"
          onClick={() => toggleStepExpansion("timeline-root")}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {hasRunning ? (
              <Loader2 className="size-3 animate-spin text-muted-foreground/45 shrink-0" />
            ) : hasFailed ? (
              <CircleX className="size-3 text-destructive/75 shrink-0" />
            ) : (
              <span className="size-1.5 rounded-full bg-muted-foreground/35 shrink-0" />
            )}
            <span className="text-[11px] text-muted-foreground/60 truncate">
              {isRunning ? "执行中…" : `${completedCount} 步已完成`}
            </span>
            {totalDuration > 0 && (
              <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                {formatDuration(totalDuration)}
              </span>
            )}
          </div>
          <ChevronRight
            className={`size-3 text-muted-foreground/30 shrink-0 transition-transform ${
              isTimelineExpanded ? "rotate-90" : ""
            }`}
          />
        </button>

        {/* 展开的详细时间线 */}
        {isTimelineExpanded && (
          <ol className="mt-2 space-y-1 border-t border-border/30 pt-2">
            {eventTimeline.map((item, index) => {
              const isItemExpanded = expandedTasks.includes(item.id);
              const hasDetail = Boolean(item.detail && item.detail.trim());
              const isLast = index === eventTimeline.length - 1;

              return (
                <li key={item.id} className="relative pl-6">
                  {!isLast && (
                    <span className="absolute left-[9px] top-5 h-[calc(100%+2px)] w-px bg-border/30" />
                  )}
                  <div className="absolute left-0 top-1 flex size-[18px] items-center justify-center rounded-full border border-border/40 bg-background">
                    {getTimelineIcon(item)}
                  </div>

                  <button
                    type="button"
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                      hasDetail ? "hover:bg-muted/30" : "cursor-default"
                    }`}
                    onClick={() => {
                      if (!hasDetail) return;
                      toggleStepExpansion(item.id);
                    }}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs text-muted-foreground">{item.title}</span>
                        <span
                          className={`shrink-0 text-[10px] leading-none ${
                            item.status === "failed"
                              ? "text-destructive/75"
                              : item.status === "waiting"
                                ? "text-muted-foreground/65"
                                : item.status === "running"
                                  ? "text-muted-foreground/65"
                                  : "text-muted-foreground/45"
                          }`}
                        >
                          {STATUS_LABELS[item.status]}
                        </span>
                      </div>
                      {item.description && (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground/60">
                          {item.description}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                      {item.duration !== undefined && (
                        <span className="tabular-nums">{formatDuration(item.duration)}</span>
                      )}
                      {hasDetail && (
                        <ChevronRight
                          className={`size-3.5 transition-transform ${isItemExpanded ? "rotate-90" : ""}`}
                        />
                      )}
                    </div>
                  </button>

                  {hasDetail && isItemExpanded && (
                    <pre className="ml-2 mt-1 max-h-32 overflow-auto rounded-md border border-border/30 bg-muted/20 px-2 py-1 text-[11px] leading-relaxed text-muted-foreground/60 whitespace-pre-wrap break-words">
                      {item.detail}
                    </pre>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    );
  };

  // 渲染任务规划进度面板
  const renderTaskPlan = () => {
    if (!taskPlan || !taskPlan.isComplex || taskPlan.steps.length === 0) {
      return null;
    }
    if (mode === "live" && embedded) {
      return null;
    }

    const { steps, summary, completedStepIndex } = taskPlan;
    const totalSteps = steps.length;
    const doneCount = Math.max(0, completedStepIndex + 1);
    const progressPct = Math.round((doneCount / totalSteps) * 100);
    const allDone = completedStepIndex >= totalSteps - 1;

    return (
      <div className="mb-1.5 rounded-md border border-border/20 bg-muted/8 px-2.5 py-2">
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <ListChecks className="size-3.5 text-muted-foreground/55 shrink-0" />
          <span className="text-[11px] font-medium text-foreground/80 truncate">
            {summary || `任务规划 (${totalSteps} 步)`}
          </span>
          <span className={`ml-auto shrink-0 text-[10px] leading-none font-medium ${
            allDone
              ? "text-muted-foreground/60"
              : "text-muted-foreground/70"
          }`}>
            {allDone ? "✓" : `${doneCount}/${totalSteps}`}
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1 w-full rounded-full bg-muted overflow-hidden mb-1.5">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              allDone ? "bg-muted-foreground/35" : "bg-muted-foreground/30"
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Step list */}
        <ol className="space-y-1">
          {steps.map((step, index) => {
            const isCompleted = index <= completedStepIndex;
            const isRunning = index === completedStepIndex + 1 && !allDone;

            return (
              <li key={index} className="flex items-start gap-2">
                {/* Status indicator */}
                <div className="mt-0.5 shrink-0">
                  {isCompleted ? (
                    <span className="block size-2 rounded-full bg-muted-foreground/30" />
                  ) : isRunning ? (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground/45" />
                  ) : (
                    <Circle className="size-3.5 text-muted-foreground/40" />
                  )}
                </div>

                {/* Step content */}
                <div className="min-w-0 flex-1">
                  <div className={`text-xs leading-relaxed ${
                    isCompleted ? "text-muted-foreground line-through decoration-muted-foreground/30" :
                    isRunning ? "text-foreground font-medium" :
                    "text-muted-foreground/60"
                  }`}>
                    <span className="text-muted-foreground/50 mr-1">{index + 1}.</span>
                    {step.description}
                  </div>
                  {step.tools.length > 0 && !isCompleted && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {step.tools.map((tool, ti) => (
                        <span key={ti} className="rounded bg-muted px-1 py-0 text-[10px] text-muted-foreground/50">
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    );
  };

  // 渲染步骤列表内容（用于 embedded 和非 embedded 模式）
  const renderSteps = () => (
    <>
      {displaySteps.map((step, index) => {
        const isExpanded = expandedTasks.includes(step.id);
        const isCompleted = step.status === "completed";
        const canToggle = true;

        return (
          <li
            key={step.id}
            id={`step-${step.id}`}
            className={`${index !== 0 ? "mt-1 pt-2" : ""}`}
          >
            {/* Step row */}
            <div className="group flex items-center gap-2 py-1">
              <div
                className={`shrink-0 ${canToggle ? "cursor-pointer" : ""}`}
                onClick={() => canToggle && toggleStepExpansion(step.id)}
              >
                <div className={canToggle ? "cursor-pointer" : ""}>
                  {getStatusIcon(step.status)}
                </div>
              </div>

              <div
                className={`flex min-w-0 grow ${canToggle ? "cursor-pointer" : ""} items-center justify-between`}
                onClick={() => canToggle && toggleStepExpansion(step.id)}
              >
                <div className="flex-1 truncate">
                  <span
                    className={`${
                      isCompleted ? "text-muted-foreground" : ""
                    }`}
                  >
                    {extractTitle(step)}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* 耗时显示 */}
                  {mode === "history" && step.duration !== undefined && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDuration(step.duration)}
                    </span>
                  )}
                  {canToggle && (
                    <ChevronRight
                      className={`size-4 text-muted-foreground shrink-0 transition-transform ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-muted mt-1 mr-2 mb-1.5 ml-6 space-y-2">
                {/* Thought */}
                {step.thought && !shouldHideThoughtBlock(step.thought) && (
                  <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                    <div className="flex items-center gap-2 py-1">
                      <Brain className="size-3.5 text-muted-foreground/45 shrink-0" />
                      <span className="font-medium text-xs">
                        {t("thought")}
                      </span>
                    </div>
                    <p
                      ref={(el) => {
                        if (step.id) {
                          if (el) thoughtRefs.current.set(step.id, el);
                          else thoughtRefs.current.delete(step.id);
                        }
                      }}
                      className="whitespace-pre-wrap max-h-40 overflow-y-auto wrap-break-word py-1"
                    >
                      {step.thought}
                    </p>
                  </div>
                )}

                {/* Action */}
                {step.action && (
                  <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                    <div className="flex items-center gap-2 py-1">
                      <Zap className="size-3.5 text-muted-foreground/45 shrink-0" />
                      <span className="font-medium text-xs">
                        {t("action")}
                      </span>
                    </div>
                    <div className="text-xs font-mono truncate" title={JSON.stringify(step.action.params)}>
                      {step.action.tool}
                      {Object.keys(step.action.params).length > 0 ? '(...)' : '()'}
                    </div>
                  </div>
                )}

                {/* Observation */}
                {step.observation && (
                  <div className="text-muted-foreground border-foreground/20 border-l border-dashed pl-3 text-xs">
                    <div className="flex items-center gap-2 py-1">
                      <Eye className="size-3.5 text-muted-foreground/45 shrink-0" />
                      <span className="font-medium text-xs">
                        {t("observation")}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap wrap-break-word py-1">
                      {step.observation}
                    </p>
                  </div>
                )}

                {/* Confirmation record */}
                {step.confirmation && (
                  <div className="flex items-center gap-2 py-1.5 px-3 border-t">
                    {step.confirmation.status === "confirmed" ? (
                      <CheckCircle className="size-4 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="size-4 text-red-500 shrink-0" />
                    )}
                    <code className="text-sm text-muted-foreground flex-1 wrap-break-word font-mono">
                      {step.confirmation.toolName}
                    </code>
                  </div>
                )}

              </div>
            )}
          </li>
        );
      })}

      {/* Current step confirmation (live mode only) */}
      {mode === "live" && pendingConfirmation && (
        <li className="mt-1 pt-2">
          <div className="rounded-md border border-border/50 bg-muted/30 overflow-hidden">
            {/* Confirmation header */}
            <div className="flex items-center justify-between px-3 py-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <Clock className="size-4.5 text-orange-500 shrink-0 animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground font-medium truncate">
                      {confirmationPreview
                        ? translateKey(
                            confirmationPreview.titleKey,
                            pendingConfirmation.toolName
                          )
                        : pendingConfirmation.toolName}
                    </span>
                    {pendingConfirmation.filePath && (
                      <span className="text-xs text-muted-foreground truncate">
                        {pendingConfirmation.filePath}
                      </span>
                    )}
                  </div>
                  {confirmationPreview && (
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {translateKey(
                        confirmationPreview.descriptionKey,
                        t("confirmation.description")
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* Show diff button */}
                {pendingConfirmation.originalContent && pendingConfirmation.modifiedContent && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setShowDiff(!showDiff)}
                  >
                    {showDiff ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                    <span className="ml-1">Diff</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Diff view */}
            {showDiff && pendingConfirmation.originalContent && pendingConfirmation.modifiedContent && (
              <div className="border-t border-border/50">
                <DiffViewer
                  original={pendingConfirmation.originalContent}
                  modified={pendingConfirmation.modifiedContent}
                  mode="lines"
                  showLineNumbers={true}
                  maxHeight={200}
                  className="border-0 rounded-none"
                />
              </div>
            )}

            {!pendingConfirmation.originalContent &&
              !pendingConfirmation.modifiedContent &&
              confirmationPreview &&
              confirmationPreview.fields.length > 0 && (
                <div className="border-t border-border/50 px-3 py-2 space-y-2">
                  {confirmationPreview.fields.map((field) => {
                    const label = translateKey(field.labelKey, field.name);
                    const formattedValue = formatFieldValue(field.value);

                    return (
                      <div key={field.name} className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground">
                          {label}
                        </div>
                        {field.displayType === "content" ? (
                          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 px-2 py-1 text-xs text-foreground">
                            {formattedValue}
                          </pre>
                        ) : (
                          <div className="whitespace-pre-wrap break-words text-xs text-foreground">
                            {formattedValue}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

            {/* Confirmation buttons */}
            <div className="flex flex-wrap items-center justify-end gap-1 px-3 py-1.5 border-t border-border/50">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={handleCancel}
              >
                <XCircle className="size-4 text-red-500" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => handleConfirm("once")}
              >
                <CheckCircle className="size-4 text-green-500" />
                <span className="ml-1">允许这次</span>
              </Button>
              {pendingConfirmation.canApproveForSession && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => handleConfirm("conversation")}
                >
                  <CheckCircle2 className="size-4 text-green-600" />
                  <span className="ml-1">
                    {pendingConfirmation.sessionApprovalType === "runtime-script-skill"
                      ? "本会话允许此 Skill 脚本"
                      : "本会话都允许"}
                  </span>
                </Button>
              )}
              {pendingConfirmation.persistentApprovalOptions?.includes("always-tool") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => handleConfirm("always-tool")}
                >
                  <CheckCircle2 className="size-4 text-green-600" />
                  <span className="ml-1">总是允许此工具</span>
                </Button>
              )}
              {pendingConfirmation.persistentApprovalOptions?.includes("always-folder") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => handleConfirm("always-folder")}
                >
                  <CheckCircle2 className="size-4 text-green-600" />
                  <span className="ml-1">总是允许此文件夹</span>
                </Button>
              )}
              {pendingConfirmation.persistentApprovalOptions?.includes("always-readonly") && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => handleConfirm("always-readonly")}
                >
                  <CheckCircle2 className="size-4 text-green-600" />
                  <span className="ml-1">总是允许只读工具</span>
                </Button>
              )}
            </div>
          </div>
        </li>
      )}
    </>
  );

  // Show loading state in live mode - compact design inspired by Codex TUI
  if (mode === "live" && isRunning && displaySteps.length === 0 && eventTimeline.length === 0) {
    return (
      <div className="w-full mb-1">
        <div className="flex items-center gap-1.5 py-1 px-1">
          {/* Animated spinner */}
          <Loader2 className="size-3.5 animate-spin text-muted-foreground/45 shrink-0" />

          {/* Status text */}
          <span className="text-[11px] font-medium text-muted-foreground">
            {isThinking ? t("thinking") : t("running")}
          </span>

          {/* Elapsed time */}
          {currentStepDuration > 0 && (
            <span className="text-[10px] text-muted-foreground/40 tabular-nums">
              {formatDuration(currentStepDuration)}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Embedded 模式：只返回 <li> 元素
  if (embedded) {
    return (
      <>
        <li>{renderTimeline()}</li>
        <li>{renderTaskPlan()}</li>
        {renderSteps()}
      </>
    )
  }

  // 标准模式：返回完整的容器
  return (
    <div className="w-full mb-4">
      {renderTimeline()}
      {renderTaskPlan()}
      {/* 步骤列表 */}
      <div className="overflow-hidden" ref={contentRef} onScroll={handleScroll}>
        <ul className="space-y-1">
          {renderSteps()}
        </ul>
      </div>
    </div>
  );
}

export default AgentPlan;
