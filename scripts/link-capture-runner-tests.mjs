import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = async path => await readFile(join(repoRoot, path), 'utf8')

const runner = await source('src/lib/link-pipeline/capture-runner.ts')
assert.match(runner, /ensureLinkJob\([\s\S]*currentStage:\s*'capture'[\s\S]*input:/)
assert.match(runner, /claimLinkJob/)
assert.match(runner, /renewLinkJobLease/)
assert.match(runner, /checkpointLinkJob/)
assert.match(runner, /persistCapturedLinkMarkIfOwned/)
assert.match(runner, /parentJobId:\s*job\.id/)
assert.match(runner, /startImmediately:\s*false/)
assert.match(runner, /completeLinkJob[\s\S]*runLinkOrganizationJob/)
assert.match(runner, /retryLinkCaptureJob/)
assert.match(runner, /link-pipeline-capture-progress/)
assert.match(runner, /CAPTURE_RECOVERY_CONCURRENCY = 2/)

const organizeRunner = await source('src/lib/link-pipeline/organize-runner.ts')
assert.match(organizeRunner, /job\.currentStage === 'capture'/)
assert.match(organizeRunner, /startLinkCaptureRecovery/)
assert.match(organizeRunner, /job\.currentStage !== 'capture'/)

const status = await source('src/app/core/main/mark/link-job-status.tsx')
assert.match(status, /retryLinkCaptureJob/)
assert.match(status, /currentStage === 'capture'/)

const control = await source('src/app/core/main/mark/control-link.tsx')
assert.match(control, /enqueueLinkCapture/)
assert.match(control, /sourceRoute\.type === 'unknown'/)
assert.match(control, /sourceType:\s*sourceRoute\.type/)
assert.match(control, /autoOrganize:\s*shouldOrganizeAfterSave/)

const store = await source('src/stores/mark.ts')
assert.match(store, /link-pipeline-capture-progress/)
assert.match(store, /event\.status === 'failed'/)

const desktopProgress = await source('src/app/core/main/global-progress.tsx')
const mobileProgress = await source('src/app/mobile/record/mobile-record-stream.tsx')
assert.match(desktopProgress, /retryLinkCaptureJob/)
// 断言重试按钮的接线而非文案：文案是随时可改的 UI 措辞，原先断言 /重新抓取/
// 就因为改成「重试」而误报失败。这里检查失败态下确实渲染了触发 retryCapture
// 的按钮，且重试进行中会禁用它。
assert.match(desktopProgress, /activeQueue\.status === 'failed'/)
assert.match(desktopProgress, /onClick=\{\(\) => void retryCapture\(activeQueue\)\}/)
assert.match(desktopProgress, /disabled=\{!activeQueue\.jobId \|\| retryingJobId === activeQueue\.jobId\}/)
assert.match(mobileProgress, /retryLinkCaptureJob/)

console.log('link capture runner tests passed')
