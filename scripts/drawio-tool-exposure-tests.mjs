import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = await mkdtemp(join(tmpdir(), 'lingmo-drawio-tool-exposure-tests-'))
const compiledModules = new Set()

const moduleMocks = {
  '@/lib/agent/workflow-templates': `
    export function formatWorkflowTemplatesForPrompt() { return '' }
    export async function findRelevantWorkflowTemplates() { return [] }
  `,
  '@/lib/agent/runtime-snapshot': `
    export function buildAgentRuntimeSnapshot(input) { return input }
    export function buildSkillRuntimeSnapshot(input) { return input }
    export function buildToolExposureSnapshot(input) {
      const visible = input.tools
        .filter(tool => input.visibleToolNames.includes(tool.name))
        .map(tool => ({ name: tool.name, reason: input.exposureReasons?.[tool.name]?.join('; ') || '' }))
      const blocked = input.tools
        .filter(tool => !input.visibleToolNames.includes(tool.name))
        .map(tool => ({ name: tool.name, reason: input.exposureReasons?.[tool.name]?.join('; ') || '' }))
      return { visible, blocked, maxVisibleTools: input.maxVisibleTools }
    }
    export function createRuntimeWarning(input) { return input }
  `,
  '@/lib/skills': `
    export const skillManager = {
      findSkill() { return null },
      async matchRelevantSkillScores() { return [] },
      toMatchSummary(score) { return score },
    }
  `,
  '@/stores/skills': `
    export const useSkillsStore = {
      getState() {
        return {
          enabled: false,
          autoMatch: false,
          async getEnabledSkills() { return [] },
        }
      }
    }
  `,
  '@/lib/skills/agent-ready': `
    export async function ensureSkillsReadyForAgent() {}
  `,
  '@/stores/mcp': `
    export const useMcpStore = {
      getState() {
        return {
          selectedServerIds: [],
          servers: [],
          async initMcpData() {},
          getServerState() { return undefined },
        }
      }
    }
  `,
  '@/lib/mcp/integration': `
    export const mcpIntegration = { async initialize() {} }
  `,
  '@/lib/mcp/server-manager': `
    export const mcpServerManager = {
      getToolGeneration() { return 0 },
      getAllTools() { return new Map() },
    }
  `,
  '@/lib/agent/tools': `
    export async function reloadMcpTools() {}
    export function getAllToolsSync() { return [] }
  `,
  '@/lib/agent/self-evolution': `
    export async function runPostSessionSelfEvolution() {}
  `,
}

function toMjsRelativePath(relativePath) {
  return relativePath.replace(/\.tsx?$/, '.mjs')
}

function mockRelativePath(specifier) {
  return `__mocks__/${specifier.replace(/^@\//, '').replace(/[^A-Za-z0-9_-]+/g, '_')}.mjs`
}

function resolveRelativeDependency(currentRelativePath, specifier) {
  const currentDir = dirname(join(repoRoot, currentRelativePath))
  const basePath = resolve(currentDir, specifier)
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
  ]

  const dependencyPath = candidates.find(candidate => existsSync(candidate))
  if (!dependencyPath) return null

  return resolve(dependencyPath)
    .replace(resolve(repoRoot), '')
    .replace(/^[/\\]/, '')
}

function rewriteSpecifier(currentRelativePath, dependencyRelativePath) {
  const currentOutDir = dirname(toMjsRelativePath(currentRelativePath))
  const dependencyOutPath = toMjsRelativePath(dependencyRelativePath)
  const currentParts = currentOutDir.split(/[\\/]/).filter(Boolean)
  const dependencyParts = dependencyOutPath.split(/[\\/]/).filter(Boolean)
  while (currentParts.length && dependencyParts.length && currentParts[0] === dependencyParts[0]) {
    currentParts.shift()
    dependencyParts.shift()
  }
  let relativeSpecifier = [...currentParts.map(() => '..'), ...dependencyParts].join('/')
  if (!relativeSpecifier.startsWith('.')) relativeSpecifier = `./${relativeSpecifier}`
  return relativeSpecifier
}

async function ensureMockModule(specifier) {
  const relativePath = mockRelativePath(specifier)
  const outPath = join(tempDir, relativePath)
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, moduleMocks[specifier], 'utf8')
  return relativePath
}

async function rewriteImports(output, relativePath) {
  const dependencies = new Set()
  const rewrite = (match, prefix, specifier, suffix) => {
    if (moduleMocks[specifier]) {
      const mockPath = mockRelativePath(specifier)
      dependencies.add({ mock: specifier })
      return `${prefix}${rewriteSpecifier(relativePath, mockPath)}${suffix}`
    }

    if (!specifier.startsWith('.')) return match

    const dependencyRelativePath = resolveRelativeDependency(relativePath, specifier)
    if (!dependencyRelativePath) return match
    dependencies.add({ path: dependencyRelativePath })
    return `${prefix}${rewriteSpecifier(relativePath, dependencyRelativePath)}${suffix}`
  }

  let rewritten = output.replace(/(from\s+['"])([^'"]+)(['"])/g, rewrite)
  rewritten = rewritten.replace(/(import\s*\(\s*['"])([^'"]+)(['"]\s*\))/g, rewrite)

  for (const dependency of dependencies) {
    if (dependency.mock) {
      await ensureMockModule(dependency.mock)
    } else if (dependency.path) {
      await compileTsModule(dependency.path)
    }
  }

  return rewritten
}

async function compileTsModule(relativePath) {
  if (compiledModules.has(relativePath)) return
  compiledModules.add(relativePath)

  const sourcePath = join(repoRoot, relativePath)
  const source = await readFile(sourcePath, 'utf8')
  const output = await rewriteImports(ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: sourcePath,
  }).outputText, relativePath)

  const outPath = join(tempDir, toMjsRelativePath(relativePath))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, output, 'utf8')
}

async function importTsModule(relativePath) {
  await compileTsModule(relativePath)
  return import(pathToFileURL(join(tempDir, toMjsRelativePath(relativePath))).href)
}

function makeTool(name, description = name, category = 'note') {
  return {
    name,
    description,
    category,
    risk: 'low',
    capabilities: name.startsWith('export_') || name.startsWith('create_') || name.startsWith('edit_') || name.startsWith('append_')
      ? ['write']
      : ['read'],
    parameters: [],
    requiresConfirmation: name.startsWith('export_') || name.startsWith('create_') || name.startsWith('edit_') || name.startsWith('append_'),
    execute: async () => ({ success: true }),
  }
}

try {
  const { AgentMiddlewareRuntime, createSkillMcpMiddleware } = await importTsModule('src/lib/agent-harness/middleware.ts')

  test('draw.io requests expose validation and export tools in harness model scope', async () => {
    const runtime = new AgentMiddlewareRuntime([createSkillMcpMiddleware()])
    const tools = [
      ...[
        'tool_search',
        'select_skill',
        'load_skill_content',
        'get_current_time',
        'list_agent_run_summaries',
        'get_editor_content',
        'replace_editor_content',
        'read_markdown_file',
        'read_markdown_files_batch',
        'safe_grep',
        'safe_read_file',
        'safe_list_files',
        'create_file',
        'create_reminder',
        'list_reminders',
      ].map(name => makeTool(name)),
      ...Array.from({ length: 60 }, (_, index) => makeTool(`filler_tool_${index}`, `highly relevant filler diagram export svg png tool ${index}`)),
      makeTool('read_diagram_file', 'Read a draw.io diagram'),
      makeTool('validate_drawio_diagram', 'Validate draw.io XML structure'),
      makeTool('export_drawio_diagram', 'Export draw.io SVG or PNG'),
    ]

    await runtime.beforeRun({
      runId: 'run-drawio-tool-exposure',
      userInput: '先校验当前 draw.io 图表，再导出 SVG 预览',
      forcedSkillIds: [],
    })

    const result = await runtime.beforeModel({
      runId: 'run-drawio-tool-exposure',
      iteration: 1,
      userInput: '先校验当前 draw.io 图表，再导出 SVG 预览',
      tools,
      steps: [],
      selectedSkillIds: [],
      activeSkillIds: [],
      intentPolicy: { allowWrite: true, allowExecute: false, allowDestructive: false },
      webSearchEnabled: false,
    })

    const visibleNames = result.tools.map(tool => tool.name)
    assert.equal(visibleNames.includes('validate_drawio_diagram'), true)
    assert.equal(visibleNames.includes('export_drawio_diagram'), true)
  })
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
