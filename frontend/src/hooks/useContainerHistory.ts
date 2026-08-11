import { useEffect, useState } from 'react';
import type { Container } from './useLiveContainers';

export type HistoryPoint = {
  timestamp: number;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
};

const HISTORY_LIMIT = 144;

export function snapshotToHistoryPoint(snapshot: Pick<Container, 'timestamp' | 'cpuPercent' | 'memoryBytes' | 'memoryLimitBytes' | 'networkRxBytes' | 'networkTxBytes'>): HistoryPoint {
  return {
    timestamp: snapshot.timestamp,
    cpuPercent: snapshot.cpuPercent,
    memoryBytes: snapshot.memoryBytes,
    memoryLimitBytes: snapshot.memoryLimitBytes,
    memoryPercent: snapshot.memoryLimitBytes ? (snapshot.memoryBytes / snapshot.memoryLimitBytes) * 100 : 0,
    networkRxBytes: snapshot.networkRxBytes,
    networkTxBytes: snapshot.networkTxBytes
  };
}

export function mergeHistorySeries(...series: HistoryPoint[][]) {
  const merged = new Map<number, HistoryPoint>();
  for (const points of series) {
    for (const point of points) merged.set(point.timestamp, point);
  }
  return [...merged.values()].sort((left, right) => left.timestamp - right.timestamp).slice(-HISTORY_LIMIT);
}

export function appendHistoryPoint(points: HistoryPoint[], point: HistoryPoint) {
  return mergeHistorySeries(points, [point]);
}

function normalizeHistoryPoint(point: HistoryPoint) {
  return {
    ...point,
    memoryPercent: point.memoryLimitBytes ? (point.memoryBytes / point.memoryLimitBytes) * 100 : 0
  };
}

export function useContainerHistory(containerId: string | null, liveContainer: Container | null) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    setHistory([]);

    if (!containerId) return () => undefined;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/containers/${encodeURIComponent(containerId)}/history?hours=24`, { signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as { items?: HistoryPoint[] };
        if (cancelled) return;
        const items = (payload.items ?? []).map(normalizeHistoryPoint);
        setHistory((current) => mergeHistorySeries(items, current));
      } catch {
        if (!cancelled) setHistory([]);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [containerId]);

  useEffect(() => {
    if (!containerId || !liveContainer) return;
    const point = snapshotToHistoryPoint(liveContainer);
    setHistory((current) => appendHistoryPoint(current, point));
  }, [containerId, liveContainer?.timestamp]);

  return history;
}
