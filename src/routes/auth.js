import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { q, audit, db } from '../db.js';
import { master } from '../bybit/client.js';
import { encrypt } from '../crypto.js';
import { signToken, requireAuth, publicUser } from '../auth.js';
import { getServices, subAccountPermissions } from '../services.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Bybit sub username: 6-16 chars, letters + digits, must contain both. */
function makeSubUsername() {
  const letters = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  let s = 'bnx';
  for (let i = 0; i < 5; i++) s += letters[randomInt(letters.length)];
  for (let i = 0; i < 5; i++) s += digits[randomInt(digits.length)];
  return s; // 13 chars
}

/**
 * Registration = local user + Bybit sub-account under the institutional master.
 *  1. POST /v5/user/create-sub-member   -> uid
 *  2. POST /v5/user/create-sub-api      -> per-user trading key (secret encrypted at rest)
 * If Bybit provisioning fails the local user is rolled back so the email can retry.
 */
authRouter.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (q.userByEmail.get(email.toLowerCase())) return res.status(409).json({ error: 'Email already registered' });

  const services = await getServices();
  if (!services.bybit.reachable) return res.status(503).json({ error: 'Exchange backend unavailable, try again later' });

  const hash = await bcrypt.hash(password, 12);
  const { lastInsertRowid: userId } = q.insertUser.run(email.toLowerCase(), hash);

  try {
    const username = makeSubUsername();
    const sub = await master.createSubMember({
      username,
      memberType: 1, // normal sub account
      switch_: 0,    // quick login off
      isUta: 1,      // unified trading account
      note: `binoex:${userId}`,
    });
    const uid = String(sub.uid);

    const key = await master.createSubApiKey({
      subuid: Number(uid),
      note: 'binoex-trading',
      readOnly: 0,
      permissions: subAccountPermissions(services.services),
    });

    q.attachBybit.run(uid, username, key.apiKey, encrypt(key.secret), userId);
    audit(userId, 'register', { uid }, req.ip);

    const user = q.userById.get(userId);
    const token = signToken(user);
    res.cookie('token', token, cookieOpts(req));
    return res.status(201).json({ token, user: publicUser(user) });
  } catch (e) {
    q.deleteUser.run(userId);
    audit(userId, 'register_failed', { error: e.message, retCode: e.retCode }, req.ip);
    console.error('[register] bybit provisioning failed:', e.message);
    return res.status(502).json({ error: `Account provisioning failed: ${e.message}` });
  }
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = q.userByEmail.get((email || '').toLowerCase());
  const ok = user && (await bcrypt.compare(password || '', user.password_hash));
  if (!ok) {
    audit(user?.id, 'login_failed', { email }, req.ip);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'Account is frozen' });
  q.touchLogin.run(user.id);
  audit(user.id, 'login', null, req.ip);
  const token = signToken(user);
  res.cookie('token', token, cookieOpts(req));
  res.json({ token, user: publicUser(user) });
});

authRouter.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

function cookieOpts(req) {
  return { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 12 * 3600 * 1000 };
}

// keep db import used (transaction helpers may be added later)
void db;
