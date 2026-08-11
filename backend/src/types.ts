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
