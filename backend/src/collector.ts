import { EventEmitter } from 'node:events';
import { getSnapshots } from './lib/docker.js';
import { recordSnapshots } from './lib/store.js';
import type { ContainerSnapshot, MonitorStatus } from './types.js';

export const collectorEvents = new EventEmitter();
let latest: ContainerSnapshot[] = [];
let status: MonitorStatus = { connected: false, mode: 'unavailable', message: 'Waiting for first collection' };

export function getLatest() { return { snapshots: latest, status }; }

async function collect() {
  const result = await getSnapshots();
  latest = result.snapshots;
  status = { ...result.status, lastCollectedAt: Date.now() };
  if (latest.length) recordSnapshots(latest);
  collectorEvents.emit('snapshot', getLatest());
}

export function startCollector() {
  void collect();
  return setInterval(() => void collect(), 10_000);
}
