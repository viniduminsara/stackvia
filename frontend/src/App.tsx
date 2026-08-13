import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Container } from './hooks/useLiveContainers';
import { useLiveContainers } from './hooks/useLiveContainers';
import { useContainerHistory, mergeHistorySeries, snapshotToHistoryPoint, type HistoryPoint } from './hooks/useContainerHistory';
import {
  createConnection,
  loadCatalog,
  loadCollectionDocuments,
  loadCollectionStats,
  loadConnections,
  loadOverview,
  removeConnection,
  type CollectionExplorer,
  type DatabaseConnection,
  type DatabaseCatalog,
  type DatabaseOverview,
  type CollectionStats
} from './hooks/useDatabases';
import { useAuth } from './hooks/useAuth';

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

function ContainerListSection({
  snapshots,
  dockerStatus,
  isStreaming,
  filter,
  setFilter,
  historyForContainer,
  onOpenContainer,
  title = 'Containers',
  description = 'Running services float to the top. Filter by state to focus on what matters.',
  emptyTitle,
  emptyDescription
}: {
  snapshots: Container[];
  dockerStatus: { connected: boolean; mode: 'docker' | 'demo' | 'unavailable' };
  isStreaming: boolean;
  filter: ContainerStateFilter;
  setFilter: (value: ContainerStateFilter) => void;
  historyForContainer: (container: Container) => HistoryPoint[];
  onOpenContainer: (id: string) => void;
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const filteredContainers = snapshots
    .filter((container) => filter === 'all' || container.state === filter)
    .slice()
    .sort((left, right) => {
      const stateDelta = STATE_ORDER[left.state] - STATE_ORDER[right.state];
      if (stateDelta) return stateDelta;
      return left.name.localeCompare(right.name);
    });

  return (
    <section className="services-section" id="containers">
      <div className="section-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="container-toolbar">
          <span className={`connection ${isStreaming && dockerStatus.connected ? 'connected' : ''}`}><i />{dockerStatus.mode === 'demo' ? 'Demo telemetry' : isStreaming && dockerStatus.connected ? 'Live connection' : 'Connecting…'}</span>
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
              history={historyForContainer(container)}
              onOpen={() => onOpenContainer(container.id)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-icon"><Icon name="box" /></div>
          <div>
            <h3>{emptyTitle ?? (dockerStatus.mode === 'unavailable' ? 'Docker is not connected' : 'No containers match this filter')}</h3>
            <p>{emptyDescription ?? (dockerStatus.mode === 'unavailable' ? 'Mount /var/run/docker.sock into Stackvia to start monitoring this host.' : 'Try another filter to reveal paused or exited containers.')}</p>
          </div>
          <code>-v /var/run/docker.sock:/var/run/docker.sock:ro</code>
        </div>
      )}
    </section>
  );
}

function OverviewPage({
  snapshots,
  dockerStatus,
  isStreaming,
  filter,
  setFilter,
  onNavigate,
  totals,
  overviewHistory,
  listTitle
}: {
  snapshots: Container[];
  dockerStatus: { connected: boolean; mode: 'docker' | 'demo' | 'unavailable'; message?: string; lastCollectedAt?: number };
  isStreaming: boolean;
  filter: ContainerStateFilter;
  setFilter: (value: ContainerStateFilter) => void;
  onNavigate: (path: string) => void;
  overviewHistory: (container: Container) => HistoryPoint[];
  totals: { running: number; paused: number; exited: number; unknown: number; cpu: number; memory: number; network: number };
  listTitle: string;
}) {
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">INFRASTRUCTURE OVERVIEW</p>
          <h1>Good morning</h1>
          <p className="subtle">Here’s what’s happening across your services.</p>
        </div>
        <div className="header-actions">
          <span className={`connection ${isStreaming && dockerStatus.connected ? 'connected' : ''}`}><i />{dockerStatus.mode === 'demo' ? 'Demo telemetry' : isStreaming && dockerStatus.connected ? 'Live connection' : 'Connecting…'}</span>
        </div>
      </header>

      <section className="metrics" id="overview">
        <StatCard label="Running containers" value={`${totals.running}`} detail={totals.running ? 'All services reporting' : 'Waiting for Docker'} tone="green" />
        <StatCard label="Paused containers" value={`${totals.paused}`} detail={totals.paused ? 'Temporarily stopped' : 'No paused containers'} />
        <StatCard label="Total CPU usage" value={percent(totals.cpu)} detail="Across visible containers" />
        <StatCard label="Memory in use" value={bytes(totals.memory)} detail="Container memory footprint" tone="blue" />
      </section>

      <ContainerListSection
        snapshots={snapshots}
        dockerStatus={dockerStatus}
        isStreaming={isStreaming}
        filter={filter}
        setFilter={setFilter}
        historyForContainer={overviewHistory}
        onOpenContainer={(id) => onNavigate(`/containers/${encodeURIComponent(id)}`)}
        title={listTitle}
        description="Running services float to the top. Filter by state to focus on what matters."
      />

      <section className="activity">
        <div className="section-header">
          <div>
            <h2>Collector activity</h2>
            <p>Persistent metrics are stored locally in SQLite.</p>
          </div>
          <span className="frequency">10 second interval</span>
        </div>
        <div className="activity-line">
          <i className={dockerStatus.connected ? 'pulse' : ''} />
          <div>
            <b>{dockerStatus.connected ? 'Collector is healthy' : 'Collector is standing by'}</b>
            <span>{dockerStatus.lastCollectedAt ? `Last check ${shortDate(dockerStatus.lastCollectedAt)}` : dockerStatus.message ?? 'Waiting for a Docker connection'}</span>
          </div>
          <span className="activity-tail">SQLite · WAL enabled</span>
        </div>
      </section>
    </>
  );
}

function ContainersPage({
  snapshots,
  dockerStatus,
  isStreaming,
  filter,
  setFilter,
  historyForContainer,
  onNavigate
}: {
  snapshots: Container[];
  dockerStatus: { connected: boolean; mode: 'docker' | 'demo' | 'unavailable' };
  isStreaming: boolean;
  filter: ContainerStateFilter;
  setFilter: (value: ContainerStateFilter) => void;
  historyForContainer: (container: Container) => HistoryPoint[];
  onNavigate: (path: string) => void;
}) {
  return (
    <section className="containers-page">
      <div className="detail-hero containers-hero">
        <p className="eyebrow">CONTAINERS</p>
        <h1>Container view</h1>
        <p className="subtle">Focused list of live, paused, and exited services without the overview metrics.</p>
      </div>

      <ContainerListSection
        snapshots={snapshots}
        dockerStatus={dockerStatus}
        isStreaming={isStreaming}
        filter={filter}
        setFilter={setFilter}
        historyForContainer={historyForContainer}
        onOpenContainer={(id) => onNavigate(`/containers/${encodeURIComponent(id)}`)}
        title="Containers"
        description="Filter and inspect your running services."
      />
    </section>
  );
}

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="db-stat-row">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

function highlightJson(json: string) {
  if (!json) return '';
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  return escaped.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (match) => {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

function DocumentCard({ doc }: { doc: Record<string, unknown> }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  const docId = doc._id !== undefined ? (typeof doc._id === 'string' ? doc._id : JSON.stringify(doc._id)) : 'unknown';

  return (
    <article className="document-card-container">
      <div className="document-card-header">
        <span className="document-id-label">
          ID: <code className="highlight-id">{docId}</code>
        </span>
        <button type="button" className="document-copy-btn" onClick={handleCopy}>
          {copied ? (
            <span className="copied-text">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, marginRight: 4 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Copied!
            </span>
          ) : (
            <span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, marginRight: 4 }}>
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy
            </span>
          )}
        </button>
      </div>
      <pre
        className="document-card-body"
        dangerouslySetInnerHTML={{ __html: highlightJson(JSON.stringify(doc, null, 2)) }}
      />
    </article>
  );
}

function DatabaseWorkspace({
  connectionId,
  onNavigate
}: {
  connectionId: string | null;
  onNavigate: (path: string) => void;
}) {
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [name, setName] = useState('');
  const [uri, setUri] = useState('');
  const [defaultDatabase, setDefaultDatabase] = useState('');
  const [catalog, setCatalog] = useState<DatabaseCatalog | null>(null);
  const [overview, setOverview] = useState<DatabaseOverview | null>(null);
  const [collectionStats, setCollectionStats] = useState<CollectionStats['stats'] | null>(null);
  const [documents, setDocuments] = useState<CollectionExplorer | null>(null);
  const [selectedDatabase, setSelectedDatabase] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(12);
  const [filterDraft, setFilterDraft] = useState('{}');
  const [filter, setFilter] = useState('');
  const [documentError, setDocumentError] = useState('');
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [collectionQuery, setCollectionQuery] = useState('');

  const activeConnection = connections.find((item) => item.id === connectionId) ?? null;
  const activeTitle = activeConnection?.name ?? 'Databases';

  const refreshConnections = async () => {
    setConnectionsLoading(true);
    setConnectionsError('');
    try {
      const payload = await loadConnections();
      setConnections(payload.items);
    } catch (error) {
      setConnectionsError(error instanceof Error ? error.message : 'Unable to load saved connections');
    } finally {
      setConnectionsLoading(false);
    }
  };

  useEffect(() => {
    void refreshConnections();
  }, []);

  useEffect(() => {
    if (!connectionId) {
      setCatalog(null);
      setOverview(null);
      setCollectionStats(null);
      setDocuments(null);
      setSelectedDatabase('');
      setSelectedCollection('');
      setPage(1);
      setFilter('');
      return;
    }

    let cancelled = false;
    setCatalog(null);
    setOverview(null);
    setCollectionStats(null);
    setDocuments(null);
    setSelectedCollection('');
    setPage(1);
    setFilter('');

    void (async () => {
      try {
        const payload = await loadCatalog(connectionId);
        if (cancelled) return;
        setCatalog(payload.item);
      } catch (error) {
        if (cancelled) return;
        setConnectionsError(error instanceof Error ? error.message : 'Unable to load database catalog');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    if (!catalog) return;
    const fallback = catalog.defaultDatabase || catalog.databaseNames[0] || '';
    setSelectedDatabase((current) => {
      if (current && catalog.databaseNames.includes(current)) return current;
      return fallback;
    });
  }, [catalog]);

  useEffect(() => {
    if (!connectionId || !selectedDatabase) {
      setOverview(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const payload = await loadOverview(connectionId, selectedDatabase);
        if (cancelled) return;
        setOverview(payload.item);
      } catch (error) {
        if (!cancelled) setConnectionsError(error instanceof Error ? error.message : 'Unable to load database overview');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDatabase]);

  useEffect(() => {
    if (!overview) return;
    setSelectedCollection((current) => {
      if (current && overview.collections.some((collection) => collection.name === current)) return current;
      return overview.collections[0]?.name ?? '';
    });
  }, [overview]);

  useEffect(() => {
    if (!connectionId || !selectedDatabase || !selectedCollection) {
      setCollectionStats(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const payload = await loadCollectionStats(connectionId, selectedCollection, selectedDatabase);
        if (!cancelled) setCollectionStats(payload.item.stats);
      } catch {
        if (!cancelled) setCollectionStats(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDatabase, selectedCollection]);

  useEffect(() => {
    if (!connectionId || !selectedDatabase || !selectedCollection) {
      setDocuments(null);
      return;
    }

    const trimmedFilter = filter.trim();
    let parsedFilter: Record<string, unknown> | null = null;

    if (trimmedFilter) {
      try {
        const parsed = JSON.parse(trimmedFilter);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setDocumentError('Filter must be a JSON object');
          return;
        }
        parsedFilter = parsed as Record<string, unknown>;
        setDocumentError('');
      } catch {
        setDocumentError('Filter must be valid JSON');
        return;
      }
    } else {
      setDocumentError('');
    }

    let cancelled = false;
    setDocumentsLoading(true);
    void (async () => {
      try {
        const payload = await loadCollectionDocuments(connectionId, selectedCollection, {
          database: selectedDatabase,
          page,
          limit,
          filter: parsedFilter ? JSON.stringify(parsedFilter) : undefined
        });
        if (!cancelled) setDocuments(payload.item);
      } catch (error) {
        if (!cancelled) {
          setDocuments(null);
          setDocumentError(error instanceof Error ? error.message : 'Unable to load documents');
        }
      } finally {
        if (!cancelled) setDocumentsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connectionId, selectedDatabase, selectedCollection, page, limit, filter]);

  const handleCreateConnection = async (event: FormEvent) => {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError('');
    try {
      const payload = await createConnection({ name, uri, defaultDatabase });
      setName('');
      setUri('');
      setDefaultDatabase('');
      await refreshConnections();
      onNavigate(`/databases/${payload.item.id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Unable to save the connection');
    } finally {
      setCreateBusy(false);
    }
  };

  const handleDeleteConnection = async (id: string) => {
    if (!window.confirm('Delete this saved MongoDB connection?')) return;
    try {
      await removeConnection(id);
      await refreshConnections();
      if (connectionId === id) onNavigate('/databases');
    } catch (error) {
      setConnectionsError(error instanceof Error ? error.message : 'Unable to delete the connection');
    }
  };

  const dbStats = overview?.dbStats ?? {};
  const summaryCards = [
    { label: 'Objects', value: String((dbStats as { objects?: number }).objects ?? overview?.collections.reduce((sum, item) => sum + item.documentCount, 0) ?? 0), hint: 'Estimated document count' },
    { label: 'Collections', value: String((dbStats as { collections?: number }).collections ?? overview?.collections.length ?? 0), hint: 'Visible collections' },
    { label: 'Data size', value: bytes(Number((dbStats as { dataSize?: number }).dataSize ?? 0)), hint: 'Logical data stored' },
    { label: 'Storage size', value: bytes(Number((dbStats as { storageSize?: number }).storageSize ?? 0)), hint: 'On-disk footprint' }
  ];

  const filteredCollections = (overview?.collections ?? []).filter((c) =>
    c.name.toLowerCase().includes(collectionQuery.toLowerCase())
  );

  if (!connectionId) {
    return (
      <section className="database-page">
        <div className="detail-hero">
          <p className="eyebrow">DATABASES</p>
          <h1>Saved database connections</h1>
          <p className="subtle">Store encrypted connection strings, then inspect db stats and documents in a read-only explorer.</p>
        </div>

        <section className="database-layout">
          <form className="detail-panel database-form" onSubmit={handleCreateConnection}>
            <div className="section-title">Add connection <span>Encrypted at rest in SQLite</span></div>
            <div className="database-form-grid">
              <label>
                <span>Name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production MongoDB" required />
              </label>
              <label>
                <span>Default database</span>
                <input value={defaultDatabase} onChange={(event) => setDefaultDatabase(event.target.value)} placeholder="appdb" />
              </label>
              <label className="database-form-full">
                <span>MongoDB connection string</span>
                <textarea value={uri} onChange={(event) => setUri(event.target.value)} placeholder="mongodb://user:password@host:27017/appdb" rows={4} required />
              </label>
            </div>
            {createError ? <p className="form-error">{createError}</p> : null}
            <button className="button secondary" type="submit" disabled={createBusy}>{createBusy ? 'Saving…' : 'Save connection'}</button>
          </form>

          <div className="detail-panel">
            <div className="section-title">Saved connections <span>{connections.length} total</span></div>
            {connectionsLoading ? <p className="subtle">Loading connections…</p> : null}
            {connectionsError ? <p className="form-error">{connectionsError}</p> : null}
            <div className="connection-list">
              {connections.map((item) => (
                <article className="connection-card" key={item.id}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong>{item.name}</strong>
                    </div>
                    <span>{item.defaultDatabase || 'No default database set'}</span>
                  </div>
                  <div className="connection-card-actions">
                    <button type="button" className="text-button" onClick={() => onNavigate(`/databases/${item.id}`)}>Open <Icon name="arrow" /></button>
                    {!item.id.startsWith('auto-') && (
                      <button type="button" className="text-button danger" onClick={() => void handleDeleteConnection(item.id)}>Delete</button>
                    )}
                  </div>
                </article>
              ))}
              {!connectionsLoading && !connections.length ? <div className="empty-state compact"><div className="empty-icon"><Icon name="database" /></div><div><h3>No databases yet</h3><p>Add your first MongoDB URI to unlock the explorer.</p></div></div> : null}
            </div>
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="database-page">
      <div className="detail-hero">
        <button type="button" className="back-link" onClick={() => onNavigate('/databases')}><Icon name="chevronLeft" />Back to connections</button>
        <p className="eyebrow">DATABASE EXPLORER</p>
        <div className="detail-title-row">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h1>{activeTitle}</h1>
              {activeConnection?.id.startsWith('auto-') && (
                <span className="soon" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', fontSize: '11px', fontWeight: 600, padding: '4px 8px', margin: 0, textTransform: 'none', fontStyle: 'normal' }}>detected</span>
              )}
            </div>
            <p className="subtle">Encrypted connection storage, stats, and a strict read-only document browser.</p>
          </div>
          <span className="detail-state live"><i />Read-only</span>
        </div>
      </div>

      <div className="detail-meta-inline">
        <span><strong>Connection</strong><code>{activeConnection?.id ?? connectionId}</code></span>
        <span><strong>Default DB</strong><code>{selectedDatabase || activeConnection?.defaultDatabase || 'auto'}</code></span>
      </div>

      <div className="db-explorer-container">
        {/* Left Navigator Panel */}
        <aside className="db-explorer-sidebar">
          <div className="db-sidebar-section">
            <label className="db-select" style={{ gap: '4px' }}>
              <span>Database</span>
              <select value={selectedDatabase} onChange={(event) => { setSelectedDatabase(event.target.value); setPage(1); }}>
                {(catalog?.databaseNames ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          </div>
          
          <div className="db-sidebar-section">
            <input
              type="text"
              placeholder="Search collections..."
              value={collectionQuery}
              onChange={(e) => setCollectionQuery(e.target.value)}
              className="collection-search-input"
            />
          </div>

          <div className="db-sidebar-section">
            <span style={{ fontSize: '10px', color: '#8490a3', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Collections</span>
            <div className="db-collections-list">
              {filteredCollections.map((collection) => (
                <button
                  type="button"
                  key={collection.name}
                  className={`collection-list-item ${selectedCollection === collection.name ? 'active' : ''}`}
                  onClick={() => { setSelectedCollection(collection.name); setPage(1); }}
                >
                  <span className="collection-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <ellipse cx="12" cy="5" rx="9" ry="3" />
                      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                      <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
                    </svg>
                  </span>
                  <span className="collection-name">{collection.name}</span>
                  <span className="collection-badge">{collection.documentCount}</span>
                </button>
              ))}
              {filteredCollections.length === 0 && (
                <p className="subtle" style={{ padding: '16px 8px', textAlign: 'center', margin: 0 }}>No collections found</p>
              )}
            </div>
          </div>
        </aside>

        {/* Right Document & Stats Viewer */}
        <div className="db-explorer-main">
          {selectedCollection ? (
            <>
              {/* Collection stats strip */}
              <div className="db-main-header">
                <h2>{selectedCollection}</h2>
                <div className="db-collection-stats-strip">
                  <div className="db-stat-pill">
                    <strong>Documents</strong>
                    <span>{collectionStats ? collectionStats.documentCount : '...'}</span>
                  </div>
                  <div className="db-stat-pill">
                    <strong>Logical Size</strong>
                    <span>{collectionStats ? bytes(collectionStats.sizeBytes) : '...'}</span>
                  </div>
                  <div className="db-stat-pill">
                    <strong>Storage Size</strong>
                    <span>{collectionStats ? bytes(collectionStats.storageSizeBytes) : '...'}</span>
                  </div>
                  <div className="db-stat-pill">
                    <strong>Indexes</strong>
                    <span>{collectionStats ? `${collectionStats.indexCount} (${bytes(collectionStats.totalIndexSizeBytes)})` : '...'}</span>
                  </div>
                </div>
              </div>

              {/* Query bar */}
              <div className="query-bar-container">
                <div className="query-bar-grid">
                  <div className="query-bar-main">
                    <span style={{ fontSize: '10px', color: '#8490a3', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Filter (JSON)</span>
                    <div className="query-input-wrapper">
                      <textarea
                        value={filterDraft}
                        onChange={(event) => setFilterDraft(event.target.value)}
                        rows={1}
                        className="query-textarea"
                        placeholder='{"status":"active"}'
                      />
                    </div>
                  </div>
                  <div className="query-bar-actions">
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginRight: '8px' }}>
                      <span style={{ fontSize: '10px', color: '#8490a3', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Limit</span>
                      <select value={limit} onChange={(event) => { setLimit(Number(event.target.value)); setPage(1); }} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #dfe3ee' }}>
                        {[6, 12, 24, 48].map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" className="button" style={{ background: 'linear-gradient(135deg, #7c5cf6, #5d7ef4)', boxShadow: '0 4px 12px rgba(124, 92, 246, 0.2)' }} onClick={() => { setFilter(filterDraft.trim()); setPage(1); }}>Find</button>
                    <button type="button" className="button secondary" onClick={() => { setFilterDraft('{}'); setFilter(''); setPage(1); }}>Clear</button>
                  </div>
                </div>
              </div>

              {/* Documents List */}
              {documentError ? <p className="form-error">{documentError}</p> : null}
              
              <div className="document-list" style={{ marginTop: 0 }}>
                {documentsLoading ? (
                  <p className="subtle" style={{ padding: '24px 0', textAlign: 'center' }}>Loading documents…</p>
                ) : documents?.documents.length ? (
                  documents.documents.map((doc, index) => (
                    <DocumentCard key={`${String(doc._id ?? index)}-${index}`} doc={doc} />
                  ))
                ) : (
                  <div className="empty-state" style={{ minHeight: '140px', gridTemplateColumns: '1fr', textAlign: 'center', padding: '32px' }}>
                    <p className="subtle" style={{ margin: 0, fontSize: '13px' }}>No documents found for this collection matching the filter.</p>
                  </div>
                )}
              </div>

              {/* Pager */}
              <div className="pager">
                <button type="button" className="button secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
                <span>Page {page}</span>
                <button type="button" className="button secondary" disabled={!documents?.hasMore} onClick={() => setPage((current) => current + 1)}>Next</button>
              </div>
            </>
          ) : (
            <div className="detail-panel" style={{ minHeight: '300px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '40px' }}>
              <div className="empty-icon" style={{ marginBottom: '16px' }}><Icon name="database" /></div>
              <h2>Welcome to {activeTitle}</h2>
              <p className="subtle" style={{ maxWidth: '420px', fontSize: '13px', lineHeight: '1.6' }}>
                Select a collection on the left navigator pane to start exploring documents, searching stats, and running queries in a read-only workspace.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-gate">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-mark">S</span>
          <span className="auth-logo-name">stackvia</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function SetupPage({ onSetup }: { onSetup: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setBusy(true);
    setError('');
    try {
      await onSetup(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      <h1 className="auth-title">Create admin account</h1>
      <p className="auth-subtitle">This is the first time stackvia is running. Set up your administrator credentials to secure the dashboard.</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-field">
          <label htmlFor="setup-username">Username</label>
          <input
            id="setup-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            required
          />
        </div>
        <div className="auth-field">
          <label htmlFor="setup-password">Password</label>
          <input
            id="setup-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            required
          />
        </div>
        <div className="auth-field">
          <label htmlFor="setup-confirm">Confirm password</label>
          <input
            id="setup-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat password"
            required
          />
        </div>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account & sign in'}
        </button>
        <p className="auth-hint">Once created, this account cannot be changed through the UI. Edit the database file directly to reset credentials.</p>
      </form>
    </AuthCard>
  );
}

function LoginPage({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard>
      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-subtitle">Sign in to your stackvia instance.</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-field">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            required
          />
        </div>
        <div className="auth-field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            required
          />
        </div>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" className="auth-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthCard>
  );
}

function AuthenticatedApp({ username, onLogout }: { username: string; onLogout: () => void }) {
  const { snapshots, status: dockerStatus, isStreaming } = useLiveContainers();
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
  const databaseId = locationPath.startsWith('/databases/') ? decodeURIComponent(locationPath.slice('/databases/'.length)) : null;
  const selectedContainer = containerId ? snapshots.find((snapshot) => snapshot.id === containerId) ?? null : null;
  const selectedHistory = useContainerHistory(containerId, selectedContainer);
  const isDetailPage = Boolean(containerId);
  const isContainersPage = locationPath === '/containers';
  const isDatabasePage = locationPath === '/databases' || Boolean(databaseId);

  const totals = useMemo(() => ({
    running: snapshots.filter((item) => item.state === 'running').length,
    paused: snapshots.filter((item) => item.state === 'paused').length,
    exited: snapshots.filter((item) => item.state === 'exited').length,
    unknown: snapshots.filter((item) => item.state === 'unknown').length,
    cpu: snapshots.reduce((sum, item) => sum + item.cpuPercent, 0),
    memory: snapshots.reduce((sum, item) => sum + item.memoryBytes, 0),
    network: snapshots.reduce((sum, item) => sum + item.networkRxBytes + item.networkTxBytes, 0)
  }), [snapshots]);

  const handleNavigate = (path: string) => {
    window.history.pushState({}, '', path);
    setLocationPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const overviewHistory = (container: Container) => liveHistoryById[container.id] ?? [];
  const listTitle = 'Containers';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); handleNavigate('/'); }}><span className="brand-mark">S</span><span>stackvia</span></a>
        <nav className="sidebar-nav">
          <a className={locationPath === '/' ? 'active' : ''} href="/" onClick={(event) => { event.preventDefault(); handleNavigate('/'); }}><Icon name="grid" />Overview</a>
          <a className={isDetailPage || isContainersPage ? 'active' : ''} href="/containers" onClick={(event) => { event.preventDefault(); handleNavigate('/containers'); }}><Icon name="box" />Containers <em>{totals.running}</em></a>
          <a className={isDatabasePage ? 'active' : ''} href="/databases" onClick={(event) => { event.preventDefault(); handleNavigate('/databases'); }}><Icon name="database" />Databases</a>
        </nav>
        <div className="sidebar-bottom">
          <a href="#settings"><Icon name="settings" />Settings</a>
          <div className="user">
            <span>{username.slice(0, 2).toUpperCase()}</span>
            <div><b>{username}</b><small>Self-hosted</small></div>
            <button type="button" className="logout-button" onClick={onLogout} aria-label="Sign out">Sign out</button>
          </div>
        </div>
      </aside>

      <main>
        {isDatabasePage ? (
          <DatabaseWorkspace connectionId={databaseId} onNavigate={handleNavigate} />
        ) : isContainersPage ? (
          <ContainersPage
            snapshots={snapshots}
            dockerStatus={dockerStatus}
            isStreaming={isStreaming}
            filter={filter}
            setFilter={setFilter}
            historyForContainer={overviewHistory}
            onNavigate={handleNavigate}
          />
        ) : !isDetailPage ? (
          <OverviewPage
            snapshots={snapshots}
            dockerStatus={dockerStatus}
            isStreaming={isStreaming}
            filter={filter}
            setFilter={setFilter}
            onNavigate={handleNavigate}
            overviewHistory={overviewHistory}
            totals={totals}
            listTitle={listTitle}
          />
        ) : (
          <DetailPage
            container={selectedContainer}
            containerId={containerId ?? ''}
            history={selectedHistory}
            onBack={() => handleNavigate('/containers')}
          />
        )}
      </main>
    </div>
  );
}

export function App() {
  const { status, setup, login, logout } = useAuth();
  if (status.phase === 'loading') {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" />
        <span>Loading stackvia…</span>
      </div>
    );
  }

  if (status.phase === 'setup') {
    return <SetupPage onSetup={setup} />;
  }

  if (status.phase === 'login') {
    return <LoginPage onLogin={login} />;
  }

  return <AuthenticatedApp username={status.username} onLogout={logout} />;
}
