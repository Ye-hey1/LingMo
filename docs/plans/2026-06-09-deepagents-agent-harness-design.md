# DeepAgents-style Agent Harness Design

Date: 2026-06-09

## Objective

Upgrade LingMo's current Agent from a prompt-heavy ReAct loop into a local-first Agent Harness inspired by `langchain-ai/deepagents`.

The immediate failure case is `/writing-skills`: a writing Skill can still enter Agent mode, then get trapped in a ReAct/JSON-action loop and remain at "思考中" without producing the expected article. The broader problem is architectural: Skills, tools, file access, context packing, approvals, and memory are currently coupled through one execution loop instead of a control plane.

This design intentionally chooses a larger harness rewrite over incremental patching.

## Source Basis

DeepAgents describes itself as a "batteries-included agent harness" that can be extended or replaced piece by piece. Its README lists these default capabilities:

- Sub-agents with isolated context windows.
- Filesystem access for read, write, edit, and search across pluggable backends.
- Context management that summarizes long threads and offloads tool outputs to disk.
- Shell access.
- Persistent memory.
- Human-in-the-loop approval, editing, or rejection before tools run.
- Skills loaded on demand.
- Bring-your-own tools and MCP servers.

References:

- https://raw.githubusercontent.com/langchain-ai/deepagents/main/README.md
- https://docs.langchain.com/oss/python/deepagents/overview
- https://docs.langchain.com/oss/python/deepagents/context-engineering
- https://docs.langchain.com/oss/python/deepagents/skills

The important design lesson is not to copy the Python library directly. LingMo needs a Tauri/Next/local-workspace version of the same harness shape.

## Current Pain Points

1. Skill execution mode is inferred too late and too loosely.
   - Writing/advisory Skills can still enter Agent mode.
   - Tool/file/script Skills are not represented as explicit runtime profiles.

2. The tool layer is a flat list.
   - Builtin tools, MCP tools, Skill scripts, GitHub tools, and filesystem tools are concatenated.
   - Risk, capability, timeout, artifact handling, and retry behavior are not enforced by one execution gateway.

3. Human control is confirmation-centric.
   - Users can approve or reject, but cannot consistently edit parameters, pause a run, or resume from a structured snapshot.

4. Filesystem concerns are mixed.
   - Real user notes, temporary scripts, long observations, and generated artifacts can blur together.
   - Large results can still pressure the model context.

5. Context is prompt assembly instead of a managed pack.
   - Priority, deduplication, deferral, summaries, and references are not first-class.

6. Memory has useful pieces but no clear layers.
   - Run state, working memory, user memory, and project memory should have separate write rules and injection priorities.

## Recommended Architecture

Build a new `AgentOrchestrator` and migrate existing Agent behavior behind it.

```text
User request
  -> IntentRouter
  -> SkillResolver
  -> ContextEngine
  -> Planner / Todo
  -> ToolSelector
  -> ApprovalGate
  -> ToolRuntime
  -> AgentVFS / MemoryStore
  -> Finalizer
```

Keep the existing `AgentHandler` and `ReActAgent` as a compatibility path during migration. The new harness should route easy/writing tasks around ReAct and reserve Agent mode for actual tool work.

## 1. Skill Loading And Routing

Introduce explicit Skill runtime profiles.

```ts
type SkillRuntimeProfile =
  | 'writer'
  | 'advisor'
  | 'agent'
  | 'workflow'
```

Profile meanings:

- `writer`: generate, revise, summarize, or structure text. No ReAct loop.
- `advisor`: explain, analyze, or propose. No tool execution by default.
- `agent`: may read/write files, call tools, or execute scripts.
- `workflow`: long-running multi-step work that needs todo state, snapshots, and approvals.

Proposed Skill manifest extension:

```yaml
---
name: writing-skills
description: 写作、文章结构、内容表达优化
runtimeProfile: writer
capabilities:
  - generate_text
  - revise_text
contextPolicy:
  load: summary-first
  references: on-demand
tools: []
---
```

Loading tiers:

1. Startup loads only summary metadata:
   - id
   - name
   - description
   - runtimeProfile
   - capabilities
   - tags

2. Match time loads the main Skill body only when selected or strongly matched.

3. Execution time loads references, scripts, and assets only on demand.

Routing rules:

- Explicit `runtimeProfile` wins.
- Legacy Skills are classified by a compatibility classifier, but the UI/log must show the inferred reason.
- Writing terms such as "write", "article", "markdown", "写", and "文章" do not imply Agent mode.
- File/script/tool terms imply Agent mode only when the Skill requests a concrete artifact, filesystem mutation, or command execution.

Immediate requirement:

`/writing-skills 我想写一篇关于 AI 产品经理的知识梳理文章` must route to `WriterExecutor`, not `AgentOrchestrator` ReAct mode.

## 2. ToolRuntime

Replace the flat `allTools` exposure with a capability registry and execution gateway.

```ts
interface ToolCapability {
  name: string
  provider: 'builtin' | 'mcp' | 'skill' | 'github' | 'filesystem'
  category: 'read' | 'write' | 'execute' | 'delete' | 'network'
  risk: 'low' | 'medium' | 'high'
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  sideEffects: string[]
  requiresApproval: boolean
  timeoutMs: number
}
```

Runtime components:

- `ToolRegistry`: registers builtin, MCP, GitHub, filesystem, and Skill script tools.
- `ToolSelector`: exposes a small task-specific tool subset.
- `ToolRuntime`: executes tools with timeout, cancellation, validation, result truncation, and artifact capture.
- `ToolPolicy`: enforces risk and approval rules.
- `ToolObservation`: normalizes every result.

```ts
interface ToolObservation {
  toolName: string
  success: boolean
  summary: string
  dataRef?: string
  artifacts?: string[]
  errorKind?: 'validation' | 'permission' | 'timeout' | 'network' | 'tool'
  retryable: boolean
}
```

Key rules:

- Writer/advisor routes see no write/execute tools.
- Agent/workflow routes see only tools relevant to their plan and Skill capabilities.
- Long outputs go to AgentVFS, not directly into the next prompt.
- Tool execution records include runId, stepId, toolCallId, timing, status, and artifact refs.
- MCP tools receive explicit capability labels instead of risk by name only.

## 3. Human Collaboration Control

Upgrade confirmations into `ApprovalGate + InterruptController`.

```ts
type HumanGateStatus =
  | 'auto'
  | 'needs_approval'
  | 'needs_clarification'
  | 'paused'
  | 'edited_by_user'
  | 'rejected'
  | 'approved'
```

```ts
interface ApprovalRequest {
  id: string
  runId: string
  stepId: string
  toolName: string
  risk: 'medium' | 'high'
  reason: string
  params: Record<string, unknown>
  diffPreview?: string
  affectedFiles?: string[]
  approvalScope: 'once' | 'session' | 'persistent'
}
```

User actions:

- Approve once.
- Approve for session.
- Persistently approve matching operations.
- Edit parameters and continue.
- Reject.
- Pause and save snapshot.

Approval previews:

- File writes show path, mode, and diff preview.
- Script execution shows command, cwd, timeout, environment, and output directory.
- Deletions and overwrites require explicit confirmation.
- GitHub operations show repository, token-powered action, and side effect.

Invariant:

All write, execute, delete, and external side-effect operations must pass through ToolRuntime and ApprovalGate. No direct dangerous tool path should bypass the gate.

## 4. AgentVFS And Filesystem Boundaries

Add a run-scoped Agent virtual filesystem.

```text
/.agent/
  runs/{runId}/
    plan.json
    todo.json
    context/
      packed-context.md
      sources.json
    observations/
      tool-{stepId}.json
      stdout-{stepId}.txt
      web-{stepId}.md
    drafts/
      answer.md
      article.md
    artifacts/
      report.html
      slides.pptx
    memory-delta.json
```

Reference type:

```ts
interface VfsRef {
  uri: `agent://${string}`
  runId: string
  path: string
  kind: 'context' | 'observation' | 'draft' | 'artifact'
  summary?: string
}
```

Rules:

- AgentVFS is low-risk work space.
- Real notes and project files are user asset space.
- Writing to real files requires approval.
- Long observations, stdout, web pages, and generated intermediate files stay in AgentVFS.
- Publishing from AgentVFS to notes/outputs is a deliberate action.

Suggested tools:

- `agent_vfs_write`
- `agent_vfs_read`
- `agent_vfs_list`
- `agent_vfs_search`
- `agent_create_draft`
- `agent_update_draft`
- `agent_publish_artifact`

This lets writing flows draft first and save later, while workflow/tool flows can persist state without polluting user notes.

## 5. ContextEngine

Promote context assembly into a managed context pack.

Priority order:

1. Current user input.
2. Explicit quote, selection, image, @ file, or user path.
3. Active note.
4. Current run plan, todo, draft, and observations.
5. Selected Skill body.
6. Skill references/assets summaries.
7. RAG and search results.
8. Working, user, and project memories.
9. Historical chat summary.

```ts
interface ContextPack {
  runId: string
  tokenBudget: number
  included: ContextItem[]
  deferred: VfsRef[]
  warnings: string[]
  checksum: string
}

interface ContextItem {
  id: string
  source: 'user' | 'quote' | 'file' | 'skill' | 'memory' | 'tool' | 'history'
  priority: number
  content: string
  tokenEstimate: number
  ref?: string
}
```

Policies:

- Include small, high-priority content directly.
- Defer large content to AgentVFS and expose refs.
- Deduplicate files, Skills, web pages, and repeated tool outputs.
- Split Markdown by headings, code by symbols or line ranges, and observations by summary/dataRef.
- Record context warnings when required context is missing, truncated, or stale.
- Show "used context" in UI for explainability.

Model compatibility:

- Writer routes should use a normal generation protocol.
- Agent routes may use tool-calling or ReAct depending on model capability.
- Reasoning models such as GLM should not be forced into JSON Action format for writing tasks.

## 6. Persistent Memory And Snapshots

Split memory into four layers.

```ts
type MemoryLayer =
  | 'run'
  | 'working'
  | 'user'
  | 'project'
```

Run snapshot:

```ts
interface AgentRunSnapshot {
  runId: string
  status: 'running' | 'paused' | 'completed' | 'failed'
  userGoal: string
  route: 'writer' | 'chat' | 'agent' | 'workflow'
  planRef?: VfsRef
  todoRef?: VfsRef
  contextPackRef?: VfsRef
  draftRefs: VfsRef[]
  observationRefs: VfsRef[]
  approvalHistory: ApprovalRequest[]
  finalAnswer?: string
  updatedAt: number
}
```

Layer rules:

- `run`: current task state, resumes, approvals, drafts, observations.
- `working`: recent files, recent tools, generated artifacts, failed attempts, session approvals. TTL 7 to 30 days.
- `user`: stable user preferences and facts. Only write with explicit user intent.
- `project`: workspace structure, module ownership, local conventions, confirmed design decisions.

Injection rules:

- Current user request and explicit context always outrank memory.
- Writer route gets relevant user style preferences only.
- Agent route gets relevant working/project memory.
- Workflow route gets run snapshot, todo, unresolved approvals, and draft refs.

Suggested tools:

- `memory_search`
- `memory_save`
- `memory_update`
- `memory_delete`
- `run_snapshot_save`
- `run_snapshot_resume`
- `project_memory_summarize`

## Migration Plan

Phase 0: stabilize routing.

- Add `runtimeProfile` support to Skill metadata.
- Implement `WriterExecutor` for writer/advisor Skills.
- Route `/writing-skills` away from Agent mode.
- Add source-level and behavior tests.

Phase 1: harness shell.

- Add `AgentOrchestrator`.
- Add runId, route, stepId, and snapshot skeleton.
- Keep old `AgentHandler` as compatibility executor.

Phase 2: ToolRuntime.

- Introduce `ToolRegistry`, `ToolSelector`, `ToolRuntime`, and normalized observations.
- Wrap existing tools before changing their implementations.
- Move approvals into the runtime path.

Phase 3: AgentVFS.

- Add run-scoped VFS storage.
- Move long tool outputs and drafts into VFS.
- Add publish flow for real workspace writes.

Phase 4: ContextEngine.

- Replace prompt-only assembly with `ContextPack`.
- Add deferred refs, deduplication, context warnings, and UI explainability.

Phase 5: memory layering.

- Add typed run/working/user/project memory.
- Migrate existing working memory and snapshots.
- Add memory write guards and explicit user-memory semantics.

Phase 6: retire legacy paths.

- Move Agent UI to orchestrator state.
- Remove ReAct-only assumptions from slash command flow.
- Keep direct ReAct as an internal executor option, not the top-level architecture.

## Verification Strategy

Required tests:

- `/writing-skills` routes to writer and streams final content.
- Tool/file/script Skill routes to Agent/workflow.
- Legacy Skill classification emits a visible reason.
- Low-risk read tools run without approval.
- Write/execute/delete/GitHub side effects require approval.
- Editing approval parameters changes the executed tool call.
- Long stdout/web/file output is stored in AgentVFS with a dataRef.
- ContextPack respects priority and budget.
- Stop/pause creates a resumable run snapshot.
- User memory is not written without explicit user intent.

Manual smoke checks:

- Writing article via slash command.
- Saving generated article as a note through approval.
- Running a Skill script and publishing artifact.
- Resuming a paused workflow.
- GitHub Star summary stays user-perspective, not global-trend framing.

## Risks

- Large scope can destabilize existing Agent behavior.
- Tool wrapping may expose hidden assumptions in existing tool return shapes.
- UI state migration may conflict with current Agent live stream rendering.
- VFS introduces lifecycle cleanup requirements.
- Memory layering must avoid silently persisting sensitive or accidental facts.

Mitigation:

- Ship phase by phase.
- Preserve legacy Agent path until harness parity is verified.
- Add tests before replacing each execution path.
- Keep all dangerous actions behind ApprovalGate.

## Acceptance Criteria

The redesign is successful when:

- Slash Skills have deterministic, inspectable routes.
- Writing Skills no longer enter ReAct/JSON action mode.
- Tools execute only through a unified runtime.
- Human approval supports approve, edit, reject, pause, and resume.
- Agent work files are separated from user notes.
- Long context is managed through refs rather than prompt stuffing.
- Run state and memory are layered, inspectable, and recoverable.
