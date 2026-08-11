import { useMemo, useState } from 'react';
import type { Container } from './hooks/useLiveContainers';
import { useLiveContainers } from './hooks/useLiveContainers';

const icons = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  box: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.1 2.1-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56v.1h-3v-.1A1.7 1.7 0 0 0 10.7 18.6a1.7 1.7 0 0 0-1.88.34l-.06.06-2.1-2.1.06-.06A1.7 1.7 0 0 0 7.06 15a1.7 1.7 0 0 0-1.56-1.03h-.1v-3h.1A1.7 1.7 0 0 0 7.06 9.94a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.1-2.1.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56v-.1h3v.1A1.7 1.7 0 0 0 15.76 6.3a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.1 2.1-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.1v3h-.1A1.7 1.7 0 0 0 19.4 15Z"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  arrow: <path d="m9 18 6-6-6-6"/>
};

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

function Sparkline({ value, kind = 'purple' }: { value: number; kind?: 'purple' | 'blue' }) {
  const points = Array.from({ length: 22 }, (_, index) => {
    const y = 21 - Math.max(2, Math.min(17, value / 7 + Math.sin(index * 0.75 + value) * 3 + Math.cos(index * 0.23) * 2));
    return `${index * 5.1},${y}`;
  }).join(' ');
  return <svg className={`spark ${kind}`} viewBox="0 0 110 24" preserveAspectRatio="none"><polyline points={points} fill="none" vectorEffect="non-scaling-stroke" /></svg>;
}

function Metric({ label, value, trend, tone = 'default' }: { label: string; value: string; trend: string; tone?: 'default' | 'blue' | 'green' }) {
  return <article className={`metric-card ${tone}`}>
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
    <div className="metric-trend"><span className="trend-dot" />{trend}</div>
  </article>;
}

function ContainerCard({ container, onSelect }: { container: Container; onSelect: () => void }) {
  const running = container.state === 'running';
  return <button className="container-card" onClick={onSelect}>
    <div className="card-top">
      <div className="service-ident"><div className="service-icon">{container.name.slice(0, 1).toUpperCase()}</div><div><strong>{container.name}</strong><span>{container.image}</span></div></div>
      <span className={`status ${running ? 'live' : ''}`}><i />{container.state}</span>
    </div>
    <div className="card-metrics">
      <div><span>CPU</span><b>{percent(container.cpuPercent)}</b><Sparkline value={container.cpuPercent} /></div>
      <div><span>Memory</span><b>{bytes(container.memoryBytes)}</b><Sparkline value={container.memoryPercent} kind="blue" /></div>
    </div>
    <div className="card-footer"><span>{percent(container.memoryPercent)} of {bytes(container.memoryLimitBytes)}</span><span>View details <Icon name="arrow" /></span></div>
  </button>;
}

function DetailPanel({ container, onClose }: { container: Container; onClose: () => void }) {
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer" onClick={(event) => event.stopPropagation()}>
    <button className="close" onClick={onClose} aria-label="Close">×</button>
    <div className="eyebrow">CONTAINER DETAILS</div><h2>{container.name}</h2><p className="muted">{container.image}</p>
    <div className="drawer-status"><span className="status live"><i />{container.state}</span><span>Live telemetry</span></div>
    <div className="drawer-grid"><Metric label="CPU usage" value={percent(container.cpuPercent)} trend="updated just now" /><Metric label="Memory" value={bytes(container.memoryBytes)} trend={`${percent(container.memoryPercent)} of limit`} tone="blue" /></div>
    <section className="network"><div className="section-title">Network I/O <span>Since container start</span></div><div><div><span>Received</span><b>{bytes(container.networkRxBytes)}</b></div><div><span>Sent</span><b>{bytes(container.networkTxBytes)}</b></div></div></section>
    <p className="notice">Historical charts are being collected every 10 seconds and will appear here as data accrues.</p>
  </aside></div>;
}

export function App() {
  const { snapshots, status, isStreaming } = useLiveContainers();
  const [selected, setSelected] = useState<Container | null>(null);
  const totals = useMemo(() => ({
    running: snapshots.filter((item) => item.state === 'running').length,
    cpu: snapshots.reduce((sum, item) => sum + item.cpuPercent, 0),
    memory: snapshots.reduce((sum, item) => sum + item.memoryBytes, 0),
    network: snapshots.reduce((sum, item) => sum + item.networkRxBytes + item.networkTxBytes, 0)
  }), [snapshots]);

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-mark">S</span><span>stackvia</span></a>
      <div className="workspace"><span>WORKSPACE</span><button>Personal workspace <b>⌄</b></button></div>
      <nav><a className="active" href="#overview"><Icon name="grid" />Overview</a><a href="#containers"><Icon name="box" />Containers <em>{totals.running}</em></a><a href="#databases"><Icon name="database" />Databases <span className="soon">Soon</span></a></nav>
      <div className="sidebar-bottom"><a href="#settings"><Icon name="settings" />Settings</a><div className="user"><span>VS</span><div><b>Local admin</b><small>Self-hosted</small></div><button aria-label="Account menu">•••</button></div></div>
    </aside>
    <main>
      <header><div><p className="eyebrow">INFRASTRUCTURE OVERVIEW</p><h1>Good morning</h1><p className="subtle">Here’s what’s happening across your services.</p></div><div className="header-actions"><span className={`connection ${isStreaming && status.connected ? 'connected' : ''}`}><i />{status.mode === 'demo' ? 'Demo telemetry' : isStreaming && status.connected ? 'Live connection' : 'Connecting…'}</span><button className="button secondary" title="Database explorer arrives in Phase 2"><Icon name="plus" />Add database</button></div></header>
      <section className="metrics" id="overview"><Metric label="Running containers" value={`${totals.running}`} trend={totals.running ? 'All services reporting' : 'Waiting for Docker'} tone="green" /><Metric label="Total CPU usage" value={percent(totals.cpu)} trend="Across active containers" /><Metric label="Memory in use" value={bytes(totals.memory)} trend="Container memory footprint" tone="blue" /><Metric label="Network traffic" value={bytes(totals.network)} trend="Total received + sent" /></section>
      <section className="services-section" id="containers"><div className="section-header"><div><h2>Containers</h2><p>Live resource usage, refreshed automatically.</p></div><button className="text-button">View all <Icon name="arrow" /></button></div>
        {snapshots.length ? <div className="container-grid">{snapshots.map((container) => <ContainerCard key={container.id} container={container} onSelect={() => setSelected(container)} />)}</div> : <div className="empty-state"><div className="empty-icon"><Icon name="box" /></div><div><h3>{status.mode === 'unavailable' ? 'Docker is not connected' : 'Looking for containers'}</h3><p>{status.mode === 'unavailable' ? 'Mount /var/run/docker.sock into Stackvia to start monitoring this host.' : 'The collector is checking the Docker daemon.'}</p></div><code>-v /var/run/docker.sock:/var/run/docker.sock:ro</code></div>}
      </section>
      <section className="activity"><div className="section-header"><div><h2>Collector activity</h2><p>Persistent metrics are stored locally in SQLite.</p></div><span className="frequency">10 second interval</span></div><div className="activity-line"><i className={status.connected ? 'pulse' : ''} /><div><b>{status.connected ? 'Collector is healthy' : 'Collector is standing by'}</b><span>{status.lastCollectedAt ? `Last check ${new Date(status.lastCollectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : status.message ?? 'Waiting for a Docker connection'}</span></div><span className="activity-tail">SQLite · WAL enabled</span></div></section>
    </main>
    {selected && <DetailPanel container={selected} onClose={() => setSelected(null)} />}
  </div>;
}
