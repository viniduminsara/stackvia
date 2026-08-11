import { Router } from 'express';
import { getLatest } from '../collector.js';
import { historyFor } from '../lib/store.js';

export const containersRouter = Router();

containersRouter.get('/', (_req, res) => res.json(getLatest()));

containersRouter.get('/:id/history', (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168);
  res.json({ items: historyFor(req.params.id, Date.now() - hours * 60 * 60 * 1000) });
});
