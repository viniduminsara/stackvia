import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  createDatabaseConnection,
  deleteDatabaseConnection,
  getDatabaseConnection,
  listDatabaseConnections
} from '../lib/store.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import {
  getCollectionOverview,
  getDatabaseOverview,
  getDocuments,
  listDatabases
} from '../lib/mongo.js';

export const databasesRouter = Router();

function respondError(res: Parameters<typeof databasesRouter.get>[1] extends (...args: infer Args) => unknown ? Args[1] : never, status: number, message: string) {
  return res.status(status).json({ error: message });
}

function readText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveConnectionUri(connection: ReturnType<typeof getDatabaseConnection>) {
  if (!connection) return null;
  return decryptSecret({
    encryptedUri: connection.encryptedUri,
    iv: connection.iv,
    authTag: connection.authTag
  });
}

function resolveDatabaseName(uri: string, explicit?: string, fallback?: string) {
  if (explicit?.trim()) return explicit.trim();
  if (fallback?.trim()) return fallback.trim();
  try {
    const parsed = new URL(uri);
    const path = parsed.pathname.replace(/^\/+/, '');
    return path || 'admin';
  } catch {
    return 'admin';
  }
}

databasesRouter.get('/', (_req, res) => {
  res.json({ items: listDatabaseConnections() });
});

databasesRouter.post('/', (req, res) => {
  const name = readText(req.body?.name);
  const uri = readText(req.body?.uri);
  const defaultDatabase = readText(req.body?.defaultDatabase);

  if (!name) return respondError(res, 400, 'Connection name is required');
  if (!uri || !/^mongodb(\+srv)?:\/\//i.test(uri)) return respondError(res, 400, 'A valid MongoDB URI is required');

  const id = randomUUID();
  const encrypted = encryptSecret(uri);
  const record = createDatabaseConnection({
    id,
    name,
    defaultDatabase,
    encryptedUri: encrypted.encryptedUri,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    createdAt: Date.now()
  });

  res.status(201).json({ item: record });
});

databasesRouter.delete('/:id', (req, res) => {
  const result = deleteDatabaseConnection(req.params.id);
  if (!result.changes) return respondError(res, 404, 'Connection not found');
  res.status(204).end();
});

databasesRouter.get('/:id/catalog', async (req, res) => {
  const connection = getDatabaseConnection(req.params.id);
  if (!connection) return respondError(res, 404, 'Connection not found');

  if (process.env.DEMO_MODE === 'true') {
    return res.json({
      item: {
        id: connection.id,
        name: connection.name,
        defaultDatabase: connection.defaultDatabase || 'shop_db',
        databaseNames: ['admin', 'config', 'local', 'shop_db', 'users_db']
      }
    });
  }

  try {
    const uri = resolveConnectionUri(connection);
    if (!uri) return respondError(res, 500, 'Unable to unlock the stored connection');
    const catalog = await listDatabases(uri);
    res.json({
      item: {
        id: connection.id,
        name: connection.name,
        defaultDatabase: connection.defaultDatabase || catalog.defaultDatabase,
        databaseNames: catalog.databaseNames
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read MongoDB catalog';
    respondError(res, 502, message);
  }
});

databasesRouter.get('/:id/overview', async (req, res) => {
  const connection = getDatabaseConnection(req.params.id);
  if (!connection) return respondError(res, 404, 'Connection not found');

  if (process.env.DEMO_MODE === 'true') {
    const databaseName = readText(req.query.database) || connection.defaultDatabase || 'shop_db';
    if (databaseName === 'shop_db') {
      return res.json({
        item: {
          databaseName: 'shop_db',
          dbStats: { collections: 3, objects: 1250, dataSize: 450000, storageSize: 1024000 },
          collections: [
            { name: 'products', documentCount: 820, sizeBytes: 250000, storageSizeBytes: 512000, indexCount: 2, totalIndexSizeBytes: 32000 },
            { name: 'orders', documentCount: 410, sizeBytes: 180000, storageSizeBytes: 450000, indexCount: 3, totalIndexSizeBytes: 48000 },
            { name: 'customers', documentCount: 20, sizeBytes: 20000, storageSizeBytes: 62000, indexCount: 1, totalIndexSizeBytes: 16000 }
          ]
        }
      });
    } else {
      return res.json({
        item: {
          databaseName,
          dbStats: { collections: 1, objects: 5, dataSize: 1000, storageSize: 4096 },
          collections: [
            { name: 'logs', documentCount: 5, sizeBytes: 1000, storageSizeBytes: 4096, indexCount: 1, totalIndexSizeBytes: 8192 }
          ]
        }
      });
    }
  }

  try {
    const uri = resolveConnectionUri(connection);
    if (!uri) return respondError(res, 500, 'Unable to unlock the stored connection');
    const databaseName = resolveDatabaseName(uri, readText(req.query.database), connection.defaultDatabase);
    const overview = await getDatabaseOverview(uri, databaseName);
    res.json({ item: overview });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read database statistics';
    respondError(res, 502, message);
  }
});

databasesRouter.get('/:id/collections', async (req, res) => {
  const connection = getDatabaseConnection(req.params.id);
  if (!connection) return respondError(res, 404, 'Connection not found');

  if (process.env.DEMO_MODE === 'true') {
    const databaseName = readText(req.query.database) || connection.defaultDatabase || 'shop_db';
    const collections = databaseName === 'shop_db' ? [
      { name: 'products', documentCount: 820, sizeBytes: 250000, storageSizeBytes: 512000, indexCount: 2, totalIndexSizeBytes: 32000 },
      { name: 'orders', documentCount: 410, sizeBytes: 180000, storageSizeBytes: 450000, indexCount: 3, totalIndexSizeBytes: 48000 },
      { name: 'customers', documentCount: 20, sizeBytes: 20000, storageSizeBytes: 62000, indexCount: 1, totalIndexSizeBytes: 16000 }
    ] : [
      { name: 'logs', documentCount: 5, sizeBytes: 1000, storageSizeBytes: 4096, indexCount: 1, totalIndexSizeBytes: 8192 }
    ];
    return res.json({ item: { databaseName, collections } });
  }

  try {
    const uri = resolveConnectionUri(connection);
    if (!uri) return respondError(res, 500, 'Unable to unlock the stored connection');
    const databaseName = resolveDatabaseName(uri, readText(req.query.database), connection.defaultDatabase);
    const overview = await getDatabaseOverview(uri, databaseName);
    res.json({ item: { databaseName: overview.databaseName, collections: overview.collections } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read collection list';
    respondError(res, 502, message);
  }
});

databasesRouter.get('/:id/collections/:collection/stats', async (req, res) => {
  const connection = getDatabaseConnection(req.params.id);
  if (!connection) return respondError(res, 404, 'Connection not found');

  if (process.env.DEMO_MODE === 'true') {
    const collection = req.params.collection;
    const databaseName = readText(req.query.database) || connection.defaultDatabase || 'shop_db';
    let stats = { documentCount: 5, sizeBytes: 1000, storageSizeBytes: 4096, indexCount: 1, totalIndexSizeBytes: 8192 };
    if (databaseName === 'shop_db') {
      if (collection === 'products') {
        stats = { documentCount: 820, sizeBytes: 250000, storageSizeBytes: 512000, indexCount: 2, totalIndexSizeBytes: 32000 };
      } else if (collection === 'orders') {
        stats = { documentCount: 410, sizeBytes: 180000, storageSizeBytes: 450000, indexCount: 3, totalIndexSizeBytes: 48000 };
      } else if (collection === 'customers') {
        stats = { documentCount: 20, sizeBytes: 20000, storageSizeBytes: 62000, indexCount: 1, totalIndexSizeBytes: 16000 };
      }
    }
    return res.json({
      item: {
        databaseName,
        collectionName: collection,
        stats
      }
    });
  }

  try {
    const uri = resolveConnectionUri(connection);
    if (!uri) return respondError(res, 500, 'Unable to unlock the stored connection');
    const databaseName = resolveDatabaseName(uri, readText(req.query.database), connection.defaultDatabase);
    const item = await getCollectionOverview(uri, databaseName, req.params.collection);
    res.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read collection statistics';
    respondError(res, 502, message);
  }
});

databasesRouter.get('/:id/collections/:collection/documents', async (req, res) => {
  const connection = getDatabaseConnection(req.params.id);
  if (!connection) return respondError(res, 404, 'Connection not found');

  if (process.env.DEMO_MODE === 'true') {
    const collection = req.params.collection;
    const databaseName = readText(req.query.database) || connection.defaultDatabase || 'shop_db';
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 25);
    
    let mockDocs: Array<Record<string, unknown>> = [];
    if (databaseName === 'shop_db') {
      if (collection === 'products') {
        mockDocs = Array.from({ length: 50 }).map((_, i) => ({
          _id: `65c92c90f23a1a45b84c8a${String(i + 1).padStart(2, '0')}`,
          name: `Product ${i + 1}`,
          category: i % 3 === 0 ? 'Electronics' : i % 3 === 1 ? 'Clothing' : 'Home & Kitchen',
          price: parseFloat((15.99 + i * 4.5).toFixed(2)),
          stock: Math.floor(10 + (i * 7) % 120),
          rating: parseFloat((4.0 + (i % 10) * 0.1).toFixed(1)),
          isActive: i % 5 !== 0,
          createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString()
        }));
      } else if (collection === 'orders') {
        mockDocs = Array.from({ length: 30 }).map((_, i) => ({
          _id: `65c92c90f23a1a45b84c8b${String(i + 1).padStart(2, '0')}`,
          orderNumber: `ORD-${1000 + i}`,
          customerId: `65c92c90f23a1a45b84c8c${String((i % 5) + 1).padStart(2, '0')}`,
          total: parseFloat((25.5 + i * 15.3).toFixed(2)),
          status: i % 4 === 0 ? 'pending' : i % 4 === 1 ? 'processing' : i % 4 === 2 ? 'shipped' : 'delivered',
          items: [
            { productId: `65c92c90f23a1a45b84c8a0${(i % 3) + 1}`, qty: (i % 2) + 1, price: 19.99 }
          ],
          createdAt: new Date(Date.now() - i * 6 * 60 * 60 * 1000).toISOString()
        }));
      } else if (collection === 'customers') {
        mockDocs = Array.from({ length: 5 }).map((_, i) => ({
          _id: `65c92c90f23a1a45b84c8c${String(i + 1).padStart(2, '0')}`,
          name: ['Alice Johnson', 'Bob Smith', 'Charlie Brown', 'Diana Prince', 'Evan Wright'][i],
          email: ['alice@example.com', 'bob@example.com', 'charlie@example.com', 'diana@example.com', 'evan@example.com'][i],
          role: i === 0 ? 'admin' : 'user',
          metadata: {
            loginCount: 5 + i * 3,
            lastLogin: new Date(Date.now() - i * 12 * 60 * 60 * 1000).toISOString()
          },
          isActive: i !== 4
        }));
      }
    } else {
      mockDocs = Array.from({ length: 3 }).map((_, i) => ({
        _id: `65c92c90f23a1a45b84c8d${String(i + 1).padStart(2, '0')}`,
        logLevel: i === 0 ? 'info' : i === 1 ? 'warn' : 'error',
        message: [`Service started on port 3000`, `High memory usage detected`, `Database connection failed`][i],
        timestamp: new Date().toISOString()
      }));
    }

    const filterText = readText(req.query.filter);
    if (filterText) {
      try {
        const parsedFilter = JSON.parse(filterText);
        mockDocs = mockDocs.filter(doc => {
          for (const [key, val] of Object.entries(parsedFilter)) {
            if (doc[key] !== val) return false;
          }
          return true;
        });
      } catch {
        // ignore filter parsing error
      }
    }

    const start = (page - 1) * limit;
    const paginatedDocs = mockDocs.slice(start, start + limit);
    const hasMore = mockDocs.length > start + limit;

    return res.json({
      item: {
        databaseName,
        collectionName: collection,
        page,
        limit,
        hasMore,
        documents: paginatedDocs
      }
    });
  }

  try {
    const uri = resolveConnectionUri(connection);
    if (!uri) return respondError(res, 500, 'Unable to unlock the stored connection');
    const databaseName = resolveDatabaseName(uri, readText(req.query.database), connection.defaultDatabase);
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 25);
    const filterText = readText(req.query.filter);
    let filter: Record<string, unknown> = {};

    if (filterText) {
      try {
        const parsed = JSON.parse(filterText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) filter = parsed as Record<string, unknown>;
        else return respondError(res, 400, 'Filter must be a JSON object');
      } catch {
        return respondError(res, 400, 'Filter must be valid JSON');
      }
    }

    const item = await getDocuments(uri, databaseName, req.params.collection, page, limit, filter);
    res.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read documents';
    respondError(res, 502, message);
  }
});
