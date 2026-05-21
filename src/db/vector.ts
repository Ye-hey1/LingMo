import { getDb, runDbTransaction, serializedWrite } from './index';

export interface VectorDocument {
  id: number;
  filename: string;
  chunk_id: number;
  content: string;
  embedding: string;
  updated_at: number;
}

interface CachedVector {
  id: number;
  filename: string;
  content: string;
  embedding: number[];
  updated_at: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000

class VectorCache {
  private cache: Map<number, CachedVector> = new Map();
  private vectorsByFilename: Map<string, number[]> = new Map();
  private lastUpdate = 0;
  private cacheVersion = 0;
  private cacheTtlMs: number;

  constructor(cacheTtlMs = DEFAULT_CACHE_TTL_MS) {
    this.cacheTtlMs = cacheTtlMs
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

  async update() {
    const db = await getDb();
    const docs = await db.select<VectorDocument[]>(`
      select id, filename, content, embedding, updated_at from vector_documents
    `);

    this.cache.clear();
    this.vectorsByFilename.clear();

    for (const doc of docs) {
      try {
        const embedding = JSON.parse(doc.embedding) as number[];
        const cached: CachedVector = {
          id: doc.id,
          filename: doc.filename,
          content: doc.content,
          embedding,
          updated_at: doc.updated_at,
        };
        this.cache.set(doc.id, cached);

        if (!this.vectorsByFilename.has(doc.filename)) {
          this.vectorsByFilename.set(doc.filename, []);
        }
        this.vectorsByFilename.get(doc.filename)!.push(doc.id);
      } catch (error) {
        console.error(`Failed to parse embedding for doc ${doc.id}:`, error);
      }
    }

    this.lastUpdate = Date.now();
    this.cacheVersion++;
  }

  add(doc: VectorDocument) {
    try {
      const embedding = JSON.parse(doc.embedding) as number[];
      const cached: CachedVector = {
        id: doc.id,
        filename: doc.filename,
        content: doc.content,
        embedding,
        updated_at: doc.updated_at,
      };
      this.cache.set(doc.id, cached);

      if (!this.vectorsByFilename.has(doc.filename)) {
        this.vectorsByFilename.set(doc.filename, []);
      }
      this.vectorsByFilename.get(doc.filename)!.push(doc.id);
      this.cacheVersion++;
    } catch (error) {
      console.error(`Failed to add vector to cache for doc ${doc.id}:`, error);
    }
  }

  deleteByFilename(filename: string) {
    const ids = this.vectorsByFilename.get(filename) || [];
    for (const id of ids) {
      this.cache.delete(id);
    }
    this.vectorsByFilename.delete(filename);
    this.cacheVersion++;
  }

  needsUpdate(): boolean {
    return Date.now() - this.lastUpdate > this.cacheTtlMs || this.cache.size === 0;
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
      'insert into vector_documents (filename, chunk_id, content, embedding, updated_at) values ($1, $2, $3, $4, $5) on conflict(filename, chunk_id) do update set content = excluded.content, embedding = excluded.embedding, updated_at = excluded.updated_at',
      [doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at],
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
    await runDbTransaction(db, async () => {
      for (const doc of docs) {
        await db.execute(
          'insert into vector_documents (filename, chunk_id, content, embedding, updated_at) values ($1, $2, $3, $4, $5) on conflict(filename, chunk_id) do update set content = excluded.content, embedding = excluded.embedding, updated_at = excluded.updated_at',
          [doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at],
        );
      }
    });
    await vectorCache.update();
  })
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

    await runDbTransaction(db, async () => {
      for (const filenameToDelete of filenamesToDelete) {
        await db.execute(
          'delete from vector_documents where filename = $1',
          [filenameToDelete],
        );
      }

      for (const doc of docs) {
        await db.execute(
          'insert into vector_documents (filename, chunk_id, content, embedding, updated_at) values ($1, $2, $3, $4, $5) on conflict(filename, chunk_id) do update set content = excluded.content, embedding = excluded.embedding, updated_at = excluded.updated_at',
          [doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at],
        );
      }
    });

    for (const filenameToDelete of filenamesToDelete) {
      vectorCache.deleteByFilename(filenameToDelete);
    }
    await vectorCache.update();
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
  if (vecA.length !== vecB.length) {
    throw new Error('Vector dimensions do not match');
  }

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

    await vectorCache.update();
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
