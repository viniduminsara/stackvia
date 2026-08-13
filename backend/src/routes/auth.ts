import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getAdmin, createAdmin } from '../lib/store.js';
import { hashPassword, verifyPassword, issueSession, requireAuth } from '../lib/auth.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later' }
});

function respondError(res: any, status: number, message: string) {
  return res.status(status).json({ error: message });
}

authRouter.get('/status', (_req, res) => {
  const admin = getAdmin();
  res.json({ setupRequired: !admin });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const user = (req as any).user;
  res.json({ username: user.username });
});

authRouter.post('/setup', (req, res) => {
  const admin = getAdmin();
  if (admin) {
    return respondError(res, 409, 'Setup already completed');
  }

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!username) {
    return respondError(res, 400, 'Username is required');
  }
  if (!password || password.length < 8) {
    return respondError(res, 400, 'Password must be at least 8 characters long');
  }

  const passwordHash = hashPassword(password);
  const success = createAdmin(username, passwordHash);

  if (!success) {
    return respondError(res, 500, 'Failed to create admin user');
  }

  issueSession(res, username);
  res.status(201).json({ success: true, username });
});

authRouter.post('/login', loginLimiter, (req, res) => {
  const admin = getAdmin();
  if (!admin) {
    return respondError(res, 400, 'Setup required');
  }

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (username !== admin.username || !verifyPassword(password, admin.passwordHash)) {
    return respondError(res, 401, 'Invalid username or password');
  }

  issueSession(res, username);
  res.json({ success: true, username });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('session_token');
  res.json({ success: true });
});
