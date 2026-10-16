(async () => {
  const { chrome, market, stream, fmt, esc, base, quote, coinIcon, qs, services, DEFAULT_SYMBOLS } = BX;
  chrome();
  const body = document.getElementById('body');
  const svc = await services();
  let cat = qs('category', 'spot') === 'linear' ? 'linear' : 'spot';
  let list = [], q = '', unsub = [];

  document.querySelectorAll('.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.cat === cat);
    b.onclick = () => { cat = b.dataset.cat; document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b)); history.replaceState(null, '', 'markets.html?category=' + cat); load(); };
  });
  document.getElementById('q').oninput = (e) => { q = e.target.value.trim().toUpperCase(); render(); };

  async function load() {
    unsub.forEach((u) => u()); unsub = [];
    body.innerHTML = '<tr><td colspan="7" class="empty"><span class="spinner"></span></td></tr>';
    try {
      const r = await market('tickers', { category: cat });
      const allowed = new Set(svc.markets?.[cat] || DEFAULT_SYMBOLS[cat]);
      list = (r.list || []).filter((t) => allowed.has(t.symbol)).sort((a, b) => b.turnover24h - a.turnover24h);
    } catch (e) { list = []; body.innerHTML = `<tr><td colspan="7" class="empty">${esc(e.message)}</td></tr>`; return; }
    render();
    const s = stream(cat);
    for (const t of list) unsub.push(s.subscribe(cat, 'tickers.' + t.symbol, (m) => { Object.assign(t, m.data); patch(t); }));
  }
  function rowHtml(t) {
    const up = Number(t.price24hPcnt) >= 0;
    return `<td><div class="coin">${coinIcon(base(t.symbol))}<span><b>${esc(base(t.symbol))}</b><small>${cat === 'linear' ? 'USDT Perpetual' : '/' + quote(t.symbol)}</small></span></div></td>
      <td class="r num" data-f="price">${fmt.price(t.lastPrice)}</td>
      <td class="r num ${up ? 'up' : 'down'}" data-f="chg">${fmt.pct(t.price24hPcnt)}</td>
      <td class="r num" data-f="high">${fmt.price(t.highPrice24h)}</td>
      <td class="r num" data-f="low">${fmt.price(t.lowPrice24h)}</td>
      <td class="r num" data-f="vol">${fmt.compact(t.turnover24h)}</td>
      <td class="r"><a class="btn btn-outline btn-xs" href="trade.html?category=${cat}&symbol=${t.symbol}">Trade</a></td>`;
  }
  function render() {
    const rows = list.filter((t) => !q || t.symbol.includes(q));
    body.innerHTML = rows.length ? rows.map((t) => `<tr data-s="${t.symbol}">${rowHtml(t)}</tr>`).join('') : '<tr><td colspan="7" class="empty">No results</td></tr>';
  }
  function patch(t) {
    const tr = body.querySelector(`tr[data-s="${t.symbol}"]`);
    if (tr) tr.innerHTML = rowHtml(t);
  }
  load();
})();
