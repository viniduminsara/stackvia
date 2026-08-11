import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startCollector } from './collector.js';
import { containersRouter } from './routes/containers.js';
import { streamRouter } from './routes/stream.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json({ limit: '32kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'stackvia' }));
app.use('/api/containers', containersRouter);
app.use('/api/stream', streamRouter);

const staticCandidates = [resolve(process.cwd(), 'frontend/dist'), resolve(process.cwd(), '../frontend/dist')];
const frontendDist = staticCandidates.find(existsSync);
if (frontendDist) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => res.sendFile(resolve(frontendDist, 'index.html')));
}

startCollector();
app.listen(port, () => console.log(`stackvia is listening on http://localhost:${port}`));
