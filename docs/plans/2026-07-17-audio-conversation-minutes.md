# Audio Conversation Minutes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert imported local audio/video transcripts into structured, actionable conversation minutes while preserving the original transcript and audio.

**Architecture:** Keep the existing `recording` mark and store versioned meeting metadata in the existing `lingmo:audio-recording` marker. Extract dependency-free parsing and formatting logic for direct regression tests, then connect the organizer to all local-media import paths and render a recording-specific detail view.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, Zustand, OpenAI-compatible chat completions, Node assertion tests.

---

### Task 1: Lock the recording metadata contract

**Files:**
- Create: `scripts/audio-conversation-minutes-tests.mjs`
- Modify: `src/lib/audio-recording-record.ts`
- Modify: `package.json`

**Steps:**

1. Write failing tests for legacy transcript parsing, versioned metadata parsing, transcript preservation, structured merge, title fallback, and timestamp anchors.
2. Run `node scripts/audio-conversation-minutes-tests.mjs` and confirm the new API is missing.
3. Implement normalized metadata types and dependency-free parsing/merge helpers.
4. Re-run the test and confirm it passes.

### Task 2: Generate grounded minutes

**Files:**
- Modify: `src/lib/audio-recording-record.ts`
- Test: `scripts/audio-conversation-minutes-tests.mjs`

**Steps:**

1. Add failing source-contract tests for the required JSON schema and non-invention rules.
2. Run the test and confirm failure.
3. Replace the generic summary prompt with adaptive conversation classification and structured requirements, decisions, actions, risks, open questions, participants, and evidence anchors.
4. Normalize malformed model output and keep the existing primary-model fallback.
5. Re-run the test.

### Task 3: Connect local-media imports

**Files:**
- Create: `src/lib/audio-transcription-record.ts`
- Modify: `src/app/core/main/mark/control-link.tsx`
- Modify: `src/app/core/main/mark/control-recording.tsx`
- Modify: `src/app/core/main/mark/index.tsx`
- Test: `scripts/audio-conversation-minutes-tests.mjs`

**Steps:**

1. Add failing tests for consistent title/source metadata and automatic organization wiring.
2. Implement one shared helper that saves the raw recording mark, optionally organizes it, and never loses the transcript on AI failure.
3. Replace the three duplicated insertion paths with the helper.
4. Ensure the link tool's “保存后 AI 整理” option controls local-media organization.
5. Re-run the test.

### Task 4: Build the recording-specific detail view

**Files:**
- Create: `src/app/core/main/mark/audio-recording-detail-view.tsx`
- Modify: `src/app/core/main/mark/mark-item.tsx`
- Modify: `src/app/core/main/mark/mark-list-item-content.tsx`

**Steps:**

1. Render “智能纪要 / 完整原文” tabs, a stable audio player, summary, highlights, requirements, decisions, action items, risks, and open questions.
2. Add organizing, empty, failed, retry, and legacy states.
3. Preserve the existing generic editor for direct raw transcript editing.
4. Update list title and preview selection to prefer structured metadata.

### Task 5: Verify

**Files:**
- Modify as required by verification findings only.

**Steps:**

1. Run `pnpm test:audio-minutes`.
2. Run `pnpm typecheck`.
3. Run `pnpm lint`.
4. Reload the running local app and verify desktop and mobile-width screenshots.
5. Review `git diff` to confirm unrelated user changes remain intact.
