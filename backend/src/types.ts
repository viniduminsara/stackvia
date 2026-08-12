export type ContainerSnapshot = {
  id: string;
  name: string;
  image: string;
  state: 'running' | 'exited' | 'paused' | 'unknown';
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  timestamp: number;
};

export type MonitorStatus = {
  connected: boolean;
  mode: 'docker' | 'demo' | 'unavailable';
  message?: string;
  lastCollectedAt?: number;
};

export type DatabaseConnection = {
  id: string;
  name: string;
  defaultDatabase: string;
  createdAt: number;
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

export type ExplorerDocument = {
  _id: unknown;
  [key: string]: unknown;
};

export type AdminUser = {
  username: string;
  passwordHash: string;
  createdAt: number;
};

