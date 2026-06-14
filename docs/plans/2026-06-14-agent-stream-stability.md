# Agent Stream Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a stable event-to-part pipeline for LingMo agent runs so tool calls, skill scripts, and long-form answer streaming no longer visually flicker or fail prematurely.

**Architecture:** Add a canonical agent part reducer beside the existing `AgentEventBus`, then migrate UI status rendering to consume reducer snapshots. Keep the current runner and callbacks during migration, but make reducer output the single stable display source for live status, tool lifecycle, recoverable errors, and final answer rendering.

**Tech Stack:** TypeScript, React 19, Zustand, Next.js, Tauri shell plugin, Node-based test scripts.

---

### Task 1: Add Canonical Agent Part Types

**Files:**
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/index.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write the failing type/runtime shape test**

Add this assertion block near the existing event bus tests in `scripts/agent-core-tests.mjs`:

```js
{
  const {
    createInitialAgentPartSnapshot,
  } = await importTsModule('src/lib/agent/part-reducer.ts')

  const snapshot = createInitialAgentPartSnapshot('run-1')
  assert.equal(snapshot.runId, 'run-1')
  assert.equal(snapshot.status, 'idle')
  assert.deepEqual(snapshot.parts, [])
  assert.equal(snapshot.visibleStatus.label, '准备中')
}
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:agent`

Expected: FAIL because `src/lib/agent/part-reducer.ts` does not exist.

**Step 3: Create minimal part types**

Create `src/lib/agent/part-reducer.ts` with:

```ts
import type { AgentActivityPhase, AgentEvent, AgentTurnTelemetry, ToolCall } from './types'

export type AgentPartStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'skipped'
  | 'cancelled'
  | 'completed'

export type AgentPartVisibility = 'visible' | 'hidden'

export interface AgentBasePart {
  id: string
  runId?: string
  type: 'reasoning' | 'text' | 'tool' | 'status' | 'error' | 'checkpoint'
  status: AgentPartStatus
  createdAt: number
  updatedAt: number
  visibility: AgentPartVisibility
}

export interface AgentReasoningPart extends AgentBasePart {
  type: 'reasoning'
  text: string
}

export interface AgentTextPart extends AgentBasePart {
  type: 'text'
  text: string
}

export interface AgentToolPart extends AgentBasePart {
  type: 'tool'
  toolCallId: string
  toolName: string
  params: Record<string, any>
  result?: ToolCall['result']
  recoverable?: boolean
}

export interface AgentStatusPart extends AgentBasePart {
  type: 'status'
  label: string
  detail?: string
  phase?: AgentActivityPhase
}

export interface AgentErrorPart extends AgentBasePart {
  type: 'error'
  message: string
  recoverable: boolean
}

export interface AgentCheckpointPart extends AgentBasePart {
  type: 'checkpoint'
  label: string
}

export type AgentPart =
  | AgentReasoningPart
  | AgentTextPart
  | AgentToolPart
  | AgentStatusPart
  | AgentErrorPart
  | AgentCheckpointPart

export interface AgentVisibleStatus {
  tone: 'running' | 'done' | 'error'
  label: string
  detail?: string
}

export interface AgentPartSnapshot {
  runId?: string
  status: 'idle' | 'running' | 'waiting_approval' | 'completed' | 'stopped' | 'error'
  parts: AgentPart[]
  visibleStatus: AgentVisibleStatus
  finalAnswerContent?: string
  activity?: {
    phase: AgentActivityPhase
    label: string
    detail?: string
    startedAt: number
    iteration?: number
    toolName?: string
  }
  telemetry?: AgentTurnTelemetry
  recoverableErrors: string[]
  fatalErrors: string[]
}

export function createInitialAgentPartSnapshot(runId?: string): AgentPartSnapshot {
  return {
    runId,
    status: 'idle',
    parts: [],
    visibleStatus: {
      tone: 'running',
      label: '准备中',
    },
    recoverableErrors: [],
    fatalErrors: [],
  }
}

export function reduceAgentPartSnapshot(
  snapshot: AgentPartSnapshot,
  event: AgentEvent,
): AgentPartSnapshot {
  return snapshot
}
```

**Step 4: Export the new API**

Modify `src/lib/agent/index.ts`:

```ts
export {
  createInitialAgentPartSnapshot,
  reduceAgentPartSnapshot,
} from './part-reducer'

export type {
  AgentPart,
  AgentPartSnapshot,
  AgentVisibleStatus,
  AgentToolPart,
} from './part-reducer'
```

**Step 5: Run test to verify it passes**

Run: `pnpm test:agent`

Expected: PASS for the new snapshot shape test.

**Step 6: Commit**

```bash
git add src/lib/agent/types.ts src/lib/agent/index.ts src/lib/agent/part-reducer.ts scripts/agent-core-tests.mjs
git commit -m "Introduce a stable agent part snapshot"
```

---

### Task 2: Reduce Tool Lifecycle Events Into Stable Tool Parts

**Files:**
- Modify: `src/lib/agent/part-reducer.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write failing lifecycle tests**

Add this block to `scripts/agent-core-tests.mjs`:

```js
{
  const {
    createInitialAgentPartSnapshot,
    reduceAgentPartSnapshot,
  } = await importTsModule('src/lib/agent/part-reducer.ts')

  let snapshot = createInitialAgentPartSnapshot('tool-run')
  snapshot = reduceAgentPartSnapshot(snapshot, {
    type: 'action.parsed',
    runId: 'tool-run',
    sequence: 1,
    timestamp: 100,
    payload: { tool: 'execute_skill_script', params: { skill_id: 'aihot' } },
  })

  assert.equal(snapshot.parts.length, 1)
  assert.equal(snapshot.parts[0].type, 'tool')
  assert.equal(snapshot.parts[0].status, 'pending')
  assert.equal(snapshot.visibleStatus.label, '准备调用工具')

  snapshot = reduceAgentPartSnapshot(snapshot, {
    type: 'tool.updated',
    runId: 'tool-run',
    sequence: 2,
    timestamp: 120,
    payload: {
      toolCall: {
        id: 'tool-1',
        toolName: 'execute_skill_script',
        params: { skill_id: 'aihot' },
        status: 'running',
        timestamp: 120,
      },
    },
  })

  assert.equal(snapshot.parts[0].status, 'running')
  assert.equal(snapshot.visibleStatus.label, '正在调用工具')

  snapshot = reduceAgentPartSnapshot(snapshot, {
    type: 'tool.updated',
    runId: 'tool-run',
    sequence: 3,
    timestamp: 140,
    payload: {
      toolCall: {
        id: 'tool-1',
        toolName: 'execute_skill_script',
        params: { skill_id: 'aihot' },
        status: 'success',
        timestamp: 120,
        result: { success: true, message: 'created report.md' },
      },
    },
  })

  assert.equal(snapshot.parts[0].status, 'success')
  assert.equal(snapshot.visibleStatus.label, '工具调用完成')
}
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:agent`

Expected: FAIL because `reduceAgentPartSnapshot` is still a no-op.

**Step 3: Implement tool part upsert helpers**

In `src/lib/agent/part-reducer.ts`, add:

```ts
function getPayloadToolName(payload: Record<string, any>) {
  return typeof payload.toolName === 'string'
    ? payload.toolName
    : typeof payload.tool === 'string'
      ? payload.tool
      : typeof payload.toolCall?.toolName === 'string'
        ? payload.toolCall.toolName
        : undefined
}

function createPartId(event: AgentEvent, suffix: string) {
  return `${event.runId || 'agent'}:${event.sequence || event.timestamp}:${suffix}`
}

function upsertPart(parts: AgentPart[], nextPart: AgentPart): AgentPart[] {
  const index = parts.findIndex(part => part.id === nextPart.id)
  if (index < 0) return [...parts, nextPart]
  return parts.map((part, partIndex) => partIndex === index ? { ...part, ...nextPart } : part)
}

function getToolPartId(event: AgentEvent, toolCallId?: string) {
  return toolCallId
    ? `${event.runId || 'agent'}:tool:${toolCallId}`
    : createPartId(event, 'tool')
}
```

**Step 4: Implement `action.parsed` handling**

Inside `reduceAgentPartSnapshot`, handle `action.parsed` and `action`:

```ts
case 'action':
case 'action.parsed': {
  const toolName = getPayloadToolName(payload)
  if (!toolName) return snapshot

  const now = event.timestamp
  const part: AgentToolPart = {
    id: getToolPartId(event),
    runId: event.runId,
    type: 'tool',
    status: 'pending',
    visibility: 'visible',
    createdAt: now,
    updatedAt: now,
    toolCallId: getToolPartId(event),
    toolName,
    params: typeof payload.params === 'object' && payload.params ? payload.params : {},
  }

  return {
    ...snapshot,
    runId: event.runId || snapshot.runId,
    status: 'running',
    parts: upsertPart(snapshot.parts, part),
    visibleStatus: { tone: 'running', label: '准备调用工具' },
  }
}
```

**Step 5: Implement `tool.updated` handling**

Map `ToolCall.status` into `AgentPartStatus` and update the visible status:

```ts
case 'tool':
case 'tool.updated': {
  const toolCall = payload.toolCall as ToolCall | undefined
  if (!toolCall?.toolName) return snapshot

  const status = toolCall.status === 'success'
    ? 'success'
    : toolCall.status === 'error'
      ? 'error'
      : toolCall.status

  const part: AgentToolPart = {
    id: getToolPartId(event, toolCall.id),
    runId: event.runId,
    type: 'tool',
    status,
    visibility: 'visible',
    createdAt: toolCall.timestamp || event.timestamp,
    updatedAt: event.timestamp,
    toolCallId: toolCall.id,
    toolName: toolCall.toolName,
    params: toolCall.params || {},
    result: toolCall.result,
    recoverable: status === 'error' ? isRecoverableToolError(toolCall.result) : undefined,
  }

  const visibleStatus = status === 'error'
    ? part.recoverable
      ? { tone: 'running' as const, label: '工具步骤失败，正在恢复', detail: toolCall.result?.error || toolCall.result?.message }
      : { tone: 'error' as const, label: '工具调用失败', detail: toolCall.result?.error || toolCall.result?.message }
    : status === 'success'
      ? { tone: 'running' as const, label: '工具调用完成', detail: toolCall.result?.message }
      : { tone: 'running' as const, label: '正在调用工具' }

  return {
    ...snapshot,
    runId: event.runId || snapshot.runId,
    status: status === 'error' && !part.recoverable ? 'error' : 'running',
    parts: upsertPart(snapshot.parts, part),
    visibleStatus,
    recoverableErrors: part.recoverable && toolCall.result?.error
      ? [...snapshot.recoverableErrors, toolCall.result.error]
      : snapshot.recoverableErrors,
  }
}
```

Add a conservative helper:

```ts
function isRecoverableToolError(result?: ToolCall['result']) {
  const message = `${result?.error || ''}\n${result?.message || ''}`
  return Boolean(
    result?.data?.retryable ||
    /invalid utf-8|utf-8|decode|skipped_tool_call|too large|truncated|firecrawl|web_fetch/i.test(message)
  )
}
```

**Step 6: Run tests**

Run: `pnpm test:agent`

Expected: PASS.

**Step 7: Commit**

```bash
git add src/lib/agent/part-reducer.ts scripts/agent-core-tests.mjs
git commit -m "Reduce tool events into stable agent parts"
```

---

### Task 3: Add Final Answer and Status Reduction

**Files:**
- Modify: `src/lib/agent/part-reducer.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write failing tests**

Add:

```js
{
  const {
    createInitialAgentPartSnapshot,
    reduceAgentPartSnapshot,
  } = await importTsModule('src/lib/agent/part-reducer.ts')

  let snapshot = createInitialAgentPartSnapshot('answer-run')
  snapshot = reduceAgentPartSnapshot(snapshot, {
    type: 'final.answer.rendered',
    runId: 'answer-run',
    sequence: 1,
    timestamp: 100,
    payload: { content: '日报正文', streaming: true },
  })

  assert.equal(snapshot.finalAnswerContent, '日报正文')
  assert.equal(snapshot.visibleStatus.label, '正在写答案')
  assert.equal(snapshot.status, 'running')

  snapshot = reduceAgentPartSnapshot(snapshot, {
    type: 'agent.completed',
    runId: 'answer-run',
    sequence: 2,
    timestamp: 200,
    payload: { result: '日报正文' },
  })

  assert.equal(snapshot.status, 'completed')
  assert.equal(snapshot.visibleStatus.label, '完成')
}
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Implement answer/status events**

Handle these event types:

```ts
case 'agent.started':
  return {
    ...snapshot,
    runId: event.runId || snapshot.runId,
    status: 'running',
    visibleStatus: { tone: 'running', label: '准备中' },
  }

case 'iteration.started':
case 'model.request.started':
  return {
    ...snapshot,
    status: 'running',
    visibleStatus: { tone: 'running', label: '思考中' },
  }

case 'final':
case 'final.answer.rendered':
  return {
    ...snapshot,
    status: snapshot.status === 'completed' ? 'completed' : 'running',
    finalAnswerContent: typeof payload.content === 'string' ? payload.content : snapshot.finalAnswerContent,
    visibleStatus: { tone: 'running', label: '正在写答案' },
  }

case 'agent.completed':
  return {
    ...snapshot,
    status: 'completed',
    finalAnswerContent: typeof payload.result === 'string' ? payload.result : snapshot.finalAnswerContent,
    visibleStatus: { tone: 'done', label: '完成' },
  }

case 'agent.stopped':
  return {
    ...snapshot,
    status: 'stopped',
    visibleStatus: { tone: 'done', label: '已停止' },
  }

case 'error':
  return {
    ...snapshot,
    status: 'error',
    visibleStatus: { tone: 'error', label: '执行失败', detail: String(payload.friendlyMessage || payload.error || '') },
    fatalErrors: [...snapshot.fatalErrors, String(payload.error || payload.friendlyMessage || 'Unknown error')],
  }
```

**Step 4: Run tests**

Run: `pnpm test:agent`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/lib/agent/part-reducer.ts scripts/agent-core-tests.mjs
git commit -m "Stabilize final answer status reduction"
```

---

### Task 4: Store Part Snapshots in Agent State

**Files:**
- Modify: `src/lib/agent/types.ts`
- Modify: `src/stores/chat.ts`
- Modify: `src/lib/agent/agent-handler.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Extend `AgentState`**

In `src/lib/agent/types.ts`, add fields:

```ts
agentPartSnapshot?: import('./part-reducer').AgentPartSnapshot
agentParts?: import('./part-reducer').AgentPart[]
```

If circular type imports are awkward, define the fields after importing types normally:

```ts
import type { AgentPart, AgentPartSnapshot } from './part-reducer'
```

Then use:

```ts
agentPartSnapshot?: AgentPartSnapshot
agentParts?: AgentPart[]
```

**Step 2: Initialize and reset state**

In `src/stores/chat.ts`, set:

```ts
agentPartSnapshot: undefined,
agentParts: [],
```

in both initial `agentState` and `resetAgentState`.

**Step 3: Write reducer integration test**

Add a pure test in `scripts/agent-core-tests.mjs` that imports `reduceAgentPartSnapshot` and proves multiple events accumulate parts. This guards the store integration without needing React.

**Step 4: Wire reducer in `AgentHandler.handleAgentEvent`**

In `src/lib/agent/agent-handler.ts`, import:

```ts
import {
  createInitialAgentPartSnapshot,
  reduceAgentPartSnapshot,
} from './part-reducer'
```

Inside `handleAgentEvent`, after `nextAgentEvents` is computed:

```ts
const previousPartSnapshot = store.agentState.agentPartSnapshot
  || createInitialAgentPartSnapshot(event.runId || store.agentState.agentRunId)
const partSnapshot = reduceAgentPartSnapshot(previousPartSnapshot, event)
```

Add to `store.setAgentState`:

```ts
agentPartSnapshot: partSnapshot,
agentParts: partSnapshot.parts,
finalAnswerContent: partSnapshot.finalAnswerContent || store.agentState.finalAnswerContent,
```

Do not remove old fields yet.

**Step 5: Run tests and typecheck**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: both PASS.

**Step 6: Commit**

```bash
git add src/lib/agent/types.ts src/stores/chat.ts src/lib/agent/agent-handler.ts scripts/agent-core-tests.mjs
git commit -m "Store agent part snapshots during live runs"
```

---

### Task 5: Render Status From Part Snapshot

**Files:**
- Modify: `src/app/core/main/chat/agent-execution-status.tsx`
- Modify: `src/app/core/main/chat/agent-live-stream.tsx`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Add a pure status selector**

Create `src/app/core/main/chat/agent-live-status.ts`:

```ts
import type { AgentPartSnapshot } from '@/lib/agent'

export function getAgentLiveDisplayStatus(snapshot?: AgentPartSnapshot) {
  if (!snapshot) {
    return undefined
  }
  return snapshot.visibleStatus
}
```

**Step 2: Test selector fallback**

Add to `scripts/agent-core-tests.mjs`:

```js
{
  const { getAgentLiveDisplayStatus } = await importTsModule('src/app/core/main/chat/agent-live-status.ts')
  assert.equal(getAgentLiveDisplayStatus(undefined), undefined)
  assert.deepEqual(
    getAgentLiveDisplayStatus({
      runId: 'r',
      status: 'running',
      parts: [],
      visibleStatus: { tone: 'running', label: '正在调用工具' },
      recoverableErrors: [],
      fatalErrors: [],
    }),
    { tone: 'running', label: '正在调用工具' },
  )
}
```

**Step 3: Run test to verify selector works**

Run: `pnpm test:agent`

Expected: PASS.

**Step 4: Add prop to `AgentLiveStream`**

In `src/app/core/main/chat/agent-live-stream.tsx`, add:

```ts
partSnapshot?: AgentPartSnapshot
```

Use `getAgentLiveDisplayStatus(partSnapshot)` before current heuristic `getStatus`. If it exists, prefer it:

```ts
const reducedStatus = getAgentLiveDisplayStatus(partSnapshot)
const status = reducedStatus || getStatus(...)
```

Keep the old heuristic as fallback.

**Step 5: Pass snapshot from `AgentExecutionStatus`**

In `src/app/core/main/chat/agent-execution-status.tsx`, pass:

```tsx
partSnapshot={agentState.agentPartSnapshot}
```

**Step 6: Typecheck**

Run: `pnpm typecheck`

Expected: PASS.

**Step 7: Commit**

```bash
git add src/app/core/main/chat/agent-live-status.ts src/app/core/main/chat/agent-live-stream.tsx src/app/core/main/chat/agent-execution-status.tsx scripts/agent-core-tests.mjs
git commit -m "Render live agent status from part snapshots"
```

---

### Task 6: Add Stream-Safe Markdown Blocks

**Files:**
- Create: `src/app/core/main/chat/markdown-live-stream.ts`
- Modify: `src/app/core/main/chat/chat-preview.tsx`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write failing markdown stream tests**

Add:

```js
{
  const { splitLiveMarkdownBlocks } = await importTsModule('src/app/core/main/chat/markdown-live-stream.ts')

  assert.deepEqual(splitLiveMarkdownBlocks('hello', false), [
    { raw: 'hello', src: 'hello', mode: 'full' },
  ])

  const blocks = splitLiveMarkdownBlocks('intro\n\n```ts\nconst a = 1', true)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].mode, 'live')
  assert.equal(blocks[1].raw.startsWith('```ts'), true)
}
```

**Step 2: Run test to verify it fails**

Run: `pnpm test:agent`

Expected: FAIL because module does not exist.

**Step 3: Implement minimal block splitter**

Create:

```ts
export type LiveMarkdownBlock = {
  raw: string
  src: string
  mode: 'full' | 'live'
}

function hasOpenFence(raw: string) {
  const lines = raw.split('\n')
  let fence: { char: string; size: number } | null = null
  for (const line of lines) {
    const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    if (!match) continue
    const mark = match[1]
    const char = mark[0]
    const size = mark.length
    if (!fence) {
      fence = { char, size }
    } else if (fence.char === char && new RegExp(`^[\\t ]{0,3}${char}{${size},}[\\t ]*$`).test(line.trim())) {
      fence = null
    }
  }
  return Boolean(fence)
}

export function splitLiveMarkdownBlocks(text: string, live: boolean): LiveMarkdownBlock[] {
  if (!live) return [{ raw: text, src: text, mode: 'full' }]
  if (!hasOpenFence(text)) return [{ raw: text, src: text, mode: 'live' }]

  const fenceStart = Math.max(text.lastIndexOf('\n```'), text.lastIndexOf('\n~~~'))
  if (fenceStart <= 0) return [{ raw: text, src: text, mode: 'live' }]

  const head = text.slice(0, fenceStart)
  const tail = text.slice(fenceStart + 1)
  return [
    { raw: head, src: head, mode: 'live' },
    { raw: tail, src: tail, mode: 'live' },
  ].filter(block => block.raw.length > 0)
}
```

**Step 4: Integrate carefully in `ChatPreview`**

In `src/app/core/main/chat/chat-preview.tsx`, inspect how markdown is currently rendered. Add the splitter only for `streaming === true`; render each block with the same existing renderer path. Do not rewrite the markdown renderer.

Pseudo-shape:

```tsx
const blocks = React.useMemo(
  () => splitLiveMarkdownBlocks(text || '', Boolean(streaming)),
  [text, streaming],
)
```

Then map blocks where current code rendered one markdown body. Use `block.src` as rendered text.

**Step 5: Run tests and typecheck**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/app/core/main/chat/markdown-live-stream.ts src/app/core/main/chat/chat-preview.tsx scripts/agent-core-tests.mjs
git commit -m "Render live markdown through stable blocks"
```

---

### Task 7: Harden Skill Script UTF-8 Output

**Files:**
- Modify: `src/lib/skills/executor.ts`
- Modify: `src/lib/skills/types.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Find current script result type**

Open `src/lib/skills/types.ts` and locate `ScriptExecutionResult`.

**Step 2: Add warning-capable result fields**

Add optional fields:

```ts
warnings?: string[]
outputEncoding?: 'utf8' | 'utf8-replacement'
```

**Step 3: Add pure decoder helper**

In `src/lib/skills/executor.ts`, export:

```ts
export function decodeSkillScriptOutput(value: string | Uint8Array): {
  output: string
  warnings: string[]
  outputEncoding: 'utf8' | 'utf8-replacement'
} {
  if (typeof value === 'string') {
    return { output: value, warnings: [], outputEncoding: 'utf8' }
  }

  const strict = new TextDecoder('utf-8', { fatal: true })
  try {
    return { output: strict.decode(value), warnings: [], outputEncoding: 'utf8' }
  } catch {
    const output = new TextDecoder('utf-8', { fatal: false }).decode(value)
    return {
      output,
      warnings: ['Script output contained invalid UTF-8 bytes and was decoded with replacement characters.'],
      outputEncoding: 'utf8-replacement',
    }
  }
}
```

**Step 4: Write decoder test**

Add:

```js
{
  const { decodeSkillScriptOutput } = await importTsModule('src/lib/skills/executor.ts')
  const decoded = decodeSkillScriptOutput(new Uint8Array([0xff, 0x61]))
  assert.equal(decoded.output.includes('a'), true)
  assert.equal(decoded.outputEncoding, 'utf8-replacement')
  assert.equal(decoded.warnings.length, 1)
}
```

**Step 5: Run test**

Run: `pnpm test:agent`

Expected: PASS.

**Step 6: Thread warnings through `executeScript`**

When `executeScriptByType` returns output, include warnings and output encoding if present. If Tauri currently gives strings only, still use the helper on `result.stdout + result.stderr`; this keeps future byte-based shell adapters safe.

Shape:

```ts
const decoded = decodeSkillScriptOutput(output)
return {
  output: decoded.output,
  exitCode: result.code ?? 0,
  warnings: decoded.warnings,
  outputEncoding: decoded.outputEncoding,
}
```

Adjust private return type and `executeScript` result mapping.

**Step 7: Run tests and typecheck**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/lib/skills/executor.ts src/lib/skills/types.ts scripts/agent-core-tests.mjs
git commit -m "Decode skill script output without fatal UI failures"
```

---

### Task 8: Persist Stable Agent Parts in Run Summaries

**Files:**
- Modify: `src/lib/agent/resume.ts`
- Modify: `src/lib/agent/agent-handler.ts`
- Modify: `src/lib/ai/citations.ts` if stored history parsing needs a tolerant field
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Inspect summary schema**

Open `src/lib/agent/resume.ts` and find `buildAgentRunSummary`.

**Step 2: Add optional `parts` field**

Extend the summary type with:

```ts
parts?: AgentPart[]
partSnapshot?: AgentPartSnapshot
```

Keep parsing tolerant: old histories without parts must still parse.

**Step 3: Add test**

Write a test that builds a summary with an `agentPartSnapshot`, serializes it, parses it via existing history parsing, and asserts old fields still work.

**Step 4: Pass snapshot from `AgentHandler.persistRunSummary`**

Read from store:

```ts
const partSnapshot = store.agentState.agentPartSnapshot
```

Pass into `buildAgentRunSummary`.

**Step 5: Run tests**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/agent/resume.ts src/lib/agent/agent-handler.ts src/lib/ai/citations.ts scripts/agent-core-tests.mjs
git commit -m "Persist stable agent part history"
```

---

### Task 9: Reduce Scroll Jitter From Thought Chunks

**Files:**
- Modify: `src/app/core/main/chat/chat-content.tsx`
- Test: manual smoke, `pnpm typecheck`

**Step 1: Change scroll dependency**

Replace the agent scroll effect dependency from raw thought fields:

```ts
agentState.currentThought,
agentState.thoughtHistory,
agentState.pendingConfirmation,
agentState.isRunning,
```

to stable part/status fields:

```ts
agentState.agentPartSnapshot?.parts.length,
agentState.agentPartSnapshot?.visibleStatus.label,
agentState.pendingConfirmation,
agentState.isRunning,
```

**Step 2: Keep RAF batching**

Do not remove the existing `requestAnimationFrame` batching. It is already useful.

**Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

**Step 4: Manual smoke**

Run dev app:

```bash
pnpm dev
```

Open the app, start a long agent response, scroll slightly upward, and verify auto-scroll does not fight the user.

**Step 5: Commit**

```bash
git add src/app/core/main/chat/chat-content.tsx
git commit -m "Scroll live agent output from stable part changes"
```

---

### Task 10: End-to-End Verification

**Files:**
- No code changes unless verification reveals a bug.

**Step 1: Run targeted automated checks**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: PASS.

**Step 2: Run broader checks if time allows**

Run:

```bash
pnpm check
```

Expected: PASS or known lint baseline documented.

**Step 3: Manual skill-script smoke**

Use the UI to run a skill script that writes a file. Confirm:

- pending tool appears before execution
- running tool state does not flicker
- invalid output encoding shows as a warning, not a full run crash
- final artifact appears in the editor
- final answer does not claim success before a tool succeeds

**Step 4: Manual long-form writing smoke**

Ask the agent to generate a daily report or article. Confirm:

- first visible answer appears promptly
- markdown code fences or lists do not visually break while streaming
- status does not alternate rapidly between thinking/tool/answering
- final rendered markdown is clean

**Step 5: Final commit if fixes were needed**

```bash
git add <fixed-files>
git commit -m "Verify stable agent streaming flow"
```

---

## Rollback Strategy

The migration keeps old `currentThought`, `currentAction`, `currentObservation`, and `toolCalls` fields during rollout. If the new reducer causes display issues, disable the snapshot preference in `AgentLiveStream` and the UI will fall back to the existing heuristic path.

## Implementation Notes

- Avoid adding new dependencies.
- Keep all reducer logic pure and testable.
- Do not remove old state fields until several manual agent runs are stable.
- Treat recoverable tool errors as tool-level warnings, not run-level failures.
- Keep script output decoding separate from script process exit-code handling.
