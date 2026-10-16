/* Binoex trading terminal (Bybit layout): ticker bar, chart, order book / trades, order form, positions & orders. */
(async () => {
  const { chrome, api, market, stream, fmt, esc, base, quote, coinIcon, qs, toast, services, DEFAULT_SYMBOLS } = BX;
  const $ = (id) => document.getElementById(id);
  const user = await chrome();
  const svc = await services();

  let cat = qs('category', 'linear') === 'spot' ? 'spot' : 'linear';
  let symbol = qs('symbol', 'BTCUSDT').toUpperCase();
  let inst = { tickSize: '0.01', qtyStep: '0.001', minQty: '0', maxLev: 100 };
  let ticker = {}, lastPx = 0, prevPx = 0;
  let side = 'Buy', otype = 'Limit', interval = '60', chartMode = 'candles';
  let leverage = 10, balance = null;
  let unsubs = [];
  const unsubAll = () => { unsubs.forEach((u) => u()); unsubs = []; };
  const tick = () => inst.tickSize, px = (v) => fmt.price(v, inst.tickSize);
  const qd = () => fmt.decimals(inst.qtyStep);

  // ================= symbol selector =================
  let ddCat = cat, ddList = { spot: [], linear: [] };
  $('symBtn').onclick = (e) => { if (e.target.closest('.sym-dd')) return; $('symDd').classList.toggle('open'); if ($('symDd').classList.contains('open')) { $('symQ').focus(); loadDd(); } };
  document.addEventListener('click', (e) => { if (!e.target.closest('#symBtn')) $('symDd').classList.remove('open'); });
  $('symDd').querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { ddCat = b.dataset.c; $('symDd').querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b)); loadDd(); });
  $('symQ').oninput = renderDd;
  async function loadDd() {
    if (!ddList[ddCat].length) {
      try {
        const r = await market('tickers', { category: ddCat });
        const allowed = new Set(svc.markets?.[ddCat] || DEFAULT_SYMBOLS[ddCat]);
        ddList[ddCat] = (r.list || []).filter((t) => allowed.has(t.symbol)).sort((a, b) => b.turnover24h - a.turnover24h);
      } catch { ddList[ddCat] = []; }
    }
    renderDd();
  }
  function renderDd() {
    const q = $('symQ').value.trim().toUpperCase();
    $('symList').innerHTML = ddList[ddCat].filter((t) => !q || t.symbol.includes(q)).map((t) => `<div class="it" data-s="${t.symbol}"><span><b>${esc(t.symbol)}</b> <small class="dim">${ddCat === 'linear' ? 'Perp' : 'Spot'}</small></span><span class="num">${fmt.price(t.lastPrice)}</span><span class="num ${t.price24hPcnt >= 0 ? 'up' : 'down'}">${fmt.pct(t.price24hPcnt)}</span></div>`).join('') || '<div class="it hd">No results</div>';
    $('symList').querySelectorAll('.it[data-s]').forEach((el) => el.onclick = () => { $('symDd').classList.remove('open'); setSymbol(ddCat, el.dataset.s); });
  }

  // ================= chart =================
  const chartEl = $('chart');
  const chart = LightweightCharts.createChart(chartEl, {
    layout: { background: { color: '#17181e' }, textColor: '#adb1b8', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11 },
    grid: { vertLines: { color: '#22232a' }, horzLines: { color: '#22232a' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2a2b33', scaleMargins: { top: 0.1, bottom: 0.25 } },
    timeScale: { borderColor: '#2a2b33', timeVisible: true, secondsVisible: false },
  });
  let candles = chart.addCandlestickSeries({ upColor: '#20b26c', downColor: '#ef454a', borderVisible: false, wickUpColor: '#20b26c', wickDownColor: '#ef454a' });
  let lineSeries = null;
  const volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  new ResizeObserver(() => chart.applyOptions({ width: chartEl.clientWidth, height: chartEl.clientHeight })).observe(chartEl);
  let klines = [];
  const toBar = (k) => ({ time: Math.floor(Number(k[0]) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
  const volBar = (b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(32,178,108,.4)' : 'rgba(239,69,74,.4)' });
  async function loadChart() {
    candles.applyOptions({ priceFormat: { type: 'price', precision: fmt.decimals(inst.tickSize), minMove: Number(inst.tickSize) } });
    try {
      const r = await market('kline', { category: cat, symbol, interval, limit: 500 });
      klines = (r.list || []).map(toBar).reverse();
    } catch { klines = []; }
    (lineSeries || candles).setData(lineSeries ? klines.map((b) => ({ time: b.time, value: b.close })) : klines);
    volume.setData(klines.map(volBar));
    chart.timeScale().fitContent();
    unsubs.push(stream(cat).subscribe(cat, `kline.${interval}.${symbol}`, (m) => {
      for (const k of m.data) {
        const b = { time: Math.floor(Number(k.start) / 1000), open: +k.open, high: +k.high, low: +k.low, close: +k.close, volume: +k.volume };
        const last = klines[klines.length - 1];
        if (last && last.time === b.time) klines[klines.length - 1] = b; else if (!last || b.time > last.time) klines.push(b); else continue;
        (lineSeries || candles).update(lineSeries ? { time: b.time, value: b.close } : b);
        volume.update(volBar(b));
      }
    }));
  }
  chart.subscribeCrosshairMove((p) => {
    const b = p.seriesData.get(candles) || (lineSeries && p.seriesData.get(lineSeries));
    const k = b?.open != null ? b : klines[klines.length - 1];
    if (!k) return;
    const chg = ((k.close - k.open) / k.open) * 100;
    $('ohlc').innerHTML = `O <span class="num">${px(k.open)}</span> H <span class="num">${px(k.high)}</span> L <span class="num">${px(k.low)}</span> C <span class="num ${chg >= 0 ? 'up' : 'down'}">${px(k.close)} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%)</span>`;
  });
  document.querySelectorAll('.chart-tools [data-i]').forEach((b) => b.onclick = () => { interval = b.dataset.i; document.querySelectorAll('.chart-tools [data-i]').forEach((x) => x.classList.toggle('active', x === b)); unsubAll(); subscribeAll(); });
  $('chartType').onclick = () => {
    chartMode = chartMode === 'candles' ? 'line' : 'candles'; $('chartType').textContent = chartMode === 'candles' ? 'Candles' : 'Line';
    if (chartMode === 'line') { chart.removeSeries(candles); lineSeries = chart.addLineSeries({ color: '#f7a600', lineWidth: 2 }); lineSeries.setData(klines.map((b) => ({ time: b.time, value: b.close }))); }
    else { chart.removeSeries(lineSeries); lineSeries = null; candles = chart.addCandlestickSeries({ upColor: '#20b26c', downColor: '#ef454a', borderVisible: false, wickUpColor: '#20b26c', wickDownColor: '#ef454a' }); candles.setData(klines); }
  };

  // ================= ticker bar =================
  function renderTicker() {
    const t = ticker; const up = Number(t.price24hPcnt) >= 0;
    $('tLast').textContent = px(t.lastPrice); $('tLast').className = 'last ' + (lastPx >= prevPx ? 'up' : 'down');
    $('tMark').textContent = px(t.markPrice); $('tIndex').textContent = px(t.indexPrice);
    $('tChg').textContent = fmt.pct(t.price24hPcnt); $('tChg').className = up ? 'up' : 'down';
    $('tHigh').textContent = px(t.highPrice24h); $('tLow').textContent = px(t.lowPrice24h);
    $('tTurn').textContent = fmt.compact(t.turnover24h); $('tVol').textContent = fmt.compact(t.volume24h) + ' ' + base(symbol);
    if (cat === 'linear') {
      const fr = Number(t.fundingRate) * 100, next = Number(t.nextFundingTime) - Date.now();
      const h = Math.max(0, Math.floor(next / 3.6e6)), m = Math.max(0, Math.floor((next % 3.6e6) / 6e4)), s = Math.max(0, Math.floor((next % 6e4) / 1e3));
      $('tFund').innerHTML = `<span class="${fr >= 0 ? 'up' : 'down'}">${isFinite(fr) ? fr.toFixed(4) + '%' : '--'}</span> / ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      $('tOi').textContent = fmt.compact(t.openInterestValue);
    }
    $('midPrice').textContent = px(t.lastPrice); $('midPrice').className = lastPx >= prevPx ? 'up' : 'down';
    $('midArrow').textContent = lastPx >= prevPx ? '↑' : '↓'; $('midArrow').className = lastPx >= prevPx ? 'up' : 'down';
    $('midMark').textContent = cat === 'linear' ? 'Mark ' + px(t.markPrice) : '';
    document.title = `${px(t.lastPrice)} | ${symbol} | Binoex`;
    updateOrderValue();
  }
  setInterval(() => cat === 'linear' && ticker.nextFundingTime && renderTicker(), 1000);

  // ================= order book =================
  const book = { a: new Map(), b: new Map() };
  const DEPTH = 13;
  function renderBook() {
    const asks = [...book.a.entries()].sort((x, y) => x[0] - y[0]).slice(0, DEPTH);
    const bids = [...book.b.entries()].sort((x, y) => y[0] - x[0]).slice(0, DEPTH);
    const cum = (rows) => { let t = 0; return rows.map(([p, q]) => [p, q, (t += Number(q))]); };
    const A = cum(asks), B = cum(bids), max = Math.max(A.at(-1)?.[2] || 0, B.at(-1)?.[2] || 0) || 1;
    const row = (cls, [p, q, t]) => `<div class="r ${cls}" data-p="${p}"><span class="${cls === 'ask' ? 'down' : 'up'}">${px(p)}</span><span>${fmt.amt(q, qd())}</span><span>${fmt.amt(t, qd())}</span><i class="bar" style="width:${(t / max) * 100}%"></i></div>`;
    $('asks').innerHTML = A.reverse().map((r) => row('ask', r)).join('');
    $('bids').innerHTML = B.map((r) => row('bid', r)).join('');
    const sb = B.at(-1)?.[2] || 0, sa = A[0]?.[2] || 0, pct = sb + sa ? Math.round((sb / (sb + sa)) * 100) : 50;
    $('buyPct').textContent = pct + '%'; $('sellPct').textContent = 100 - pct + '%'; $('ratioBar').style.width = pct + '%';
  }
  $('asks').onclick = $('bids').onclick = (e) => { const r = e.target.closest('.r'); if (r) { $('oPrice').value = r.dataset.p; updateOrderValue(); } };
  document.querySelectorAll('.ob .tabs button').forEach((b) => b.onclick = () => { document.querySelectorAll('.ob .tabs button').forEach((x) => x.classList.toggle('active', x === b)); $('bookView').classList.toggle('hidden', b.dataset.t !== 'book'); $('tradesView').classList.toggle('hidden', b.dataset.t !== 'trades'); });

  // ================= recent trades =================
  function tradeRow(t) { return `<div class="r"><span class="${t.S === 'Buy' ? 'up' : 'down'}">${px(t.p)}</span><span>${fmt.amt(t.v, qd())}</span><span class="dim">${fmt.clock(t.T)}</span></div>`; }

  // ================= subscribe everything for current symbol =================
  async function subscribeAll() {
    const s = stream(cat);
    unsubs.push(s.subscribe(cat, 'tickers.' + symbol, (m) => {
      Object.assign(ticker, m.data);
      if (m.data.lastPrice) { prevPx = lastPx || Number(m.data.lastPrice); lastPx = Number(m.data.lastPrice); }
      renderTicker();
    }));
    unsubs.push(s.subscribe(cat, `orderbook.50.${symbol}`, (m) => {
      if (m.type === 'snapshot') { book.a.clear(); book.b.clear(); }
      for (const [p, q] of m.data.a || []) Number(q) === 0 ? book.a.delete(+p) : book.a.set(+p, q);
      for (const [p, q] of m.data.b || []) Number(q) === 0 ? book.b.delete(+p) : book.b.set(+p, q);
      renderBook();
    }));
    unsubs.push(s.subscribe(cat, 'publicTrade.' + symbol, (m) => {
      $('trades').insertAdjacentHTML('afterbegin', m.data.map(tradeRow).join(''));
      while ($('trades').children.length > 40) $('trades').lastChild.remove();
    }));
    await loadChart();
  }

  async function setSymbol(c, s) {
    unsubAll(); cat = c; symbol = s; ticker = {}; lastPx = prevPx = 0; book.a.clear(); book.b.clear();
    history.replaceState(null, '', `trade.html?category=${cat}&symbol=${symbol}`);
    const b = base(symbol), q = quote(symbol);
    $('symIcon').innerHTML = `<span class="coin">${coinIcon(b)}</span>`; $('symName').textContent = cat === 'linear' ? symbol : `${b}/${q}`;
    $('symType').textContent = cat === 'linear' ? 'USDT Perpetual' : 'Spot';
    $('obQuote').textContent = q; $('obBase').textContent = b; $('trQuote').textContent = q; $('qtyUnit').textContent = b; $('priceUnit').textContent = q; $('trigUnit').textContent = q;
    for (const id of ['markStat', 'indexStat', 'fundStat', 'oiStat', 'levRow', 'roWrap']) $(id).classList.toggle('hidden', cat !== 'linear');
    $('bsBuy').textContent = cat === 'linear' ? 'Buy / Long' : 'Buy'; $('bsSell').textContent = cat === 'linear' ? 'Sell / Short' : 'Sell'; applySide();
    $('asks').innerHTML = $('bids').innerHTML = $('trades').innerHTML = '';
    try {
      const [ti, ii, tr] = await Promise.all([market('tickers', { category: cat, symbol }), market('instruments', { category: cat, symbol }), market('trades', { category: cat, symbol, limit: 40 })]);
      ticker = ti.list?.[0] || {}; lastPx = prevPx = Number(ticker.lastPrice) || 0;
      const i = ii.list?.[0];
      if (i) inst = { tickSize: i.priceFilter?.tickSize || '0.01', qtyStep: i.lotSizeFilter?.qtyStep || i.lotSizeFilter?.basePrecision || '0.001', minQty: i.lotSizeFilter?.minOrderQty || '0', maxLev: Number(i.leverageFilter?.maxLeverage || 100) };
      $('trades').innerHTML = (tr.list || []).map(tradeRow).join('');
      renderTicker();
    } catch (e) { toast('Market data unavailable: ' + e.message, false); }
    await subscribeAll();
    loadBalance(); loadBottom();
  }

  // ================= order form =================
  function applySide() {
    document.querySelectorAll('.bs button').forEach((b) => b.classList.toggle('active', b.dataset.side === side));
    const btn = $('oSubmit'); btn.className = 'btn btn-block btn-lg ' + (side === 'Buy' ? 'btn-green' : 'btn-red');
    btn.textContent = otype === 'Conditional' ? (side === 'Buy' ? 'Place Buy Order' : 'Place Sell Order') : (side === 'Buy' ? $('bsBuy').textContent : $('bsSell').textContent);
    updateAvail(); updateOrderValue();
  }
  document.querySelectorAll('.bs button').forEach((b) => b.onclick = () => { side = b.dataset.side; applySide(); });
  document.querySelectorAll('.of .tabs button').forEach((b) => b.onclick = () => {
    otype = b.dataset.ot; document.querySelectorAll('.of .tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $('priceField').classList.toggle('hidden', otype === 'Market'); $('trigField').classList.toggle('hidden', otype !== 'Conditional'); $('poWrap').classList.toggle('hidden', otype === 'Market'); applySide();
  });
  $('lastBtn').onclick = () => { $('oPrice').value = ticker.lastPrice || ''; updateOrderValue(); };
  $('tpsl').onchange = () => $('tpslFields').classList.toggle('hidden', !$('tpsl').checked);
  $('oPrice').oninput = $('oQty').oninput = () => { $('pct').value = 0; updateOrderValue(); };
  $('pct').oninput = () => {
    const p = Number($('oPrice').value) || Number(ticker.lastPrice) || 0, a = availNum(), pct = Number($('pct').value) / 100;
    if (!a || !p) return;
    let q = cat === 'linear' ? (a * leverage * pct) / p : side === 'Buy' ? (a * pct) / p : a * pct;
    const step = Number(inst.qtyStep); q = Math.floor(q / step) * step;
    $('oQty').value = q.toFixed(qd()); updateOrderValue();
  };
  function availNum() {
    if (!balance) return 0;
    const coin = (c) => Number(balance.coins.find((x) => x.coin === c)?.availableToWithdraw || balance.coins.find((x) => x.coin === c)?.walletBalance || 0);
    if (cat === 'linear') return Number(balance.totalAvailableBalance) || coin('USDT');
    return side === 'Buy' ? coin(quote(symbol)) : coin(base(symbol));
  }
  function updateAvail() {
    const unit = cat === 'linear' || side === 'Buy' ? quote(symbol) : base(symbol);
    $('avail').textContent = balance ? `${fmt.amt(availNum(), 4)} ${unit}` : '--';
  }
  function updateOrderValue() {
    const p = otype === 'Market' ? Number(ticker.lastPrice) : Number($('oPrice').value), q = Number($('oQty').value);
    $('orderValue').textContent = p && q ? `${fmt.usd(p * q)} ${quote(symbol)}` : `-- ${quote(symbol)}`;
  }
  async function loadBalance() {
    if (!user) return;
    try { balance = await api('/wallet/balance'); } catch { balance = null; }
    $('acctEquity').textContent = balance ? fmt.usd(balance.totalEquity) + ' USDT' : '--';
    $('acctAvail').textContent = balance ? fmt.usd(balance.totalAvailableBalance) + ' USDT' : '--';
    updateAvail();
  }
  $('orderForm').onsubmit = async (e) => {
    e.preventDefault(); const err = $('oErr'); err.textContent = '';
    const qty = Number($('oQty').value), price = Number($('oPrice').value), trig = Number($('oTrig').value);
    if (!(qty > 0)) return (err.textContent = 'Please enter a quantity.');
    if (qty < Number(inst.minQty)) return (err.textContent = `Minimum quantity is ${inst.minQty} ${base(symbol)}.`);
    if (otype !== 'Market' && !(price > 0)) return (err.textContent = 'Please enter an order price.');
    if (otype === 'Conditional' && !(trig > 0)) return (err.textContent = 'Please enter a trigger price.');
    const body = { category: cat, symbol, side, orderType: otype === 'Market' ? 'Market' : 'Limit', qty: $('oQty').value };
    if (otype !== 'Market') { body.price = $('oPrice').value; body.timeInForce = $('postOnly').checked ? 'PostOnly' : 'GTC'; }
    if (otype === 'Conditional') { body.triggerPrice = $('oTrig').value; body.triggerDirection = trig >= Number(ticker.lastPrice) ? 1 : 2; }
    if (cat === 'spot' && otype === 'Market') body.marketUnit = 'baseCoin';
    if (cat === 'linear' && $('reduceOnly').checked) body.reduceOnly = true;
    if ($('tpsl').checked) { if ($('oTp').value) body.takeProfit = $('oTp').value; if ($('oSl').value) body.stopLoss = $('oSl').value; }
    const btn = $('oSubmit'); btn.disabled = true;
    try {
      const r = await api('/trade/order', { method: 'POST', body });
      toast(`Order submitted · ${r.orderId.slice(0, 8)}…`); $('oQty').value = ''; $('pct').value = 0; updateOrderValue();
      setTimeout(() => { loadBottom(); loadBalance(); }, 600);
    } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
  };
  // leverage
  $('levBtn').onclick = () => {
    const v = prompt(`Set leverage for ${symbol} (1 – ${inst.maxLev}x)`, leverage);
    const n = Math.min(inst.maxLev, Math.max(1, Number(v)));
    if (!v || !isFinite(n)) return;
    if (!user) { leverage = n; $('levBtn').textContent = n + 'x'; return; }
    api('/trade/leverage', { method: 'POST', body: { category: cat, symbol, leverage: n } }).then(() => { leverage = n; $('levBtn').textContent = n + 'x'; toast('Leverage updated'); }).catch((e) => toast(e.message, false));
  };

  if (!user) { $('guest').classList.remove('hidden'); $('orderForm').classList.add('hidden'); }

  // ================= bottom panel =================
  let btab = location.hash === '#orders' ? 'open' : 'positions';
  document.querySelectorAll('.bottom .tabs button').forEach((b) => { b.classList.toggle('active', b.dataset.b === btab); b.onclick = () => { btab = b.dataset.b; document.querySelectorAll('.bottom .tabs button').forEach((x) => x.classList.toggle('active', x === b)); loadBottom(); }; });
  const bb = $('bottomBody');
  const table = (heads, rows, empty) => `<table class="tbl"><thead><tr>${heads.map((h) => `<th${h.startsWith('>') ? ' class="r"' : ''}>${h.replace(/^>/, '')}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${heads.length}" class="empty">${empty}</td></tr>`}</tbody></table>`;
  async function loadBottom() {
    if (!user) { bb.innerHTML = '<div class="empty" style="padding:40px;text-align:center;color:var(--text-3)">Log in or sign up to view your positions and orders.</div>'; return; }
    try {
      if (btab === 'positions') {
        if (cat !== 'linear') { bb.innerHTML = '<div class="empty" style="padding:40px;text-align:center;color:var(--text-3)">Positions apply to derivatives only.</div>'; return; }
        const { list } = await api('/trade/positions?category=linear');
        const rows = list.filter((p) => Number(p.size) > 0);
        $('nPos').textContent = rows.length;
        bb.innerHTML = table(['Contracts', 'Qty', 'Value', 'Entry Price', 'Mark Price', 'Liq. Price', 'IM', 'Unrealized P&L (%)', '>Close'], rows.map((p) => {
          const pnl = Number(p.unrealisedPnl), pct = Number(p.positionIM) ? (pnl / Number(p.positionIM)) * 100 : 0;
          return `<tr><td><b>${esc(p.symbol)}</b> <span class="tag ${p.side === 'Buy' ? 'g' : 'r'}">${p.side === 'Buy' ? 'Long' : 'Short'} ${esc(p.leverage)}x</span></td><td class="num">${fmt.amt(p.size)}</td><td class="num">${fmt.usd(p.positionValue)}</td><td class="num">${fmt.price(p.avgPrice)}</td><td class="num">${fmt.price(p.markPrice)}</td><td class="num">${fmt.price(p.liqPrice)}</td><td class="num">${fmt.usd(p.positionIM)}</td><td class="num ${pnl >= 0 ? 'up' : 'down'}">${fmt.usd(pnl)} (${pct.toFixed(2)}%)</td><td class="r"><button class="btn btn-outline btn-xs" data-close="${esc(p.symbol)}" data-side="${p.side}" data-size="${p.size}">Market</button></td></tr>`;
        }), 'No open positions');
        bb.querySelectorAll('[data-close]').forEach((b) => b.onclick = async () => { b.disabled = true; try { await api('/trade/order', { method: 'POST', body: { category: 'linear', symbol: b.dataset.close, side: b.dataset.side === 'Buy' ? 'Sell' : 'Buy', orderType: 'Market', qty: b.dataset.size, reduceOnly: true } }); toast('Position closed'); setTimeout(loadBottom, 600); } catch (e) { toast(e.message, false); b.disabled = false; } });
      } else if (btab === 'open' || btab === 'history') {
        const { open, history } = await api('/trade/orders?category=' + cat);
        $('nOpen').textContent = open.length;
        const rows = (btab === 'open' ? open : history).map((o) => `<tr><td>${fmt.time(o.createdTime)}</td><td><b>${esc(o.symbol)}</b></td><td class="${o.side === 'Buy' ? 'up' : 'down'}">${esc(o.side)}</td><td>${esc(o.orderType)}${o.triggerPrice && Number(o.triggerPrice) ? ' (Cond.)' : ''}</td><td class="num">${o.orderType === 'Market' ? 'Market' : fmt.price(o.price)}</td><td class="num">${fmt.amt(o.qty)}</td><td class="num">${fmt.amt(o.cumExecQty)}</td><td class="num">${fmt.price(o.avgPrice)}</td><td>${esc(o.orderStatus)}</td>${btab === 'open' ? `<td class="r"><button class="btn btn-outline btn-xs" data-cancel="${esc(o.orderId)}" data-sym="${esc(o.symbol)}">Cancel</button></td>` : ''}</tr>`);
        bb.innerHTML = table(['Time', 'Symbol', 'Side', 'Type', 'Price', 'Qty', 'Filled', 'Avg. Price', 'Status', ...(btab === 'open' ? ['>Action'] : [])], rows, btab === 'open' ? 'No open orders' : 'No order history');
        bb.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => { b.disabled = true; try { await api('/trade/order/cancel', { method: 'POST', body: { category: cat, symbol: b.dataset.sym, orderId: b.dataset.cancel } }); toast('Order cancelled'); loadBottom(); } catch (e) { toast(e.message, false); b.disabled = false; } });
      } else if (btab === 'fills') {
        const { list } = await api('/trade/executions?category=' + cat);
        bb.innerHTML = table(['Time', 'Symbol', 'Side', 'Price', 'Qty', 'Value', 'Fee', 'Type'], list.map((x) => `<tr><td>${fmt.time(x.execTime)}</td><td><b>${esc(x.symbol)}</b></td><td class="${x.side === 'Buy' ? 'up' : 'down'}">${esc(x.side)}</td><td class="num">${fmt.price(x.execPrice)}</td><td class="num">${fmt.amt(x.execQty)}</td><td class="num">${fmt.usd(x.execValue)}</td><td class="num">${fmt.amt(x.execFee, 8)} ${esc(x.feeCurrency || '')}</td><td>${x.isMaker ? 'Maker' : 'Taker'}</td></tr>`), 'No trade history');
      } else {
        const b = balance || (await api('/wallet/balance'));
        bb.innerHTML = table(['Coin', 'Wallet Balance', 'Available', 'Locked', 'USD Value'], (b.coins || []).map((c) => `<tr><td><div class="coin">${coinIcon(c.coin)}<b>${esc(c.coin)}</b></div></td><td class="num">${fmt.amt(c.walletBalance, 8)}</td><td class="num">${fmt.amt(c.availableToWithdraw, 8)}</td><td class="num">${fmt.amt(c.locked, 8)}</td><td class="num">${fmt.usd(c.usdValue)}</td></tr>`), 'No assets — make a deposit');
      }
    } catch (e) { bb.innerHTML = `<div class="empty" style="padding:40px;text-align:center;color:var(--red)">${esc(e.message)}</div>`; }
  }
  if (user) setInterval(() => { loadBottom(); loadBalance(); }, 10000);

  await setSymbol(cat, symbol);
})();
