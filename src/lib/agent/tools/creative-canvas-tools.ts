import { Tool, type ToolParameter, type ToolResult } from '../types'
import { getCreativeCanvasSnapshot, listCreativeCanvasProjects } from '@/db/creative-canvas'
import useCreativeCanvasStore, { analyzeCreativeCanvasAssetCleanup, type CreativeCanvasOp } from '@/stores/creative-canvas'
import type { CreativeCanvasGenerationMode, CreativeCanvasJobStatus, CreativeCanvasNodeType } from '@/types/creative-canvas'

type ToolHandler = (params: Record<string, any>) => Promise<ToolResult>

interface CreativeCanvasToolSchema {
  name: string
  description: string
  risk: NonNullable<Tool['risk']>
  capabilities: NonNullable<Tool['capabilities']>
  parameters: ToolParameter[]
  inputSchema: Record<string, unknown>
}

const NODE_TYPES: CreativeCanvasNodeType[] = ['text', 'image', 'config', 'video', 'audio']
const GENERATION_MODES: CreativeCanvasGenerationMode[] = ['text', 'image', 'video', 'audio']

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function ensureCanvasReady() {
  const store = useCreativeCanvasStore.getState()
  await store.ensureReady()
  return useCreativeCanvasStore.getState()
}

async function getCanvasForRead() {
  const state = useCreativeCanvasStore.getState()
  const projects = await listCreativeCanvasProjects()
  const project = projects.find(item => item.id === state.activeProjectId) || projects[0]
  if (!project) return { snapshot: null, selectedNodeIds: [] as string[] }
  const snapshot = await getCreativeCanvasSnapshot(project.id)
  return {
    snapshot,
    selectedNodeIds: state.activeProjectId === project.id ? state.selectedNodeIds : [],
  }
}

function stringParam(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberParam(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function boolParam(value: unknown) {
  return value === true
}

function generationToolResult(nodeId: string, status: CreativeCanvasJobStatus | undefined, successMessage: string): ToolResult {
  const state = useCreativeCanvasStore.getState()
  const node = state.nodes.find(item => item.id === nodeId)
  const jobId = typeof node?.metadata.jobId === 'string' ? node.metadata.jobId : undefined
  const job = jobId ? state.jobs.find(item => item.id === jobId) : undefined
  const effectiveStatus = status || job?.status
  const data = {
    projectId: job?.projectId || state.project?.id,
    nodeId,
    jobId,
    status: effectiveStatus,
    assetIds: job?.assetIds || [],
  }
  if (effectiveStatus !== 'succeeded') {
    return {
      success: false,
      data,
      error: job?.error || (typeof node?.metadata.error === 'string' ? node.metadata.error : undefined) || '生成任务未成功完成。',
    }
  }
  return { success: true, data, message: successMessage }
}

function stringArrayParam(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => stringParam(item)).filter(Boolean)
    : []
}

function normalizeNodeType(value: unknown): CreativeCanvasNodeType {
  const type = stringParam(value).toLowerCase()
  return NODE_TYPES.includes(type as CreativeCanvasNodeType) ? type as CreativeCanvasNodeType : 'text'
}

function normalizeGenerationMode(value: unknown): CreativeCanvasGenerationMode {
  const mode = stringParam(value).toLowerCase()
  return GENERATION_MODES.includes(mode as CreativeCanvasGenerationMode) ? mode as CreativeCanvasGenerationMode : 'image'
}

function createJsonSchema(properties: Record<string, Record<string, unknown>>, required: string[] = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: true,
  }
}

function paramsToSchema(parameters: ToolParameter[]) {
  const properties = Object.fromEntries(parameters.map(parameter => [
    parameter.name,
    {
      type: parameter.type === 'number' ? 'number' : parameter.type,
      description: parameter.description,
    },
  ]))
  return createJsonSchema(properties, parameters.filter(parameter => parameter.required).map(parameter => parameter.name))
}

function p(name: string, type: ToolParameter['type'], description: string, required = false): ToolParameter {
  return { name, type, description, required }
}

const noParams: ToolParameter[] = []
const generationParams = [
  p('prompt', 'string', '生成提示词。', true),
  p('title', 'string', '可选节点标题。'),
  p('x', 'number', '流程起点 X 坐标。'),
  p('y', 'number', '流程起点 Y 坐标。'),
  p('referenceNodeIds', 'array', '可选参考节点 ID 数组，会连到配置节点。'),
  p('modelSelection', 'string', '可选已配置图片模型选择 ID，例如 provider:modelId。'),
  p('model', 'string', '兼容旧调用的原始模型名覆盖。'),
  p('size', 'string', '图片尺寸，例如 1024x1024。'),
  p('quality', 'string', '图片质量，例如 standard、hd、high。'),
  p('count', 'number', '生成数量，1 到 4。'),
]

const nativeSchemas: CreativeCanvasToolSchema[] = [
  {
    name: 'creative_canvas_get_state',
    description: '读取 LingMo 无限画布当前项目、节点、连线、素材、选区、视口和最近生成任务。',
    risk: 'low',
    capabilities: ['read'],
    parameters: noParams,
    inputSchema: paramsToSchema(noParams),
  },
  {
    name: 'creative_canvas_get_selection',
    description: '读取当前选中的画布节点以及与选中图片节点关联的素材。',
    risk: 'low',
    capabilities: ['read'],
    parameters: noParams,
    inputSchema: paramsToSchema(noParams),
  },
  {
    name: 'creative_canvas_export_snapshot',
    description: '导出当前画布快照，用于理解布局、任务和素材状态。',
    risk: 'low',
    capabilities: ['read'],
    parameters: noParams,
    inputSchema: paramsToSchema(noParams),
  },
  {
    name: 'creative_canvas_get_tool_schema',
    description: '读取 LingMo 无限画布 Agent/MCP 工具 schema，便于外部 MCP schema 对齐。',
    risk: 'low',
    capabilities: ['read'],
    parameters: noParams,
    inputSchema: paramsToSchema(noParams),
  },
  {
    name: 'creative_canvas_apply_ops',
    description: '批量操作画布节点、连线、选区和视口。delete_node、delete_connections、delete_edge 会永久删除数据，因此工具始终声明 delete 能力并按高风险确认。',
    risk: 'high',
    capabilities: ['write', 'delete'],
    parameters: [p('ops', 'array', '画布操作数组。', true)],
    inputSchema: createJsonSchema({
      ops: {
        type: 'array',
        description: 'Canvas operations. Delete operation types are destructive.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['add_node', 'update_node', 'delete_node', 'delete_connections', 'connect_nodes', 'delete_edge', 'select_nodes', 'set_viewport', 'run_generation'],
            },
          },
          required: ['type'],
        },
      },
    }, ['ops']),
  },
  {
    name: 'creative_canvas_create_node',
    description: '创建任意类型节点：text、image、config、video、audio。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [
      p('nodeType', 'string', '节点类型。', true),
      p('title', 'string', '节点标题。'),
      p('x', 'number', 'X 坐标。'),
      p('y', 'number', 'Y 坐标。'),
      p('width', 'number', '节点宽度。'),
      p('height', 'number', '节点高度。'),
      p('metadata', 'object', '节点 metadata。'),
    ],
    inputSchema: paramsToSchema([
      p('nodeType', 'string', 'Node type.', true),
      p('title', 'string', 'Node title.'),
      p('x', 'number', 'X.'),
      p('y', 'number', 'Y.'),
      p('width', 'number', 'Width.'),
      p('height', 'number', 'Height.'),
      p('metadata', 'object', 'Metadata.'),
    ]),
  },
  {
    name: 'creative_canvas_create_text_node',
    description: '创建单个文本/提示词节点。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [
      p('text', 'string', '文本内容或提示词。'),
      p('title', 'string', '节点标题。'),
      p('x', 'number', 'X 坐标。'),
      p('y', 'number', 'Y 坐标。'),
      p('width', 'number', '节点宽度。'),
      p('height', 'number', '节点高度。'),
    ],
    inputSchema: paramsToSchema([
      p('text', 'string', 'Text content.'),
      p('title', 'string', 'Title.'),
      p('x', 'number', 'X.'),
      p('y', 'number', 'Y.'),
      p('width', 'number', 'Width.'),
      p('height', 'number', 'Height.'),
    ]),
  },
  {
    name: 'creative_canvas_create_text_nodes',
    description: '批量创建文本节点，支持横向或纵向排列。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [
      p('items', 'array', '文本节点数组，每项可包含 text、title、x、y、width、height。', true),
      p('x', 'number', '默认起点 X。'),
      p('y', 'number', '默认起点 Y。'),
      p('gap', 'number', '节点间距。'),
      p('direction', 'string', 'row 或 column。'),
    ],
    inputSchema: createJsonSchema({
      items: { type: 'array', description: 'Text node items.' },
      x: { type: 'number' },
      y: { type: 'number' },
      gap: { type: 'number' },
      direction: { type: 'string', enum: ['row', 'column'] },
    }, ['items']),
  },
  {
    name: 'creative_canvas_create_config_node',
    description: '创建生成配置节点，可选择图片/视频/音频/文本模式。v1 仅运行图片模式。',
    risk: 'medium',
    capabilities: ['write', 'network'],
    parameters: [
      p('prompt', 'string', '生成提示词。'),
      p('mode', 'string', '生成模式：image、video、audio、text。'),
      p('title', 'string', '节点标题。'),
      p('x', 'number', 'X 坐标。'),
      p('y', 'number', 'Y 坐标。'),
      p('width', 'number', '节点宽度。'),
      p('height', 'number', '节点高度。'),
      p('modelSelection', 'string', '已配置模型选择 ID。'),
      p('model', 'string', '兼容旧调用的原始模型名。'),
      p('size', 'string', '图片尺寸。'),
      p('quality', 'string', '质量。'),
      p('count', 'number', '生成数量。'),
      p('autoRun', 'boolean', '创建后是否立即运行。'),
    ],
    inputSchema: paramsToSchema([
      p('prompt', 'string', 'Prompt.'),
      p('mode', 'string', 'Generation mode.'),
      p('title', 'string', 'Title.'),
      p('x', 'number', 'X.'),
      p('y', 'number', 'Y.'),
      p('width', 'number', 'Width.'),
      p('height', 'number', 'Height.'),
      p('modelSelection', 'string', 'Configured model selection ID.'),
      p('model', 'string', 'Legacy raw model override.'),
      p('size', 'string', 'Size.'),
      p('quality', 'string', 'Quality.'),
      p('count', 'number', 'Count.'),
      p('autoRun', 'boolean', 'Auto run.'),
    ]),
  },
  {
    name: 'creative_canvas_create_image_prompt_flow',
    description: '创建提示词文本节点和图片生成配置节点，并自动连线，可选择立即运行。',
    risk: 'medium',
    capabilities: ['write', 'network'],
    parameters: [...generationParams, p('autoRun', 'boolean', '创建后是否立即运行。')],
    inputSchema: paramsToSchema([...generationParams, p('autoRun', 'boolean', 'Auto run.')]),
  },
  {
    name: 'creative_canvas_create_generation_flow',
    description: '创建通用生成流程。v1 运行 image；video/audio/text 会创建预留配置节点。',
    risk: 'medium',
    capabilities: ['write', 'network'],
    parameters: [...generationParams, p('mode', 'string', '生成模式。'), p('autoRun', 'boolean', '创建后是否立即运行。')],
    inputSchema: paramsToSchema([...generationParams, p('mode', 'string', 'Mode.'), p('autoRun', 'boolean', 'Auto run.')]),
  },
  {
    name: 'creative_canvas_generate_image',
    description: '创建图片生成流程并立即运行。',
    risk: 'medium',
    capabilities: ['write', 'network'],
    parameters: generationParams,
    inputSchema: paramsToSchema(generationParams),
  },
  {
    name: 'creative_canvas_generate_video',
    description: '创建视频生成预留流程。v1 不会调用视频生成 adapter。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: generationParams,
    inputSchema: paramsToSchema(generationParams),
  },
  {
    name: 'creative_canvas_generate_audio',
    description: '创建音频生成预留流程。v1 不会调用音频生成 adapter。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: generationParams,
    inputSchema: paramsToSchema(generationParams),
  },
  {
    name: 'creative_canvas_generate_text',
    description: '创建文本生成预留流程。v1 不会调用文本生成 adapter。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: generationParams,
    inputSchema: paramsToSchema(generationParams),
  },
  {
    name: 'creative_canvas_update_node',
    description: '更新节点基础字段或 metadata。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [p('id', 'string', '节点 ID。', true), p('patch', 'object', '基础字段补丁。'), p('metadata', 'object', 'metadata 补丁。')],
    inputSchema: paramsToSchema([p('id', 'string', 'Node id.', true), p('patch', 'object', 'Patch.'), p('metadata', 'object', 'Metadata.')]),
  },
  {
    name: 'creative_canvas_update_node_text',
    description: '更新文本节点内容和标题。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [p('id', 'string', '节点 ID。', true), p('text', 'string', '新文本。', true), p('title', 'string', '可选标题。')],
    inputSchema: paramsToSchema([p('id', 'string', 'Node id.', true), p('text', 'string', 'Text.', true), p('title', 'string', 'Title.')]),
  },
  {
    name: 'creative_canvas_move_nodes',
    description: '移动一个或多个节点，支持绝对坐标或 dx/dy 偏移。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [p('items', 'array', '移动项数组：id、x、y、dx、dy。', true)],
    inputSchema: createJsonSchema({ items: { type: 'array', description: 'Move items.' } }, ['items']),
  },
  {
    name: 'creative_canvas_resize_node',
    description: '调整节点尺寸。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [p('id', 'string', '节点 ID。', true), p('width', 'number', '宽度。', true), p('height', 'number', '高度。', true)],
    inputSchema: paramsToSchema([p('id', 'string', 'Node id.', true), p('width', 'number', 'Width.', true), p('height', 'number', 'Height.', true)]),
  },
  {
    name: 'creative_canvas_delete_nodes',
    description: '删除指定节点及相关连线。',
    risk: 'high',
    capabilities: ['write', 'delete'],
    parameters: [p('ids', 'array', '节点 ID 数组。', true)],
    inputSchema: createJsonSchema({ ids: { type: 'array', description: 'Node ids.' } }, ['ids']),
  },
  {
    name: 'creative_canvas_connect_nodes',
    description: '批量连接节点。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [p('connections', 'array', '连线数组：fromNodeId、toNodeId。', true)],
    inputSchema: createJsonSchema({ connections: { type: 'array', description: 'Connections.' } }, ['connections']),
  },
  {
    name: 'creative_canvas_select_nodes',
    description: '设置当前画布选区。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [p('ids', 'array', '节点 ID 数组。', true)],
    inputSchema: createJsonSchema({ ids: { type: 'array', description: 'Node ids.' } }, ['ids']),
  },
  {
    name: 'creative_canvas_set_viewport',
    description: '设置画布视口。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [p('viewport', 'object', '视口对象：x、y、k。', true)],
    inputSchema: createJsonSchema({ viewport: { type: 'object', description: 'Viewport x/y/k.' } }, ['viewport']),
  },
  {
    name: 'creative_canvas_run_generation',
    description: '运行指定节点的图片生成。节点可从上游文本读取提示词，并可从上游图片读取参考图。',
    risk: 'medium',
    capabilities: ['write', 'network'],
    parameters: [p('nodeId', 'string', '要运行的节点 ID。', true), p('prompt', 'string', '可选覆盖提示词。'), p('mode', 'string', '可选模式；v1 仅支持 image。')],
    inputSchema: paramsToSchema([p('nodeId', 'string', 'Node id.', true), p('prompt', 'string', 'Prompt.'), p('mode', 'string', 'Mode.')]),
  },
  {
    name: 'creative_canvas_insert_asset_into_note',
    description: '把画布素材复制到工作区 outputs/creative-canvas，并插入当前 Markdown 笔记。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [p('assetId', 'string', '要插入的素材 ID。', true)],
    inputSchema: paramsToSchema([p('assetId', 'string', 'Asset id.', true)]),
  },
  {
    name: 'creative_canvas_recover_jobs',
    description: '恢复生成任务状态，把上次会话中断的 queued/running 任务标记为 stale。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: noParams,
    inputSchema: paramsToSchema(noParams),
  },
  {
    name: 'creative_canvas_retry_generation',
    description: '重试一个 failed/stale 生成任务。',
    risk: 'medium',
    capabilities: ['write', 'network'],
    parameters: [p('jobId', 'string', '任务 ID。', true)],
    inputSchema: paramsToSchema([p('jobId', 'string', 'Job id.', true)]),
  },
  {
    name: 'creative_canvas_analyze_asset_cleanup',
    description: '分析未引用素材、孤立文件、缺失引用和可释放空间，不执行删除。',
    risk: 'low',
    capabilities: ['read'],
    parameters: noParams,
    inputSchema: paramsToSchema(noParams),
  },
  {
    name: 'creative_canvas_cleanup_assets',
    description: '删除未引用素材和孤立的画布文件。高风险，需要确认。',
    risk: 'high',
    capabilities: ['write', 'delete'],
    parameters: [
      p('includeUnusedAssets', 'boolean', '是否删除未引用素材，默认 true。'),
      p('includeOrphanFiles', 'boolean', '是否删除孤立文件，默认 true。'),
    ],
    inputSchema: paramsToSchema([
      p('includeUnusedAssets', 'boolean', 'Include unused assets.'),
      p('includeOrphanFiles', 'boolean', 'Include orphan files.'),
    ]),
  },
  {
    name: 'creative_canvas_import_infinite_canvas_json',
    description: '导入 basketikun/infinite-canvas 风格 JSON，best-effort 转换为 LingMo 无限画布新项目。',
    risk: 'medium',
    capabilities: ['write'],
    parameters: [p('json', 'string', 'JSON 字符串。', true), p('title', 'string', '导入后的项目标题。')],
    inputSchema: paramsToSchema([p('json', 'string', 'JSON string.', true), p('title', 'string', 'Project title.')]),
  },
]

const aliasPairs: Array<[string, string]> = [
  ['canvas_get_state', 'creative_canvas_get_state'],
  ['canvas_get_selection', 'creative_canvas_get_selection'],
  ['canvas_export_snapshot', 'creative_canvas_export_snapshot'],
  ['canvas_apply_ops', 'creative_canvas_apply_ops'],
  ['canvas_create_node', 'creative_canvas_create_node'],
  ['canvas_create_text_node', 'creative_canvas_create_text_node'],
  ['canvas_create_text_nodes', 'creative_canvas_create_text_nodes'],
  ['canvas_create_config_node', 'creative_canvas_create_config_node'],
  ['canvas_create_image_prompt_flow', 'creative_canvas_create_image_prompt_flow'],
  ['canvas_create_generation_flow', 'creative_canvas_create_generation_flow'],
  ['canvas_generate_text', 'creative_canvas_generate_text'],
  ['canvas_generate_image', 'creative_canvas_generate_image'],
  ['canvas_generate_video', 'creative_canvas_generate_video'],
  ['canvas_generate_audio', 'creative_canvas_generate_audio'],
  ['canvas_update_node', 'creative_canvas_update_node'],
  ['canvas_update_node_text', 'creative_canvas_update_node_text'],
  ['canvas_move_nodes', 'creative_canvas_move_nodes'],
  ['canvas_resize_node', 'creative_canvas_resize_node'],
  ['canvas_delete_nodes', 'creative_canvas_delete_nodes'],
  ['canvas_connect_nodes', 'creative_canvas_connect_nodes'],
  ['canvas_select_nodes', 'creative_canvas_select_nodes'],
  ['canvas_set_viewport', 'creative_canvas_set_viewport'],
  ['canvas_run_generation', 'creative_canvas_run_generation'],
]

export const creativeCanvasMcpSchemas = [
  ...nativeSchemas.map(schema => ({
    name: schema.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
    risk: schema.risk,
    capabilities: schema.capabilities,
  })),
  ...aliasPairs.map(([aliasName, nativeName]) => {
    const native = nativeSchemas.find(schema => schema.name === nativeName)
    return {
      name: aliasName,
      description: native?.description || aliasName,
      inputSchema: native?.inputSchema || paramsToSchema(noParams),
      risk: native?.risk || 'medium',
      capabilities: native?.capabilities || ['write'],
      nativeName,
    }
  }),
]

async function createGenerationFlow(params: Record<string, any>, modeOverride?: CreativeCanvasGenerationMode, autoRunOverride?: boolean) {
  const prompt = stringParam(params.prompt)
  if (!prompt) return { success: false, error: 'prompt is required.' }
  const mode = modeOverride || normalizeGenerationMode(params.mode)
  const store = await ensureCanvasReady()

  if (mode !== 'image') {
    const x = numberParam(params.x) ?? 140
    const y = numberParam(params.y) ?? 140
    const textNode = await store.addNode({
      type: 'text',
      title: stringParam(params.title) || '提示词',
      x,
      y,
      width: 320,
      height: 180,
      metadata: { content: prompt, prompt, provenance: { source: 'agent', createdAt: Date.now() } },
    })
    const configNode = await store.addNode({
      type: 'config',
      title: stringParam(params.title) || `${mode} 生成配置`,
      x: x + 380,
      y,
      width: 320,
      height: 220,
      metadata: {
        prompt,
        status: 'idle',
        generationMode: mode,
        generationType: 'generation',
        modelSelection: stringParam(params.modelSelection) || undefined,
        model: stringParam(params.model) || undefined,
        size: stringParam(params.size) || undefined,
        quality: stringParam(params.quality) || undefined,
        count: numberParam(params.count),
        provenance: { source: 'agent', sourceNodeIds: [textNode.id], createdAt: Date.now() },
      },
    })
    await store.connectNodes(textNode.id, configNode.id)
    for (const referenceNodeId of stringArrayParam(params.referenceNodeIds)) {
      await store.connectNodes(referenceNodeId, configNode.id)
    }
    return {
      success: true,
      data: { textNode, configNode },
      message: `已创建 ${mode} 预留生成流程；v1 仅运行图片生成。`,
    }
  }

  const autoRun = autoRunOverride ?? boolParam(params.autoRun)
  const result = await store.createGenerationFlow(prompt, {
    x: numberParam(params.x),
    y: numberParam(params.y),
    modelSelection: stringParam(params.modelSelection) || undefined,
    model: stringParam(params.model) || undefined,
    size: stringParam(params.size) || undefined,
    quality: stringParam(params.quality) || undefined,
    count: numberParam(params.count),
    autoRun: false,
  })
  for (const referenceNodeId of stringArrayParam(params.referenceNodeIds)) {
    await store.connectNodes(referenceNodeId, result.configNode.id)
  }
  if (autoRun) {
    const status = await useCreativeCanvasStore.getState().runGenerationForNode(result.configNode.id)
    const outcome = generationToolResult(result.configNode.id, status, '图片生成已完成。')
    return {
      ...outcome,
      data: {
        ...(outcome.data as Record<string, unknown>),
        textNode: result.textNode,
        configNode: useCreativeCanvasStore.getState().nodes.find(node => node.id === result.configNode.id) || result.configNode,
      },
    }
  }
  return { success: true, data: result, message: '已创建无限画布生成流程。' }
}

const handlers: Record<string, ToolHandler> = {
  creative_canvas_get_state: async () => {
    const { snapshot } = await getCanvasForRead()
    return { success: true, data: snapshot }
  },
  creative_canvas_get_selection: async () => {
    const { snapshot, selectedNodeIds } = await getCanvasForRead()
    const selectedNodes = (snapshot?.nodes || []).filter(node => selectedNodeIds.includes(node.id))
    const selectedAssetIds = new Set(selectedNodes.map(node => node.metadata.assetId).filter((id): id is string => typeof id === 'string'))
    return {
      success: true,
      data: {
        selectedNodeIds,
        nodes: selectedNodes,
        assets: (snapshot?.assets || []).filter(asset => selectedAssetIds.has(asset.id)),
      },
    }
  },
  creative_canvas_export_snapshot: async () => {
    const { snapshot } = await getCanvasForRead()
    return { success: true, data: snapshot }
  },
  creative_canvas_get_tool_schema: async () => ({
    success: true,
    data: creativeCanvasMcpSchemas,
  }),
  creative_canvas_apply_ops: async (params) => {
    const ops = Array.isArray(params.ops) ? params.ops as CreativeCanvasOp[] : []
    if (!ops.length) return { success: false, error: 'ops must be a non-empty array.' }
    const store = await ensureCanvasReady()
    await store.applyOps(ops)
    return { success: true, data: store.exportSnapshot(), message: `已应用 ${ops.length} 个画布操作。` }
  },
  creative_canvas_create_node: async (params) => {
    const store = await ensureCanvasReady()
    const node = await store.addNode({
      type: normalizeNodeType(params.nodeType),
      title: stringParam(params.title) || undefined,
      x: numberParam(params.x),
      y: numberParam(params.y),
      width: numberParam(params.width),
      height: numberParam(params.height),
      metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : undefined,
    })
    return { success: true, data: node, message: '已创建画布节点。' }
  },
  creative_canvas_create_text_node: async (params) => {
    const store = await ensureCanvasReady()
    const content = stringParam(params.text)
    const node = await store.addNode({
      type: 'text',
      title: stringParam(params.title) || '提示词',
      x: numberParam(params.x),
      y: numberParam(params.y),
      width: numberParam(params.width),
      height: numberParam(params.height),
      metadata: { content, prompt: content, provenance: { source: 'agent', createdAt: Date.now() } },
    })
    return { success: true, data: node, message: '已创建文本节点。' }
  },
  creative_canvas_create_text_nodes: async (params) => {
    const items = Array.isArray(params.items) ? params.items : []
    if (!items.length) return { success: false, error: 'items must be a non-empty array.' }
    const store = await ensureCanvasReady()
    const baseX = numberParam(params.x) ?? 140
    const baseY = numberParam(params.y) ?? 140
    const gap = numberParam(params.gap) ?? 36
    const direction = stringParam(params.direction) === 'row' ? 'row' : 'column'
    const created = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] && typeof items[index] === 'object' ? items[index] : {}
      const width = numberParam(item.width) ?? 300
      const height = numberParam(item.height) ?? 160
      const x = numberParam(item.x) ?? (direction === 'row' ? baseX + index * (width + gap) : baseX)
      const y = numberParam(item.y) ?? (direction === 'column' ? baseY + index * (height + gap) : baseY)
      const content = stringParam(item.text)
      created.push(await store.addNode({
        type: 'text',
        title: stringParam(item.title) || '文本',
        x,
        y,
        width,
        height,
        metadata: { content, prompt: content, provenance: { source: 'agent', createdAt: Date.now() } },
      }))
    }
    return { success: true, data: created, message: `已创建 ${created.length} 个文本节点。` }
  },
  creative_canvas_create_config_node: async (params) => {
    const store = await ensureCanvasReady()
    const prompt = stringParam(params.prompt)
    const mode = normalizeGenerationMode(params.mode)
    const node = await store.addNode({
      type: 'config',
      title: stringParam(params.title) || '生成配置',
      x: numberParam(params.x),
      y: numberParam(params.y),
      width: numberParam(params.width),
      height: numberParam(params.height),
      metadata: {
        prompt,
        status: 'idle',
        generationMode: mode,
        generationType: 'generation',
        modelSelection: stringParam(params.modelSelection) || undefined,
        model: stringParam(params.model) || undefined,
        size: stringParam(params.size) || '1024x1024',
        quality: stringParam(params.quality) || 'standard',
        count: numberParam(params.count) || 1,
        provenance: { source: 'agent', createdAt: Date.now() },
      },
    })
    if (boolParam(params.autoRun)) {
      const status = await store.runGenerationForNode(node.id)
      return generationToolResult(node.id, status, '图片生成已完成。')
    }
    return { success: true, data: node, message: mode === 'image' ? '已创建生成配置节点。' : `已创建 ${mode} 预留配置节点。` }
  },
  creative_canvas_create_image_prompt_flow: async (params) => createGenerationFlow(params, 'image'),
  creative_canvas_create_generation_flow: async (params) => createGenerationFlow(params),
  creative_canvas_generate_image: async (params) => createGenerationFlow(params, 'image', true),
  creative_canvas_generate_video: async (params) => createGenerationFlow(params, 'video', false),
  creative_canvas_generate_audio: async (params) => createGenerationFlow(params, 'audio', false),
  creative_canvas_generate_text: async (params) => createGenerationFlow(params, 'text', false),
  creative_canvas_update_node: async (params) => {
    const id = stringParam(params.id)
    if (!id) return { success: false, error: 'id is required.' }
    const store = await ensureCanvasReady()
    await store.updateNode(id, {
      ...(params.patch && typeof params.patch === 'object' ? params.patch : {}),
      metadata: params.metadata && typeof params.metadata === 'object' ? params.metadata : undefined,
    })
    return { success: true, data: store.exportSnapshot(), message: '已更新节点。' }
  },
  creative_canvas_update_node_text: async (params) => {
    const id = stringParam(params.id)
    const content = stringParam(params.text)
    if (!id) return { success: false, error: 'id is required.' }
    const store = await ensureCanvasReady()
    await store.updateNode(id, {
      title: stringParam(params.title) || undefined,
      metadata: { content, prompt: content },
    })
    return { success: true, data: store.exportSnapshot(), message: '已更新文本节点。' }
  },
  creative_canvas_move_nodes: async (params) => {
    const items = Array.isArray(params.items) ? params.items : []
    if (!items.length) return { success: false, error: 'items must be a non-empty array.' }
    const store = await ensureCanvasReady()
    for (const item of items) {
      const record = item && typeof item === 'object' ? item : {}
      const id = stringParam(record.id)
      const node = useCreativeCanvasStore.getState().nodes.find(candidate => candidate.id === id)
      if (!id || !node) continue
      const x = numberParam(record.x) ?? node.x + (numberParam(record.dx) ?? 0)
      const y = numberParam(record.y) ?? node.y + (numberParam(record.dy) ?? 0)
      await store.moveNode(id, x, y)
    }
    return { success: true, data: useCreativeCanvasStore.getState().exportSnapshot(), message: '已移动节点。' }
  },
  creative_canvas_resize_node: async (params) => {
    const id = stringParam(params.id)
    const width = numberParam(params.width)
    const height = numberParam(params.height)
    if (!id || !width || !height) return { success: false, error: 'id, width and height are required.' }
    const store = await ensureCanvasReady()
    await store.resizeNode(id, width, height)
    return { success: true, data: store.exportSnapshot(), message: '已调整节点尺寸。' }
  },
  creative_canvas_delete_nodes: async (params) => {
    const ids = stringArrayParam(params.ids)
    if (!ids.length) return { success: false, error: 'ids must be a non-empty array.' }
    const store = await ensureCanvasReady()
    await store.deleteNodes(ids)
    return { success: true, data: store.exportSnapshot(), message: `已删除 ${ids.length} 个节点。` }
  },
  creative_canvas_connect_nodes: async (params) => {
    const connections = Array.isArray(params.connections) ? params.connections : []
    if (!connections.length) return { success: false, error: 'connections must be a non-empty array.' }
    const store = await ensureCanvasReady()
    const edges = []
    for (const connection of connections) {
      const record = connection && typeof connection === 'object' ? connection : {}
      const fromNodeId = stringParam(record.fromNodeId)
      const toNodeId = stringParam(record.toNodeId)
      if (!fromNodeId || !toNodeId) continue
      const edge = await store.connectNodes(fromNodeId, toNodeId)
      if (edge) edges.push(edge)
    }
    return { success: true, data: edges, message: `已创建 ${edges.length} 条连线。` }
  },
  creative_canvas_select_nodes: async (params) => {
    const store = await ensureCanvasReady()
    const ids = stringArrayParam(params.ids)
    store.selectNodes(ids)
    return { success: true, data: { selectedNodeIds: ids }, message: '已更新选区。' }
  },
  creative_canvas_set_viewport: async (params) => {
    const viewport = params.viewport || {}
    const store = await ensureCanvasReady()
    await store.setViewport({
      x: numberParam(viewport.x) ?? 0,
      y: numberParam(viewport.y) ?? 0,
      k: numberParam(viewport.k) ?? 1,
    })
    return { success: true, data: store.exportSnapshot(), message: '已更新视口。' }
  },
  creative_canvas_run_generation: async (params) => {
    const nodeId = stringParam(params.nodeId)
    if (!nodeId) return { success: false, error: 'nodeId is required.' }
    const store = await ensureCanvasReady()
    const status = await store.runGenerationForNode(nodeId, typeof params.prompt === 'string' ? params.prompt : undefined)
    return generationToolResult(nodeId, status, '生成任务已完成。')
  },
  creative_canvas_insert_asset_into_note: async (params) => {
    const assetId = stringParam(params.assetId)
    if (!assetId) return { success: false, error: 'assetId is required.' }
    const store = await ensureCanvasReady()
    const path = await store.insertAssetIntoNote(assetId)
    return { success: true, data: { path }, message: `已插入图片引用：${path}` }
  },
  creative_canvas_recover_jobs: async () => {
    const store = await ensureCanvasReady()
    const result = await store.recoverStaleJobs()
    return { success: true, data: result, message: result.staleJobIds.length ? `已标记 ${result.staleJobIds.length} 个 stale 任务。` : '没有需要恢复的任务。' }
  },
  creative_canvas_retry_generation: async (params) => {
    const jobId = stringParam(params.jobId)
    if (!jobId) return { success: false, error: 'jobId is required.' }
    const store = await ensureCanvasReady()
    const job = useCreativeCanvasStore.getState().jobs.find(item => item.id === jobId)
    const status = await store.retryGenerationJob(jobId)
    return generationToolResult(job?.nodeId || '', status, '已重试并完成生成任务。')
  },
  creative_canvas_analyze_asset_cleanup: async () => {
    const { snapshot } = await getCanvasForRead()
    const plan = await analyzeCreativeCanvasAssetCleanup(snapshot)
    return { success: true, data: plan }
  },
  creative_canvas_cleanup_assets: async (params) => {
    const store = await ensureCanvasReady()
    const result = await store.cleanupAssets({
      includeUnusedAssets: params.includeUnusedAssets === undefined ? true : boolParam(params.includeUnusedAssets),
      includeOrphanFiles: params.includeOrphanFiles === undefined ? true : boolParam(params.includeOrphanFiles),
    })
    return { success: true, data: result, message: `已清理 ${result.deletedAssetIds.length} 个素材和 ${result.deletedFiles.length} 个文件。` }
  },
  creative_canvas_import_infinite_canvas_json: async (params) => {
    const json = stringParam(params.json)
    if (!json) return { success: false, error: 'json is required.' }
    const store = await ensureCanvasReady()
    const report = await store.importInfiniteCanvasJson(json, stringParam(params.title) || undefined)
    return { success: true, data: report, message: `已导入 ${report.snapshot.nodes.length} 个节点和 ${report.snapshot.edges.length} 条连线。` }
  },
}

function createTool(schema: CreativeCanvasToolSchema, executeName = schema.name): Tool {
  const execute = handlers[executeName]
  return {
    name: schema.name,
    description: schema.description,
    category: 'editor',
    risk: schema.risk,
    capabilities: schema.capabilities,
    requiresConfirmation: schema.risk !== 'low',
    parameters: schema.parameters,
    execute: async (params) => {
      try {
        if (!execute) return { success: false, error: `Missing creative canvas handler: ${executeName}` }
        return await execute(params || {})
      } catch (error) {
        return { success: false, error: getErrorMessage(error) }
      }
    },
  }
}

const nativeTools = nativeSchemas.map(schema => createTool(schema))
const aliasTools = aliasPairs
  .map(([aliasName, nativeName]) => {
    const native = nativeSchemas.find(schema => schema.name === nativeName)
    if (!native) return null
    return createTool({
      ...native,
      name: aliasName,
      description: `${native.description}（兼容 canvas-agent 命名，实际映射到 ${nativeName}。）`,
    }, nativeName)
  })
  .filter((tool): tool is Tool => Boolean(tool))

export const creativeCanvasTools: Tool[] = [...nativeTools, ...aliasTools]
