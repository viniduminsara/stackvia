import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startCollector } from './collector.js';
import { databasesRouter } from './routes/databases.js';
import { containersRouter } from './routes/containers.js';
import { streamRouter } from './routes/stream.js';
import { authRouter } from './routes/auth.js';
import { requireAuth } from './lib/auth.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

if (process.env.ALLOWED_ORIGIN) {
  app.use(cors({
    origin: process.env.ALLOWED_ORIGIN,
    credentials: true
  }));
}

app.use(cookieParser());
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'stackvia' }));

app.use('/api/auth', authRouter);
app.use('/api/containers', requireAuth, containersRouter);
app.use('/api/databases', requireAuth, databasesRouter);
app.use('/api/stream', requireAuth, streamRouter);

const staticCandidates = [resolve(process.cwd(), 'frontend/dist'), resolve(process.cwd(), '../frontend/dist')];
const frontendDist = staticCandidates.find(existsSync);
if (frontendDist) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => res.sendFile(resolve(frontendDist, 'index.html')));
}

startCollector();
app.listen(port, () => console.log(`stackvia is listening on http://localhost:${port}`));
