import { EventEmitter } from 'node:events';
import { getSnapshots, detectMongoContainers } from './lib/docker.js';
import { findWorkingUri } from './lib/mongo.js';
import { createDatabaseConnection, deleteDatabaseConnection, listDatabaseConnections, recordSnapshots } from './lib/store.js';
import { encryptSecret } from './lib/crypto.js';
import type { ContainerSnapshot, MonitorStatus } from './types.js';

export const collectorEvents = new EventEmitter();
let latest: ContainerSnapshot[] = [];
let status: MonitorStatus = { connected: false, mode: 'unavailable', message: 'Waiting for first collection' };

export function getLatest() { return { snapshots: latest, status }; }

async function autoDetectDatabases() {
  const mongoContainers = await detectMongoContainers();
  
  const allConnections = listDatabaseConnections();
  const existingAutoIds = allConnections
    .filter(conn => conn.id.startsWith('auto-'))
    .map(conn => conn.id);
    
  const detectedIds = new Set<string>();

  for (const container of mongoContainers) {
    const connId = `auto-${container.id}`;
    detectedIds.add(connId);

    if (!existingAutoIds.includes(connId)) {
      if (process.env.DEMO_MODE === 'true') {
        const name = `Mongo DB (${container.name})`;
        const encrypted = encryptSecret('mongodb://localhost:27017');
        createDatabaseConnection({
          id: connId,
          name,
          defaultDatabase: 'shop_db',
          encryptedUri: encrypted.encryptedUri,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          createdAt: Date.now()
        });
        console.log(`[Collector] Registered demo auto-detected connection for container ${container.name}`);
      } else {
        const workingUri = await findWorkingUri(container.uris);
        if (workingUri) {
          const name = `Mongo DB (${container.name})`;
          const encrypted = encryptSecret(workingUri);
          createDatabaseConnection({
            id: connId,
            name,
            defaultDatabase: '',
            encryptedUri: encrypted.encryptedUri,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            createdAt: Date.now()
          });
          console.log(`[Collector] Registered auto-detected connection for container ${container.name} with URI: ${workingUri}`);
        } else {
          console.log(`[Collector] Found MongoDB container ${container.name} but could not establish a connection.`);
        }
      }
    }
  }

  // Clean up auto-detected connections for stopped containers
  for (const existingId of existingAutoIds) {
    if (!detectedIds.has(existingId)) {
      deleteDatabaseConnection(existingId);
      console.log(`[Collector] Removed auto-detected connection ${existingId} as container is no longer running`);
    }
  }
}

async function collect() {
  const result = await getSnapshots();
  latest = result.snapshots;
  status = { ...result.status, lastCollectedAt: Date.now() };
  if (latest.length) recordSnapshots(latest);

  // Trigger background database auto-detection
  void autoDetectDatabases().catch((err) => {
    console.error('[Collector] Error during database auto-detection:', err);
  });

  collectorEvents.emit('snapshot', getLatest());
}

export function startCollector() {
  void collect();
  return setInterval(() => void collect(), 10_000);
}
