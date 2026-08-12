import { MongoClient } from 'mongodb';
import type { DatabaseOverview, ExplorerDocument } from '../types.js';

type DatabaseSummary = {
  name: string;
  sizeOnDisk?: number;
  empty?: boolean;
};

const MONGO_TIMEOUT_MS = 7000;
const QUERY_LIMIT = 100;
const PAGE_LIMIT = 25;

function createClient(uri: string) {
  return new MongoClient(uri, {
    serverSelectionTimeoutMS: MONGO_TIMEOUT_MS,
    connectTimeoutMS: MONGO_TIMEOUT_MS,
    socketTimeoutMS: MONGO_TIMEOUT_MS,
    maxIdleTimeMS: 10_000
  });
}

function resolveDatabaseName(uri: string, preferred?: string) {
  if (preferred?.trim()) return preferred.trim();
  try {
    const parsed = new URL(uri);
    const name = parsed.pathname.replace(/^\/+/, '');
    return name || 'admin';
  } catch {
    return 'admin';
  }
}

function sanitizeName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Database and collection names cannot be empty');
  if (trimmed.includes('\0')) throw new Error('Invalid MongoDB name');
  if (trimmed.startsWith('system.')) throw new Error('system collections are read-only');
  return trimmed;
}

function sanitizeCollectionName(value: string) {
  return sanitizeName(value);
}

async function withClient<T>(uri: string, action: (client: MongoClient) => Promise<T>) {
  const client = createClient(uri);
  try {
    await client.connect();
    return await action(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function findWorkingUri(uris: string[]): Promise<string | null> {
  for (const uri of uris) {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 1000,
      connectTimeoutMS: 1000,
      family: 4
    });
    try {
      await client.connect();
      await client.db().admin().ping();
      return uri;
    } catch {
      // Ignore connection error and try next candidate
    } finally {
      await client.close().catch(() => undefined);
    }
  }
  return null;
}

export async function listDatabases(uri: string) {
  return withClient(uri, async (client) => {
    const databases = await client.db().admin().listDatabases({ nameOnly: true }) as { databases: DatabaseSummary[] };
    return {
      defaultDatabase: resolveDatabaseName(uri),
      databaseNames: databases.databases.map((database) => database.name).sort((left, right) => left.localeCompare(right))
    };
  });
}

export async function getDatabaseOverview(uri: string, databaseName?: string): Promise<DatabaseOverview> {
  const resolvedDatabase = resolveDatabaseName(uri, databaseName);
  return withClient(uri, async (client) => {
    const db = client.db(resolvedDatabase);
    const dbStats = await db.command({ dbStats: 1, scale: 1 }, { timeoutMS: MONGO_TIMEOUT_MS });
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();

    const summaries = await Promise.all(collections.slice(0, QUERY_LIMIT).map(async (collection) => {
      try {
        const stats = await db.command({ collStats: collection.name, scale: 1 }, { timeoutMS: MONGO_TIMEOUT_MS });
        return {
          name: collection.name,
          documentCount: Number(stats.count ?? 0),
          sizeBytes: Number(stats.size ?? 0),
          storageSizeBytes: Number(stats.storageSize ?? 0),
          indexCount: Number(stats.nindexes ?? 0),
          totalIndexSizeBytes: Number(stats.totalIndexSize ?? 0)
        };
      } catch {
        return {
          name: collection.name,
          documentCount: 0,
          sizeBytes: 0,
          storageSizeBytes: 0,
          indexCount: 0,
          totalIndexSizeBytes: 0
        };
      }
    }));

    return {
      databaseName: resolvedDatabase,
      dbStats,
      collections: summaries.sort((left, right) => left.name.localeCompare(right.name))
    };
  });
}

export async function getCollectionOverview(uri: string, databaseName: string, collectionName: string) {
  const resolvedDatabase = resolveDatabaseName(uri, databaseName);
  const resolvedCollection = sanitizeCollectionName(collectionName);

  return withClient(uri, async (client) => {
    const db = client.db(resolvedDatabase);
    const stats = await db.command({ collStats: resolvedCollection, scale: 1 }, { timeoutMS: MONGO_TIMEOUT_MS });
    return {
      databaseName: resolvedDatabase,
      collectionName: resolvedCollection,
      stats: {
        documentCount: Number(stats.count ?? 0),
        sizeBytes: Number(stats.size ?? 0),
        storageSizeBytes: Number(stats.storageSize ?? 0),
        indexCount: Number(stats.nindexes ?? 0),
        totalIndexSizeBytes: Number(stats.totalIndexSize ?? 0)
      }
    };
  });
}

export async function getDocuments(uri: string, databaseName: string, collectionName: string, page = 1, limit = PAGE_LIMIT, filter: Record<string, unknown> = {}) {
  const resolvedDatabase = resolveDatabaseName(uri, databaseName);
  const resolvedCollection = sanitizeCollectionName(collectionName);
  const safePage = Math.max(1, Math.min(Number.isFinite(page) ? Math.trunc(page) : 1, 1000));
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : PAGE_LIMIT, PAGE_LIMIT));

  return withClient(uri, async (client) => {
    const collection = client.db(resolvedDatabase).collection<ExplorerDocument>(resolvedCollection);
    const cursor = collection
      .find(filter, {
        timeoutMS: MONGO_TIMEOUT_MS,
        limit: safeLimit + 1,
        skip: (safePage - 1) * safeLimit,
        sort: { _id: 1 }
      });

    const documents = await cursor.toArray();
    const hasMore = documents.length > safeLimit;
    return {
      databaseName: resolvedDatabase,
      collectionName: resolvedCollection,
      page: safePage,
      limit: safeLimit,
      hasMore,
      documents: documents.slice(0, safeLimit)
    };
  });
}
