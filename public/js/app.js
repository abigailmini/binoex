(() => {
  const { api, marketSocket, fmt, setToken, token, STATIC, STATIC_SYMBOLS } = window.Binoex;
  if (!token() && !STATIC) { location.href = './'; return; }

  const $ = (id) => document.getElementById(id);
  const toast = (msg, ok = true) => { const t = $('toast'); t.textContent = msg; t.style.borderColor = ok ? 'var(--green)' : 'var(--red)'; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 4000); };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let services, user;
  // Backend relay carries every category on one socket; in STATIC mode each category is its own Bybit stream.
  const socks = {};
  const sock = {
    subscribe: (cat, topic, h) => (socks[STATIC ? cat : 'relay'] ??= marketSocket(cat)).subscribe(cat, topic, h),
    unsubscribe: (cat, topic) => socks[STATIC ? cat : 'relay']?.unsubscribe(cat, topic),
  };

  // ---------- boot ----------
  (async () => {
    await null; // let the rest of this script's declarations initialise before touching them
    if (STATIC) {
      // Preview terminal on GitHub Pages: live market data, no account.
      user = { email: 'preview', uid: null };
      services = {
        online: false, withdrawals: false,
        services: { spot: { id: 'spot', label: 'Spot', live: true }, linear: { id: 'linear', label: 'USDT Perps', live: true } },
        markets: { spot: STATIC_SYMBOLS, linear: STATIC_SYMBOLS.slice(0, 3) },
        depositAssets: [{ coin: 'USDT', chain: 'TRX' }, { coin: 'USDT', chain: 'ETH' }, { coin: 'BTC', chain: 'BTC' }, { coin: 'ETH', chain: 'ETH' }],
      };
      $('userEmail').textContent = 'Preview mode';
      $('banner').innerHTML = 'Preview terminal — live Bybit market data, but no account: orders, deposits and withdrawals need the Binoex backend deployed with your Bybit keys.';
      $('banner').style.display = 'block';
      fillAssetSelects();
      show('trade', document.querySelector('.side a[data-view="trade"]'));
      return;
    }
    try {
      [{ user }, services] = await Promise.all([api('/auth/me'), api('/services')]);
    } catch (e) {
      if (e.status === 401) { setToken(null); location.href = './'; return; }
      $('banner').textContent = 'Backend unavailable: ' + e.message; $('banner').style.display = 'block'; return;
    }
    $('userEmail').textContent = user.email + ' · UID ' + (user.uid || '—');
    if (!services.online) { $('banner').textContent = 'Exchange connectivity degraded — balances and trading may be unavailable.'; $('banner').style.display = 'block'; }

    // hide nav for services Bybit doesn't let us run
    document.querySelectorAll('.side a[data-service]').forEach((a) => {
      if (!services.services[a.dataset.service]?.live) a.classList.add('hidden');
    });
    if (!services.withdrawals) { $('wdSubmit').disabled = true; $('wdNote').textContent = 'Withdrawals are temporarily disabled.'; }

    fillAssetSelects();
    loadBalance();
  })();

  $('btnLogout').onclick = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setToken(null); location.href = './'; };

  // ---------- navigation ----------
  let currentCat = 'spot';
  document.querySelectorAll('.side a[data-view]').forEach((a) => a.onclick = () => show(a.dataset.view, a));
  function show(view, a) {
    document.querySelectorAll('.side a').forEach((x) => x.classList.remove('active'));
    a?.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const real = view === 'perps' ? 'trade' : view;
    $('view-' + real).classList.add('active');
    if (view === 'wallet') loadBalance();
    if (view === 'deposit') loadDepositHistory();
    if (view === 'withdraw') loadWithdrawHistory();
    if (view === 'trade') openTrade('spot');
    if (view === 'perps') openTrade('linear');
    if (view === 'orders') loadOrders();
  }

  // ---------- wallet ----------
  async function loadBalance() {
    try {
      const b = await api('/wallet/balance');
      $('equity').innerHTML = fmt.usd(b.totalEquity) + ' <small>USD</small>';
      $('available').innerHTML = fmt.usd(b.totalAvailableBalance) + ' <small>USD</small>';
      $('balances').innerHTML = b.coins.length
        ? b.coins.map((c) => `<tr><td><b>${esc(c.coin)}</b></td><td class="mono">${fmt.amt(c.walletBalance)}</td><td class="mono">${fmt.amt(c.locked)}</td><td>${fmt.usd(c.usdValue)}</td></tr>`).join('')
        : '<tr><td colspan="4">No assets yet — make a deposit to get started.</td></tr>';
    } catch (e) { $('balances').innerHTML = `<tr><td colspan="4" class="err">${esc(e.message)}</td></tr>`; }
  }
  $('refreshBal').onclick = loadBalance;

  // ---------- deposit / withdraw asset selects ----------
  let assetInfo = [];
  function fillAssetSelects() {
    const coins = [...new Set(services.depositAssets.map((a) => a.coin))];
    for (const [coinSel, chainSel] of [['depCoin', 'depChain'], ['wdCoin', 'wdChain']]) {
      $(coinSel).innerHTML = coins.map((c) => `<option>${c}</option>`).join('');
      const fillChains = () => { $(chainSel).innerHTML = services.depositAssets.filter((a) => a.coin === $(coinSel).value).map((a) => `<option>${a.chain}</option>`).join(''); updateNotes(); };
      $(coinSel).onchange = fillChains; $(chainSel).onchange = updateNotes; fillChains();
    }
    api('/wallet/deposit/assets').then((r) => { assetInfo = r.assets; updateNotes(); }).catch(() => {});
  }
  function info(coin, chain) { return assetInfo.find((a) => a.coin === coin && a.chain === chain) || {}; }
  function updateNotes() {
    const d = info($('depCoin').value, $('depChain').value);
    $('depNote').textContent = d.depositMin ? `Min deposit ${d.depositMin} ${d.coin} · ${d.confirmation || '?'} confirmations${d.chainDeposit === '0' ? ' · DEPOSITS SUSPENDED on this chain' : ''}` : '';
    const w = info($('wdCoin').value, $('wdChain').value);
    if (services?.withdrawals) $('wdNote').textContent = w.withdrawFee ? `Network fee ${w.withdrawFee} ${w.coin} · min ${w.withdrawMin}${w.chainWithdraw === '0' ? ' · WITHDRAWALS SUSPENDED on this chain' : ''}` : '';
  }

  // ---------- deposit ----------
  $('depGet').onclick = async () => {
    $('depErr').textContent = ''; $('depResult').style.display = 'none'; $('depGet').disabled = true;
    try {
      const r = await api(`/wallet/deposit/address?coin=${$('depCoin').value}&chain=${$('depChain').value}`);
      $('depAddr').textContent = r.address || '(no address returned)';
      $('depTag').textContent = r.tag; $('depTagWrap').style.display = r.tag ? 'block' : 'none';
      $('depResult').style.display = 'block';
    } catch (e) { $('depErr').textContent = e.message; } finally { $('depGet').disabled = false; }
  };
  $('depCopy').onclick = () => navigator.clipboard.writeText($('depAddr').textContent).then(() => toast('Address copied'));
  async function loadDepositHistory() {
    try {
      const { list } = await api('/wallet/deposit/history');
      $('depHist').innerHTML = list.length ? list.map((d) => `<tr><td>${fmt.time(d.successAt || d.createdTime || 0)}</td><td>${esc(d.coin)}</td><td class="mono">${fmt.amt(d.amount)}</td><td>${depStatus(d.status)}</td></tr>`).join('') : '<tr><td colspan="4">No deposits yet</td></tr>';
    } catch (e) { $('depHist').innerHTML = `<tr><td colspan="4" class="err">${esc(e.message)}</td></tr>`; }
  }
  const depStatus = (s) => ({ 0: 'Unknown', 1: 'Pending', 2: 'Processing', 3: 'Success', 4: 'Failed', 10011: 'Pending credit', 10012: 'Credited' }[s] || s);
  $('depRefresh').onclick = loadDepositHistory;

  // ---------- withdraw ----------
  $('wdForm').onsubmit = async (e) => {
    e.preventDefault(); $('wdErr').textContent = ''; $('wdSubmit').disabled = true;
    try {
      const r = await api('/wallet/withdraw', { method: 'POST', body: { coin: $('wdCoin').value, chain: $('wdChain').value, address: $('wdAddr').value.trim(), tag: $('wdTag').value.trim(), amount: $('wdAmt').value } });
      toast(`Withdrawal submitted (#${r.id})`); $('wdForm').reset(); loadWithdrawHistory();
    } catch (ex) { $('wdErr').textContent = ex.message; } finally { $('wdSubmit').disabled = !services.withdrawals; }
  };
  async function loadWithdrawHistory() {
    try {
      const { list } = await api('/wallet/withdraw/history');
      $('wdHist').innerHTML = list.length ? list.map((w) => `<tr><td>${esc(w.created_at)}</td><td>${esc(w.coin)}/${esc(w.chain)}</td><td class="mono">${fmt.amt(w.amount)}</td><td title="${esc(w.error || '')}">${esc(w.status)}</td></tr>`).join('') : '<tr><td colspan="4">No withdrawals yet</td></tr>';
    } catch (e) { $('wdHist').innerHTML = `<tr><td colspan="4" class="err">${esc(e.message)}</td></tr>`; }
  }
  $('wdRefresh').onclick = loadWithdrawHistory;

  // ---------- trade ----------
  let symbol = null, side = 'Buy', otype = 'Market', tickers = {};
  const subs = []; // active [category, topic]
  function unsubAll() { while (subs.length) { const [c, t] = subs.pop(); sock.unsubscribe(c, t); } }

  async function openTrade(cat) {
    currentCat = cat; $('tCat').textContent = cat === 'spot' ? 'Spot' : 'USDT Perpetual';
    const syms = services.markets[cat] || [];
    try {
      const { list } = await api('/market/tickers?category=' + cat);
      tickers = Object.fromEntries(list.map((t) => [t.symbol, t]));
    } catch { tickers = {}; }
    $('mktList').innerHTML = syms.map((s) => `<div class="m" data-s="${s}"><span class="sym">${s}</span><span class="mono">${fmt.price(tickers[s]?.lastPrice)}</span></div>`).join('');
    $('mktList').querySelectorAll('.m').forEach((m) => m.onclick = () => selectSymbol(m.dataset.s));
    for (const s of syms) { sock.subscribe(cat, 'tickers.' + s, (msg) => { tickers[s] = { ...tickers[s], ...msg.data }; const el = $('mktList').querySelector(`[data-s="${s}"] .mono`); if (el) el.textContent = fmt.price(tickers[s].lastPrice); if (s === symbol) renderTicker(); }); subs.push([cat, 'tickers.' + s]); }
    selectSymbol(symbol && syms.includes(symbol) ? symbol : syms[0]);
  }

  function selectSymbol(s) {
    // drop previous symbol-specific streams (keep ticker list streams)
    for (let i = subs.length - 1; i >= 0; i--) if (!subs[i][1].startsWith('tickers.')) { sock.unsubscribe(...subs[i]); subs.splice(i, 1); }
    symbol = s; $('tSymbol').textContent = s;
    $('mktList').querySelectorAll('.m').forEach((m) => m.classList.toggle('active', m.dataset.s === s));
    renderTicker();
    $('asks').innerHTML = $('bids').innerHTML = $('tTrades').innerHTML = '';
    const book = { a: new Map(), b: new Map() };
    const renderBook = () => {
      const asks = [...book.a.entries()].sort((x, y) => x[0] - y[0]).slice(0, 12).reverse();
      const bids = [...book.b.entries()].sort((x, y) => y[0] - x[0]).slice(0, 12);
      $('asks').innerHTML = asks.map(([p, q]) => `<div class="r"><span class="down">${fmt.price(p)}</span><span>${fmt.amt(q)}</span></div>`).join('');
      $('bids').innerHTML = bids.map(([p, q]) => `<div class="r"><span class="up">${fmt.price(p)}</span><span>${fmt.amt(q)}</span></div>`).join('');
    };
    sock.subscribe(currentCat, 'orderbook.50.' + s, (msg) => {
      if (msg.type === 'snapshot') { book.a.clear(); book.b.clear(); }
      for (const [p, q] of msg.data.a || []) Number(q) === 0 ? book.a.delete(+p) : book.a.set(+p, q);
      for (const [p, q] of msg.data.b || []) Number(q) === 0 ? book.b.delete(+p) : book.b.set(+p, q);
      renderBook();
    }); subs.push([currentCat, 'orderbook.50.' + s]);
    sock.subscribe(currentCat, 'publicTrade.' + s, (msg) => {
      const rows = msg.data.map((t) => `<div class="r"><span class="${t.S === 'Buy' ? 'up' : 'down'}">${fmt.price(t.p)}</span><span>${fmt.amt(t.v)}</span><span style="color:var(--muted)">${new Date(+t.T).toLocaleTimeString()}</span></div>`).join('');
      $('tTrades').insertAdjacentHTML('afterbegin', rows);
      while ($('tTrades').children.length > 25) $('tTrades').lastChild.remove();
    }); subs.push([currentCat, 'publicTrade.' + s]);
    updateQtyLabel();
  }
  function renderTicker() {
    const t = tickers[symbol] || {};
    $('tLast').textContent = fmt.price(t.lastPrice); $('mid').textContent = fmt.price(t.lastPrice);
    const c = Number(t.price24hPcnt); $('tChg').textContent = isFinite(c) ? fmt.pct(c) : '—'; $('tChg').className = 'stat ' + (c >= 0 ? 'up' : 'down');
    $('tHigh').textContent = fmt.price(t.highPrice24h); $('tLow').textContent = fmt.price(t.lowPrice24h);
    $('tVol').textContent = fmt.amt(t.volume24h);
  }
  document.querySelectorAll('[data-side]').forEach((b) => b.onclick = () => { side = b.dataset.side; document.querySelectorAll('[data-side]').forEach((x) => x.classList.toggle('active', x === b)); $('oSubmit').textContent = side; $('oSubmit').className = 'btn ' + side.toLowerCase(); updateQtyLabel(); });
  document.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => { otype = b.dataset.type; document.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('active', x === b)); $('priceField').style.display = otype === 'Limit' ? 'flex' : 'none'; updateQtyLabel(); });
  function updateQtyLabel() {
    if (!symbol) return;
    const base = symbol.replace(/USDT$|USDC$/, ''), quote = symbol.slice(base.length);
    // Bybit spot market BUY is denominated in quote coin by default; everything else in base.
    const quoteDenominated = currentCat === 'spot' && otype === 'Market' && side === 'Buy';
    $('qtyLabel').textContent = quoteDenominated ? `Amount (${quote} to spend)` : `Amount (${base})`;
  }
  $('orderForm').onsubmit = async (e) => {
    e.preventDefault(); $('oErr').textContent = ''; $('oSubmit').disabled = true;
    try {
      const body = { category: currentCat, symbol, side, orderType: otype, qty: $('oQty').value };
      if (otype === 'Limit') body.price = $('oPrice').value;
      if (currentCat === 'spot' && otype === 'Market') body.marketUnit = side === 'Buy' ? 'quoteCoin' : 'baseCoin';
      const r = await api('/trade/order', { method: 'POST', body });
      toast(`${side} order placed · ${r.orderId.slice(0, 8)}…`); $('oQty').value = '';
    } catch (ex) { $('oErr').textContent = ex.message; } finally { $('oSubmit').disabled = false; }
  };

  // ---------- orders ----------
  async function loadOrders() {
    const cats = Object.values(services.services).filter((s) => s.live && ['spot', 'linear', 'inverse', 'option'].includes(s.id));
    if (!$('ordCat').options.length) $('ordCat').innerHTML = cats.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
    const cat = $('ordCat').value || 'spot';
    try {
      const { open, history } = await api('/trade/orders?category=' + cat);
      $('openOrders').innerHTML = open.length ? open.map((o) => `<tr><td>${fmt.time(o.createdTime)}</td><td>${esc(o.symbol)}</td><td class="${o.side === 'Buy' ? 'up' : 'down'}">${esc(o.side)}</td><td>${esc(o.orderType)}</td><td class="mono">${fmt.price(o.price)}</td><td class="mono">${fmt.amt(o.qty)}</td><td class="mono">${fmt.amt(o.cumExecQty)}</td><td><button class="btn sm" data-cancel="${esc(o.orderId)}" data-sym="${esc(o.symbol)}">Cancel</button></td></tr>`).join('') : '<tr><td colspan="8">No open orders</td></tr>';
      $('orderHist').innerHTML = history.length ? history.map((o) => `<tr><td>${fmt.time(o.updatedTime)}</td><td>${esc(o.symbol)}</td><td class="${o.side === 'Buy' ? 'up' : 'down'}">${esc(o.side)}</td><td>${esc(o.orderType)}</td><td class="mono">${fmt.price(o.avgPrice)}</td><td class="mono">${fmt.amt(o.cumExecQty || o.qty)}</td><td>${esc(o.orderStatus)}</td></tr>`).join('') : '<tr><td colspan="7">No history</td></tr>';
      $('openOrders').querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => { b.disabled = true; try { await api('/trade/order/cancel', { method: 'POST', body: { category: cat, symbol: b.dataset.sym, orderId: b.dataset.cancel } }); toast('Order cancelled'); loadOrders(); } catch (ex) { toast(ex.message, false); b.disabled = false; } });
      if (cat !== 'spot') {
        $('posPanel').style.display = 'block';
        const { list } = await api('/trade/positions?category=' + cat);
        $('positions').innerHTML = list.filter((p) => Number(p.size) > 0).map((p) => `<tr><td>${esc(p.symbol)}</td><td class="${p.side === 'Buy' ? 'up' : 'down'}">${esc(p.side)}</td><td class="mono">${fmt.amt(p.size)}</td><td class="mono">${fmt.price(p.avgPrice)}</td><td class="mono">${fmt.price(p.markPrice)}</td><td class="${Number(p.unrealisedPnl) >= 0 ? 'up' : 'down'}">${fmt.usd(p.unrealisedPnl)}</td></tr>`).join('') || '<tr><td colspan="6">No open positions</td></tr>';
      } else $('posPanel').style.display = 'none';
    } catch (e) { $('openOrders').innerHTML = `<tr><td colspan="8" class="err">${esc(e.message)}</td></tr>`; }
  }
  $('ordRefresh').onclick = loadOrders; $('ordCat').onchange = loadOrders;
})();
