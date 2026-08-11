import { useEffect, useMemo, useState } from 'react';
import type { Container } from './hooks/useLiveContainers';
import { useLiveContainers } from './hooks/useLiveContainers';
import { useContainerHistory, mergeHistorySeries, snapshotToHistoryPoint, type HistoryPoint } from './hooks/useContainerHistory';

type ContainerStateFilter = 'all' | 'running' | 'paused' | 'exited' | 'unknown';

const icons = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56v.1h-3v-.1A1.7 1.7 0 0 0 10.7 18.6a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.06 15a1.7 1.7 0 0 0-1.56-1.03h-.1v-3h.1A1.7 1.7 0 0 0 7.06 9.94a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56v-.1h3v.1A1.7 1.7 0 0 0 15.76 6.3a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.1v3h-.1A1.7 1.7 0 0 0 19.4 15Z" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  arrow: <path d="m9 18 6-6-6-6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />
};

const STATE_ORDER: Record<Container['state'], number> = {
  running: 0,
  paused: 1,
  exited: 2,
  unknown: 3
};

const STATE_LABELS: Record<Container['state'], string> = {
  running: 'Running',
  paused: 'Paused',
  exited: 'Exited',
  unknown: 'Unknown'
};

const FILTERS: Array<{ value: ContainerStateFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'exited', label: 'Exited' },
  { value: 'unknown', label: 'Unknown' }
];

function Icon({ name }: { name: keyof typeof icons }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

const bytes = (value: number) => {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** exponent).toFixed(exponent > 1 ? 1 : 0)} ${units[exponent]}`;
};

const percent = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)}%`;

const shortDate = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const longDate = (timestamp: number) => new Date(timestamp).toLocaleString([], {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

function stateTone(state: Container['state']) {
  if (state === 'running') return 'live';
  if (state === 'paused') return 'paused';
  if (state === 'exited') return 'ended';
  return 'unknown';
}

function metricTone(value: number, threshold = 65) {
  if (value >= threshold) return 'hot';
  if (value >= threshold / 2) return 'warm';
  return 'cool';
}

function mergeLatestSeries(history: HistoryPoint[], livePoint: HistoryPoint | null) {
  return livePoint ? mergeHistorySeries(history, [livePoint]) : history;
}

function TrendChart({ values, accent = 'purple' }: { values: number[]; accent?: 'purple' | 'blue' | 'green' | 'amber' }) {
  const safeValues = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const padding = Math.max((max - min) * 0.18, max === min ? (max || 1) * 0.18 : 1);
  const top = min - padding;
  const bottom = max + padding;
  const width = 100;
  const height = 36;
  const span = bottom - top || 1;
  const step = safeValues.length > 1 ? width / (safeValues.length - 1) : 0;
  const coords = safeValues.map((value, index) => {
    const x = safeValues.length > 1 ? index * step : width / 2;
    const y = height - ((value - top) / span) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = coords.join(' ');
  const area = `0,${height} ${line} ${width},${height}`;

  return (
    <svg className={`trend-chart ${accent}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`trend-${accent}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M ${area}`} fill={`url(#trend-${accent})`} />
      <polyline points={line} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatCard({ label, value, detail, tone = 'default' }: { label: string; value: string; detail: string; tone?: 'default' | 'blue' | 'green' | 'amber' }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-trend"><span className="trend-dot" />{detail}</div>
    </article>
  );
}

function FilterChip({ value, label, active, count, onClick }: { value: ContainerStateFilter; label: string; active: boolean; count: number; onClick: (value: ContainerStateFilter) => void }) {
  return (
    <button type="button" className={`filter-chip ${active ? 'active' : ''}`} onClick={() => onClick(value)}>
      <span>{label}</span>
      <em>{count}</em>
    </button>
  );
}

function ContainerCard({ container, history, onOpen }: { container: Container; history: HistoryPoint[]; onOpen: () => void }) {
  const running = container.state === 'running';
  const livePoint = snapshotToHistoryPoint(container);
  const series = mergeLatestSeries(history, livePoint);

  return (
    <button type="button" className="container-card" onClick={onOpen}>
      <div className="card-top">
        <div className="service-ident">
          <div className="service-icon">{container.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{container.name}</strong>
            <span>{container.image}</span>
          </div>
        </div>
        <span className={`status ${running ? 'live' : stateTone(container.state)}`}><i />{STATE_LABELS[container.state]}</span>
      </div>

      <div className="card-metrics">
        <div>
          <span>CPU</span>
          <b>{percent(container.cpuPercent)}</b>
          <TrendChart values={series.map((point) => point.cpuPercent)} accent="purple" />
        </div>
        <div>
          <span>Memory</span>
          <b>{percent(container.memoryPercent)}</b>
          <TrendChart values={series.map((point) => point.memoryPercent)} accent="blue" />
        </div>
      </div>

      <div className="card-footer">
        <span>{percent(container.memoryPercent)} of {bytes(container.memoryLimitBytes)}</span>
        <span>Open details <Icon name="arrow" /></span>
      </div>
    </button>
  );
}

function DetailStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function ChartCard({ title, value, note, values, accent }: { title: string; value: string; note: string; values: number[]; accent: 'purple' | 'blue' | 'green' | 'amber' }) {
  return (
    <article className={`chart-card ${accent}`}>
      <div className="chart-head">
        <div>
          <span>{title}</span>
          <strong>{value}</strong>
        </div>
        <small>{note}</small>
      </div>
      <TrendChart values={values} accent={accent} />
    </article>
  );
}

function DetailPage({
  container,
  containerId,
  history,
  onBack
}: {
  container: Container | null;
  containerId: string;
  history: HistoryPoint[];
  onBack: () => void;
}) {
  const latest = history[history.length - 1] ?? (container ? snapshotToHistoryPoint(container) : null);
  const chartHistory = latest ? mergeHistorySeries(history, [latest]) : history;
  const cpuSeries = chartHistory.map((point) => point.cpuPercent);
  const memorySeries = chartHistory.map((point) => point.memoryPercent);
  const rxSeries = chartHistory.map((point) => point.networkRxBytes);
  const txSeries = chartHistory.map((point) => point.networkTxBytes);

  if (!container && !latest) {
    return (
      <section className="detail-page">
        <div className="detail-hero">
          <button type="button" className="back-link" onClick={onBack}><Icon name="chevronLeft" />Back to containers</button>
          <p className="eyebrow">CONTAINER DETAILS</p>
          <h1>Container not found</h1>
          <p className="subtle">The container might have been removed since the last snapshot. The ID below is still available for reference.</p>
          <code className="detail-id">{containerId}</code>
        </div>
      </section>
    );
  }

  const name = container?.name ?? containerId;
  const image = container?.image ?? 'No current snapshot available';
  const state = container?.state ?? 'unknown';
  const lastUpdated = latest ? longDate(latest.timestamp) : 'Waiting for the next sample';

  return (
    <section className="detail-page">
      <div className="detail-hero">
        <button type="button" className="back-link" onClick={onBack}><Icon name="chevronLeft" />Back to containers</button>
        <div className="detail-title-row">
          <div>
            <p className="eyebrow">CONTAINER DETAILS</p>
            <h1>{name}</h1>
            <p className="subtle">{image}</p>
          </div>
          <span className={`detail-state ${stateTone(state)}`}><i />{STATE_LABELS[state]}</span>
        </div>
        <div className="detail-meta-inline">
          <span><strong>ID</strong><code>{containerId}</code></span>
          <span><strong>Last sample</strong><code>{lastUpdated}</code></span>
        </div>
      </div>

      <section className="detail-summary-grid">
        <DetailStat label="CPU usage" value={container ? percent(container.cpuPercent) : '0%'} hint="Live snapshot" />
        <DetailStat label="Memory in use" value={container ? bytes(container.memoryBytes) : '0 B'} hint={container ? `${percent(container.memoryPercent)} of limit` : 'Awaiting history'} />
        <DetailStat label="Memory limit" value={container ? bytes(container.memoryLimitBytes) : 'Unknown'} hint="Container limit" />
        <DetailStat label="Network I/O" value={container ? `${bytes(container.networkRxBytes)} in / ${bytes(container.networkTxBytes)} out` : 'Unknown'} hint="Since container start" />
      </section>

      <section className="detail-charts">
        <ChartCard title="CPU" value={container ? percent(container.cpuPercent) : '0%'} note="Continuous samples from the collector" values={cpuSeries} accent="purple" />
        <ChartCard title="Memory" value={container ? bytes(container.memoryBytes) : '0 B'} note="Resident memory across the last 24 hours" values={memorySeries} accent="blue" />
        <ChartCard title="Network received" value={container ? bytes(container.networkRxBytes) : '0 B'} note="Cumulative bytes read from the network" values={rxSeries} accent="green" />
        <ChartCard title="Network sent" value={container ? bytes(container.networkTxBytes) : '0 B'} note="Cumulative bytes written to the network" values={txSeries} accent="amber" />
      </section>

      <section className="detail-grid">
        <article className="detail-panel">
          <div className="section-title">Live snapshot <span>What the collector sees right now</span></div>
          <div className="detail-key-values">
            <div><span>State</span><strong>{STATE_LABELS[state]}</strong></div>
            <div><span>Collector timestamp</span><strong>{latest ? shortDate(latest.timestamp) : 'Waiting'}</strong></div>
            <div><span>CPU trend</span><strong>{container ? metricTone(container.cpuPercent) : 'cool'}</strong></div>
            <div><span>Memory pressure</span><strong>{container ? metricTone(container.memoryPercent) : 'cool'}</strong></div>
          </div>
        </article>
        <article className="detail-panel">
          <div className="section-title">Container metadata <span>Useful identifiers and runtime facts</span></div>
          <div className="detail-key-values">
            <div><span>Name</span><strong>{name}</strong></div>
            <div><span>Image</span><strong>{image}</strong></div>
            <div><span>ID</span><strong>{containerId}</strong></div>
            <div><span>History window</span><strong>24 hours</strong></div>
          </div>
        </article>
      </section>
    </section>
  );
}

export function App() {
  const { snapshots, status, isStreaming } = useLiveContainers();
  const [filter, setFilter] = useState<ContainerStateFilter>('all');
  const [locationPath, setLocationPath] = useState(() => window.location.pathname);
  const [liveHistoryById, setLiveHistoryById] = useState<Record<string, HistoryPoint[]>>({});

  useEffect(() => {
    const onPopState = () => setLocationPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    setLiveHistoryById((current) => {
      const next: Record<string, HistoryPoint[]> = { ...current };
      for (const snapshot of snapshots) {
        const point = snapshotToHistoryPoint(snapshot);
        next[snapshot.id] = mergeHistorySeries(next[snapshot.id] ?? [], [point]);
      }
      return next;
    });
  }, [snapshots]);

  const containerId = locationPath.startsWith('/containers/') ? decodeURIComponent(locationPath.slice('/containers/'.length)) : null;
  const selectedContainer = containerId ? snapshots.find((snapshot) => snapshot.id === containerId) ?? null : null;
  const selectedHistory = useContainerHistory(containerId, selectedContainer);
  const isDetailPage = Boolean(containerId);

  const totals = useMemo(() => ({
    running: snapshots.filter((item) => item.state === 'running').length,
    paused: snapshots.filter((item) => item.state === 'paused').length,
    exited: snapshots.filter((item) => item.state === 'exited').length,
    unknown: snapshots.filter((item) => item.state === 'unknown').length,
    cpu: snapshots.reduce((sum, item) => sum + item.cpuPercent, 0),
    memory: snapshots.reduce((sum, item) => sum + item.memoryBytes, 0),
    network: snapshots.reduce((sum, item) => sum + item.networkRxBytes + item.networkTxBytes, 0)
  }), [snapshots]);

  const filteredContainers = useMemo(() => {
    return snapshots
      .filter((container) => filter === 'all' || container.state === filter)
      .slice()
      .sort((left, right) => {
        const stateDelta = STATE_ORDER[left.state] - STATE_ORDER[right.state];
        if (stateDelta) return stateDelta;
        return left.name.localeCompare(right.name);
      });
  }, [snapshots, filter]);

  const handleNavigate = (path: string) => {
    window.history.pushState({}, '', path);
    setLocationPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const overviewHistory = (container: Container) => liveHistoryById[container.id] ?? [];
  const listTitle = isDetailPage ? 'Container detail' : 'Containers';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); handleNavigate('/'); }}><span className="brand-mark">S</span><span>stackvia</span></a>
        <div className="workspace"><span>WORKSPACE</span><button type="button">Personal workspace <b>⌄</b></button></div>
        <nav>
          <a className={!isDetailPage ? 'active' : ''} href="/" onClick={(event) => { event.preventDefault(); handleNavigate('/'); }}><Icon name="grid" />Overview</a>
          <a className={isDetailPage ? 'active' : ''} href="/containers"><Icon name="box" />Containers <em>{totals.running}</em></a>
          <a href="#databases"><Icon name="database" />Databases <span className="soon">Soon</span></a>
        </nav>
        <div className="sidebar-bottom">
          <a href="#settings"><Icon name="settings" />Settings</a>
          <div className="user">
            <span>VS</span>
            <div><b>Local admin</b><small>Self-hosted</small></div>
            <button type="button" aria-label="Account menu">•••</button>
          </div>
        </div>
      </aside>

      <main>
        {!isDetailPage ? (
          <>
            <header>
              <div>
                <p className="eyebrow">INFRASTRUCTURE OVERVIEW</p>
                <h1>Good morning</h1>
                <p className="subtle">Here’s what’s happening across your services.</p>
              </div>
              <div className="header-actions">
                <span className={`connection ${isStreaming && status.connected ? 'connected' : ''}`}><i />{status.mode === 'demo' ? 'Demo telemetry' : isStreaming && status.connected ? 'Live connection' : 'Connecting…'}</span>
                <button type="button" className="button secondary" title="Database explorer arrives in Phase 2"><Icon name="plus" />Add database</button>
              </div>
            </header>

            <section className="metrics" id="overview">
              <StatCard label="Running containers" value={`${totals.running}`} detail={totals.running ? 'All services reporting' : 'Waiting for Docker'} tone="green" />
              <StatCard label="Paused containers" value={`${totals.paused}`} detail={totals.paused ? 'Temporarily stopped' : 'No paused containers'} />
              <StatCard label="Total CPU usage" value={percent(totals.cpu)} detail="Across visible containers" />
              <StatCard label="Memory in use" value={bytes(totals.memory)} detail="Container memory footprint" tone="blue" />
            </section>

            <section className="services-section" id="containers">
              <div className="section-header">
                <div>
                  <h2>{listTitle}</h2>
                  <p>Running services float to the top. Filter by state to focus on what matters.</p>
                </div>
                <div className="container-toolbar">
                  <span className="frequency">{snapshots.length} containers</span>
                  <div className="filters" role="tablist" aria-label="Container state filter">
                    {FILTERS.map((option) => {
                      const count = option.value === 'all' ? snapshots.length : snapshots.filter((container) => container.state === option.value).length;
                      return <FilterChip key={option.value} value={option.value} label={option.label} active={filter === option.value} count={count} onClick={setFilter} />;
                    })}
                  </div>
                </div>
              </div>

              {filteredContainers.length ? (
                <div className="container-grid">
                  {filteredContainers.map((container) => (
                    <ContainerCard
                      key={container.id}
                      container={container}
                      history={overviewHistory(container)}
                      onOpen={() => handleNavigate(`/containers/${encodeURIComponent(container.id)}`)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon"><Icon name="box" /></div>
                  <div>
                    <h3>{status.mode === 'unavailable' ? 'Docker is not connected' : 'No containers match this filter'}</h3>
                    <p>{status.mode === 'unavailable' ? 'Mount /var/run/docker.sock into Stackvia to start monitoring this host.' : 'Try another filter to reveal paused or exited containers.'}</p>
                  </div>
                  <code>-v /var/run/docker.sock:/var/run/docker.sock:ro</code>
                </div>
              )}
            </section>

            <section className="activity">
              <div className="section-header">
                <div>
                  <h2>Collector activity</h2>
                  <p>Persistent metrics are stored locally in SQLite.</p>
                </div>
                <span className="frequency">10 second interval</span>
              </div>
              <div className="activity-line">
                <i className={status.connected ? 'pulse' : ''} />
                <div>
                  <b>{status.connected ? 'Collector is healthy' : 'Collector is standing by'}</b>
                  <span>{status.lastCollectedAt ? `Last check ${shortDate(status.lastCollectedAt)}` : status.message ?? 'Waiting for a Docker connection'}</span>
                </div>
                <span className="activity-tail">SQLite · WAL enabled</span>
              </div>
            </section>
          </>
        ) : (
          <DetailPage
            container={selectedContainer}
            containerId={containerId ?? ''}
            history={selectedHistory}
            onBack={() => handleNavigate('/')}
          />
        )}
      </main>
    </div>
  );
}
