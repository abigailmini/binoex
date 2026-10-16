/* Paper-trading routes: replace /api/wallet and /api/trade when config.paper is on.
 * Same engine as the browser build (public/js/paper-engine.js); state persisted per user in SQLite. */
import { Router } from 'express';
import '../../public/js/paper-engine.js'; // defines globalThis.PaperEngine
import { config } from '../config.js';
import { q, audit } from '../db.js';
import { requireAuth } from '../auth.js';
import { prices, onPrice } from '../bybit/ws.js';

const { PaperEngine } = globalThis;
const engines = new Map(); // userId -> PaperEngine

export function paperEngine(userId) {
  let e = engines.get(userId);
  if (!e) {
    const row = q.paperState.get(userId);
    let state = null;
    try { state = row?.paper_state ? JSON.parse(row.paper_state) : null; } catch { state = null; }
    e = new PaperEngine({
      state: state || PaperEngine.initial(config.paperStartBalance),
      getPrice: (cat, sym) => prices.get(`${cat}:${sym}`),
      onChange: (s) => q.savePaperState.run(JSON.stringify(s), userId),
    });
    if (!state) e.save();
    engines.set(userId, e);
  }
  return e;
}

// Every upstream price tick drives resting / conditional orders for users with open items.
// Engines are loaded lazily; users not touched since boot are loaded once here.
for (const { id } of q.paperUsersWithState.all()) paperEngine(id);
onPrice((cat, sym, px) => { for (const e of engines.values()) e.tick(cat, sym, px); });

export const paperWallet = Router();
paperWallet.use(requireAuth);
paperWallet.get('/balance', (req, res) => res.json(paperEngine(req.user.id).balance()));
paperWallet.post('/faucet', (req, res) => {
  const amt = Math.min(Number(req.body?.amount) || 10000, 1_000_000);
  const bal = paperEngine(req.user.id).faucet(amt);
  audit(req.user.id, 'paper_faucet', { amt }, req.ip);
  res.json({ ok: true, balance: bal });
});
paperWallet.post('/reset', (req, res) => { paperEngine(req.user.id).reset(config.paperStartBalance); res.json({ ok: true }); });
paperWallet.get('/deposit/assets', (_req, res) => res.json({ assets: config.depositAssets.map((a) => ({ ...a, chainName: a.chain })) }));
paperWallet.get('/deposit/address', (_req, res) => res.status(400).json({ error: 'Paper trading: use the demo faucet instead of on-chain deposits' }));
paperWallet.get('/deposit/history', (_req, res) => res.json({ list: [] }));
paperWallet.get('/withdraw/history', (_req, res) => res.json({ list: [] }));
paperWallet.post('/withdraw', (_req, res) => res.status(400).json({ error: 'Withdrawals are not available in paper trading' }));

export const paperTrade = Router();
paperTrade.use(requireAuth);
const allowed = (cat, sym) => (cat === 'spot' ? config.spotSymbols : config.linearSymbols).includes(sym);
paperTrade.post('/order', (req, res) => {
  try {
    const body = req.body || {}; const sym = String(body.symbol || '').toUpperCase(), cat = body.category === 'spot' ? 'spot' : 'linear';
    if (!allowed(cat, sym)) return res.status(400).json({ error: 'Market not listed' });
    const o = paperEngine(req.user.id).placeOrder({ ...body, symbol: sym, category: cat });
    audit(req.user.id, 'paper_order', { orderId: o.orderId, sym, side: o.side, qty: o.qty }, req.ip);
    res.json({ orderId: o.orderId, orderLinkId: '' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
paperTrade.post('/order/cancel', (req, res) => {
  try { res.json(paperEngine(req.user.id).cancelOrder(String(req.body?.orderId || ''))); } catch (e) { res.status(400).json({ error: e.message }); }
});
paperTrade.get('/orders', (req, res) => res.json(paperEngine(req.user.id).orders(req.query.category)));
paperTrade.get('/executions', (req, res) => res.json({ list: paperEngine(req.user.id).executions(req.query.category) }));
paperTrade.get('/positions', (req, res) => res.json({ list: paperEngine(req.user.id).positions() }));
paperTrade.post('/leverage', (req, res) => {
  const lev = Number(req.body?.leverage);
  if (!(lev >= 1 && lev <= 100)) return res.status(400).json({ error: 'Invalid leverage' });
  paperEngine(req.user.id).setLeverage(String(req.body?.symbol || '').toUpperCase(), lev);
  res.json({ ok: true, leverage: lev });
});
