(async () => {
  const { chrome, market, stream, fmt, esc, base, quote, coinIcon, DEFAULT_SYMBOLS, services } = BX;
  chrome();

  // hero sign-up → login page with email prefilled
  document.getElementById('heroForm').onsubmit = (e) => { e.preventDefault(); location.href = 'login.html?mode=register&email=' + encodeURIComponent(document.getElementById('heroEmail').value); };

  // QR → this site
  try { const q = qrcode(0, 'M'); q.addData(location.href.replace(/[#?].*$/, '')); q.make(); document.getElementById('qr').innerHTML = q.createSvgTag({ cellSize: 3, margin: 0 }); } catch {}

  // ---- market table ----
  const body = document.getElementById('mktBody');
  const svc = await services();
  const all = { spot: [], linear: [] };
  const sparks = {}; // symbol -> close series
  let tab = 'hot', rows = [];

  async function loadCat(cat) {
    try {
      const r = await market('tickers', { category: cat });
      const allowed = new Set(svc.markets?.[cat] || DEFAULT_SYMBOLS[cat]);
      all[cat] = (r.list || []).filter((t) => allowed.has(t.symbol)).map((t) => ({ ...t, category: cat }));
    } catch { all[cat] = []; }
  }
  await Promise.all([loadCat('linear'), loadCat('spot')]);

  function pick() {
    const spot = all.spot, lin = all.linear;
    if (tab === 'hot') return lin.slice(0, 10);
    if (tab === 'spot') return spot.slice(0, 10);
    const pool = [...spot];
    if (tab === 'gainers') return pool.sort((a, b) => b.price24hPcnt - a.price24hPcnt).slice(0, 10);
    return pool.sort((a, b) => b.turnover24h - a.turnover24h).slice(0, 10);
  }

  function sparkSvg(series, up) {
    if (!series || series.length < 2) return '<svg class="spark"></svg>';
    const min = Math.min(...series), max = Math.max(...series), w = 120, h = 36;
    const pts = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * (h - 4) - 2}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${up ? '#20b26c' : '#ef454a'}" stroke-width="1.5"/></svg>`;
  }

  function render() {
    rows = pick();
    if (!rows.length) { body.innerHTML = '<tr><td colspan="6" class="empty">Market data unavailable</td></tr>'; return; }
    body.innerHTML = rows.map((t) => {
      const up = Number(t.price24hPcnt) >= 0;
      return `<tr data-s="${t.symbol}">
        <td><div class="coin">${coinIcon(base(t.symbol))}<span><b>${esc(base(t.symbol))}</b><small>${t.category === 'linear' ? 'USDT Perp' : '/' + quote(t.symbol)}</small></span></div></td>
        <td class="r num" data-f="price">${fmt.price(t.lastPrice)}</td>
        <td class="r num ${up ? 'up' : 'down'}" data-f="chg">${fmt.pct(t.price24hPcnt)}</td>
        <td class="r num" data-f="vol">${fmt.compact(t.turnover24h)}</td>
        <td data-f="spark">${sparkSvg(sparks[t.symbol], up)}</td>
        <td class="r"><a class="btn btn-outline btn-xs" href="trade.html?category=${t.category}&symbol=${t.symbol}">Trade</a></td></tr>`;
    }).join('');
    for (const t of rows) if (!sparks[t.symbol]) loadSpark(t);
  }
  async function loadSpark(t) {
    sparks[t.symbol] = [];
    try {
      const r = await market('kline', { category: t.category, symbol: t.symbol, interval: '60', limit: 24 });
      sparks[t.symbol] = (r.list || []).map((k) => Number(k[4])).reverse();
      const cell = body.querySelector(`tr[data-s="${t.symbol}"] [data-f="spark"]`);
      if (cell) cell.innerHTML = sparkSvg(sparks[t.symbol], Number(t.price24hPcnt) >= 0);
    } catch {}
  }

  document.querySelectorAll('.mkt-tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.tab; document.querySelectorAll('.mkt-tabs button').forEach((x) => x.classList.toggle('active', x === b)); render(); });
  render();

  // live updates
  for (const cat of ['spot', 'linear']) {
    const s = stream(cat);
    for (const t of all[cat]) s.subscribe(cat, 'tickers.' + t.symbol, (msg) => {
      Object.assign(t, msg.data);
      const tr = body.querySelector(`tr[data-s="${t.symbol}"]`);
      if (!tr || (tab !== 'hot' && cat === 'linear') || (tab === 'hot' && cat === 'spot')) return;
      const up = Number(t.price24hPcnt) >= 0;
      tr.querySelector('[data-f="price"]').textContent = fmt.price(t.lastPrice);
      const c = tr.querySelector('[data-f="chg"]'); c.textContent = fmt.pct(t.price24hPcnt); c.className = 'r num ' + (up ? 'up' : 'down');
      tr.querySelector('[data-f="vol"]').textContent = fmt.compact(t.turnover24h);
    });
  }
})();
