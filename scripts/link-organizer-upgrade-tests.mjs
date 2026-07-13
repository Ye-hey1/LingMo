import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function loadPureTs(relativePath) {
  const path = join(repoRoot, relativePath)
  const output = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true },
    fileName: path,
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error(`${relativePath} must stay dependency-free`)
  }, module, module.exports)
  return module.exports
}

const { chunkLinkContent } = await loadPureTs('src/lib/link-pipeline/chunker.ts')
assert.deepEqual(chunkLinkContent('短正文', { maxChars: 100, maxChunks: 4 }), ['短正文'])

const longContent = [
  `HEAD-${'a'.repeat(180)}`,
  `MIDDLE-${'b'.repeat(180)}`,
  `TAIL-${'c'.repeat(180)}`,
].join('\n\n')
const chunks = chunkLinkContent(longContent, { maxChars: 120, maxChunks: 6, overlapChars: 10 })
assert.ok(chunks.length > 1)
assert.ok(chunks.every(chunk => chunk.length <= 130), 'chunk size should stay near the configured maximum')
assert.match(chunks[0], /HEAD-/)
assert.ok(chunks.some(chunk => chunk.includes('TAIL-')), 'chunking should preserve the end section')
assert.ok(chunks.some(chunk => chunk.includes('MIDDLE-')), 'balanced chunking should not keep only the beginning')

const manySections = Array.from({ length: 20 }, (_, index) => `SECTION-${index}-${String(index).repeat(90)}`).join('\n\n')
const sampled = chunkLinkContent(manySections, { maxChars: 120, maxChunks: 4, overlapChars: 0 })
assert.equal(sampled.length, 4)
assert.match(sampled[0], /SECTION-0-/)
assert.ok(sampled.at(-1).endsWith('19'), 'balanced sampling should preserve the actual tail content')
assert.ok(sampled.slice(1, -1).some(chunk => /SECTION-(?:[5-9]|1[0-5])-/.test(chunk)))

const organizerSource = await readFile(join(repoRoot, 'src/lib/ai/link-organizer.ts'), 'utf8')
assert.match(organizerSource, /chunkLinkContent/)
assert.match(organizerSource, /mapWithConcurrency/)
assert.match(organizerSource, /link-organizer-v2/)
assert.doesNotMatch(organizerSource, /prepareMessages/)
assert.doesNotMatch(organizerSource, /LINK_ORGANIZE_CONTENT_LIMIT/)

console.log('link organizer upgrade tests passed')
