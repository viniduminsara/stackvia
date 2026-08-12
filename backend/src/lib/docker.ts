import Docker from 'dockerode';
import type { ContainerSnapshot, MonitorStatus } from '../types.js';

export const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const demoStartedAt = Date.now();

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function totalNetwork(networks: Record<string, { rx_bytes?: number; tx_bytes?: number }> | undefined) {
  return Object.values(networks ?? {}).reduce(
    (total, network) => ({ rx: total.rx + number(network.rx_bytes), tx: total.tx + number(network.tx_bytes) }),
    { rx: 0, tx: 0 }
  );
}

function demoSnapshots(): ContainerSnapshot[] {
  const t = Date.now() / 1000;
  const elapsedSeconds = (Date.now() - demoStartedAt) / 1000;
  const values = [
    ['b3a12df5', 'stackvia-api', 'stackvia/api:latest', 16.8, 186, 512],
    ['a7cb8891', 'mongodb-primary', 'mongo:7.0', 9.6, 624, 2048],
    ['c1ed230e', 'caddy', 'caddy:2-alpine', 1.7, 32, 256]
  ] as const;
  return values.map(([id, name, image, baseCpu, memoryMb, limitMb], index) => {
    const wave = Math.sin(t / 7 + index * 2.1);
    const cpuPercent = Math.max(0.2, baseCpu + wave * (index === 0 ? 8 : 3));
    const memoryBytes = Math.round((memoryMb + wave * 6) * 1024 * 1024);
    return {
      id, name, image, state: 'running', cpuPercent, memoryBytes,
      memoryLimitBytes: limitMb * 1024 * 1024,
      memoryPercent: (memoryBytes / (limitMb * 1024 * 1024)) * 100,
      networkRxBytes: Math.round(18_000_000 + index * 6_200_000 + elapsedSeconds * (1500 + index * 300)),
      networkTxBytes: Math.round(8_000_000 + index * 1_900_000 + elapsedSeconds * (700 + index * 180)),
      timestamp: Date.now()
    };
  });
}

export async function getSnapshots(): Promise<{ snapshots: ContainerSnapshot[]; status: MonitorStatus }> {
  if (process.env.DEMO_MODE === 'true') {
    return { snapshots: demoSnapshots(), status: { connected: true, mode: 'demo', message: 'Demo telemetry' } };
  }

  try {
    const containers = await docker.listContainers({ all: true });
    const snapshots = await Promise.all(containers.map(async (container) => {
      const name = container.Names[0]?.replace(/^\//, '') ?? container.Id.slice(0, 12);
      if (container.State !== 'running') {
        return { id: container.Id, name, image: container.Image, state: container.State as ContainerSnapshot['state'], cpuPercent: 0, memoryBytes: 0, memoryLimitBytes: 0, memoryPercent: 0, networkRxBytes: 0, networkTxBytes: 0, timestamp: Date.now() };
      }
      const stats = await docker.getContainer(container.Id).stats({ stream: false });
      const cpuDelta = number(stats.cpu_stats.cpu_usage?.total_usage) - number(stats.precpu_stats.cpu_usage?.total_usage);
      const systemDelta = number(stats.cpu_stats.system_cpu_usage) - number(stats.precpu_stats.system_cpu_usage);
      const cores = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage?.percpu_usage?.length || 1;
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cores * 100 : 0;
      const rawMemory = number(stats.memory_stats.usage);
      const cache = number((stats.memory_stats.stats as Record<string, unknown> | undefined)?.cache);
      const memoryBytes = Math.max(0, rawMemory - cache);
      const memoryLimitBytes = number(stats.memory_stats.limit);
      const network = totalNetwork(stats.networks);
      return { id: container.Id, name, image: container.Image, state: 'running' as const, cpuPercent, memoryBytes, memoryLimitBytes, memoryPercent: memoryLimitBytes ? (memoryBytes / memoryLimitBytes) * 100 : 0, networkRxBytes: network.rx, networkTxBytes: network.tx, timestamp: Date.now() };
    }));
    return { snapshots, status: { connected: true, mode: 'docker' } };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to reach the Docker socket';
    return { snapshots: [], status: { connected: false, mode: 'unavailable', message } };
  }
}

export async function detectMongoContainers() {
  if (process.env.DEMO_MODE === 'true') {
    return [
      {
        id: 'demo-mongodb-primary',
        name: 'mongodb-primary',
        image: 'mongo:7.0',
        uris: ['mongodb://localhost:27017']
      }
    ];
  }

  try {
    const containers = await docker.listContainers({ all: false });
    const mongoContainers = [];

    for (const container of containers) {
      const isMongoImage = container.Image.toLowerCase().includes('mongo');
      const isMongoName = container.Names.some((name) => name.toLowerCase().includes('mongo'));
      const hasMongoPort = container.Ports.some((p) => p.PrivatePort === 27017);

      if (isMongoImage || isMongoName || hasMongoPort) {
        const uris: string[] = [];
        const containerName = container.Names[0]?.replace(/^\//, '');

        // 1. Try container name
        if (containerName) {
          uris.push(`mongodb://${containerName}:27017`);
        }

        // 2. Try container network IPs
        if (container.NetworkSettings?.Networks) {
          for (const net of Object.values(container.NetworkSettings.Networks)) {
            if (net.IPAddress) {
              uris.push(`mongodb://${net.IPAddress}:27017`);
            }
          }
        }

        // 3. Try host mapped ports (useful if running in host mode or dev mode)
        if (container.Ports) {
          for (const port of container.Ports) {
            if (port.PrivatePort === 27017 && port.PublicPort) {
              uris.push(`mongodb://127.0.0.1:${port.PublicPort}`);
              uris.push(`mongodb://host.docker.internal:${port.PublicPort}`);
              uris.push(`mongodb://localhost:${port.PublicPort}`);
            }
          }
        }

        const uniqueUris = Array.from(new Set(uris));

        mongoContainers.push({
          id: container.Id,
          name: containerName || container.Id.slice(0, 12),
          image: container.Image,
          uris: uniqueUris
        });
      }
    }
    return mongoContainers;
  } catch (error) {
    console.error('Failed to detect MongoDB containers:', error);
    return [];
  }
}
