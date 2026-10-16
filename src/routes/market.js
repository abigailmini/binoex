import { Router } from 'express';
import { master } from '../bybit/client.js';
import { config } from '../config.js';

export const marketRouter = Router();

const CATS = new Set(['spot', 'linear', 'inverse', 'option']);
function cat(req, res) {
  const c = String(req.query.category || 'spot');
  if (!CATS.has(c)) { res.status(400).json({ error: 'bad category' }); return null; }
  return c;
}
const sym = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');

// Public market data, proxied so the browser never talks to Bybit directly (white-label domain only).
marketRouter.get('/tickers', async (req, res, next) => {
  try {
    const c = cat(req, res); if (!c) return;
    const r = await master.tickers(c);
    const allowed = new Set(c === 'spot' ? config.spotSymbols : config.linearSymbols);
    res.json({ category: c, list: r.list.filter((t) => allowed.has(t.symbol)) });
  } catch (e) { next(e); }
});

marketRouter.get('/instruments', async (req, res, next) => {
  try {
    const c = cat(req, res); if (!c) return;
    const r = await master.instruments(c, req.query.symbol ? sym(req.query.symbol) : undefined);
    const allowed = new Set(c === 'spot' ? config.spotSymbols : config.linearSymbols);
    res.json({ category: c, list: r.list.filter((i) => allowed.has(i.symbol)) });
  } catch (e) { next(e); }
});

marketRouter.get('/kline', async (req, res, next) => {
  try {
    const c = cat(req, res); if (!c) return;
    const interval = String(req.query.interval || '60');
    const r = await master.kline(c, sym(req.query.symbol), interval, Math.min(Number(req.query.limit || 200), 1000));
    res.json(r);
  } catch (e) { next(e); }
});

marketRouter.get('/orderbook', async (req, res, next) => {
  try {
    const c = cat(req, res); if (!c) return;
    res.json(await master.orderbook(c, sym(req.query.symbol), Math.min(Number(req.query.limit || 25), 200)));
  } catch (e) { next(e); }
});

marketRouter.get('/trades', async (req, res, next) => {
  try {
    const c = cat(req, res); if (!c) return;
    res.json(await master.recentTrades(c, sym(req.query.symbol), 50));
  } catch (e) { next(e); }
});
