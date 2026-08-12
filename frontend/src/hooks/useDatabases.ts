export type DatabaseConnection = {
  id: string;
  name: string;
  defaultDatabase: string;
  createdAt: number;
};

export type DatabaseCatalog = {
  id: string;
  name: string;
  defaultDatabase: string;
  databaseNames: string[];
};

export type DatabaseOverview = {
  databaseName: string;
  dbStats: Record<string, unknown>;
  collections: Array<{
    name: string;
    documentCount: number;
    sizeBytes: number;
    storageSizeBytes: number;
    indexCount: number;
    totalIndexSizeBytes: number;
  }>;
};

export type CollectionExplorer = {
  databaseName: string;
  collectionName: string;
  page: number;
  limit: number;
  hasMore: boolean;
  documents: Array<Record<string, unknown>>;
};

export type CollectionStats = {
  databaseName: string;
  collectionName: string;
  stats: {
    documentCount: number;
    sizeBytes: number;
    storageSizeBytes: number;
    indexCount: number;
    totalIndexSizeBytes: number;
  };
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function loadConnections() {
  return requestJson<{ items: DatabaseConnection[] }>('/api/databases');
}

export async function createConnection(input: { name: string; uri: string; defaultDatabase: string }) {
  return requestJson<{ item: DatabaseConnection }>('/api/databases', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function removeConnection(id: string) {
  await requestJson(`/api/databases/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function loadCatalog(id: string) {
  return requestJson<{ item: DatabaseCatalog }>(`/api/databases/${encodeURIComponent(id)}/catalog`);
}

export async function loadOverview(id: string, database?: string) {
  const params = database ? `?database=${encodeURIComponent(database)}` : '';
  return requestJson<{ item: DatabaseOverview }>(`/api/databases/${encodeURIComponent(id)}/overview${params}`);
}

export async function loadCollectionDocuments(
  id: string,
  collection: string,
  options: { database?: string; page?: number; limit?: number; filter?: string } = {}
) {
  const params = new URLSearchParams();
  if (options.database) params.set('database', options.database);
  if (options.page) params.set('page', String(options.page));
  if (options.limit) params.set('limit', String(options.limit));
  if (options.filter) params.set('filter', options.filter);
  const query = params.toString();
  return requestJson<{ item: CollectionExplorer }>(
    `/api/databases/${encodeURIComponent(id)}/collections/${encodeURIComponent(collection)}/documents${query ? `?${query}` : ''}`
  );
}

export async function loadDatabaseNames(id: string) {
  return requestJson<{ item: DatabaseCatalog }>(`/api/databases/${encodeURIComponent(id)}/catalog`);
}

export async function loadCollectionStats(id: string, collection: string, database?: string) {
  const params = database ? `?database=${encodeURIComponent(database)}` : '';
  return requestJson<{ item: CollectionStats }>(
    `/api/databases/${encodeURIComponent(id)}/collections/${encodeURIComponent(collection)}/stats${params}`
  );
}
