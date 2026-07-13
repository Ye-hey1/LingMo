import { getDb, runDbBatch, serializedWrite } from './index';

export interface VectorDocument {
  id: number;
  filename: string;
  chunk_id: number;
  content: string;
  embedding: string;
  updated_at: number;
  metadata?: string | null;
}

interface CachedVector {
  id: number;
  filename: string;
  chunk_id: number;
  content: string;
  embedding: number[];
  updated_at: number;
  metadata?: string | null;
}

export interface VectorEmbeddingDocument {
  id: number;
  filename: string;
  chunk_id: number;
  content: string;
  embedding: number[];
  updated_at: number;
  metadata?: string | null;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

class VectorCache {
  private cache: Map<number, CachedVector> = new Map();
  private vectorsByFilename: Map<string, number[]> = new Map();
  private lastUpdate = 0;
  private cacheVersion = 0;
  private hasCompleteSnapshot = false;
  private cacheTtlMs: number;

  constructor(cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
    this.cacheTtlMs = cacheTtlMs
  }

  private parseDocument(doc: VectorDocument): CachedVector | null {
    try {
      return {
        id: doc.id,
        filename: doc.filename,
        chunk_id: doc.chunk_id,
        content: doc.content,
        embedding: JSON.parse(doc.embedding) as number[],
        updated_at: doc.updated_at,
        metadata: doc.metadata ?? null,
      };
    } catch (error) {
      console.error(`Failed to parse embedding for doc ${doc.id}:`, error);
      return null;
    }
  }

  getVersion(): number {
    return this.cacheVersion;
  }

  getAll(): CachedVector[] {
    return Array.from(this.cache.values());
  }

  getByFilename(filename: string): CachedVector[] {
    const ids = this.vectorsByFilename.get(filename) || [];
    return ids.map(id => this.cache.get(id)).filter(Boolean) as CachedVector[];
  }

  stats() {
    return {
      size: this.cache.size,
      filenames: this.vectorsByFilename.size,
      lastUpdate: this.lastUpdate,
      version: this.cacheVersion,
      isComplete: this.hasCompleteSnapshot,
    };
  }

  private removeIdFromFilename(filename: string, id: number) {
    const ids = this.vectorsByFilename.get(filename);
    if (!ids) return;
    const nextIds = ids.filter(existingId => existingId !== id);
    if (nextIds.length > 0) {
      this.vectorsByFilename.set(filename, nextIds);
    } else {
      this.vectorsByFilename.delete(filename);
    }
  }

  private trackFilenameId(filename: string, id: number) {
    const ids = this.vectorsByFilename.get(filename) || [];
    if (!ids.includes(id)) {
      ids.push(id);
      this.vectorsByFilename.set(filename, ids);
    }
  }

  async update() {
    const db = await getDb();
    const docs = await db.select<VectorDocument[]>(`
      select id, filename, chunk_id, content, embedding, updated_at, metadata from vector_documents
    `);

    const nextCache = new Map<number, CachedVector>();
    const nextVectorsByFilename = new Map<string, number[]>();

    for (const doc of docs) {
      const cached = this.parseDocument(doc);
      if (!cached) continue;
      nextCache.set(doc.id, cached);
      const ids = nextVectorsByFilename.get(doc.filename) || [];
      ids.push(doc.id);
      nextVectorsByFilename.set(doc.filename, ids);
    }

    this.cache = nextCache;
    this.vectorsByFilename = nextVectorsByFilename;
    this.lastUpdate = Date.now();
    this.hasCompleteSnapshot = true;
    this.cacheVersion++;
  }

  add(doc: VectorDocument) {
    const cached = this.parseDocument(doc);
    if (!cached) return;
    const existing = this.cache.get(doc.id);
    if (existing) {
      this.removeIdFromFilename(existing.filename, doc.id);
    }
    this.cache.set(doc.id, cached);
    this.trackFilenameId(doc.filename, doc.id);
    this.cacheVersion++;
  }

  deleteByFilename(filename: string) {
    const ids = this.vectorsByFilename.get(filename) || [];
    for (const id of ids) {
      this.cache.delete(id);
    }
    this.vectorsByFilename.delete(filename);
    this.cacheVersion++;
  }

  async refreshFilenames(filenames: string[]) {
    const uniqueFilenames = Array.from(new Set(filenames.filter(Boolean)));
    if (uniqueFilenames.length === 0) return;

    const db = await getDb();
    const placeholders = uniqueFilenames.map((_, index) => `$${index + 1}`).join(', ');
    const docs = await db.select<VectorDocument[]>(
      `select id, filename, chunk_id, content, embedding, updated_at, metadata
       from vector_documents
       where filename in (${placeholders})`,
      uniqueFilenames,
    );

    const nextCache = new Map(this.cache);
    const nextVectorsByFilename = new Map(
      Array.from(this.vectorsByFilename, ([filename, ids]) => [filename, [...ids]]),
    );
    for (const filename of uniqueFilenames) {
      for (const id of nextVectorsByFilename.get(filename) || []) {
        nextCache.delete(id);
      }
      nextVectorsByFilename.delete(filename);
    }

    for (const doc of docs) {
      const cached = this.parseDocument(doc);
      if (!cached) continue;
      const existing = nextCache.get(doc.id);
      if (existing) {
        const existingIds = nextVectorsByFilename.get(existing.filename) || [];
        const remainingIds = existingIds.filter(id => id !== doc.id);
        if (remainingIds.length > 0) nextVectorsByFilename.set(existing.filename, remainingIds);
        else nextVectorsByFilename.delete(existing.filename);
      }
      nextCache.set(doc.id, cached);
      const ids = nextVectorsByFilename.get(doc.filename) || [];
      ids.push(doc.id);
      nextVectorsByFilename.set(doc.filename, ids);
    }

    this.cache = nextCache;
    this.vectorsByFilename = nextVectorsByFilename;
    this.lastUpdate = Date.now();
    this.cacheVersion++;
  }

  clear() {
    this.cache.clear();
    this.vectorsByFilename.clear();
    this.lastUpdate = Date.now();
    this.hasCompleteSnapshot = true;
    this.cacheVersion++;
  }

  needsUpdate(): boolean {
    return !this.hasCompleteSnapshot || Date.now() - this.lastUpdate > this.cacheTtlMs;
  }
}

const vectorCache = new VectorCache();

export async function initVectorDb() {
  const db = await getDb();
  await db.execute(`
    create table if not exists vector_documents (
      id integer primary key autoincrement,
      filename text not null,
      chunk_id integer not null,
      content text not null,
      embedding text not null,
      updated_at integer not null,
      unique(filename, chunk_id)
    )
  `);

  try {
    await db.execute('alter table vector_documents add column metadata text')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/duplicate column|already exists/i.test(message)) {
      console.warn('[VectorDB] metadata migration skipped:', error)
    }
  }

  await db.execute(`
    create index if not exists idx_vector_documents_filename
    on vector_documents(filename)
  `);

  await vectorCache.update();
}

export async function upsertVectorDocument(doc: Omit<VectorDocument, 'id'>) {
  return serializedWrite(async () => {
    const db = await getDb();
    await db.execute(
      'insert into vector_documents (filename, chunk_id, content, embedding, updated_at, metadata) values ($1, $2, $3, $4, $5, $6) on conflict(filename, chunk_id) do update set content = excluded.content, embedding = excluded.embedding, updated_at = excluded.updated_at, metadata = excluded.metadata',
      [doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at, doc.metadata ?? null],
    );

    const inserted = await db.select<VectorDocument[]>(
      'select * from vector_documents where filename = $1 and chunk_id = $2',
      [doc.filename, doc.chunk_id],
    );

    if (inserted.length > 0) {
      vectorCache.add(inserted[0]);
    }
  });
}

export async function upsertVectorDocumentsBatch(docs: Omit<VectorDocument, 'id'>[]) {
  return serializedWrite(async () => {
    const db = await getDb();
    await runDbBatch(db, async () => {
      for (const doc of docs) {
        await db.execute(
          'insert into vector_documents (filename, chunk_id, content, embedding, updated_at, metadata) values ($1, $2, $3, $4, $5, $6) on conflict(filename, chunk_id) do update set content = excluded.content, embedding = excluded.embedding, updated_at = excluded.updated_at, metadata = excluded.metadata',
          [doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at, doc.metadata ?? null],
        );
      }
    });
    await vectorCache.refreshFilenames(docs.map(doc => doc.filename));
  });
}

export async function replaceVectorDocumentsForFile(
  filename: string,
  docs: Omit<VectorDocument, 'id'>[],
  legacyFilenames: string[] = [],
) {
  return serializedWrite(async () => {
    const db = await getDb();
    const filenamesToDelete = Array.from(
      new Set([filename, ...legacyFilenames].filter(Boolean)),
    );

    await runDbBatch(db, async () => {
      for (const filenameToDelete of filenamesToDelete) {
        await db.execute(
          'delete from vector_documents where filename = $1',
          [filenameToDelete],
        );
      }

      for (const doc of docs) {
        await db.execute(
          'insert into vector_documents (filename, chunk_id, content, embedding, updated_at, metadata) values ($1, $2, $3, $4, $5, $6) on conflict(filename, chunk_id) do update set content = excluded.content, embedding = excluded.embedding, updated_at = excluded.updated_at, metadata = excluded.metadata',
          [doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at, doc.metadata ?? null],
        );
      }
    });

    await vectorCache.refreshFilenames(Array.from(new Set([...filenamesToDelete, ...docs.map(doc => doc.filename)])));
  });
}

export async function getVectorDocumentsByFilename(filename: string) {
  const db = await getDb();
  return await db.select<VectorDocument[]>(
    'select * from vector_documents where filename = $1 order by chunk_id',
    [filename],
  );
}

export async function deleteVectorDocumentsByFilename(filename: string) {
  return serializedWrite(async () => {
    const db = await getDb();
    await db.execute(
      'delete from vector_documents where filename = $1',
      [filename],
    );

    vectorCache.deleteByFilename(filename);
  });
}

export async function checkVectorDocumentExists(filename: string) {
  const db = await getDb();
  const result = await db.select<{ count: number }[]>(
    'select count(*) as count from vector_documents where filename = $1',
    [filename],
  );

  return result[0]?.count > 0;
}

export async function getSimilarDocuments(
  queryEmbedding: number[],
  limit = 5,
  threshold = 0.7,
): Promise<{ id: number; filename: string; content: string; similarity: number }[]> {
  if (vectorCache.needsUpdate()) {
    await vectorCache.update();
  }

  const cachedVectors = vectorCache.getAll();
  if (!cachedVectors.length) return [];

  return cachedVectors
    .map(doc => ({
      id: doc.id,
      filename: doc.filename,
      content: doc.content,
      similarity: cosineSimilarity(queryEmbedding, doc.embedding),
    }))
    .filter(doc => doc.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  // ponytail: 维度不符返回 0，与 memories.ts 保持一致；统一公共实现留待去重任务
  if (vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function clearVectorDb() {
  return serializedWrite(async () => {
    const db = await getDb();
    await db.execute(`
      delete from vector_documents
    `);

    vectorCache.clear();
  });
}

export async function getAllVectorDocumentFilenames() {
  const db = await getDb();
  return await db.select<{ filename: string }[]>(`
    select distinct filename from vector_documents
  `);
}

export async function refreshVectorCache() {
  await vectorCache.update();
}

export async function getAllVectorEmbeddingDocuments(): Promise<VectorEmbeddingDocument[]> {
  if (vectorCache.needsUpdate()) {
    await vectorCache.update();
  }

  return vectorCache.getAll().map(doc => ({
    id: doc.id,
    filename: doc.filename,
    chunk_id: doc.chunk_id,
    content: doc.content,
    embedding: [...doc.embedding],
    updated_at: doc.updated_at,
    metadata: doc.metadata ?? null,
  }));
}

export function getVectorCacheStats() {
  return vectorCache.stats();
}

// Return file-level averaged embeddings for semantic graph computation
export async function getFileEmbeddings(): Promise<Map<string, number[]>> {
  if (vectorCache.needsUpdate()) {
    await vectorCache.update();
  }

  const allDocs = vectorCache.getAll();
  const chunksByFile = new Map<string, number[][]>();

  for (const doc of allDocs) {
    if (!chunksByFile.has(doc.filename)) {
      chunksByFile.set(doc.filename, []);
    }
    chunksByFile.get(doc.filename)!.push(doc.embedding);
  }

  // Average embeddings per file
  const result = new Map<string, number[]>();
  for (const [filename, embeddings] of chunksByFile) {
    if (embeddings.length === 0) continue;
    const dim = embeddings[0].length;
    const avg = new Array<number>(dim).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        avg[i] += emb[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      avg[i] /= embeddings.length;
    }
    result.set(filename, avg);
  }

  return result;
}
