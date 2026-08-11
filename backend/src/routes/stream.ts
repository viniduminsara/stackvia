import { Router } from 'express';
import { collectorEvents, getLatest } from '../collector.js';

export const streamRouter = Router();

streamRouter.get('/stats', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no'
  });
  const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  send(getLatest());
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
  collectorEvents.on('snapshot', send);
  req.on('close', () => {
    clearInterval(heartbeat);
    collectorEvents.off('snapshot', send);
  });
});
