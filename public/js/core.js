/* Binoex core: API client, market-data source (backend relay or Bybit public endpoints in static mode),
 * formatting helpers and the shared header/footer. */
window.BX = (() => {
  const STATIC = location.hostname.endsWith('github.io') || window.BINOEX_STATIC === true;
  const BYBIT_REST = 'https://api.bybit.com';
  const BYBIT_WS = 'wss://stream.bybit.com/v5/public/';
  const DEFAULT_SYMBOLS = {
    spot: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'ADAUSDT', 'TONUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'TRXUSDT', 'LTCUSDT', 'SUIUSDT', 'PEPEUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'UNIUSDT'],
    linear: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'ADAUSDT', 'TONUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'SUIUSDT', 'PEPEUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'WIFUSDT', 'LTCUSDT', 'TRXUSDT'],
  };

  const token = () => localStorage.getItem('binoex_token');
  const setToken = (t) => (t ? localStorage.setItem('binoex_token', t) : localStorage.removeItem('binoex_token'));

  // ---------- backend API ----------
  async function api(path, { method = 'GET', body } = {}) {
    if (STATIC) {
      // Static site: accounts + paper trading live in the browser (see paper.js)
      if (window.PaperLocal) return window.PaperLocal.handle(path, method, body || {});
      const err = new Error('Preview site: accounts, deposits and trading require the Binoex backend to be deployed.');
      err.status = 503; err.preview = true; throw err;
    }
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; throw err; }
    return data;
  }

  let meCache;
  async function me() {
    if (meCache !== undefined) return meCache;
    if (!token()) return (meCache = null);
    try { meCache = (await api('/auth/me')).user; } catch (e) { if (e.status === 401) setToken(null); meCache = null; }
    return meCache;
  }

  let servicesCache;
  async function services() {
    if (servicesCache) return servicesCache;
    if (STATIC) {
      return (servicesCache = {
        online: true, withdrawals: false, preview: true, paper: !!window.PaperLocal,
        services: { spot: { id: 'spot', label: 'Spot', live: true }, linear: { id: 'linear', label: 'Derivatives', live: true } },
        markets: DEFAULT_SYMBOLS,
        depositAssets: [{ coin: 'USDT', chain: 'TRX' }, { coin: 'USDT', chain: 'ETH' }, { coin: 'USDT', chain: 'ARBI' }, { coin: 'USDC', chain: 'ETH' }, { coin: 'BTC', chain: 'BTC' }, { coin: 'ETH', chain: 'ETH' }, { coin: 'SOL', chain: 'SOL' }],
      });
    }
    try { servicesCache = await api('/services'); } catch { servicesCache = { online: false, services: {}, markets: DEFAULT_SYMBOLS, depositAssets: [] }; }
    return servicesCache;
  }

  // ---------- public market data ----------
  const MKT = { tickers: 'tickers', kline: 'kline', orderbook: 'orderbook', trades: 'recent-trade', instruments: 'instruments-info' };
  async function market(kind, params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
    if (STATIC) {
      const res = await fetch(`${BYBIT_REST}/v5/market/${MKT[kind]}?${qs}`);
      const j = await res.json();
      if (j.retCode !== 0) throw new Error(j.retMsg || 'market data error');
      return j.result;
    }
    const res = await fetch(`/api/market/${kind}?${qs}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    return j;
  }

  // One shared socket per category (static: Bybit public stream; backend: relay carries all categories on /ws).
  const sockets = {};
  const prices = {}; // `${category}:${symbol}` -> last traded price (fed by any ticker subscription)
  function stream(category) {
    const key = STATIC ? category : 'relay';
    if (sockets[key]) return sockets[key];
    const handlers = new Map(); // `${cat}:${topic}` -> Set<fn>
    let ws, timer, open = false;
    const url = STATIC ? BYBIT_WS + category : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    const send = (o) => open && ws.send(JSON.stringify(o));
    function connect() {
      ws = new WebSocket(url);
      ws.onopen = () => {
        open = true;
        const byCat = {};
        for (const k of handlers.keys()) { const [c, t] = k.split(':'); (byCat[c] ??= []).push(t); }
        for (const [c, args] of Object.entries(byCat)) send(STATIC ? { op: 'subscribe', args } : { op: 'subscribe', category: c, args });
        timer = setInterval(() => send({ op: 'ping' }), 20000);
      };
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (!msg.topic) return;
        const cat = STATIC ? category : msg.category;
        if (msg.topic.startsWith('tickers.') && msg.data?.lastPrice) {
          prices[`${cat}:${msg.topic.slice(8)}`] = Number(msg.data.lastPrice);
          if (window.PaperLocal) window.PaperLocal.onPrice(cat, msg.topic.slice(8), Number(msg.data.lastPrice));
        }
        const set = handlers.get(`${cat}:${msg.topic}`);
        if (set) for (const h of set) h(msg);
      };
      ws.onclose = () => { open = false; clearInterval(timer); setTimeout(connect, 2000); };
      ws.onerror = () => ws.close();
    }
    connect();
    const s = {
      subscribe(cat, topic, h) {
        const k = `${cat}:${topic}`;
        if (!handlers.has(k)) { handlers.set(k, new Set()); send(STATIC ? { op: 'subscribe', args: [topic] } : { op: 'subscribe', category: cat, args: [topic] }); }
        handlers.get(k).add(h);
        return () => s.unsubscribe(cat, topic, h);
      },
      unsubscribe(cat, topic, h) {
        const k = `${cat}:${topic}`, set = handlers.get(k);
        if (!set) return;
        if (h) set.delete(h); else set.clear();
        if (!set.size) { handlers.delete(k); send(STATIC ? { op: 'unsubscribe', args: [topic] } : { op: 'unsubscribe', category: cat, args: [topic] }); }
      },
    };
    return (sockets[key] = s);
  }

  // ---------- formatting ----------
  const fmt = {
    num: (v, d) => { const n = Number(v); if (!isFinite(n)) return '--'; return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); },
    price: (v, tick) => {
      const n = Number(v); if (!isFinite(n)) return '--';
      if (tick) { const d = Math.max(0, (String(tick).split('.')[1] || '').length); return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
      const d = n >= 1000 ? 2 : n >= 1 ? 4 : n >= 0.01 ? 6 : 8;
      return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    pct: (v) => { const n = Number(v) * 100; return isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%' : '--'; },
    amt: (v, max = 6) => { const n = Number(v); return isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: max }) : '--'; },
    compact: (v) => { const n = Number(v); if (!isFinite(n)) return '--'; if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K'; return n.toFixed(2); },
    usd: (v) => { const n = Number(v); return isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '--'; },
    time: (ms) => { const d = new Date(Number(ms)); return isNaN(d) ? '--' : d.toLocaleString('en-GB', { hour12: false }); },
    clock: (ms) => new Date(Number(ms)).toLocaleTimeString('en-GB', { hour12: false }),
    decimals: (step) => Math.max(0, (String(step).split('.')[1] || '').replace(/0+$/, '').length),
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const base = (symbol) => symbol.replace(/(USDT|USDC|USD|PERP)$/, '');
  const quote = (symbol) => symbol.slice(base(symbol).length) || 'USDT';
  const COIN_COLORS = { BTC: '#f7931a', ETH: '#627eea', SOL: '#9945ff', XRP: '#346aa9', BNB: '#f3ba2f', DOGE: '#c2a633', ADA: '#0d1e30', TON: '#0098ea', USDT: '#26a17b', USDC: '#2775ca', AVAX: '#e84142', LINK: '#2a5ada', DOT: '#e6007a', TRX: '#ef0027', LTC: '#345d9d', SUI: '#4da2ff', PEPE: '#3d8b37', NEAR: '#00c08b', APT: '#2dd8a3', ARB: '#28a0f0', OP: '#ff0420', UNI: '#ff007a', WIF: '#b58cf5' };
  const coinIcon = (c) => `<span class="ci" style="background:${COIN_COLORS[c] || '#5b5f66'}">${esc(c.slice(0, 3))}</span>`;
  const toast = (msg, ok = true) => {
    let t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'toast show ' + (ok ? 'ok' : 'bad');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 4000);
  };
  const qs = (k, d) => new URLSearchParams(location.search).get(k) || d;

  // ---------- shared chrome ----------
  const NAV = `
    <div class="dd"><a href="#">Buy Crypto <svg class="chev" viewBox="0 0 10 10"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></a>
      <div class="menu">
        <a href="assets.html#deposit"><span class="ic">💳</span><span><b>Deposit Crypto</b><small>Transfer crypto from another exchange or wallet</small></span></a>
        <a href="#"><span class="ic">🏦</span><span><b>Fiat Deposit</b><small>Bank transfer &amp; cards — coming soon</small></span></a>
        <a href="#"><span class="ic">🤝</span><span><b>P2P Trading</b><small>Buy from verified merchants — coming soon</small></span></a>
      </div></div>
    <a href="markets.html">Markets</a>
    <div class="dd"><a href="trade.html?category=spot&symbol=BTCUSDT">Spot <svg class="chev" viewBox="0 0 10 10"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></a>
      <div class="menu">
        <a href="trade.html?category=spot&symbol=BTCUSDT"><span class="ic">📈</span><span><b>Spot Trading</b><small>Buy and sell crypto at market price</small></span></a>
        <a href="markets.html?category=spot"><span class="ic">🧭</span><span><b>Spot Markets</b><small>All listed trading pairs</small></span></a>
      </div></div>
    <div class="dd"><a href="trade.html?category=linear&symbol=BTCUSDT">Derivatives <svg class="chev" viewBox="0 0 10 10"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></a>
      <div class="menu">
        <a href="trade.html?category=linear&symbol=BTCUSDT"><span class="ic">⚡</span><span><b>USDT Perpetual</b><small>Up to 100x leverage, settled in USDT</small></span></a>
        <a href="markets.html?category=linear"><span class="ic">🧭</span><span><b>Derivatives Markets</b><small>All perpetual contracts</small></span></a>
      </div></div>
    <a href="#">Earn</a>
    <div class="dd"><a href="#">More <svg class="chev" viewBox="0 0 10 10"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></a>
      <div class="menu">
        <a href="#"><span class="ic">🎁</span><span><b>Rewards Hub</b><small>Complete tasks, earn rewards</small></span></a>
        <a href="#"><span class="ic">🛡️</span><span><b>Proof of Reserves</b><small>Verify that assets are fully backed</small></span></a>
        <a href="#"><span class="ic">📚</span><span><b>Learn</b><small>Guides and tutorials</small></span></a>
      </div></div>`;

  async function chrome() {
    const h = document.getElementById('hdr');
    const user = await me();
    if (h) {
      h.className = 'hdr';
      h.innerHTML = `<div class="in">
        <a class="logo" href="./"><span class="mark">B</span>Binoex</a>
        <nav class="nav">${NAV}</nav>
        <div class="right">${user ? `
          <div class="dd"><a class="btn btn-ghost btn-sm" href="assets.html">Assets <svg class="chev" viewBox="0 0 10 10"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></a>
            <div class="menu" style="left:auto;right:0">
              <a href="assets.html"><span class="ic">💼</span><span><b>Assets Overview</b><small>Balances across accounts</small></span></a>
              <a href="assets.html#deposit"><span class="ic">⬇️</span><span><b>Deposit</b></span></a>
              <a href="assets.html#withdraw"><span class="ic">⬆️</span><span><b>Withdraw</b></span></a>
            </div></div>
          <a class="btn btn-ghost btn-sm" href="trade.html#orders">Orders</a>
          <div class="dd"><a class="avatar" href="#">${esc(user.email[0].toUpperCase())}</a>
            <div class="menu" style="left:auto;right:0;min-width:220px">
              <a href="assets.html"><span><b>${esc(user.email)}</b><small>UID ${esc(user.uid || '--')}</small></span></a>
              <a href="#" id="logoutBtn"><span><b>Log Out</b></span></a>
            </div></div>` : `
          <a class="btn btn-ghost btn-sm" href="login.html">Log In</a>
          <a class="btn btn-primary btn-sm" href="login.html?mode=register">Sign Up</a>`}
          <a class="ico" href="#" title="Download App"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg></a>
          <a class="ico" href="#" title="Language"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg></a>
        </div></div>`;
      const lo = document.getElementById('logoutBtn');
      if (lo) lo.onclick = async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }).catch(() => {}); setToken(null); location.href = './'; };
    }
    const f = document.getElementById('ftr');
    if (f) {
      f.className = 'ftr';
      f.innerHTML = `<div class="container">
        <div class="cols">
          <div><div class="logo"><span class="mark">B</span>Binoex</div><p class="dim" style="max-width:260px">Spot and derivatives trading with institutional-grade liquidity and segregated custody.</p>
            <div class="social"><span>𝕏</span><span>in</span><span>▶</span><span>✈</span><span>◎</span></div></div>
          <div><h4>About</h4><a href="#">About Binoex</a><a href="#">Careers</a><a href="#">Press</a><a href="#">Terms of Service</a><a href="#">Privacy Policy</a></div>
          <div><h4>Products</h4><a href="trade.html?category=spot&symbol=BTCUSDT">Spot</a><a href="trade.html?category=linear&symbol=BTCUSDT">Derivatives</a><a href="#">Earn</a><a href="#">Launchpad</a><a href="#">Copy Trading</a></div>
          <div><h4>Services</h4><a href="assets.html#deposit">Deposit</a><a href="assets.html#withdraw">Withdraw</a><a href="#">Institutional</a><a href="#">API</a><a href="#">Referral</a></div>
          <div><h4>Support</h4><a href="#">Help Center</a><a href="#">Fees</a><a href="#">Submit a Request</a><a href="#">Status</a><a href="#">Law Enforcement</a></div>
          <div><h4>Learn</h4><a href="#">Academy</a><a href="#">Blog</a><a href="#">Market Insights</a><a href="#">Glossary</a></div>
        </div>
        <div class="bottom"><span>© ${new Date().getFullYear()} Binoex. All rights reserved.</span><span>Digital assets are highly volatile. Trade responsibly.</span></div>
      </div>`;
    }
    const svc = await services();
    if (svc.paper || STATIC) {
      const n = document.createElement('div'); n.className = 'notice'; n.style.cssText = 'border-radius:0;text-align:center;font-size:12px;padding:6px';
      n.innerHTML = svc.paper
        ? '<b>Paper trading</b> — live Bybit prices, simulated fills. Sign up to get a 100,000 USDT demo balance. No real funds are involved.'
        : 'Preview build — live market data from Bybit. Accounts, deposits and order execution activate once the Binoex backend is deployed.';
      document.body.insertBefore(n, document.body.firstChild);
    }
    if (user && window.PaperLocal) window.PaperLocal.ensureWatch();
    return user;
  }

  return { STATIC, DEFAULT_SYMBOLS, api, me, services, market, stream, prices, fmt, esc, base, quote, coinIcon, toast, qs, chrome, token, setToken };
})();
