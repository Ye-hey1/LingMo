# Agent Runtime Stability and Manual Dream/Distill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a stable runtime snapshot, tool lifecycle, and stream reducer for LingMo agent runs, then add manual Dream and Distill entry points that turn run history into reviewable memory and workflow suggestions.

**Architecture:** Add a canonical runtime snapshot that combines skill exposure, MCP exposure, and permission state before each run. Feed that snapshot into a single agent-part reducer so the UI renders stable lifecycle parts instead of guessing from transient fields. After the runtime and stream foundation is in place, add manual Dream and Distill actions that read run summaries, working memory, and memory store data, then write only after explicit user approval.

**Tech Stack:** TypeScript, React 19, Zustand, Next.js, Tauri shell/plugin APIs, Node-based test scripts.

---

### Task 1: Add Runtime Snapshot Types

**Files:**
- Create: `src/lib/agent/runtime-snapshot.ts`
- Modify: `src/lib/agent/index.ts`
- Modify: `src/lib/agent-harness/types.ts`
- Modify: `src/lib/agent/types.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write the failing snapshot-shape test**

Add a pure test to `scripts/agent-core-tests.mjs` that imports the new snapshot helpers and asserts the initial runtime snapshot exposes:

- `runId`
- skill summary
- MCP summary
- visible tool names
- warnings

Example expectation:

```js
const snapshot = createInitialAgentRuntimeSnapshot('run-1')
assert.equal(snapshot.runId, 'run-1')
assert.deepEqual(snapshot.visibleToolNames, [])
assert.deepEqual(snapshot.warnings, [])
```

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL because the new snapshot module and types do not exist yet.

**Step 3: Add the minimal snapshot types**

Create `src/lib/agent/runtime-snapshot.ts` with pure types and an initializer for:

- runtime snapshot
- skill snapshot
- MCP snapshot
- tool exposure snapshot
- permission snapshot
- warning entries

**Step 4: Export the new API**

Modify `src/lib/agent/index.ts` to export the new runtime snapshot helpers and types.

**Step 5: Run the test to confirm it passes**

Run: `pnpm test:agent`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/agent/runtime-snapshot.ts src/lib/agent/index.ts src/lib/agent-harness/types.ts src/lib/agent/types.ts scripts/agent-core-tests.mjs
git commit -m "Add canonical agent runtime snapshot types"
```

---

### Task 2: Build Skill Runtime Snapshot Data

**Files:**
- Modify: `src/lib/agent-harness/middleware.ts`
- Modify: `src/lib/skills/manager.ts`
- Modify: `src/stores/skills.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write a failing snapshot-assembly test**

Add a pure test that constructs a runtime snapshot from mocked skill metadata and asserts it includes:

- skill id and name
- source scope
- base directory or file info
- allowed tools
- user-invocable flag
- validation warnings

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Add skill snapshot helpers**

Implement a helper that reads from `skillManager` and the skills store to produce a stable runtime view for the current run.

**Step 4: Thread skill snapshot into middleware state**

Extend the middleware state in `src/lib/agent-harness/types.ts` and `src/lib/agent-harness/middleware.ts` so `beforeRun` stores the skill snapshot alongside the existing skill match state.

**Step 5: Run the test to confirm it passes**

Run: `pnpm test:agent`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/agent-harness/middleware.ts src/lib/agent-harness/types.ts src/lib/skills/manager.ts src/stores/skills.ts scripts/agent-core-tests.mjs
git commit -m "Capture stable skill runtime state for agent runs"
```

---

### Task 3: Build MCP Runtime Snapshot Data

**Files:**
- Modify: `src/lib/agent-harness/middleware.ts`
- Modify: `src/lib/mcp/types.ts`
- Modify: `src/stores/mcp.ts`
- Modify: `src/lib/mcp/client.ts`
- Modify: `src/lib/mcp/server-manager.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write a failing MCP snapshot test**

Add a test that checks the runtime snapshot can represent:

- selected servers
- connected servers
- failed servers
- auth-needed servers
- cached tool names
- warnings

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Add richer MCP state**

Extend `MCPServerState` and related types with explicit lifecycle states and cache metadata.

**Step 4: Normalize tool results**

Harden `normalizeCallToolResult` and tool-call paths so missing or malformed results never throw when `isError` is read.

**Step 5: Thread MCP snapshot into middleware**

Update `createSkillMcpMiddleware` so `beforeRun` records MCP snapshot data from `useMcpStore` and `mcpServerManager`.

**Step 6: Run the test to confirm it passes**

Run: `pnpm test:agent`

Expected: PASS.

**Step 7: Commit**

```bash
git add src/lib/agent-harness/middleware.ts src/lib/mcp/types.ts src/lib/mcp/client.ts src/lib/mcp/server-manager.ts src/stores/mcp.ts scripts/agent-core-tests.mjs
git commit -m "Stabilize MCP runtime state and tool normalization"
```

---

### Task 4: Expose Runtime Snapshot to the Agent Runner

**Files:**
- Modify: `src/lib/agent-harness/types.ts`
- Modify: `src/lib/agent-harness/harness-agent-runner.ts`
- Modify: `src/lib/agent-harness/middleware.ts`
- Modify: `src/lib/agent/agent-handler.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write a failing integration test**

Add a test that confirms the agent run control stores a runtime snapshot and that tool exposure reads from it.

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Add runtime snapshot plumbing**

Wire the runtime snapshot through the run control and middleware state so each model step can use one stable source of truth for visible tools and permissions.

**Step 4: Keep fallback behavior**

Do not remove existing tool selection heuristics yet; keep them as fallback while the new snapshot path is being verified.

**Step 5: Run the test to confirm it passes**

Run: `pnpm test:agent`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/agent-harness/types.ts src/lib/agent-harness/harness-agent-runner.ts src/lib/agent-harness/middleware.ts src/lib/agent/agent-handler.ts scripts/agent-core-tests.mjs
git commit -m "Plumb runtime snapshots through agent execution"
```

---

### Task 5: Add Canonical Agent Part Types and Reducer

**Files:**
- Create: `src/lib/agent/part-reducer.ts`
- Modify: `src/lib/agent/index.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write the failing reducer test**

Add a test that constructs a snapshot, feeds it `agent.started`, `action.parsed`, `tool.updated`, and `agent.completed`, then asserts the visible status and part statuses move predictably.

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Implement the minimal reducer**

Create the part types, snapshot shape, and pure reducer.

**Step 4: Export the reducer API**

Expose the new reducer from `src/lib/agent/index.ts`.

**Step 5: Run the test to confirm it passes**

Run: `pnpm test:agent`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/agent/part-reducer.ts src/lib/agent/index.ts scripts/agent-core-tests.mjs
git commit -m "Introduce stable agent part reduction"
```

---

### Task 6: Store Part Snapshots in Agent State

**Files:**
- Modify: `src/lib/agent/types.ts`
- Modify: `src/stores/chat.ts`
- Modify: `src/lib/agent/agent-handler.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write the failing store integration test**

Add a pure test that verifies agent state can hold the new part snapshot and part list.

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Extend agent state**

Add `agentPartSnapshot` and `agentParts` to agent state and initialize/reset them.

**Step 4: Update the agent handler**

Reduce each incoming agent event into the part snapshot and persist it to chat state alongside the legacy fields.

**Step 5: Run tests and typecheck**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/agent/types.ts src/stores/chat.ts src/lib/agent/agent-handler.ts scripts/agent-core-tests.mjs
git commit -m "Persist agent parts in live chat state"
```

---

### Task 7: Render Live Status From the Snapshot

**Files:**
- Create: `src/app/core/main/chat/agent-live-status.ts`
- Modify: `src/app/core/main/chat/agent-live-stream.tsx`
- Modify: `src/app/core/main/chat/agent-execution-status.tsx`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write a failing selector test**

Add a test for the live status selector against empty and populated part snapshots.

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Implement the selector**

Return the reducer’s visible status when available.

**Step 4: Pass the snapshot through the UI**

Use the snapshot as the primary source for live status, with the old heuristic path as fallback.

**Step 5: Run tests and typecheck**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/app/core/main/chat/agent-live-status.ts src/app/core/main/chat/agent-live-stream.tsx src/app/core/main/chat/agent-execution-status.tsx scripts/agent-core-tests.mjs
git commit -m "Render live agent status from part snapshots"
```

---

### Task 8: Add Stream-Safe Markdown Rendering

**Files:**
- Create: `src/app/core/main/chat/markdown-live-stream.ts`
- Modify: `src/app/core/main/chat/chat-preview.tsx`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write the failing markdown-stream test**

Add a test that checks unfinished code fences stay in live-safe mode.

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Implement the block splitter**

Create a minimal live markdown splitter that preserves unfinished blocks.

**Step 4: Wire it into preview rendering**

Use the live splitter only when streaming is active.

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
git commit -m "Render streaming markdown through safe blocks"
```

---

### Task 9: Harden Skill Script UTF-8 Output

**Files:**
- Modify: `src/lib/skills/executor.ts`
- Modify: `src/lib/skills/types.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write the failing decoder test**

Add a test that feeds invalid bytes into the output decoder and asserts the result contains replacement decoding and warnings.

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Implement output decoding with warnings**

Decode script output as UTF-8 with replacement fallback and preserve the warning state.

**Step 4: Thread warnings through script execution**

Return encoding warnings and preserve successful artifact handling even when output is malformed.

**Step 5: Run tests and typecheck**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/skills/executor.ts src/lib/skills/types.ts scripts/agent-core-tests.mjs
git commit -m "Decode skill script output without fatal UTF-8 failures"
```

---

### Task 10: Persist Stable Run Summaries and Memory Evidence

**Files:**
- Modify: `src/lib/agent/resume.ts`
- Modify: `src/lib/agent/working-memory.ts`
- Modify: `src/lib/agent/agent-handler.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write the failing summary test**

Add a test that verifies `AgentRunSummary` can carry part history or snapshot metadata without breaking old summary parsing.

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Extend run summaries**

Add optional snapshot/history fields and keep parsing tolerant of older records.

**Step 4: Record stable evidence**

Persist the new snapshot or part summary after a run completes so Dream and Distill can use it later.

**Step 5: Run tests**

Run: `pnpm test:agent`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/agent/resume.ts src/lib/agent/working-memory.ts src/lib/agent/agent-handler.ts scripts/agent-core-tests.mjs
git commit -m "Persist stable agent run evidence"
```

---

### Task 11: Add Manual Dream Entry Points

**Files:**
- Create: `src/lib/agent/dream.ts`
- Modify: `src/lib/agent/index.ts`
- Modify: `src/lib/agent/tools/agent-memory-tools.ts`
- Modify: `src/app/core/main/memory/memory-workspace.tsx`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write the failing dream-candidate test**

Add a test that creates a memory candidate list from run summaries and working-memory evidence.

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Implement Dream candidate extraction**

Use run summaries, working memory, and memory store data to produce reviewable candidates with evidence and confidence.

**Step 4: Add a manual trigger path**

Expose Dream through a tool or workspace action that opens the candidate list for review.

**Step 5: Run tests and typecheck**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/agent/dream.ts src/lib/agent/index.ts src/lib/agent/tools/agent-memory-tools.ts src/app/core/main/memory/memory-workspace.tsx scripts/agent-core-tests.mjs
git commit -m "Add manual Dream review flow"
```

---

### Task 12: Add Manual Distill Entry Points

**Files:**
- Create: `src/lib/agent/distill.ts`
- Modify: `src/lib/agent/index.ts`
- Modify: `src/app/core/main/memory/memory-workspace.tsx`
- Modify: `src/lib/agent/tools/agent-memory-tools.ts`
- Test: `scripts/agent-core-tests.mjs`

**Step 1: Write the failing distill-recommendation test**

Add a test that identifies repeated workflows from summaries and tool usage.

**Step 2: Run the test to confirm it fails**

Run: `pnpm test:agent`

Expected: FAIL.

**Step 3: Implement Distill recommendation generation**

Produce workflow suggestions, trigger examples, reusable steps, and risk notes.

**Step 4: Keep Distill manual-first**

Do not auto-create or auto-enable skills. Only emit suggestions and optional drafts after user action.

**Step 5: Run tests and typecheck**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/agent/distill.ts src/lib/agent/index.ts src/app/core/main/memory/memory-workspace.tsx src/lib/agent/tools/agent-memory-tools.ts scripts/agent-core-tests.mjs
git commit -m "Add manual Distill workflow recommendations"
```

---

### Task 13: End-to-End Verification

**Files:**
- No code changes unless verification reveals a bug.

**Step 1: Run the targeted agent tests**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: PASS.

**Step 2: Run the broader checks**

Run:

```bash
pnpm check
```

Expected: PASS or a known baseline issue documented separately.

**Step 3: Smoke test runtime stability**

Verify manually that:

- skill scripts do not trigger false fatal failures when output is recoverable
- MCP unavailable/auth/permission states are visible before tool execution
- tool calls keep one stable lifecycle in the UI
- long-form writing streams without flicker or broken markdown

**Step 4: Smoke test manual Dream and Distill**

Verify manually that:

- Dream shows reviewable memory candidates with evidence
- accepted memory candidates are written only after confirmation
- Distill shows workflow recommendations without auto-writing files

**Step 5: Final commit if any fixes were needed**

```bash
git add <fixed-files>
git commit -m "Verify stable agent runtime and manual memory flows"
```
