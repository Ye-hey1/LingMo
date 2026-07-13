import { getDb, serializedWrite } from './index'
import type {
  CreativeCanvasAsset,
  CreativeCanvasEdge,
  CreativeCanvasGenerationJob,
  CreativeCanvasNode,
  CreativeCanvasProject,
  CreativeCanvasSnapshot,
  CreativeCanvasViewport,
} from '@/types/creative-canvas'
import { CREATIVE_CANVAS_SCHEMA_VERSION } from '@/types/creative-canvas'
import { normalizeCanvasViewport } from '@/lib/creative-canvas/geometry'

const DEFAULT_VIEWPORT: CreativeCanvasViewport = { x: 0, y: 0, k: 1 }

function now() {
  return Date.now()
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {})
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

async function ensureCreativeCanvasColumn(table: string, column: string, definition: string) {
  const db = await getDb()
  const columns = await db.select<Array<{ name: string }>>(`pragma table_info(${table})`)
  if (!columns.some(item => item.name === column)) {
    await db.execute(`alter table ${table} add column ${column} ${definition}`)
  }
}

function mapProject(row: any): CreativeCanvasProject {
  return {
    id: row.id,
    title: row.title || '创意画布',
    schemaVersion: Number(row.schema_version || CREATIVE_CANVAS_SCHEMA_VERSION),
    viewport: normalizeCanvasViewport(parseJson(row.viewport, DEFAULT_VIEWPORT), DEFAULT_VIEWPORT),
    settings: parseJson(row.settings, {}),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  }
}

function mapNode(row: any): CreativeCanvasNode {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    title: row.title || '',
    x: Number(row.x || 0),
    y: Number(row.y || 0),
    width: Number(row.width || 280),
    height: Number(row.height || 180),
    metadata: parseJson(row.metadata, {}),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  }
}

function mapEdge(row: any): CreativeCanvasEdge {
  return {
    id: row.id,
    projectId: row.project_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    createdAt: Number(row.created_at || 0),
  }
}

function mapAsset(row: any): CreativeCanvasAsset {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    filePath: row.file_path,
    thumbnailPath: row.thumbnail_path || undefined,
    title: row.title || '',
    mimeType: row.mime_type || 'application/octet-stream',
    bytes: Number(row.bytes || 0),
    width: row.width == null ? undefined : Number(row.width),
    height: row.height == null ? undefined : Number(row.height),
    hash: row.hash || undefined,
    sourceNodeId: row.source_node_id || undefined,
    sourceJobId: row.source_job_id || undefined,
    prompt: row.prompt || undefined,
    provenance: parseJson(row.provenance, undefined),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  }
}

function mapJob(row: any): CreativeCanvasGenerationJob {
  return {
    id: row.id,
    projectId: row.project_id,
    nodeId: row.node_id || undefined,
    status: row.status,
    mode: row.mode,
    generationType: row.generation_type,
    modelSelection: row.model_selection || undefined,
    model: row.model || undefined,
    prompt: row.prompt || '',
    request: parseJson(row.request_json, {}),
    response: parseJson(row.response_json, undefined),
    error: row.error || undefined,
    assetIds: parseJson(row.asset_ids, []),
    startedAt: row.started_at == null ? undefined : Number(row.started_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  }
}

export async function initCreativeCanvasDb() {
  const db = await getDb()

  await db.execute(`
    create table if not exists creative_canvas_projects (
      id text primary key,
      title text not null,
      schema_version integer not null,
      viewport text not null,
      settings text not null default '{}',
      created_at integer not null,
      updated_at integer not null
    )
  `)

  await db.execute(`
    create table if not exists creative_canvas_nodes (
      id text primary key,
      project_id text not null,
      type text not null,
      title text not null,
      x real not null,
      y real not null,
      width real not null,
      height real not null,
      metadata text not null,
      created_at integer not null,
      updated_at integer not null
    )
  `)

  await db.execute(`
    create table if not exists creative_canvas_edges (
      id text primary key,
      project_id text not null,
      from_node_id text not null,
      to_node_id text not null,
      created_at integer not null
    )
  `)

  await db.execute(`
    create table if not exists creative_canvas_assets (
      id text primary key,
      project_id text not null,
      kind text not null,
      file_path text not null,
      thumbnail_path text,
      title text not null,
      mime_type text not null,
      bytes integer not null,
      width integer,
      height integer,
      hash text,
      source_node_id text,
      source_job_id text,
      prompt text,
      provenance text,
      created_at integer not null,
      updated_at integer not null
    )
  `)

  await db.execute(`
    create table if not exists creative_generation_jobs (
      id text primary key,
      project_id text not null,
      node_id text,
      status text not null,
      mode text not null,
      generation_type text not null,
      model_selection text,
      model text,
      prompt text not null,
      request_json text not null,
      response_json text,
      error text,
      asset_ids text not null,
      started_at integer,
      completed_at integer,
      created_at integer not null,
      updated_at integer not null
    )
  `)

  await db.execute('create index if not exists idx_creative_canvas_nodes_project on creative_canvas_nodes(project_id)')
  await db.execute('create index if not exists idx_creative_canvas_edges_project on creative_canvas_edges(project_id)')
  await db.execute('create unique index if not exists idx_creative_canvas_edges_pair on creative_canvas_edges(project_id, from_node_id, to_node_id)')
  await db.execute('create index if not exists idx_creative_canvas_assets_project on creative_canvas_assets(project_id, updated_at desc)')
  await db.execute('create index if not exists idx_creative_generation_jobs_project on creative_generation_jobs(project_id, updated_at desc)')
  await db.execute('create index if not exists idx_creative_generation_jobs_status on creative_generation_jobs(status)')

  await ensureCreativeCanvasColumn('creative_canvas_assets', 'thumbnail_path', 'text')
  await ensureCreativeCanvasColumn('creative_canvas_projects', 'settings', "text not null default '{}'")
  await ensureCreativeCanvasColumn('creative_generation_jobs', 'model_selection', 'text')
}

export async function listCreativeCanvasProjects() {
  const db = await getDb()
  const rows = await db.select<any[]>('select * from creative_canvas_projects order by updated_at desc')
  return rows.map(mapProject)
}

export async function getCreativeCanvasProject(projectId: string) {
  const db = await getDb()
  const rows = await db.select<any[]>('select * from creative_canvas_projects where id = $1 limit 1', [projectId])
  return rows[0] ? mapProject(rows[0]) : null
}

export async function createCreativeCanvasProject(input?: { title?: string }): Promise<CreativeCanvasProject> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    const project: CreativeCanvasProject = {
      id: createId('canvas'),
      title: input?.title?.trim() || '创意画布',
      schemaVersion: CREATIVE_CANVAS_SCHEMA_VERSION,
      viewport: DEFAULT_VIEWPORT,
      settings: {},
      createdAt: ts,
      updatedAt: ts,
    }

    await db.execute(
      `insert into creative_canvas_projects
       (id, title, schema_version, viewport, settings, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [project.id, project.title, project.schemaVersion, stringifyJson(project.viewport), stringifyJson(project.settings), ts, ts],
    )

    return project
  })
}

export async function updateCreativeCanvasProject(project: CreativeCanvasProject) {
  return await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `update creative_canvas_projects
       set title = $1, schema_version = $2, viewport = $3, settings = $4, updated_at = $5
       where id = $6`,
      [
        project.title,
        project.schemaVersion,
        stringifyJson(project.viewport),
        stringifyJson(project.settings),
        project.updatedAt || now(),
        project.id,
      ],
    )
  })
}

export async function deleteCreativeCanvasProject(projectId: string): Promise<CreativeCanvasAsset[]> {
  return await serializedWrite(async () => {
    const db = await getDb()
    const assetRows = await db.select<any[]>(
      'select * from creative_canvas_assets where project_id = $1',
      [projectId],
    )

    await db.execute('delete from creative_generation_jobs where project_id = $1', [projectId])
    await db.execute('delete from creative_canvas_edges where project_id = $1', [projectId])
    await db.execute('delete from creative_canvas_nodes where project_id = $1', [projectId])
    await db.execute('delete from creative_canvas_assets where project_id = $1', [projectId])
    await db.execute('delete from creative_canvas_projects where id = $1', [projectId])

    return assetRows.map(mapAsset)
  })
}

export async function getCreativeCanvasSnapshot(projectId: string): Promise<CreativeCanvasSnapshot | null> {
  const db = await getDb()
  const project = await getCreativeCanvasProject(projectId)
  if (!project) return null

  const [nodes, edges, assets, jobs] = await Promise.all([
    db.select<any[]>('select * from creative_canvas_nodes where project_id = $1 order by created_at asc', [projectId]),
    db.select<any[]>('select * from creative_canvas_edges where project_id = $1 order by created_at asc', [projectId]),
    db.select<any[]>('select * from creative_canvas_assets where project_id = $1 order by updated_at desc', [projectId]),
    db.select<any[]>('select * from creative_generation_jobs where project_id = $1 order by updated_at desc limit 50', [projectId]),
  ])

  return {
    project,
    nodes: nodes.map(mapNode),
    edges: edges.map(mapEdge),
    assets: assets.map(mapAsset),
    jobs: jobs.map(mapJob),
  }
}

export async function listCreativeCanvasAssets(): Promise<CreativeCanvasAsset[]> {
  const db = await getDb()
  const rows = await db.select<any[]>('select * from creative_canvas_assets order by updated_at desc')
  return rows.map(mapAsset)
}

export async function replaceCreativeCanvasGraph(project: CreativeCanvasProject, nodes: CreativeCanvasNode[], edges: CreativeCanvasEdge[]) {
  return await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into creative_canvas_projects
       (id, title, schema_version, viewport, settings, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict(id) do update set
         title = excluded.title,
         schema_version = excluded.schema_version,
         viewport = excluded.viewport,
         settings = excluded.settings,
         updated_at = excluded.updated_at`,
      [
        project.id,
        project.title,
        project.schemaVersion,
        stringifyJson(project.viewport),
        stringifyJson(project.settings),
        project.createdAt,
        project.updatedAt,
      ],
    )
    await db.execute('delete from creative_canvas_nodes where project_id = $1', [project.id])
    await db.execute('delete from creative_canvas_edges where project_id = $1', [project.id])

    for (const node of nodes) {
      await upsertCreativeCanvasNodeInTransaction(db, node)
    }
    for (const edge of edges) {
      await upsertCreativeCanvasEdgeInTransaction(db, edge)
    }
  })
}

async function upsertCreativeCanvasNodeInTransaction(db: Awaited<ReturnType<typeof getDb>>, node: CreativeCanvasNode) {
  await db.execute(
    `insert into creative_canvas_nodes
     (id, project_id, type, title, x, y, width, height, metadata, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict(id) do update set
       type = excluded.type,
       title = excluded.title,
       x = excluded.x,
       y = excluded.y,
       width = excluded.width,
       height = excluded.height,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at`,
    [
      node.id,
      node.projectId,
      node.type,
      node.title,
      node.x,
      node.y,
      node.width,
      node.height,
      stringifyJson(node.metadata),
      node.createdAt,
      node.updatedAt,
    ],
  )
}

async function upsertCreativeCanvasEdgeInTransaction(db: Awaited<ReturnType<typeof getDb>>, edge: CreativeCanvasEdge) {
  await db.execute(
    `insert into creative_canvas_edges
     (id, project_id, from_node_id, to_node_id, created_at)
     values ($1, $2, $3, $4, $5)
     on conflict(project_id, from_node_id, to_node_id) do update set
       id = excluded.id,
       created_at = excluded.created_at`,
    [edge.id, edge.projectId, edge.fromNodeId, edge.toNodeId, edge.createdAt],
  )
}

export async function upsertCreativeCanvasNode(node: CreativeCanvasNode) {
  return await serializedWrite(async () => {
    const db = await getDb()
    await upsertCreativeCanvasNodeInTransaction(db, node)
    await touchCreativeCanvasProjectUpdatedAt(node.projectId)
  })
}

export async function upsertCreativeCanvasEdge(edge: CreativeCanvasEdge) {
  return await serializedWrite(async () => {
    const db = await getDb()
    await upsertCreativeCanvasEdgeInTransaction(db, edge)
    await touchCreativeCanvasProjectUpdatedAt(edge.projectId)
  })
}

export async function deleteCreativeCanvasNodes(projectId: string, nodeIds: string[]) {
  if (!nodeIds.length) return
  return await serializedWrite(async () => {
    const db = await getDb()
    for (const nodeId of nodeIds) {
      await db.execute('delete from creative_canvas_nodes where project_id = $1 and id = $2', [projectId, nodeId])
    }
    await db.execute(
      `delete from creative_canvas_edges
       where project_id = $1 and (
         from_node_id in (${nodeIds.map((_, index) => `$${index + 2}`).join(',')})
         or to_node_id in (${nodeIds.map((_, index) => `$${index + 2}`).join(',')})
       )`,
      [projectId, ...nodeIds],
    )
    await db.execute('update creative_canvas_projects set updated_at = $1 where id = $2', [now(), projectId])
  })
}

export async function deleteCreativeCanvasEdge(projectId: string, edgeId: string) {
  return await serializedWrite(async () => {
    const db = await getDb()
    await db.execute('delete from creative_canvas_edges where project_id = $1 and id = $2', [projectId, edgeId])
    await touchCreativeCanvasProjectUpdatedAt(projectId)
  })
}

export async function createCreativeCanvasAsset(input: Omit<CreativeCanvasAsset, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  return await serializedWrite(async () => {
    const db = await getDb()
    const ts = now()
    const asset: CreativeCanvasAsset = {
      ...input,
      id: input.id || createId('asset'),
      createdAt: ts,
      updatedAt: ts,
    }
    await db.execute(
      `insert into creative_canvas_assets
       (id, project_id, kind, file_path, thumbnail_path, title, mime_type, bytes, width, height, hash,
        source_node_id, source_job_id, prompt, provenance, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       on conflict(id) do update set
         file_path = excluded.file_path,
         thumbnail_path = excluded.thumbnail_path,
         title = excluded.title,
         mime_type = excluded.mime_type,
         bytes = excluded.bytes,
         width = excluded.width,
         height = excluded.height,
         hash = excluded.hash,
         source_node_id = excluded.source_node_id,
         source_job_id = excluded.source_job_id,
         prompt = excluded.prompt,
         provenance = excluded.provenance,
         updated_at = excluded.updated_at`,
      [
        asset.id,
        asset.projectId,
        asset.kind,
        asset.filePath,
        asset.thumbnailPath ?? null,
        asset.title,
        asset.mimeType,
        asset.bytes,
        asset.width ?? null,
        asset.height ?? null,
        asset.hash ?? null,
        asset.sourceNodeId ?? null,
        asset.sourceJobId ?? null,
        asset.prompt ?? null,
        asset.provenance ? stringifyJson(asset.provenance) : null,
        asset.createdAt,
        asset.updatedAt,
      ],
    )
    await touchCreativeCanvasProjectUpdatedAt(asset.projectId)
    return asset
  })
}

export async function upsertCreativeCanvasAsset(asset: CreativeCanvasAsset) {
  return await serializedWrite(async () => {
    const db = await getDb()
    await db.execute(
      `insert into creative_canvas_assets
       (id, project_id, kind, file_path, thumbnail_path, title, mime_type, bytes, width, height, hash,
        source_node_id, source_job_id, prompt, provenance, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       on conflict(id) do update set
         file_path = excluded.file_path,
         thumbnail_path = excluded.thumbnail_path,
         title = excluded.title,
         mime_type = excluded.mime_type,
         bytes = excluded.bytes,
         width = excluded.width,
         height = excluded.height,
         hash = excluded.hash,
         source_node_id = excluded.source_node_id,
         source_job_id = excluded.source_job_id,
         prompt = excluded.prompt,
         provenance = excluded.provenance,
         updated_at = excluded.updated_at`,
      [
        asset.id,
        asset.projectId,
        asset.kind,
        asset.filePath,
        asset.thumbnailPath ?? null,
        asset.title,
        asset.mimeType,
        asset.bytes,
        asset.width ?? null,
        asset.height ?? null,
        asset.hash ?? null,
        asset.sourceNodeId ?? null,
        asset.sourceJobId ?? null,
        asset.prompt ?? null,
        asset.provenance ? stringifyJson(asset.provenance) : null,
        asset.createdAt,
        asset.updatedAt || now(),
      ],
    )
    await touchCreativeCanvasProjectUpdatedAt(asset.projectId)
    return asset
  })
}

export async function deleteCreativeCanvasAssets(projectId: string, assetIds: string[]) {
  if (!assetIds.length) return
  return await serializedWrite(async () => {
    const db = await getDb()
    const placeholders = assetIds.map((_, index) => `$${index + 2}`).join(',')
    await db.execute(
      `delete from creative_canvas_assets where project_id = $1 and id in (${placeholders})`,
      [projectId, ...assetIds],
    )
    await touchCreativeCanvasProjectUpdatedAt(projectId)
  })
}

async function upsertCreativeCanvasJobInTransaction(db: Awaited<ReturnType<typeof getDb>>, job: CreativeCanvasGenerationJob) {
  await db.execute(
      `insert into creative_generation_jobs
       (id, project_id, node_id, status, mode, generation_type, model_selection, model, prompt, request_json,
        response_json, error, asset_ids, started_at, completed_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       on conflict(id) do update set
         node_id = excluded.node_id,
         status = excluded.status,
         model_selection = excluded.model_selection,
         model = excluded.model,
         prompt = excluded.prompt,
         request_json = excluded.request_json,
         response_json = excluded.response_json,
         error = excluded.error,
         asset_ids = excluded.asset_ids,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at`,
      [
        job.id,
        job.projectId,
        job.nodeId ?? null,
        job.status,
        job.mode,
        job.generationType,
        job.modelSelection ?? null,
        job.model ?? null,
        job.prompt,
        stringifyJson(job.request),
        job.response ? stringifyJson(job.response) : null,
        job.error ?? null,
        stringifyJson(job.assetIds),
        job.startedAt ?? null,
        job.completedAt ?? null,
        job.createdAt,
        job.updatedAt,
      ],
    )
}

export async function commitCreativeCanvasGenerationResult(input: {
  sourceNode: CreativeCanvasNode
  resultNodes: CreativeCanvasNode[]
  resultEdges: CreativeCanvasEdge[]
  job: CreativeCanvasGenerationJob
}) {
  return await serializedWrite(async () => {
    const db = await getDb()
    const nodeRows = await db.select<Array<{ metadata: string }>>(
      `select n.metadata
       from creative_canvas_nodes n
       where n.project_id = $1 and n.id = $2
         and json_extract(n.metadata, '$.jobId') = $3
         and json_extract(n.metadata, '$.status') = 'running'
         and exists (
           select 1 from creative_generation_jobs j
           where j.project_id = $1 and j.id = $3 and j.status = 'running'
         )
       limit 1`,
      [input.job.projectId, input.sourceNode.id, input.job.id],
    )
    const metadata = parseJson<CreativeCanvasNode['metadata']>(nodeRows[0]?.metadata, {})
    if (!nodeRows.length) return false

    for (const node of input.resultNodes) {
      await upsertCreativeCanvasNodeInTransaction(db, node)
    }
    for (const edge of input.resultEdges) {
      await upsertCreativeCanvasEdgeInTransaction(db, edge)
    }
    await db.execute(
      'update creative_canvas_nodes set metadata = $1, updated_at = $2 where project_id = $3 and id = $4',
      [
        stringifyJson({
          ...metadata,
          prompt: input.sourceNode.metadata.prompt,
          status: 'succeeded',
          error: undefined,
          jobId: input.job.id,
        }),
        input.sourceNode.updatedAt,
        input.job.projectId,
        input.sourceNode.id,
      ],
    )
    await upsertCreativeCanvasJobInTransaction(db, input.job)
    await db.execute('update creative_canvas_projects set updated_at = $1 where id = $2', [now(), input.job.projectId])
    return true
  })
}

export async function upsertCreativeCanvasJob(job: CreativeCanvasGenerationJob) {
  return await serializedWrite(async () => {
    const db = await getDb()
    await upsertCreativeCanvasJobInTransaction(db, job)
    await touchCreativeCanvasProjectUpdatedAt(job.projectId)
  })
}

export function createCreativeCanvasId(prefix: string) {
  return createId(prefix)
}

async function touchCreativeCanvasProjectUpdatedAt(projectId: string) {
  const db = await getDb()
  await db.execute('update creative_canvas_projects set updated_at = $1 where id = $2', [now(), projectId])
}
