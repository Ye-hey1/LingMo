/**
 * drawio 内嵌资源的契约测试。
 *
 * public/drawio 是 drawio 上游发行版的整份拷贝，里面有两类东西在 Tauri 静态
 * 内嵌场景下用不到：Java servlet 配置（WEB-INF，且含上游托管服务的第三方 OAuth
 * client secret）和未被任何入口引用的 js 包。它们已移到 .drawio-removed/。
 *
 * 这个测试锁定三件事，防止升级 drawio 时又整份拷回来：
 * 1. 运行时真正需要的包必须在
 * 2. 已移出的项不得回到 public/
 * 3. 入口 html 的 js 引用集合不得扩大（扩大说明上游改了加载方式，需人工复核）
 */
import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const drawioDir = join(repoRoot, 'public/drawio')

const exists = async path => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

// 1. bootstrap.js 动态加载的三个包 + app.min.js 运行时引用的 viewer-static，
//    以及两个入口脚本。少任何一个都会导致画布或形状库静默失效。
const required = [
  'js/bootstrap.js',
  'js/main.js',
  'js/app.min.js',
  'js/extensions.min.js',
  'js/stencils.min.js',
  'js/viewer-static.min.js',
]
for (const rel of required) {
  assert.ok(await exists(join(drawioDir, rel)), `drawio 运行时必需文件缺失: ${rel}`)
}

// app.min.js 是主包，被截断或占位会让画布打不开
const appBundle = await readFile(join(drawioDir, 'js/app.min.js'), 'utf8')
assert.ok(appBundle.length > 1_000_000, 'app.min.js 体积异常，疑似被截断或替换为占位')

// 2. 已移出的项不得回到 public/（WEB-INF 含第三方 OAuth 凭据，不应进分发包）
const mustStayOut = ['WEB-INF', 'js/integrate.min.js', 'js/viewer.min.js']
for (const rel of mustStayOut) {
  assert.ok(
    !(await exists(join(drawioDir, rel))),
    `${rel} 又出现在 public/drawio —— 若是升级 drawio 导致，请重新移出并复核引用`,
  )
}

// 3. 入口 html 的 js 引用集合。bootstrap/main 之外若冒出新的 src，说明上游改了
//    加载方式，此时上面的“必需/可移除”判断需要重新做。
const indexHtml = await readFile(join(drawioDir, 'index.html'), 'utf8')
const scriptSrcs = [...indexHtml.matchAll(/src="([^"]*\.js[^"]*)"/g)].map(m => m[1]).sort()
assert.deepEqual(
  scriptSrcs,
  ['js/bootstrap.js', 'js/main.js'],
  'index.html 的 js 引用集合变了，需人工复核哪些包仍可移除',
)

console.log('drawio assets tests passed')
