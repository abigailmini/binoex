import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { q } from './db.js';
import { BybitClient } from './bybit/client.js';
import { decrypt } from './crypto.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: '12h' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = q.userById.get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account is frozen' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

/** Bybit client bound to the user's own sub-account API key. */
export function userClient(user) {
  if (!user.sub_api_key || !user.sub_api_secret) {
    const err = new Error('Account not provisioned on Bybit yet');
    err.status = 409;
    throw err;
  }
  return new BybitClient({ apiKey: user.sub_api_key, apiSecret: decrypt(user.sub_api_secret) });
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    uid: user.bybit_uid,
    paper: config.paper,
    provisioned: config.paper || !!user.sub_api_key,
    status: user.status,
    createdAt: user.created_at,
  };
}
