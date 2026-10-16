/* Browser-side paper trading: accounts + engine state in localStorage (used on the static site / GitHub Pages).
 * Exposes PaperLocal.handle(path, method, body) with the same contract as the backend /api routes. */
window.PaperLocal = (() => {
  const LS = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const K = { users: 'binoex_paper_users', sessions: 'binoex_paper_sessions', state: (e) => 'binoex_paper_state:' + e };
  const prices = {}; // `${cat}:${sym}` -> last price
  const engines = {};
  let watchers = new Set();

  async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
  const rand = () => [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const fail = (msg, status = 400) => { const e = new Error(msg); e.status = status; throw e; };

  function currentEmail() { const t = localStorage.getItem('binoex_token'); return t ? LS.get(K.sessions, {})[t] || null : null; }
  function engine(email) {
    if (!engines[email]) engines[email] = new PaperEngine({ state: LS.get(K.state(email), null), getPrice: (c, s) => prices[c + ':' + s], onChange: (s) => LS.set(K.state(email), s) });
    return engines[email];
  }
  function user(email) { const u = LS.get(K.users, {})[email]; return u && { id: u.id, email, uid: u.uid, provisioned: true, status: 'active', createdAt: u.created, paper: true }; }

  // Keep live prices flowing for symbols with open orders / positions so fills happen even off the trade page.
  function ensureWatch() {
    const email = currentEmail(); if (!email || !window.BX) return;
    for (const [cat, sym] of engine(email).watchList()) {
      const k = cat + ':' + sym; if (watchers.has(k)) continue; watchers.add(k);
      BX.stream(cat).subscribe(cat, 'tickers.' + sym, () => {});
    }
  }
  function onPrice(cat, sym, px) {
    prices[cat + ':' + sym] = px;
    const email = currentEmail(); if (email) engine(email).tick(cat, sym, px);
  }

  async function handle(path, method = 'GET', body = {}) {
    const [p, q] = path.split('?'); const params = Object.fromEntries(new URLSearchParams(q || ''));
    const users = LS.get(K.users, {}), sessions = LS.get(K.sessions, {});
    // ---- auth ----
    if (p === '/auth/register') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Valid email required');
      if (!body.password || body.password.length < 8) fail('Password must be at least 8 characters');
      if (users[email]) fail('Email already registered', 409);
      const id = Object.keys(users).length + 1;
      users[email] = { id, uid: String(100000 + id), hash: await sha(email + ':' + body.password), created: new Date().toISOString() };
      LS.set(K.users, users); engine(email); // creates the 100k USDT demo account
      const token = rand(); sessions[token] = email; LS.set(K.sessions, sessions);
      return { token, user: user(email) };
    }
    if (p === '/auth/login') {
      const email = String(body.email || '').trim().toLowerCase(); const u = users[email];
      if (!u || u.hash !== (await sha(email + ':' + (body.password || '')))) fail('Invalid email or password', 401);
      const token = rand(); sessions[token] = email; LS.set(K.sessions, sessions);
      return { token, user: user(email) };
    }
    if (p === '/auth/logout') { const t = localStorage.getItem('binoex_token'); delete sessions[t]; LS.set(K.sessions, sessions); return { ok: true }; }
    const email = currentEmail(); if (!email || !users[email]) fail('Not authenticated', 401);
    if (p === '/auth/me') return { user: user(email) };
    const eng = engine(email);
    // ---- wallet ----
    if (p === '/wallet/balance') return eng.balance();
    if (p === '/wallet/faucet' && method === 'POST') return { ok: true, balance: eng.faucet(Number(body.amount) || 10000) };
    if (p === '/wallet/reset' && method === 'POST') { eng.reset(); return { ok: true }; }
    if (p === '/wallet/deposit/assets') return { assets: (await BX.services()).depositAssets.map((a) => ({ ...a, chainName: a.chain })) };
    if (p === '/wallet/deposit/address') fail('Deposit address generation is temporarily unavailable. Please try again later.');
    if (p === '/wallet/deposit/history' || p === '/wallet/withdraw/history') return { list: [] };
    if (p === '/wallet/withdraw') fail('Withdrawals are temporarily unavailable. Please try again later.');
    // ---- trade ----
    if (p === '/trade/order' && method === 'POST') { const o = eng.placeOrder(body); ensureWatch(); return { orderId: o.orderId, orderLinkId: '' }; }
    if (p === '/trade/order/cancel') return eng.cancelOrder(String(body.orderId));
    if (p === '/trade/orders') return eng.orders(params.category);
    if (p === '/trade/executions') return { list: eng.executions(params.category) };
    if (p === '/trade/positions') return { list: eng.positions() };
    if (p === '/trade/leverage') { const lev = Number(body.leverage); if (!(lev >= 1 && lev <= 100)) fail('Invalid leverage'); eng.setLeverage(String(body.symbol).toUpperCase(), lev); return { ok: true, leverage: lev }; }
    fail('Not found', 404);
  }

  return { handle, onPrice, ensureWatch, prices };
})();
