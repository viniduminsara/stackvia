import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function issueSession(res: Response, username: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured');
  }
  const token = jwt.sign({ username }, secret, { expiresIn: '7d' });
  
  res.cookie('session_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days in ms
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session_token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Server authentication configuration error' });
  }

  try {
    const decoded = jwt.verify(token, secret) as { username: string };
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
