import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const source = async path => await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const getExportedFunctionSource = (text, name) => {
  const start = text.indexOf(`export async function ${name}`)
  if (start < 0) return ''
  const nextExport = text.indexOf('\nexport ', start + 1)
  return text.slice(start, nextExport < 0 ? text.length : nextExport)
}

const dbEntries = await readdir(new URL('../src/db/', import.meta.url), { withFileTypes: true })
for (const entry of dbEntries.filter(entry => entry.isFile() && entry.name.endsWith('.ts'))) {
  const text = await source(`src/db/${entry.name}`)
  assert.doesNotMatch(text, /\brunDbTransaction\b/, `${entry.name} still uses the pooled transaction helper`)
  assert.doesNotMatch(
    text,
    /\.execute\(\s*['"`]\s*(?:begin(?:\s+immediate)?|commit|rollback)\b/i,
    `${entry.name} issues raw transaction control SQL through the connection pool`,
  )
}

const indexSource = await source('src/db/index.ts')
const batchSource = getExportedFunctionSource(indexSource, 'runDbBatch')
assert.match(indexSource, /not an atomic database transaction/)
assert.match(batchSource, /batchMutexPromise/)
assert.doesNotMatch(batchSource, /BEGIN|COMMIT|ROLLBACK/)

const flashcardsSource = await source('src/db/flashcards.ts')
assert.doesNotMatch(flashcardsSource, /last_insert_rowid/)
assert.ok((flashcardsSource.match(/result\.lastInsertId/g) || []).length >= 4)

const knowledgeObjectsSource = await source('src/db/knowledge-objects.ts')
const bulkKnowledgeSource = getExportedFunctionSource(knowledgeObjectsSource, 'bulkUpsertKnowledgeObjects')
assert.match(bulkKnowledgeSource, /serializedWrite[\s\S]*runDbBatch/)

const objectRegistrySource = await source('src/lib/knowledge/object-registry.ts')
assert.match(objectRegistrySource, /moveByPath[\s\S]*serializedWrite[\s\S]*where instr\(path, \$2\) = 1/)
assert.doesNotMatch(objectRegistrySource, /moveByPath[\s\S]{0,800}select id, path/)

const structuredSource = await source('src/db/structured-knowledge.ts')
for (const name of [
  'markStructuredSemanticExtractionRequested',
  'markStructuredSemanticExtractionRunning',
  'markStructuredSemanticExtractionFailed',
]) {
  assert.match(getExportedFunctionSource(structuredSource, name), /serializedWrite/)
}

console.log('database runtime regression tests passed')
