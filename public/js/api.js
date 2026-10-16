// Tiny API + WS helper shared by landing & app pages.
window.Binoex = (() => {
  const token = () => localStorage.getItem('binoex_token');

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token()) headers.Authorization = 'Bearer ' + token();
    const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // WebSocket relay client with auto-reconnect; handlers keyed by `${category}:${topic}`.
  function marketSocket() {
    const handlers = new Map();
    const subs = new Set();
    let ws, timer;
    function connect() {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      ws.onopen = () => {
        const byCat = {};
        for (const key of subs) { const [cat, topic] = key.split(':'); (byCat[cat] ??= []).push(topic); }
        for (const [category, args] of Object.entries(byCat)) ws.send(JSON.stringify({ op: 'subscribe', category, args }));
        timer = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ op: 'ping' })), 25000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (!msg.topic) return;
        const h = handlers.get(`${msg.category}:${msg.topic}`);
        if (h) h(msg);
      };
      ws.onclose = () => { clearInterval(timer); setTimeout(connect, 2000); };
    }
    connect();
    return {
      subscribe(category, topic, handler) {
        const key = `${category}:${topic}`;
        handlers.set(key, handler); subs.add(key);
        if (ws.readyState === 1) ws.send(JSON.stringify({ op: 'subscribe', category, args: [topic] }));
      },
      unsubscribe(category, topic) {
        const key = `${category}:${topic}`;
        handlers.delete(key); subs.delete(key);
        if (ws.readyState === 1) ws.send(JSON.stringify({ op: 'unsubscribe', category, args: [topic] }));
      },
    };
  }

  const fmt = {
    price: (v) => { const n = Number(v); if (!isFinite(n)) return '-'; return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n >= 1 ? n.toFixed(4) : n.toPrecision(4); },
    pct: (v) => { const n = Number(v) * 100; return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; },
    amt: (v) => { const n = Number(v); return isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '-'; },
    usd: (v) => { const n = Number(v); return isFinite(n) ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '-'; },
    time: (ms) => new Date(Number(ms)).toLocaleString(),
  };

  function setToken(t) { if (t) localStorage.setItem('binoex_token', t); else localStorage.removeItem('binoex_token'); }

  return { api, marketSocket, fmt, token, setToken };
})();
