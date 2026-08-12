import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ContainerSnapshot, DatabaseConnection } from '../types.js';

const dataFile = resolve(process.env.DATA_DIR ?? './data', 'stackvia.db');
mkdirSync(dirname(dataFile), { recursive: true });

export const db = new Database(dataFile);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS container_metrics (
    id INTEGER PRIMARY KEY,
    container_id TEXT NOT NULL,
    container_name TEXT NOT NULL,
    cpu_percent REAL NOT NULL,
    memory_bytes INTEGER NOT NULL,
    memory_limit_bytes INTEGER NOT NULL,
    network_rx_bytes INTEGER NOT NULL,
    network_tx_bytes INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_container_metrics_history
    ON container_metrics(container_id, recorded_at);

  CREATE TABLE IF NOT EXISTS database_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    default_database TEXT NOT NULL DEFAULT '',
    encrypted_uri TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const databaseConnectionsColumns = new Set<string>(
  db.prepare("PRAGMA table_info(database_connections)").all().map((column) => (column as { name: string }).name)
);

if (!databaseConnectionsColumns.has('default_database')) {
  db.exec("ALTER TABLE database_connections ADD COLUMN default_database TEXT NOT NULL DEFAULT ''");
}

const insertMetric = db.prepare(`
  INSERT INTO container_metrics (
    container_id, container_name, cpu_percent, memory_bytes, memory_limit_bytes,
    network_rx_bytes, network_tx_bytes, recorded_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertConnection = db.prepare(`
  INSERT INTO database_connections (
    id, name, default_database, encrypted_uri, iv, auth_tag, created_at
  ) VALUES (@id, @name, @defaultDatabase, @encryptedUri, @iv, @authTag, @createdAt)
`);

const listConnectionsStatement = db.prepare(`
  SELECT id, name, default_database AS defaultDatabase, created_at AS createdAt
  FROM database_connections
  ORDER BY created_at DESC
`);

const getConnectionStatement = db.prepare(`
  SELECT id, name, default_database AS defaultDatabase, encrypted_uri AS encryptedUri,
    iv, auth_tag AS authTag, created_at AS createdAt
  FROM database_connections
  WHERE id = ?
`);

const deleteConnectionStatement = db.prepare(`
  DELETE FROM database_connections WHERE id = ?
`);

export function recordSnapshots(snapshots: ContainerSnapshot[]) {
  const save = db.transaction((items: ContainerSnapshot[]) => {
    for (const item of items) {
      insertMetric.run(
        item.id, item.name, item.cpuPercent, item.memoryBytes, item.memoryLimitBytes,
        item.networkRxBytes, item.networkTxBytes, item.timestamp
      );
    }
  });
  save(snapshots);
}

export function historyFor(containerId: string, from: number) {
  return db.prepare(`
    SELECT recorded_at AS timestamp, cpu_percent AS cpuPercent, memory_bytes AS memoryBytes,
      memory_limit_bytes AS memoryLimitBytes, network_rx_bytes AS networkRxBytes,
      network_tx_bytes AS networkTxBytes
    FROM container_metrics
    WHERE container_id = ? AND recorded_at >= ?
    ORDER BY recorded_at ASC
  `).all(containerId, from);
}

export function listDatabaseConnections(): DatabaseConnection[] {
  return listConnectionsStatement.all() as DatabaseConnection[];
}

export function getDatabaseConnection(id: string) {
  return getConnectionStatement.get(id) as
    | (DatabaseConnection & {
        encryptedUri: string;
        iv: string;
        authTag: string;
      })
    | undefined;
}

export function createDatabaseConnection(connection: {
  id: string;
  name: string;
  defaultDatabase: string;
  encryptedUri: string;
  iv: string;
  authTag: string;
  createdAt: number;
}) {
  insertConnection.run(connection);
  return connection;
}

export function deleteDatabaseConnection(id: string) {
  return deleteConnectionStatement.run(id);
}
