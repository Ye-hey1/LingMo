import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = async path => await readFile(join(repoRoot, path), 'utf8')

const adapters = await source('src/lib/link-pipeline/capture-adapters.ts')
assert.match(adapters, /export async function captureGithub/)
assert.match(adapters, /export async function captureXiaohongshu/)
assert.match(adapters, /export async function captureVideo/)
assert.match(adapters, /buildGitHubProjectRecord/)
assert.match(adapters, /buildXhsNoteRecord/)
assert.match(adapters, /fetchVideoTranscript/)
assert.match(adapters, /existingContentMarker:\s*'lingmo:github-project'/)
assert.match(adapters, /sourceIdentity:/)
assert.match(adapters, /organization:\s*'adapter_structured'/)

const marks = await source('src/db/marks.ts')
assert.match(marks, /upsertByUrl\?: boolean/)
assert.match(marks, /existingContentMarker\?: string/)
assert.match(marks, /idx_marks_source_identity_unique/)
assert.match(marks, /instr\(coalesce\(content, ''\), \$[0-9]+\)/i)
assert.match(marks, /status = 'running' and lease_owner/i)

const runner = await source('src/lib/link-pipeline/capture-runner.ts')
assert.match(runner, /case 'github'/)
assert.match(runner, /case 'xiaohongshu'/)
assert.match(runner, /case 'video'/)
assert.match(runner, /draft\.organization === 'generic_ai'/)
assert.match(runner, /draft\.sourceType/)

const control = await source('src/app/core/main/mark/control-link.tsx')
assert.match(control, /enqueueLinkCapture/)
assert.doesNotMatch(control, /fetchGitHubProjectInfo/)
assert.doesNotMatch(control, /fetchXhsNoteData/)
assert.doesNotMatch(control, /fetchVideoTranscript/)
assert.doesNotMatch(control, /findExistingGitHubProjectMark/)

console.log('structured link capture tests passed')
