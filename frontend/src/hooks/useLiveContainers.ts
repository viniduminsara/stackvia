import { useEffect, useState } from 'react';

export type Container = {
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

type Feed = {
  snapshots: Container[];
  status: { connected: boolean; mode: 'docker' | 'demo' | 'unavailable'; message?: string; lastCollectedAt?: number };
};

const initial: Feed = { snapshots: [], status: { connected: false, mode: 'unavailable' } };

export function useLiveContainers() {
  const [feed, setFeed] = useState<Feed>(initial);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/stream/stats');
    source.onopen = () => setIsStreaming(true);
    source.onmessage = ({ data }) => setFeed(JSON.parse(data) as Feed);
    source.onerror = () => setIsStreaming(false);
    return () => source.close();
  }, []);

  return { ...feed, isStreaming };
}
