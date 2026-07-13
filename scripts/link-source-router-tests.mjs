import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(repoRoot, 'src/lib/link-pipeline/source-router.ts')
const output = ts.transpileModule(await readFile(path, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true },
  fileName: path,
}).outputText
const module = { exports: {} }
new Function('require', 'module', 'exports', output)(() => {
  throw new Error('source router must stay dependency-free')
}, module, module.exports)

const { routeLinkSource } = module.exports

assert.deepEqual(routeLinkSource('https://github.com/guyue356/Video2TechBlog'), {
  type: 'github',
  organization: 'adapter_structured',
})
assert.deepEqual(routeLinkSource('https://mp.weixin.qq.com/s/example'), {
  type: 'wechat',
  organization: 'generic_ai',
})
assert.deepEqual(routeLinkSource('https://www.xiaohongshu.com/explore/example'), {
  type: 'xiaohongshu',
  organization: 'adapter_structured',
})
assert.deepEqual(routeLinkSource('https://www.bilibili.com/video/BV1234567890'), {
  type: 'video',
  organization: 'adapter_structured',
})
assert.deepEqual(routeLinkSource('https://example.com/article'), {
  type: 'webpage',
  organization: 'generic_ai',
})
assert.deepEqual(routeLinkSource('not a url'), {
  type: 'unknown',
  organization: 'capture_only',
})

const controlSource = await readFile(join(repoRoot, 'src/app/core/main/mark/control-link.tsx'), 'utf8')
assert.match(controlSource, /routeLinkSource\(targetUrl\)/)
assert.match(controlSource, /sourceRoute\.type === 'wechat'/)
assert.match(controlSource, /sourceType:\s*sourceRoute\.type/)
assert.match(controlSource, /autoOrganize:\s*shouldOrganizeAfterSave/)

console.log('link source router tests passed')
