# DeepAgents-style Agent Harness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild LingMo Agent around an inspectable local-first harness so writing Skills avoid ReAct loops and tool workflows gain unified routing, context, approval, VFS, and memory control.

**Architecture:** Add the new harness beside the existing `AgentHandler` and migrate by route. Start with deterministic Skill runtime profiles and writer routing, then introduce harness types, VFS, ToolRuntime, ApprovalGate, ContextEngine, and run snapshots as wrappers around existing tools before replacing legacy execution.

**Tech Stack:** TypeScript, Next.js React components, Tauri filesystem/store APIs, existing LingMo stores, `scripts/agent-core-tests.mjs`, `pnpm typecheck`.

---

## Implementation Rules

- Keep the legacy `AgentHandler` and `ReActAgent` usable until parity is proven.
- Commit after each task.
- Stage only files changed by that task.
- Run `pnpm test:agent` after each behavior-bearing task.
- Run `pnpm typecheck` after each integration task.
- Do not edit unrelated dirty files.

## Task 1: Add Skill Runtime Profile Types

**Files:**
- Modify: `src/lib/skills/types.ts`
- Modify: `src/lib/skills/parser.ts`
- Modify: `src/lib/skills/validator.ts`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write the failing test**

In `scripts/agent-core-tests.mjs`, import `parseSkillFile` if not already imported and add assertions for `runtimeProfile`.

```js
const { parseSkillFile } = await importTsModule('src/lib/skills/parser.ts')

const parsedRuntimeSkill = parseSkillFile(`---
name: writing-skills
description: writing support
runtimeProfile: writer
capabilities: [generate_text, revise_text]
---
# Writing Skills
`)
assert.equal(parsedRuntimeSkill.metadata.runtimeProfile, 'writer')
assert.deepEqual(parsedRuntimeSkill.metadata.capabilities, ['generate_text', 'revise_text'])
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm test:agent
```

Expected: FAIL because `runtimeProfile` and `capabilities` are not parsed.

**Step 3: Add types**

In `src/lib/skills/types.ts`, add:

```ts
export type SkillRuntimeProfile = 'writer' | 'advisor' | 'agent' | 'workflow'

export interface SkillContextPolicy {
  load?: 'summary-first' | 'full'
  references?: 'on-demand' | 'eager'
}
```

Extend `SkillMetadata` and `SkillYamlMetadata`:

```ts
runtimeProfile?: SkillRuntimeProfile
capabilities?: string[]
contextPolicy?: SkillContextPolicy
```

**Step 4: Parse metadata**

In `src/lib/skills/parser.ts`, add parser cases:

```ts
case 'runtimeProfile':
case 'runtime-profile':
  metadata.runtimeProfile = parseValue(value) as SkillRuntimeProfile
  break
case 'capabilities':
  metadata.capabilities = parseStringArray(value)
  break
```

Add a helper:

```ts
function parseStringArray(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(item => item.trim().replace(/['"]/g, ''))
      .filter(Boolean)
  }
  return trimmed.split(/\s+/).filter(Boolean)
}
```

**Step 5: Validate runtime profile**

In `src/lib/skills/validator.ts`, add:

```ts
const VALID_RUNTIME_PROFILES = new Set(['writer', 'advisor', 'agent', 'workflow'])

if (metadata.runtimeProfile && !VALID_RUNTIME_PROFILES.has(metadata.runtimeProfile)) {
  errors.push({
    field: 'runtimeProfile',
    message: 'runtimeProfile must be one of writer, advisor, agent, workflow',
    severity: 'error',
  })
}
```

Pass the new metadata fields through `validateSkillContent`.

**Step 6: Run tests**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: both pass.

**Step 7: Commit**

```bash
git add src/lib/skills/types.ts src/lib/skills/parser.ts src/lib/skills/validator.ts scripts/agent-core-tests.mjs
git commit -m "Teach Skills to declare runtime profiles" \
  -m "Constraint: Slash Skill routing needs explicit metadata before the new harness can choose writer vs agent execution." \
  -m "Rejected: Continue inferring writer Skills from text regexes | brittle and opaque for users." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Directive: Prefer explicit runtimeProfile over compatibility inference." \
  -m "Tested: pnpm test:agent; pnpm typecheck"
```

## Task 2: Add Skill Runtime Classifier

**Files:**
- Create: `src/lib/skills/runtime-profile.ts`
- Modify: `src/lib/ai-doc-commands/slash-bridge.ts`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write failing tests**

Add source and behavior tests:

```js
const {
  resolveSkillRuntimeProfile,
} = await importTsModule('src/lib/skills/runtime-profile.ts')

assert.equal(resolveSkillRuntimeProfile({
  metadata: {
    id: 'writing-skills',
    name: 'writing-skills',
    description: 'Write articles and improve prose',
    runtimeProfile: 'writer',
    scope: 'project',
    createdAt: 1,
    updatedAt: 1,
  },
  instructions: 'Write an article outline and draft.',
  scripts: [],
  references: [],
  assets: [],
}).profile, 'writer')

assert.equal(resolveSkillRuntimeProfile({
  metadata: {
    id: 'pptx-exporter',
    name: 'pptx-exporter',
    description: 'Export notes to PPTX files',
    scope: 'project',
    createdAt: 1,
    updatedAt: 1,
  },
  instructions: 'Create a presentation file using scripts.',
  scripts: [{ name: 'build.js', path: 'scripts/build.js', type: 'javascript' }],
  references: [],
  assets: [],
}).profile, 'agent')
```

**Step 2: Run failing test**

Run:

```bash
pnpm test:agent
```

Expected: FAIL because the module does not exist.

**Step 3: Implement classifier**

Create `src/lib/skills/runtime-profile.ts`:

```ts
import type { SkillContent, SkillRuntimeProfile } from './types'

export interface SkillRuntimeResolution {
  profile: SkillRuntimeProfile
  explicit: boolean
  reasons: string[]
}

const WRITER_TERMS = /write|writing|article|essay|draft|rewrite|summari[sz]e|prose|写作|文章|草稿|改写|润色|总结|梳理/i
const ARTIFACT_TERMS = /pptx|pdf|docx|xlsx|diagram|excalidraw|file|script|command|export|execute|run|保存|导出|执行|运行|脚本|文件|图表|演示文稿/i

export function resolveSkillRuntimeProfile(skill: SkillContent): SkillRuntimeResolution {
  if (skill.metadata.runtimeProfile) {
    return {
      profile: skill.metadata.runtimeProfile,
      explicit: true,
      reasons: [`metadata.runtimeProfile=${skill.metadata.runtimeProfile}`],
    }
  }

  const text = [
    skill.metadata.name,
    skill.metadata.description,
    skill.instructions,
  ].join('\n')

  if (skill.metadata.allowedTools?.length) {
    return { profile: 'agent', explicit: false, reasons: ['allowedTools present'] }
  }

  if (skill.scripts?.length) {
    return { profile: 'agent', explicit: false, reasons: ['scripts present'] }
  }

  if (ARTIFACT_TERMS.test(text) && !WRITER_TERMS.test(text)) {
    return { profile: 'agent', explicit: false, reasons: ['artifact or execution terms detected'] }
  }

  if (WRITER_TERMS.test(text)) {
    return { profile: 'writer', explicit: false, reasons: ['writing/advisory terms detected'] }
  }

  return { profile: 'advisor', explicit: false, reasons: ['default advisor profile'] }
}

export function skillProfileNeedsAgent(profile: SkillRuntimeProfile) {
  return profile === 'agent' || profile === 'workflow'
}
```

**Step 4: Use classifier in slash bridge**

In `src/lib/ai-doc-commands/slash-bridge.ts`, replace local `skillNeedsAgentMode` with:

```ts
import { resolveSkillRuntimeProfile, skillProfileNeedsAgent } from '@/lib/skills/runtime-profile'
```

When mapping Skill commands:

```ts
const runtime = resolveSkillRuntimeProfile(skill)
return {
  ...
  executionMode: skillProfileNeedsAgent(runtime.profile) ? 'agent' as const : 'chat' as const,
  runtimeProfile: runtime.profile,
  runtimeProfileReason: runtime.reasons,
}
```

If `SlashCommandItem` does not yet expose those fields, add optional fields.

**Step 5: Run tests**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: pass.

**Step 6: Commit**

```bash
git add src/lib/skills/runtime-profile.ts src/lib/ai-doc-commands/slash-bridge.ts scripts/agent-core-tests.mjs
git commit -m "Route Skills through explicit runtime profiles" \
  -m "Constraint: Writer Skills must avoid the Agent/ReAct protocol even when they mention writing." \
  -m "Rejected: A slash-bridge-only regex | routing belongs with Skill runtime metadata." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Directive: Keep routing reasons visible for debugging and UI display." \
  -m "Tested: pnpm test:agent; pnpm typecheck"
```

## Task 3: Introduce WriterExecutor For Writer Skills

**Files:**
- Create: `src/lib/agent/writer-executor.ts`
- Modify: `src/app/core/main/chat/chat-send.tsx`
- Modify: `src/app/core/main/chat/chat-input.tsx`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write source assertions**

In `scripts/agent-core-tests.mjs`, assert the new executor exists and slash skills can pass a writer route:

```js
const writerExecutorSource = await readFile(join(repoRoot, 'src/lib/agent/writer-executor.ts'), 'utf8')
assert.match(writerExecutorSource, /export async function runWriterSkill/)

const chatInputSource = await readFile(join(repoRoot, 'src/app/core/main/chat/chat-input.tsx'), 'utf8')
assert.match(chatInputSource, /routeOverride:\s*slashCommand\.runtimeProfile/)

const chatSendSource = await readFile(join(repoRoot, 'src/app/core/main/chat/chat-send.tsx'), 'utf8')
assert.match(chatSendSource, /handleWriterMode/)
```

**Step 2: Run failing test**

Run:

```bash
pnpm test:agent
```

Expected: FAIL.

**Step 3: Add ChatSend option**

In `src/app/core/main/chat/chat-send.tsx`:

```ts
export interface ChatSendOptions {
  ...
  routeOverride?: 'writer' | 'advisor' | 'agent' | 'workflow' | 'chat' | 'research'
}
```

**Step 4: Implement writer executor**

Create `src/lib/agent/writer-executor.ts`:

```ts
import type { SkillContent } from '@/lib/skills/types'

export function buildWriterSkillInstruction(skill: SkillContent, userRequest: string) {
  return [
    `# Skill: ${skill.metadata.name}`,
    '',
    'The user explicitly invoked this writing/advisory Skill.',
    'Produce the final user-visible content directly.',
    'Do not use ReAct JSON, tool calls, Action, Observation, or final_answer wrappers.',
    'Do not mention this wrapper.',
    '',
    '## Skill Instructions',
    skill.instructions,
    '',
    '## User Request',
    userRequest,
  ].join('\n')
}
```

If direct streaming stays in `chat-send.tsx`, this helper only builds the prompt. Keep it small.

**Step 5: Add handleWriterMode**

In `chat-send.tsx`, route `writer/advisor` to normal `handleChatMode` with a writer instruction:

```ts
if (effectiveRoute === 'writer' || effectiveRoute === 'advisor') {
  await handleWriterMode(imageUrls, effectiveInstruction, options)
} else if (effectiveMode === 'chat') {
  await handleChatMode(...)
}
```

`handleWriterMode` can call `handleChatMode` internally for the first iteration:

```ts
async function handleWriterMode(imageUrls: string[], instructionOverride?: string, options?: ChatSendOptions) {
  await handleChatMode(imageUrls, instructionOverride, options)
}
```

Do not enter `handleAgentMode`.

**Step 6: Pass route from chat-input**

In `chat-input.tsx`, when executing Skill slash command:

```ts
routeOverride: slashCommand.runtimeProfile,
modeOverride: isAgentSkill ? 'agent' : 'chat',
```

**Step 7: Run tests**

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Expected: pass.

**Step 8: Manual smoke**

Run the app and test:

```text
/writing-skills 我想写一篇关于AI产品经理的知识梳理的文章
```

Expected:

- It streams article content.
- It does not show Agent tool loop status.
- It does not require JSON `final_answer`.

**Step 9: Commit**

```bash
git add src/lib/agent/writer-executor.ts src/app/core/main/chat/chat-send.tsx src/app/core/main/chat/chat-input.tsx scripts/agent-core-tests.mjs
git commit -m "Keep writer Skills out of the Agent loop" \
  -m "Constraint: The failing slash command is a writer task and must stream visible content directly." \
  -m "Rejected: More ReAct formatting reminders | writer tasks should not enter ReAct at all." \
  -m "Confidence: high" \
  -m "Scope-risk: moderate" \
  -m "Directive: Future writer/advisor Skills must route through WriterExecutor unless explicitly upgraded to agent/workflow." \
  -m "Tested: pnpm test:agent; pnpm typecheck; manual /writing-skills smoke"
```

## Task 4: Add Harness Core Types And Run State

**Files:**
- Create: `src/lib/agent-harness/types.ts`
- Create: `src/lib/agent-harness/run-id.ts`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write failing tests**

Assert exported types and run id helper:

```js
const harnessTypesSource = await readFile(join(repoRoot, 'src/lib/agent-harness/types.ts'), 'utf8')
assert.match(harnessTypesSource, /export interface AgentRunSnapshot/)
assert.match(harnessTypesSource, /export interface ContextPack/)
assert.match(harnessTypesSource, /export interface ToolObservation/)
assert.match(harnessTypesSource, /export interface ApprovalRequest/)
```

**Step 2: Implement types**

Create `src/lib/agent-harness/types.ts` with:

```ts
export type AgentRoute = 'writer' | 'advisor' | 'chat' | 'agent' | 'workflow' | 'research'

export interface VfsRef {
  uri: `agent://${string}`
  runId: string
  path: string
  kind: 'context' | 'observation' | 'draft' | 'artifact'
  summary?: string
}

export interface ContextPack {
  runId: string
  tokenBudget: number
  included: ContextItem[]
  deferred: VfsRef[]
  warnings: string[]
  checksum: string
}

export interface ContextItem {
  id: string
  source: 'user' | 'quote' | 'file' | 'skill' | 'memory' | 'tool' | 'history'
  priority: number
  content: string
  tokenEstimate: number
  ref?: string
}

export interface ToolObservation {
  toolName: string
  success: boolean
  summary: string
  dataRef?: string
  artifacts?: string[]
  errorKind?: 'validation' | 'permission' | 'timeout' | 'network' | 'tool'
  retryable: boolean
}

export interface ApprovalRequest {
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

export interface AgentRunSnapshot {
  runId: string
  status: 'running' | 'paused' | 'completed' | 'failed'
  userGoal: string
  route: AgentRoute
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

Create `run-id.ts`:

```ts
export function createAgentRunId(prefix = 'run') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
```

**Step 3: Run tests**

```bash
pnpm test:agent
pnpm typecheck
```

**Step 4: Commit**

```bash
git add src/lib/agent-harness/types.ts src/lib/agent-harness/run-id.ts scripts/agent-core-tests.mjs
git commit -m "Define the Agent harness state contract" \
  -m "Constraint: Tool runtime, context packs, approvals, VFS, and snapshots need shared typed records." \
  -m "Confidence: high" \
  -m "Scope-risk: narrow" \
  -m "Directive: Add behavior behind these contracts before replacing legacy Agent execution." \
  -m "Tested: pnpm test:agent; pnpm typecheck"
```

## Task 5: Add AgentVFS Storage Skeleton

**Files:**
- Create: `src/lib/agent-harness/vfs.ts`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write source assertions**

```js
const vfsSource = await readFile(join(repoRoot, 'src/lib/agent-harness/vfs.ts'), 'utf8')
assert.match(vfsSource, /export async function writeAgentVfsText/)
assert.match(vfsSource, /export async function readAgentVfsText/)
assert.match(vfsSource, /agent:\\/\\//)
```

**Step 2: Implement skeleton**

Create `src/lib/agent-harness/vfs.ts`:

```ts
import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { VfsRef } from './types'

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\./g, '')
}

function runRoot(runId: string) {
  return `.agent/runs/${normalizePath(runId)}`
}

async function ensureRunDir(runId: string, subdir: string) {
  const dir = `${runRoot(runId)}/${subdir}`
  if (!(await exists(dir, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true })
  }
  return dir
}

export async function writeAgentVfsText(
  runId: string,
  kind: VfsRef['kind'],
  path: string,
  content: string,
  summary?: string,
): Promise<VfsRef> {
  const safePath = normalizePath(path)
  const dir = await ensureRunDir(runId, kind)
  const fullPath = `${dir}/${safePath}`
  const parent = fullPath.slice(0, fullPath.lastIndexOf('/'))
  if (parent && !(await exists(parent, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(parent, { baseDir: BaseDirectory.AppData, recursive: true })
  }
  await writeTextFile(fullPath, content, { baseDir: BaseDirectory.AppData })
  return {
    uri: `agent://${runId}/${kind}/${safePath}`,
    runId,
    path: `${kind}/${safePath}`,
    kind,
    summary,
  }
}

export async function readAgentVfsText(ref: VfsRef): Promise<string> {
  return readTextFile(`${runRoot(ref.runId)}/${ref.path}`, { baseDir: BaseDirectory.AppData })
}
```

**Step 3: Run tests**

```bash
pnpm test:agent
pnpm typecheck
```

**Step 4: Commit**

```bash
git add src/lib/agent-harness/vfs.ts scripts/agent-core-tests.mjs
git commit -m "Add run-scoped Agent VFS storage" \
  -m "Constraint: Long context and intermediate outputs need storage separate from user notes." \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Directive: Keep AgentVFS low-risk, but require approval before publishing into real workspace files." \
  -m "Tested: pnpm test:agent; pnpm typecheck"
```

## Task 6: Wrap Existing Tools In ToolRuntime

**Files:**
- Create: `src/lib/agent-harness/tool-runtime.ts`
- Modify: `src/lib/agent/types.ts`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write tests**

Assert runtime source includes normalization:

```js
const toolRuntimeSource = await readFile(join(repoRoot, 'src/lib/agent-harness/tool-runtime.ts'), 'utf8')
assert.match(toolRuntimeSource, /export async function executeHarnessTool/)
assert.match(toolRuntimeSource, /ToolObservation/)
assert.match(toolRuntimeSource, /retryable/)
```

**Step 2: Extend execution context**

In `src/lib/agent/types.ts`, extend `ToolExecutionContext`:

```ts
stepId?: string
toolCallId?: string
```

**Step 3: Implement runtime wrapper**

Create `src/lib/agent-harness/tool-runtime.ts`:

```ts
import type { Tool } from '@/lib/agent/types'
import type { ToolObservation } from './types'

function classifyError(error: string): ToolObservation['errorKind'] {
  if (/timeout|timed out/i.test(error)) return 'timeout'
  if (/permission|unauthorized|forbidden/i.test(error)) return 'permission'
  if (/network|fetch|connect|http/i.test(error)) return 'network'
  if (/invalid|required|schema|参数/i.test(error)) return 'validation'
  return 'tool'
}

function summarizeResult(result: Awaited<ReturnType<Tool['execute']>>) {
  return (result.message || result.error || JSON.stringify(result.data || '')).slice(0, 1200)
}

export async function executeHarnessTool(
  tool: Tool,
  params: Record<string, any>,
  context: Parameters<Tool['execute']>[1],
): Promise<ToolObservation> {
  try {
    const result = await tool.execute(params, context)
    if (!result.success) {
      const error = result.error || result.message || 'Tool failed'
      return {
        toolName: tool.name,
        success: false,
        summary: error,
        errorKind: classifyError(error),
        retryable: /timeout|network|fetch|connect/i.test(error),
      }
    }
    return {
      toolName: tool.name,
      success: true,
      summary: summarizeResult(result),
      artifacts: Array.isArray(result.data?.output_files) ? result.data.output_files : undefined,
      retryable: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      toolName: tool.name,
      success: false,
      summary: message,
      errorKind: classifyError(message),
      retryable: /timeout|network|fetch|connect/i.test(message),
    }
  }
}
```

**Step 4: Run tests**

```bash
pnpm test:agent
pnpm typecheck
```

**Step 5: Commit**

```bash
git add src/lib/agent-harness/tool-runtime.ts src/lib/agent/types.ts scripts/agent-core-tests.mjs
git commit -m "Normalize tool execution through the harness" \
  -m "Constraint: Existing tools must be wrapped before their implementations are migrated." \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Directive: Add VFS offloading for large observations before routing all Agent tools through this wrapper." \
  -m "Tested: pnpm test:agent; pnpm typecheck"
```

## Task 7: Add ApprovalGate Contracts

**Files:**
- Create: `src/lib/agent-harness/approval-gate.ts`
- Modify: `src/lib/agent/types.ts`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write tests**

```js
const approvalSource = await readFile(join(repoRoot, 'src/lib/agent-harness/approval-gate.ts'), 'utf8')
assert.match(approvalSource, /export function shouldInterruptForTool/)
assert.match(approvalSource, /approvalScope/)
assert.match(approvalSource, /diffPreview/)
```

**Step 2: Implement gate**

Create `src/lib/agent-harness/approval-gate.ts`:

```ts
import type { Tool } from '@/lib/agent/types'
import type { ApprovalRequest } from './types'

export function shouldInterruptForTool(tool: Tool) {
  return tool.requiresConfirmation || tool.risk === 'medium' || tool.risk === 'high'
}

export function createApprovalRequest(input: {
  runId: string
  stepId: string
  tool: Tool
  params: Record<string, unknown>
  reason: string
  diffPreview?: string
  affectedFiles?: string[]
}): ApprovalRequest {
  return {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: input.runId,
    stepId: input.stepId,
    toolName: input.tool.name,
    risk: input.tool.risk === 'high' ? 'high' : 'medium',
    reason: input.reason,
    params: input.params,
    diffPreview: input.diffPreview,
    affectedFiles: input.affectedFiles,
    approvalScope: 'once',
  }
}
```

**Step 3: Extend UI state later, not now**

Do not refactor `agent-execution-status.tsx` yet. This task only adds contracts.

**Step 4: Run tests**

```bash
pnpm test:agent
pnpm typecheck
```

**Step 5: Commit**

```bash
git add src/lib/agent-harness/approval-gate.ts scripts/agent-core-tests.mjs
git commit -m "Define human approval gates for harness tools" \
  -m "Constraint: Approval must support future parameter editing and pause/resume, not only confirm/cancel." \
  -m "Confidence: medium" \
  -m "Scope-risk: narrow" \
  -m "Directive: Do not route write/execute/delete tools around ApprovalGate." \
  -m "Tested: pnpm test:agent; pnpm typecheck"
```

## Task 8: Add ContextEngine Skeleton

**Files:**
- Create: `src/lib/agent-harness/context-engine.ts`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write tests**

```js
const contextEngineSource = await readFile(join(repoRoot, 'src/lib/agent-harness/context-engine.ts'), 'utf8')
assert.match(contextEngineSource, /export function buildContextPack/)
assert.match(contextEngineSource, /priority/)
assert.match(contextEngineSource, /deferred/)
```

**Step 2: Implement basic packer**

Create `src/lib/agent-harness/context-engine.ts`:

```ts
import { estimateTokens } from '@/lib/ai/token-counter'
import type { ContextItem, ContextPack, VfsRef } from './types'

function checksum(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

export function buildContextPack(input: {
  runId: string
  tokenBudget: number
  items: ContextItem[]
  deferred?: VfsRef[]
}): ContextPack {
  const sorted = [...input.items].sort((a, b) => b.priority - a.priority)
  const included: ContextItem[] = []
  const deferred: VfsRef[] = [...(input.deferred || [])]
  let used = 0
  const warnings: string[] = []

  for (const item of sorted) {
    const tokens = item.tokenEstimate || estimateTokens(item.content)
    if (used + tokens > input.tokenBudget) {
      warnings.push(`Deferred context item ${item.id} due to token budget`)
      continue
    }
    included.push({ ...item, tokenEstimate: tokens })
    used += tokens
  }

  return {
    runId: input.runId,
    tokenBudget: input.tokenBudget,
    included,
    deferred,
    warnings,
    checksum: checksum(JSON.stringify(included.map(item => [item.id, item.ref, item.content]))),
  }
}
```

**Step 3: Run tests**

```bash
pnpm test:agent
pnpm typecheck
```

**Step 4: Commit**

```bash
git add src/lib/agent-harness/context-engine.ts scripts/agent-core-tests.mjs
git commit -m "Add a typed context packer for the harness" \
  -m "Constraint: Prompt assembly needs priority, budget, and deferral semantics before long observations move to VFS." \
  -m "Confidence: medium" \
  -m "Scope-risk: narrow" \
  -m "Directive: Keep current buildChatContext until ContextEngine parity is verified." \
  -m "Tested: pnpm test:agent; pnpm typecheck"
```

## Task 9: Add Run Snapshot Store

**Files:**
- Create: `src/lib/agent-harness/run-snapshot-store.ts`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write source assertions**

```js
const snapshotSource = await readFile(join(repoRoot, 'src/lib/agent-harness/run-snapshot-store.ts'), 'utf8')
assert.match(snapshotSource, /export async function saveRunSnapshot/)
assert.match(snapshotSource, /export async function loadRunSnapshot/)
assert.match(snapshotSource, /agent-harness-runs\.json/)
```

**Step 2: Implement store**

Create `src/lib/agent-harness/run-snapshot-store.ts`:

```ts
import { Store } from '@tauri-apps/plugin-store'
import type { AgentRunSnapshot } from './types'

const STORE_FILE = 'agent-harness-runs.json'
const SNAPSHOTS_KEY = 'snapshots'

async function loadStore() {
  return Store.load(STORE_FILE)
}

export async function saveRunSnapshot(snapshot: AgentRunSnapshot) {
  const store = await loadStore()
  const current = await store.get<AgentRunSnapshot[]>(SNAPSHOTS_KEY) || []
  const next = [
    ...current.filter(item => item.runId !== snapshot.runId),
    { ...snapshot, updatedAt: Date.now() },
  ].slice(-100)
  await store.set(SNAPSHOTS_KEY, next)
  await store.save()
}

export async function loadRunSnapshot(runId: string) {
  const store = await loadStore()
  const current = await store.get<AgentRunSnapshot[]>(SNAPSHOTS_KEY) || []
  return current.find(item => item.runId === runId) || null
}

export async function listRunSnapshots() {
  const store = await loadStore()
  return (await store.get<AgentRunSnapshot[]>(SNAPSHOTS_KEY) || [])
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
```

**Step 3: Run tests**

```bash
pnpm test:agent
pnpm typecheck
```

**Step 4: Commit**

```bash
git add src/lib/agent-harness/run-snapshot-store.ts scripts/agent-core-tests.mjs
git commit -m "Persist harness run snapshots" \
  -m "Constraint: Pause and resume require a typed run record independent of chat messages." \
  -m "Confidence: medium" \
  -m "Scope-risk: narrow" \
  -m "Directive: Store only refs and summaries in snapshots; keep large contents in AgentVFS." \
  -m "Tested: pnpm test:agent; pnpm typecheck"
```

## Task 10: Add AgentOrchestrator Route Shell

**Files:**
- Create: `src/lib/agent-harness/orchestrator.ts`
- Modify: `src/app/core/main/chat/chat-send.tsx`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write source assertions**

```js
const orchestratorSource = await readFile(join(repoRoot, 'src/lib/agent-harness/orchestrator.ts'), 'utf8')
assert.match(orchestratorSource, /export class AgentOrchestrator/)
assert.match(orchestratorSource, /route/)
assert.match(orchestratorSource, /legacyAgentExecutor/)
```

**Step 2: Implement orchestrator shell**

Create `src/lib/agent-harness/orchestrator.ts`:

```ts
import { createAgentRunId } from './run-id'
import type { AgentRoute, AgentRunSnapshot } from './types'

export interface AgentOrchestratorInput {
  userInput: string
  route: AgentRoute
  legacyAgentExecutor?: () => Promise<string>
  writerExecutor?: () => Promise<string>
}

export class AgentOrchestrator {
  async run(input: AgentOrchestratorInput): Promise<{ runId: string; result: string; snapshot: AgentRunSnapshot }> {
    const runId = createAgentRunId()
    const started: AgentRunSnapshot = {
      runId,
      status: 'running',
      userGoal: input.userInput,
      route: input.route,
      draftRefs: [],
      observationRefs: [],
      approvalHistory: [],
      updatedAt: Date.now(),
    }

    const result = input.route === 'writer' || input.route === 'advisor'
      ? await input.writerExecutor?.() || ''
      : await input.legacyAgentExecutor?.() || ''

    return {
      runId,
      result,
      snapshot: {
        ...started,
        status: 'completed',
        finalAnswer: result,
        updatedAt: Date.now(),
      },
    }
  }
}
```

**Step 3: Wire lightly in chat-send**

Do not replace all execution. Add route computation and leave existing execution functions as callbacks.

```ts
const effectiveRoute = options?.routeOverride || effectiveMode
```

Use `AgentOrchestrator` only when `routeOverride` is present for writer/advisor first. Keep agent path legacy for now.

**Step 4: Run tests**

```bash
pnpm test:agent
pnpm typecheck
```

**Step 5: Manual smoke**

Test:

- `/writing-skills ...` still writes.
- Existing Agent tool task still works through legacy path.

**Step 6: Commit**

```bash
git add src/lib/agent-harness/orchestrator.ts src/app/core/main/chat/chat-send.tsx scripts/agent-core-tests.mjs
git commit -m "Introduce the Agent harness route shell" \
  -m "Constraint: The new harness must coexist with the legacy Agent path during migration." \
  -m "Rejected: Replace ReAct in one step | broad regression risk across tools and UI." \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Directive: Migrate one route at a time and keep smoke tests for writer and legacy agent behavior." \
  -m "Tested: pnpm test:agent; pnpm typecheck; manual writer and legacy agent smoke"
```

## Task 11: Move Large Tool Observations Into AgentVFS

**Files:**
- Modify: `src/lib/agent-harness/tool-runtime.ts`
- Modify: `src/lib/agent-harness/vfs.ts`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write test assertions**

```js
const toolRuntimeSource = await readFile(join(repoRoot, 'src/lib/agent-harness/tool-runtime.ts'), 'utf8')
assert.match(toolRuntimeSource, /MAX_INLINE_OBSERVATION_CHARS/)
assert.match(toolRuntimeSource, /writeAgentVfsText/)
assert.match(toolRuntimeSource, /dataRef/)
```

**Step 2: Implement offloading**

In `tool-runtime.ts`:

```ts
const MAX_INLINE_OBSERVATION_CHARS = 4000
```

When summary exceeds the limit and `context?.runId` exists, write full content:

```ts
const ref = await writeAgentVfsText(
  context.runId,
  'observation',
  `${context.stepId || Date.now()}-${tool.name}.txt`,
  fullText,
  fullText.slice(0, 500),
)
return {
  ...observation,
  summary: fullText.slice(0, MAX_INLINE_OBSERVATION_CHARS),
  dataRef: ref.uri,
}
```

**Step 3: Run tests**

```bash
pnpm test:agent
pnpm typecheck
```

**Step 4: Commit**

```bash
git add src/lib/agent-harness/tool-runtime.ts src/lib/agent-harness/vfs.ts scripts/agent-core-tests.mjs
git commit -m "Offload large tool observations to AgentVFS" \
  -m "Constraint: Long stdout, web pages, and file reads should not flood model context." \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Directive: Treat dataRef as the source for follow-up reads, not the truncated summary." \
  -m "Tested: pnpm test:agent; pnpm typecheck"
```

## Task 12: Update UI Diagnostics For Skill Routes

**Files:**
- Modify: `src/app/core/main/chat/ai-doc-command-popover.tsx`
- Modify: `src/app/core/main/chat/chat-input.tsx`
- Modify: `scripts/agent-core-tests.mjs`

**Step 1: Write source assertions**

```js
const popoverSource = await readFile(join(repoRoot, 'src/app/core/main/chat/ai-doc-command-popover.tsx'), 'utf8')
assert.match(popoverSource, /runtimeProfile/)
assert.doesNotMatch(popoverSource, /agent\\s*之类|Agent badge placeholder/)
```

**Step 2: Show concise diagnostics**

Keep popup visually simple, but expose runtime route in accessible tooltip or debug title:

```tsx
title={command.runtimeProfile ? `route: ${command.runtimeProfile}` : undefined}
```

Do not reintroduce wide descriptions or badges.

**Step 3: Add console/debug log only in dev**

In `chat-input.tsx`, when executing slash Skill:

```ts
if (process.env.NODE_ENV !== 'production') {
  console.debug('[SlashSkill] route', {
    id: slashCommand.id,
    runtimeProfile: slashCommand.runtimeProfile,
    reasons: slashCommand.runtimeProfileReason,
  })
}
```

**Step 4: Run tests**

```bash
pnpm test:agent
pnpm typecheck
```

**Step 5: Manual smoke**

Open slash command popup:

- Popup remains compact.
- `/writing-skills` route debug shows `writer`.
- No visible `agent` badges come back.

**Step 6: Commit**

```bash
git add src/app/core/main/chat/ai-doc-command-popover.tsx src/app/core/main/chat/chat-input.tsx scripts/agent-core-tests.mjs
git commit -m "Expose Skill route diagnostics without cluttering slash UI" \
  -m "Constraint: The popup must stay compact while routing remains debuggable." \
  -m "Confidence: medium" \
  -m "Scope-risk: narrow" \
  -m "Directive: Do not restore wide Skill descriptions or route badges in the slash popup." \
  -m "Tested: pnpm test:agent; pnpm typecheck; manual slash popup smoke"
```

## Final Verification

Run:

```bash
pnpm test:agent
pnpm typecheck
```

Manual verification:

1. Open LingMo.
2. Use `/writing-skills 我想写一篇关于AI产品经理的知识梳理的文章`.
3. Confirm it streams visible article text.
4. Confirm it does not stay in Agent "思考中".
5. Run a known tool-based Agent task and confirm legacy path still works.
6. Run a file-write task and confirm approval still appears.

Expected final state:

- Writer Skills route to direct generation.
- Agent/workflow Skills still support tools.
- Harness contracts exist for future migration.
- Existing tools still work through compatibility paths.
