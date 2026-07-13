import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-creative-canvas-tests-'))
const compiledModules = new Set()

process.on('exit', () => {
  rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

async function source(path) {
  return await readFile(resolve(repoRoot, path), 'utf8')
}

function resolveLocalDependency(currentRelativePath, specifier) {
  const basePath = specifier.startsWith('@/')
    ? resolve(repoRoot, 'src', specifier.slice(2))
    : resolve(dirname(resolve(repoRoot, currentRelativePath)), specifier)
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, join(basePath, 'index.ts'), join(basePath, 'index.tsx')]
  const dependencyPath = candidates.find(candidate => existsSync(candidate))
  return dependencyPath ? relative(repoRoot, dependencyPath).replaceAll('\\', '/') : null
}

function outputPath(relativePath) {
  return relativePath.replace(/\.tsx?$/, '.mjs')
}

function rewriteSpecifier(currentRelativePath, dependencyRelativePath) {
  let specifier = relative(dirname(outputPath(currentRelativePath)), outputPath(dependencyRelativePath)).replaceAll('\\', '/')
  if (!specifier.startsWith('.')) specifier = `./${specifier}`
  return specifier
}

async function compileTsModule(relativePath) {
  if (compiledModules.has(relativePath)) return
  compiledModules.add(relativePath)
  const input = await source(relativePath)
  let output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: resolve(repoRoot, relativePath),
  }).outputText
  const dependencies = new Set()
  const rewrite = (match, prefix, specifier, suffix) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return match
    const dependency = resolveLocalDependency(relativePath, specifier)
    if (!dependency) return match
    dependencies.add(dependency)
    return `${prefix}${rewriteSpecifier(relativePath, dependency)}${suffix}`
  }
  output = output.replace(/(from\s+['"])([^'"]+)(['"])/g, rewrite)
  output = output.replace(/(import\s*\(\s*['"])([^'"]+)(['"]\s*\))/g, rewrite)
  for (const dependency of dependencies) await compileTsModule(dependency)
  const destination = join(tempDir, outputPath(relativePath))
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, output, 'utf8')
}

async function importTsModule(relativePath) {
  await compileTsModule(relativePath)
  return await import(pathToFileURL(join(tempDir, outputPath(relativePath))).href)
}

test('creative canvas model slots are distinct from image understanding', async () => {
  const settings = await source('src/stores/setting.ts')
  const modelSelect = await source('src/app/core/setting/components/model-select.tsx')

  assert.match(settings, /'imageGenerationModel'/)
  assert.match(settings, /'videoGenerationModel'/)
  assert.match(settings, /function isImageModel/)
  assert.match(settings, /model\.modelType === 'image'/)
  assert.match(modelSelect, /case 'imageGeneration': return 'image'/)
  assert.match(modelSelect, /setImageGenerationModel/)
})

test('creative canvas is not registered as an editor virtual workspace', async () => {
  const articleStore = await source('src/stores/article.ts')
  const editorLayout = await source('src/app/core/main/editor/editor-layout.tsx')

  assert.doesNotMatch(articleStore, /lingmo:\/\/creative-canvas/)
  assert.doesNotMatch(editorLayout, /CreativeCanvasWorkspace/)
  assert.doesNotMatch(editorLayout, /isCreativeCanvasTabPath/)
  assert.doesNotMatch(editorLayout, /creativeCanvas/)
})

test('creative canvas opens as a dedicated left sidebar modal tool', async () => {
  const sidebarStore = await source('src/stores/sidebar.ts')
  const leftSidebar = await source('src/app/core/main/left-sidebar.tsx')
  const modal = await source('src/components/creative-canvas-modal.tsx')
  const canvasSidebar = await source('src/app/core/main/creative-canvas/creative-canvas-sidebar-panel.tsx')

  assert.match(sidebarStore, /'creativeCanvas'/)
  assert.match(sidebarStore, /normalizedLeftTab = leftTab === 'creativeCanvas' \? 'files' : leftTab/)
  assert.match(leftSidebar, /CreativeCanvasModal/)
  assert.match(leftSidebar, /open-creative-canvas/)
  assert.match(leftSidebar, /label=\{t\('creativeCanvas\.title'\)\}/)
  assert.doesNotMatch(leftSidebar, /CREATIVE_CANVAS_TAB_PATH/)
  assert.doesNotMatch(leftSidebar, /setLeftSidebarTab\('creativeCanvas'\)/)
  assert.match(modal, /DialogContent/)
  assert.match(modal, /CreativeCanvasWorkspace/)
  assert.match(canvasSidebar, /打开创意画布/)
  assert.match(canvasSidebar, /open-creative-canvas/)
})

test('creative canvas full workspace preserves core generation workflows', async () => {
  const store = await source('src/stores/creative-canvas.ts')
  const modal = await source('src/components/creative-canvas-modal.tsx')
  const workspace = await source('src/app/core/main/creative-canvas/creative-canvas-workspace.tsx')

  assert.match(store, /importImageAsset/)
  assert.match(store, /addImageNodeFromAsset/)
  assert.match(store, /runGenerationForNodes/)
  assert.match(store, /recoverStaleJobs/)
  assert.match(store, /retryGenerationJob/)
  assert.match(store, /analyzeAssetCleanup/)
  assert.match(store, /cleanupAssets/)
  assert.match(store, /cacheAssetThumbnail/)
  assert.match(store, /referenceAssetIds/)
  assert.match(store, /referenceEdges/)
  assert.match(workspace, /tCanvas\('inspector\.title'\)/)
  assert.match(workspace, /handleImportCanvasJson/)
  assert.match(workspace, /handleRecoverJobs/)
  assert.match(workspace, /handleCleanupAssets/)
  assert.match(workspace, /insertAssetIntoNote/)
  assert.match(workspace, /CanvasMiniMap/)
  assert.match(workspace, /boxSelectMode/)
  assert.match(modal, /CreativeCanvasWorkspace/)
})

test('advanced workspace is exposed through the dedicated modal', async () => {
  const workspace = await source('src/app/core/main/creative-canvas/creative-canvas-workspace.tsx')
  const modal = await source('src/components/creative-canvas-modal.tsx')

  assert.match(workspace, /CanvasMiniMap/)
  assert.match(workspace, /tCanvas\('inspector\.title'\)/)
  assert.doesNotMatch(workspace, /assistantMessages/)
  assert.doesNotMatch(workspace, /handleAssistantSubmit/)
  assert.match(workspace, /boxSelectMode/)
  assert.match(workspace, /contextMenu/)
  assert.match(workspace, /onDrop=\{handleDrop\}/)
  assert.match(workspace, /tCanvas\('toolbar\.runMany'\)/)
  assert.match(workspace, /tCanvas\('toolbar\.importImage'\)/)
  assert.match(workspace, /tCanvas\('toolbar\.importJson'\)/)
  assert.match(workspace, /connectionDrag/)
  assert.match(workspace, /draftNodeRects/)
  assert.match(workspace, /fitNodesInViewport/)
  assert.match(modal, /CreativeCanvasWorkspace/)
})

test('creative canvas viewport math keeps zoom anchored and clamps invalid input', async () => {
  const geometry = await importTsModule('src/lib/creative-canvas/geometry.ts')
  const viewport = { x: 120, y: 80, k: 1 }
  const anchor = { x: 420, y: 280 }
  const worldBefore = {
    x: (anchor.x - viewport.x) / viewport.k,
    y: (anchor.y - viewport.y) / viewport.k,
  }
  const zoomed = geometry.zoomViewportAtPoint(viewport, 2, anchor)

  assert.equal((anchor.x - zoomed.x) / zoomed.k, worldBefore.x)
  assert.equal((anchor.y - zoomed.y) / zoomed.k, worldBefore.y)
  assert.equal(geometry.normalizeCanvasViewport({ x: Number.NaN, y: 4, k: 0 }).k, geometry.CREATIVE_CANVAS_MIN_ZOOM)
  assert.deepEqual(
    geometry.getCanvasSelectionRect({ x: 30, y: 40 }, { x: 10, y: 20 }),
    { x: 10, y: 20, width: 20, height: 20 },
  )
})

test('creative canvas separates configured model selection from request model', async () => {
  const generation = await source('src/lib/creative-canvas/generation.ts')
  const generationRequest = await source('src/lib/creative-canvas/generation-request.ts')
  const aiUtils = await source('src/lib/ai/utils.ts')
  const store = await source('src/stores/creative-canvas.ts')
  const modelSelect = await source('src/app/core/main/creative-canvas/creative-canvas-model-select.tsx')

  assert.match(generation, /getAISettings\('imageGenerationModel', modelSelection\)/)
  assert.match(generationRequest, /options\?\.modelSelection \? aiConfig\.model/)
  assert.match(aiUtils, /modelSelectionOverride/)
  assert.match(store, /project\.settings\?\.imageModelSelection/)
  assert.match(modelSelect, /createConfiguredModelSelectionId/)
  assert.match(modelSelect, /modelType !== 'image'/)
})

test('creative canvas image requests stay portable across OpenAI-compatible providers', async () => {
  const {
    buildImageRequest,
    invokeImageRequestWithCompatibility,
  } = await importTsModule('src/lib/creative-canvas/generation-request.ts')
  const aiConfig = {
    key: 'agnes',
    title: 'Agnes',
    model: 'agnes-t2i-general-model',
    modelType: 'image',
  }

  const defaultRequest = buildImageRequest(aiConfig, '一座海边灯塔', {
    size: '1024x1024',
    quality: 'standard',
    count: 1,
  })
  assert.deepEqual(defaultRequest, {
    model: 'agnes-t2i-general-model',
    prompt: '一座海边灯塔',
    size: '1024x1024',
  })
  assert.equal('response_format' in defaultRequest, false)

  const enhancedRequest = buildImageRequest(aiConfig, '一座海边灯塔', {
    size: '1536x1024',
    quality: 'hd',
    count: 2,
  })
  assert.deepEqual(enhancedRequest, {
    model: 'agnes-t2i-general-model',
    prompt: '一座海边灯塔',
    n: 2,
    size: '1536x1024',
    quality: 'hd',
  })

  const attempts = []
  const compatibleResult = await invokeImageRequestWithCompatibility(enhancedRequest, async request => {
    attempts.push(request)
    if (attempts.length === 1) {
      throw new Error('UnsupportedParamsError: Setting `quality` is not supported by openai, agnes-t2i-general-model.')
    }
    return { data: [{ url: 'https://example.test/generated.png' }] }
  })
  assert.equal(attempts.length, 2)
  assert.equal('quality' in attempts[1], false)
  assert.equal(attempts[1].model, enhancedRequest.model)
  assert.equal(attempts[1].prompt, enhancedRequest.prompt)
  assert.deepEqual(compatibleResult.request, attempts[1])

  let requiredParameterAttempts = 0
  await assert.rejects(
    invokeImageRequestWithCompatibility(enhancedRequest, async () => {
      requiredParameterAttempts += 1
      throw new Error('Unsupported parameter: model')
    }),
    /Unsupported parameter: model/,
  )
  assert.equal(requiredParameterAttempts, 1)
})

test('creative canvas data layer participates in db initialization', async () => {
  const dbIndex = await source('src/db/index.ts')
  const canvasDb = await source('src/db/creative-canvas.ts')

  assert.match(dbIndex, /initCreativeCanvasDb/)
  assert.match(dbIndex, /tauri-plugin-sql may use a[\s\S]*different pooled connection/)
  assert.doesNotMatch(dbIndex, /db\.execute\('(?:BEGIN|COMMIT|ROLLBACK)/)
  assert.match(canvasDb, /creative_canvas_projects/)
  assert.match(canvasDb, /creative_canvas_nodes/)
  assert.match(canvasDb, /creative_generation_jobs/)
  assert.match(canvasDb, /schema_version/)
  assert.match(canvasDb, /thumbnail_path/)
  assert.match(canvasDb, /settings text not null/)
  assert.match(canvasDb, /model_selection/)
  assert.match(canvasDb, /serializedWrite/)
  assert.doesNotMatch(canvasDb, /runDbTransaction/)
  assert.match(canvasDb, /deleteCreativeCanvasAssets/)
})

test('creative canvas agent tools are registered and risk-gated', async () => {
  const toolsIndex = await source('src/lib/agent/tools/index.ts')
  const tools = await source('src/lib/agent/tools/creative-canvas-tools.ts')
  const policy = await source('src/lib/agent/tool-policy.ts')
  const dynamicFilter = await source('src/lib/agent/dynamic-tool-filter.ts')

  for (const toolName of [
    'creative_canvas_get_state',
    'creative_canvas_get_selection',
    'creative_canvas_export_snapshot',
    'creative_canvas_get_tool_schema',
    'creative_canvas_apply_ops',
    'creative_canvas_create_node',
    'creative_canvas_create_text_node',
    'creative_canvas_create_text_nodes',
    'creative_canvas_create_config_node',
    'creative_canvas_create_image_prompt_flow',
    'creative_canvas_create_generation_flow',
    'creative_canvas_generate_image',
    'creative_canvas_update_node',
    'creative_canvas_update_node_text',
    'creative_canvas_move_nodes',
    'creative_canvas_resize_node',
    'creative_canvas_delete_nodes',
    'creative_canvas_connect_nodes',
    'creative_canvas_select_nodes',
    'creative_canvas_set_viewport',
    'creative_canvas_run_generation',
    'creative_canvas_insert_asset_into_note',
    'creative_canvas_recover_jobs',
    'creative_canvas_retry_generation',
    'creative_canvas_analyze_asset_cleanup',
    'creative_canvas_cleanup_assets',
    'creative_canvas_import_infinite_canvas_json',
  ]) {
    assert.match(tools, new RegExp(toolName))
    assert.match(policy, new RegExp(toolName))
    assert.match(dynamicFilter, new RegExp(toolName))
  }

  assert.match(toolsIndex, /creativeCanvasTools/)
  assert.match(tools, /creativeCanvasMcpSchemas/)
  assert.match(tools, /canvas_generate_image/)
  assert.match(tools, /canvas_create_generation_flow/)
  assert.match(policy, /READ_ONLY_TOOLS[\s\S]*creative_canvas_get_state/)
  assert.match(policy, /READ_ONLY_TOOLS[\s\S]*creative_canvas_analyze_asset_cleanup/)
  assert.match(policy, /HIGH_RISK_TOOLS[\s\S]*creative_canvas_apply_ops/)
  assert.match(policy, /HIGH_RISK_TOOLS[\s\S]*creative_canvas_cleanup_assets/)
  assert.match(policy, /MEDIUM_RISK_TOOLS[\s\S]*creative_canvas_run_generation/)
  assert.match(policy, /MEDIUM_RISK_TOOLS[\s\S]*creative_canvas_import_infinite_canvas_json/)
})

test('creative canvas generated media stays out of sqlite and asset paths are scoped', async () => {
  const generation = await source('src/lib/creative-canvas/generation.ts')
  const store = await source('src/stores/creative-canvas.ts')
  const assets = await source('src/lib/creative-canvas/assets.ts')

  assert.match(generation, /sanitizeGenerationResponseForStorage/)
  assert.match(generation, /REDACTED_BASE64_IMAGE/)
  assert.match(store, /response: sanitizeGenerationResponseForStorage\(result\.raw\)/)
  assert.match(assets, /CREATIVE_CANVAS_ASSET_ROOT = 'creative-canvas\/assets'/)
  assert.match(assets, /CREATIVE_CANVAS_THUMBNAIL_ROOT = 'creative-canvas\/thumbnails'/)
  assert.match(assets, /writeCreativeCanvasThumbnailFile/)
  assert.match(assets, /listCreativeCanvasAssetFiles/)
  assert.match(assets, /removeCreativeCanvasStoredFile/)
  assert.match(assets, /assertCreativeCanvasAssetPath/)
  assert.match(assets, /INVALID_CREATIVE_CANVAS_ASSET_PATH/)
})

test('creative canvas imports infinite-canvas json with best-effort conversion', async () => {
  const importer = await source('src/lib/creative-canvas/importer.ts')
  const store = await source('src/stores/creative-canvas.ts')
  const modal = await source('src/components/creative-canvas-modal.tsx')
  const workspace = await source('src/app/core/main/creative-canvas/creative-canvas-workspace.tsx')
  const sidebar = await source('src/app/core/main/creative-canvas/creative-canvas-sidebar-panel.tsx')

  assert.match(importer, /convertInfiniteCanvasJson/)
  assert.match(importer, /parseInfiniteCanvasJson/)
  assert.match(importer, /remoteUrl/)
  assert.match(importer, /skippedEdges/)
  assert.match(store, /importInfiniteCanvasJson/)
  assert.match(modal, /CreativeCanvasWorkspace/)
  assert.match(workspace, /handleImportCanvasJson/)
  assert.match(sidebar, /open-creative-canvas/)
})

test('creative canvas import remaps every external primary key and preserves edge endpoints', async () => {
  const { convertInfiniteCanvasJson } = await importTsModule('src/lib/creative-canvas/importer.ts')
  let sequence = 0
  const report = convertInfiniteCanvasJson({
    title: 'External canvas',
    nodes: [
      { id: 'shared-node', type: 'text', text: 'One' },
      { id: 'other-node', type: 'text', text: 'Two' },
    ],
    edges: [{ id: 'shared-edge', source: 'shared-node', target: 'other-node' }],
  }, {
    createId: prefix => `${prefix}_fresh_${++sequence}`,
    now: 123,
  })

  assert.deepEqual(report.snapshot.nodes.map(node => node.id), ['node_fresh_2', 'node_fresh_3'])
  assert.equal(report.snapshot.edges[0].id, 'edge_fresh_4')
  assert.equal(report.snapshot.edges[0].fromNodeId, report.snapshot.nodes[0].id)
  assert.equal(report.snapshot.edges[0].toNodeId, report.snapshot.nodes[1].id)
  assert.notEqual(report.snapshot.project.id, 'shared-node')
})

test('asset cleanup treats files referenced by any canvas project as known', async () => {
  const { findOrphanCreativeCanvasFiles } = await importTsModule('src/lib/creative-canvas/cleanup.ts')
  const files = [
    { path: 'creative-canvas/assets/a.png', bytes: 10 },
    { path: 'creative-canvas/assets/b.png', bytes: 20 },
    { path: 'creative-canvas/assets/orphan.png', bytes: 30 },
  ]
  const assets = [
    { filePath: 'creative-canvas/assets/a.png' },
    { filePath: 'creative-canvas/assets/b.png' },
  ]

  assert.deepEqual(findOrphanCreativeCanvasFiles(files, assets), [files[2]])
})

test('creative canvas persistence and tools preserve serialized write and read-only boundaries', async () => {
  const canvasDb = await source('src/db/creative-canvas.ts')
  const store = await source('src/stores/creative-canvas.ts')
  const tools = await source('src/lib/agent/tools/creative-canvas-tools.ts')

  assert.match(canvasDb, /replaceCreativeCanvasGraph[\s\S]*serializedWrite/)
  assert.match(canvasDb, /deleteCreativeCanvasNodes[\s\S]*serializedWrite/)
  assert.doesNotMatch(canvasDb, /runDbTransaction/)
  assert.match(tools, /async function getCanvasForRead/)
  const readHelper = tools.match(/async function getCanvasForRead\(\)[\s\S]*?\n\}/)?.[0] || ''
  assert.match(readHelper, /listCreativeCanvasProjects/)
  assert.match(readHelper, /getCreativeCanvasSnapshot/)
  assert.doesNotMatch(readHelper, /ensureReady|loadProjects|openProject/)
  assert.doesNotMatch(tools, /creative_canvas_get_state:\s*async \(\) => \{\s*const store = await ensureCanvasReady/)
  assert.match(tools, /creative_canvas_apply_ops[\s\S]*capabilities: \['write', 'delete'\]/)
  assert.match(tools, /creative_canvas_cleanup_assets[\s\S]*includeUnusedAssets[\s\S]*includeOrphanFiles/)
  const cleanupStart = store.indexOf('cleanupAssets: async (options) =>')
  const dbDelete = store.indexOf('await deleteCreativeCanvasAssets', cleanupStart)
  const fileDelete = store.indexOf('for (const filePath of filePaths)', cleanupStart)
  assert.ok(cleanupStart >= 0 && dbDelete > cleanupStart && fileDelete > dbDelete)
  assert.match(store.slice(cleanupStart, fileDelete), /remainingKnownPaths[\s\S]*listCreativeCanvasAssets/)
})

test('creative canvas projects can be deleted safely from the compact sidebar', async () => {
  const db = await source('src/db/creative-canvas.ts')
  const store = await source('src/stores/creative-canvas.ts')
  const workspace = await source('src/app/core/main/creative-canvas/creative-canvas-workspace.tsx')

  const deleteStart = db.indexOf('export async function deleteCreativeCanvasProject')
  const deleteEnd = db.indexOf('export async function getCreativeCanvasSnapshot', deleteStart)
  const deleteBlock = db.slice(deleteStart, deleteEnd)
  assert.ok(deleteStart >= 0 && deleteEnd > deleteStart)
  for (const table of [
    'creative_generation_jobs',
    'creative_canvas_edges',
    'creative_canvas_nodes',
    'creative_canvas_assets',
    'creative_canvas_projects',
  ]) {
    assert.match(deleteBlock, new RegExp(`delete from ${table}`))
  }
  assert.ok(
    deleteBlock.indexOf('creative_canvas_projects') > deleteBlock.indexOf('creative_canvas_assets'),
    'project row must be deleted after its dependent records',
  )
  assert.match(deleteBlock, /serializedWrite/)

  assert.match(store, /deleteProject: async \(projectId\) =>/)
  assert.match(store, /remainingProjects[\s\S]*openProject\(nextProject\.id\)/)
  assert.match(store, /remainingKnownPaths[\s\S]*removeCreativeCanvasStoredFile/)

  assert.match(workspace, /AlertDialog/)
  assert.match(workspace, /tCanvas\('project\.deleteConfirm'/)
  assert.match(workspace, /group\/project/)
  assert.match(workspace, /role="radiogroup"/)
})

test('creative canvas keeps the right sidebar focused on user-facing node details', async () => {
  const workspace = await source('src/app/core/main/creative-canvas/creative-canvas-workspace.tsx')

  assert.doesNotMatch(workspace, /tCanvas\('assistant\.title'/)
  assert.doesNotMatch(workspace, /assistantDraft|assistantBusy|latestAssistantMessage|handleAssistantSubmit/)
  assert.doesNotMatch(workspace, /CircleHelp|<Command|<Send/)
  assert.match(workspace, /tCanvas\('inspector\.title'\)/)
  assert.match(workspace, /pr-12/)
  assert.doesNotMatch(workspace, /selectedNode \? selectedNode\.id/)
  assert.doesNotMatch(workspace, /String\(selectedNode\.metadata\.jobId\)/)
  assert.match(workspace, /connectedNodeTitle/)
  assert.match(workspace, /nodeById\.get\(connectedNodeId\)\?\.title/)
  assert.doesNotMatch(workspace, /inspector\.output' : 'inspector\.input'\)} · \{edge\.id\}/)
  assert.match(workspace, /aria-hidden="true" className="h-5 w-px shrink-0 bg-border"/)
})

test('full creative canvas renders graph interactions with committed drag boundaries', async () => {
  const modal = await source('src/components/creative-canvas-modal.tsx')
  const workspace = await source('src/app/core/main/creative-canvas/creative-canvas-workspace.tsx')
  const store = await source('src/stores/creative-canvas.ts')

  assert.match(modal, /CreativeCanvasWorkspace/)
  assert.match(workspace, /displayNodes\.map\(node =>/)
  assert.match(workspace, /setDraftNodeRects/)
  assert.match(workspace, /void moveNodes\(positions\)/)
  assert.doesNotMatch(workspace, /handlePointerMove[\s\S]{0,1800}void moveNode/)
  assert.match(store, /moveNodes: async/)
  assert.match(store, /duplicateNodes: async/)
  assert.match(workspace, /setPromptDraft\(initialPrompt\?\.trim\(\) \|\| ''\)/)
  assert.match(workspace, /generationStatus === 'cancelled'/)
  assert.match(workspace, /handleCancelJob/)
  assert.match(workspace, /importedNodeIds[\s\S]{0,320}fitNodesInViewport/)
  assert.match(workspace, /aria-hidden="true" className="h-5 w-px shrink-0 bg-border"/)
  assert.match(workspace, /max-w-56 break-words whitespace-normal text-sm leading-relaxed/)
})

test('creative canvas caps multi-reference edits and preserves multipart array semantics', async () => {
  const store = await source('src/stores/creative-canvas.ts')
  const generation = await source('src/lib/creative-canvas/generation.ts')
  const rustTransport = await source('src-tauri/src/ai.rs')

  const referenceStart = store.indexOf('const referenceAssets = upstreamNodes')
  const referenceEnd = store.indexOf('const generationType = getGenerationType(referenceAssets)', referenceStart)
  const referenceBlock = store.slice(referenceStart, referenceEnd)
  assert.ok(referenceStart >= 0 && referenceEnd > referenceStart)
  assert.match(referenceBlock, /\.filter\(\(asset\): asset is CreativeCanvasAsset => Boolean\(asset\)\)\s*\.slice\(0, 16\)\s*$/)
  assert.match(store, /generationType === 'edit' && referenceAssets\.length\s*\? await editImage\(\{ prompt, referenceAssets, options, signal: controller\.signal \}\)/)

  const editStart = generation.indexOf('export async function editImage')
  const editEnd = generation.indexOf('export async function assetToDataUrl', editStart)
  const editBlock = generation.slice(editStart, editEnd)
  assert.ok(editStart >= 0 && editEnd > editStart)
  assert.match(editBlock, /Promise\.all\(params\.referenceAssets\.map/)
  assert.match(editBlock, /fileFieldName: files\.length === 1 \? 'image' : 'image\[\]'/)
  assert.match(editBlock, /fileFieldName:[\s\S]*files,\s*\}\s*, params\.signal\)/)

  const multipartStart = rustTransport.indexOf('pub async fn ai_multipart_request')
  const multipartBlock = rustTransport.slice(multipartStart)
  assert.match(multipartBlock, /for file in files \{[\s\S]*form = form\.part\(request\.file_field_name\.clone\(\), part\)/)
})

test('creative canvas waits for agent generation and conditionally commits final results', async () => {
  const store = await source('src/stores/creative-canvas.ts')
  const db = await source('src/db/creative-canvas.ts')
  const tools = await source('src/lib/agent/tools/creative-canvas-tools.ts')

  assert.match(store, /if \(options\?\.autoRun && get\(\)\.project\?\.id === state\.project\.id\) \{\s*await get\(\)\.runGenerationForNode\(configNode\.id\)/)
  assert.match(store, /commitCreativeCanvasGenerationResult\(\{[\s\S]*sourceNode:[\s\S]*resultNodes,[\s\S]*resultEdges,[\s\S]*job: completedJob/)
  assert.match(store, /sourceNode\.metadata\.jobId !== jobId[\s\S]*sourceNode\.metadata\.status !== 'running'[\s\S]*latestJob\?\.status !== 'running'/)
  assert.match(store, /status: 'cancelled'[\s\S]*await upsertCreativeCanvasJob\(cancelledJob\)/)
  assert.match(store, /current\.project\?\.id === projectId[\s\S]*recovered\.snapshot\.nodes/)

  assert.match(db, /export async function commitCreativeCanvasGenerationResult/)
  assert.match(db, /json_extract\(n\.metadata, '\$\.jobId'\) = \$3[\s\S]*json_extract\(n\.metadata, '\$\.status'\) = 'running'/)
  assert.match(db, /creative_generation_jobs j[\s\S]*j\.id = \$3 and j\.status = 'running'/)
  assert.doesNotMatch(db, /runDbTransaction/)

  const flowStart = tools.indexOf('async function createGenerationFlow')
  const handlersStart = tools.indexOf('const handlers:', flowStart)
  const flowBlock = tools.slice(flowStart, handlersStart)
  const createIndex = flowBlock.indexOf('autoRun: false')
  const connectIndex = flowBlock.indexOf('await store.connectNodes', createIndex)
  const runIndex = flowBlock.indexOf('await useCreativeCanvasStore.getState().runGenerationForNode', connectIndex)
  assert.ok(createIndex >= 0 && connectIndex > createIndex && runIndex > connectIndex)
  assert.match(flowBlock, /generationToolResult\(result\.configNode\.id, status/)
  assert.match(tools, /creative_canvas_run_generation:[\s\S]*return generationToolResult\(nodeId, status/)
  assert.match(tools, /creative_canvas_retry_generation:[\s\S]*return generationToolResult\(job\?\.nodeId \|\| '', status/)
})

test('creative canvas UI translations have five-locale key parity and no new hardcoded labels', async () => {
  const locales = await Promise.all(['en', 'ja', 'pt-BR', 'zh-TW', 'zh'].map(async locale =>
    JSON.parse(await source(`messages/${locale}.json`)).creativeCanvas,
  ))
  const flattenKeys = (value, prefix = '') => Object.entries(value || {}).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return nested && typeof nested === 'object' ? flattenKeys(nested, path) : [path]
  }).sort()
  const expected = flattenKeys(locales[0])
  assert.ok(expected.length > 100)
  for (const locale of locales.slice(1)) assert.deepEqual(flattenKeys(locale), expected)

  const modal = await source('src/components/creative-canvas-modal.tsx')
  const workspace = await source('src/app/core/main/creative-canvas/creative-canvas-workspace.tsx')
  const sidebar = await source('src/app/core/main/left-sidebar.tsx')
  const bubbleMenu = await source('src/app/core/main/editor/markdown/bubble-menu.tsx')
  const editor = await source('src/app/core/main/editor/markdown/tiptap-editor.tsx')
  assert.match(modal, /useTranslations\('creativeCanvas'\)/)
  assert.doesNotMatch(modal, />\s*(创意画布|参考图|画布助手|维护|作品|任务|恢复|清理|重试|取消)\s*</)
  const workspaceWithoutIntentMatchers = workspace.replace(/\/[^\n/]*[\p{Script=Han}][^\n/]*\/[gimuy]*/gu, '')
  assert.doesNotMatch(workspaceWithoutIntentMatchers, /无图片素材|画布图片|放到画布|插入笔记|提示词|预留节点类型|小地图|参考图|运行生成|删除连线|选择节点后/)
  for (const [, key] of workspace.matchAll(/tCanvas\('([^']+)'/g)) {
    assert.ok(key.split('.').reduce((value, segment) => value?.[segment], locales[0]), `Missing creativeCanvas key: ${key}`)
  }
  assert.ok(locales[0].jobs.idle)
  assert.ok(locales[0].jobs.queued)
  assert.match(sidebar, /t\('creativeCanvas\.title'\)/)
  assert.match(bubbleMenu, /tRoot\('creativeCanvas\.sendSelection'\)/)
  assert.match(editor, /tRoot\('creativeCanvas\./)
})
