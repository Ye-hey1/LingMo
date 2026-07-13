import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = async path => await readFile(join(repoRoot, path), 'utf8')

async function loadPureTs(relativePath) {
  const filePath = join(repoRoot, relativePath)
  const output = ts.transpileModule(await readFile(filePath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true },
    fileName: filePath,
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error(`${relativePath} must stay dependency-free`)
  }, module, module.exports)
  return module.exports
}

const projection = await loadPureTs('src/lib/link-pipeline/projection.ts')
const baseline = projection.createLinkProjectionFingerprint({ desc: '标题', content: '原始正文' })
assert.equal(baseline, projection.createLinkProjectionFingerprint({ desc: '标题', content: '原始正文' }))
assert.notEqual(baseline, projection.createLinkProjectionFingerprint({ desc: '人工修改', content: '原始正文' }))

const marksSource = await source('src/db/marks.ts')
assert.match(marksSource, /export async function updateMarkContentIfUnchanged/)
assert.match(marksSource, /export async function updateMarkContentIfUnchangedIfOwned/)
assert.match(marksSource, /coalesce\(desc, ''\) = \$[0-9]+/i)
assert.match(marksSource, /coalesce\(content, ''\) = \$[0-9]+/i)
assert.match(marksSource, /status = 'running' and lease_owner = \$7/i)

const runnerSource = await source('src/lib/link-pipeline/organize-runner.ts')
assert.match(runnerSource, /replaceLinkSourceBlocks/)
assert.match(runnerSource, /upsertLinkStageResult/)
assert.match(runnerSource, /createLinkOutputVersion/)
assert.match(runnerSource, /updateMarkContentIfUnchangedIfOwned/)
assert.match(runnerSource, /renewLinkJobLease/)
assert.match(runnerSource, /completeLinkJob/)
assert.match(runnerSource, /failLinkJob/)
assert.match(runnerSource, /startLinkPipelineRecovery/)
assert.match(runnerSource, /getMarkById/)
assert.match(runnerSource, /recoveredFromMark/)
assert.match(runnerSource, /reusableOutput/)
assert.match(runnerSource, /updateLinkOutputVersionMetadata/)
assert.match(runnerSource, /RECOVERY_SCAN_INTERVAL_MS = 30_000/)
assert.match(runnerSource, /link-pipeline-mark-updated/)

const statusSource = await source('src/app/core/main/mark/link-job-status.tsx')
assert.match(statusSource, /getLatestLinkJobForMark/)
assert.match(statusSource, /getLinkJobBundle/)
assert.match(statusSource, /retryLinkOrganizationJob/)
assert.match(statusSource, /AI 整理失败/)
assert.match(statusSource, /结果待应用/)
assert.match(statusSource, /link-pipeline-job-updated/)
assert.doesNotMatch(statusSource, /setTimeout\(poll/)

const markItemSource = await source('src/app/core/main/mark/mark-item.tsx')
assert.match(markItemSource, /LinkJobStatus/)
assert.match(markItemSource, /<LinkJobStatus markId=\{mark\.id\}/)
const renderContentSource = markItemSource.slice(markItemSource.indexOf('const renderContent = () =>'))
const defaultLinkBranch = renderContentSource.match(/case 'link':[\s\S]*?case 'text':/)?.[0] || ''
const defaultScanBranch = renderContentSource.match(/case 'scan':[\s\S]*?case 'image':/)?.[0] || ''
assert.match(defaultLinkBranch, /LinkJobStatus/)
assert.doesNotMatch(defaultScanBranch, /LinkJobStatus/)

const mobileRecordSource = await source('src/app/mobile/record/mobile-record-stream.tsx')
assert.match(mobileRecordSource, /mark\.type === 'link'.*LinkJobStatus/)

const controlSource = await source('src/app/core/main/mark/control-link.tsx')
assert.match(controlSource, /enqueueLinkCapture/)
assert.match(controlSource, /managedByCaptureRunner/)
assert.doesNotMatch(controlSource, /enqueueSavedLinkOrganization/)
assert.doesNotMatch(controlSource, /captureWechatArticleToMark/)
assert.doesNotMatch(controlSource, /async function extractResponseText/)
assert.doesNotMatch(controlSource, /async function organizeSavedLinkRecord/)

const desktopLayout = await source('src/app/core/layout.tsx')
const mobileLayout = await source('src/app/mobile/layout.tsx')
assert.match(desktopLayout, /startLinkPipelineRecovery/)
assert.match(desktopLayout, /await initAllDatabases\(\)[\s\S]*startLinkPipelineRecovery[\s\S]*await initVectorDb\(\)/)
assert.match(mobileLayout, /await initAllDatabases\(\)[\s\S]*startLinkPipelineRecovery[\s\S]*await initVectorDb\(\)/)

console.log('link organize job tests passed')
