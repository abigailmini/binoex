(async () => {
  const { chrome, api, me, services, fmt, esc, coinIcon, toast, STATIC } = BX;
  const user = await chrome();
  const $ = (id) => document.getElementById(id);
  if (!user && !STATIC) { location.href = 'login.html?next=assets.html' + location.hash; return; }
  const svc = await services();
  const notice = $('notice');
  if (STATIC) { notice.textContent = 'Preview site — balances, deposit addresses and withdrawals are served by the Binoex backend once deployed.'; notice.classList.remove('hidden'); }
  else if (!svc.online) { notice.textContent = 'Exchange connectivity degraded — balances may be unavailable.'; notice.classList.remove('hidden'); }

  // ---- routing ----
  const views = ['overview', 'deposit', 'withdraw', 'history'];
  function route() {
    const v = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    views.forEach((x) => $('v-' + x).classList.toggle('hidden', x !== v));
    document.querySelectorAll('.sidenav a[data-v]').forEach((a) => a.classList.toggle('active', a.dataset.v === v));
    if (v === 'overview') loadBalance();
    if (v === 'deposit') loadDepHist();
    if (v === 'withdraw') { loadBalance(); loadWdHist(); }
    if (v === 'history') { loadDepHist('hDep'); loadWdHist('hWd'); }
  }
  window.addEventListener('hashchange', route);

  // ---- balance ----
  let balance = null;
  async function loadBalance() {
    try { balance = await api('/wallet/balance'); } catch (e) { $('coins').innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`; return; }
    $('equity').textContent = fmt.usd(balance.totalEquity); $('equityUsd').textContent = fmt.usd(balance.totalEquity); $('available').textContent = fmt.usd(balance.totalAvailableBalance);
    renderCoins(); updateWdAvail();
  }
  function renderCoins() {
    if (!balance) return;
    const q = $('coinQ').value.trim().toUpperCase(), hide = $('hideSmall').checked;
    const rows = balance.coins.filter((c) => (!q || c.coin.includes(q)) && (!hide || Number(c.usdValue) >= 1));
    $('coins').innerHTML = rows.length ? rows.map((c) => `<tr><td><div class="coin">${coinIcon(c.coin)}<b>${esc(c.coin)}</b></div></td><td class="r num">${fmt.amt(c.walletBalance, 8)}</td><td class="r num">${fmt.amt(c.availableToWithdraw, 8)}</td><td class="r num">${fmt.amt(c.locked, 8)}</td><td class="r num">${fmt.usd(c.usdValue)}</td><td class="r"><a class="btn btn-ghost btn-xs" href="#deposit">Deposit</a><a class="btn btn-ghost btn-xs" href="#withdraw">Withdraw</a><a class="btn btn-ghost btn-xs" href="trade.html?category=spot&symbol=${esc(c.coin)}USDT">Trade</a></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No assets yet — make a deposit to get started.</td></tr>';
  }
  $('coinQ').oninput = renderCoins; $('hideSmall').onchange = renderCoins;

  // ---- coin / chain selectors ----
  const assets = svc.depositAssets || [];
  const coins = [...new Set(assets.map((a) => a.coin))];
  let info = [];
  api('/wallet/deposit/assets').then((r) => { info = r.assets; depNotes(); wdNotes(); }).catch(() => {});
  const chainsFor = (c) => assets.filter((a) => a.coin === c);
  const infoFor = (c, ch) => info.find((a) => a.coin === c && a.chain === ch) || {};
  for (const id of ['depCoin', 'wdCoin']) $(id).innerHTML = coins.map((c) => `<option value="${c}">${c}</option>`).join('');

  // deposit
  let depChain = null;
  function renderDepChains() {
    const c = $('depCoin').value; depChain = chainsFor(c)[0]?.chain;
    $('depChains').innerHTML = chainsFor(c).map((a) => `<span class="chip ${a.chain === depChain ? 'active' : ''}" data-ch="${a.chain}">${a.chain}</span>`).join('');
    $('depChains').querySelectorAll('.chip').forEach((el) => el.onclick = () => { depChain = el.dataset.ch; $('depChains').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === el)); resetDep(); });
    resetDep();
  }
  function resetDep() { $('depAddrWrap').classList.add('hidden'); $('depPlaceholder').classList.remove('hidden'); $('depErr').textContent = ''; $('depCoinName').textContent = $('depCoin').value; $('depChainName').textContent = depChain; depNotes(); }
  function depNotes() { const i = infoFor($('depCoin').value, depChain); $('depChainNote').textContent = i.chainDeposit === '0' ? 'Deposits on this network are temporarily suspended.' : i.confirmation ? `${i.confirmation} network confirmations` : ''; $('depMin').textContent = i.depositMin ? `${i.depositMin} ${i.coin}` : '--'; $('depConf').textContent = i.confirmation ? `${i.confirmation} confirmations` : '--'; }
  $('depCoin').onchange = renderDepChains; renderDepChains();
  $('depGet').onclick = async () => {
    $('depErr').textContent = ''; $('depGet').disabled = true;
    try {
      const r = await api(`/wallet/deposit/address?coin=${$('depCoin').value}&chain=${depChain}`);
      $('depAddr').textContent = r.address || '--'; $('depTag').textContent = r.tag || ''; $('depTagWrap').classList.toggle('hidden', !r.tag);
      try { const q = qrcode(0, 'M'); q.addData(r.address); q.make(); $('depQr').innerHTML = q.createSvgTag({ cellSize: 3, margin: 0 }); } catch {}
      $('depAddrWrap').classList.remove('hidden'); $('depPlaceholder').classList.add('hidden');
    } catch (e) { $('depErr').textContent = e.message; } finally { $('depGet').disabled = false; }
  };
  $('depCopy').onclick = () => navigator.clipboard.writeText($('depAddr').textContent).then(() => toast('Address copied'));
  const depStatus = (s) => ({ 0: 'Unknown', 1: 'To be confirmed', 2: 'Processing', 3: 'Success', 4: 'Failed', 10011: 'Pending credit', 10012: 'Credited' }[s] || s);
  async function loadDepHist(target = 'depHist') {
    try { const { list } = await api('/wallet/deposit/history'); $(target).innerHTML = list.length ? list.map((d) => `<tr><td>${fmt.time(d.successAt || d.createdTime)}</td><td><b>${esc(d.coin)}</b></td><td class="r num">${fmt.amt(d.amount, 8)}</td><td>${esc(d.chain)}</td><td class="num" style="font-size:11px">${esc((d.txID || '').slice(0, 10))}…</td><td><span class="tag ${d.status == 3 ? 'g' : d.status == 4 ? 'r' : ''}">${depStatus(d.status)}</span></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No deposits yet</td></tr>'; }
    catch (e) { $(target).innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`; }
  }
  $('depRefresh').onclick = () => loadDepHist();

  // withdraw
  let wdChain = null;
  function renderWdChains() {
    const c = $('wdCoin').value; wdChain = chainsFor(c)[0]?.chain; $('wdUnit').textContent = c;
    $('wdChains').innerHTML = chainsFor(c).map((a) => `<span class="chip ${a.chain === wdChain ? 'active' : ''}" data-ch="${a.chain}">${a.chain}</span>`).join('');
    $('wdChains').querySelectorAll('.chip').forEach((el) => el.onclick = () => { wdChain = el.dataset.ch; $('wdChains').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === el)); wdNotes(); });
    updateWdAvail(); wdNotes();
  }
  function updateWdAvail() { const c = balance?.coins.find((x) => x.coin === $('wdCoin').value); $('wdAvail').textContent = `${fmt.amt(c?.availableToWithdraw || 0, 8)} ${$('wdCoin').value}`; }
  function wdNotes() {
    const i = infoFor($('wdCoin').value, wdChain); $('wdFee').textContent = i.withdrawFee ? `${i.withdrawFee} ${i.coin}` : '--'; $('wdAmt').placeholder = i.withdrawMin ? `Minimum ${i.withdrawMin}` : 'Amount';
    const a = Number($('wdAmt').value), fee = Number(i.withdrawFee || 0); $('wdRecv').textContent = a > 0 ? `${fmt.amt(Math.max(0, a - fee), 8)} ${i.coin || ''}` : '--';
    if (!svc.withdrawals) { $('wdSubmit').disabled = true; $('wdErr').textContent = STATIC ? '' : 'Withdrawals are temporarily unavailable.'; }
  }
  $('wdCoin').onchange = renderWdChains; renderWdChains(); $('wdAmt').oninput = wdNotes;
  $('wdAll').onclick = () => { const c = balance?.coins.find((x) => x.coin === $('wdCoin').value); $('wdAmt').value = c?.availableToWithdraw || 0; wdNotes(); };
  $('wdForm').onsubmit = async (e) => {
    e.preventDefault(); $('wdErr').textContent = '';
    const body = { coin: $('wdCoin').value, chain: wdChain, address: $('wdAddr').value.trim(), tag: $('wdTag').value.trim(), amount: $('wdAmt').value };
    if (body.address.length < 10) return ($('wdErr').textContent = 'Please enter a valid address.');
    if (!(Number(body.amount) > 0)) return ($('wdErr').textContent = 'Please enter an amount.');
    if (!confirm(`Withdraw ${body.amount} ${body.coin} via ${body.chain} to\n${body.address}?`)) return;
    $('wdSubmit').disabled = true;
    try { const r = await api('/wallet/withdraw', { method: 'POST', body }); toast(`Withdrawal submitted (#${r.id})`); $('wdForm').reset(); renderWdChains(); loadWdHist(); loadBalance(); }
    catch (ex) { $('wdErr').textContent = ex.message; } finally { $('wdSubmit').disabled = !svc.withdrawals; }
  };
  async function loadWdHist(target = 'wdHist') {
    try { const { list } = await api('/wallet/withdraw/history'); $(target).innerHTML = list.length ? list.map((w) => `<tr><td>${esc(w.created_at)}</td><td><b>${esc(w.coin)}</b></td><td class="r num">${fmt.amt(w.amount, 8)}</td><td>${esc(w.chain)}</td><td class="num" style="font-size:11px">${esc(w.address.slice(0, 8))}…${esc(w.address.slice(-6))}</td><td title="${esc(w.error || '')}"><span class="tag ${w.status === 'submitted' ? 'g' : w.status === 'failed' ? 'r' : ''}">${esc(w.status)}</span></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No withdrawals yet</td></tr>'; }
    catch (e) { $(target).innerHTML = `<tr><td colspan="6" class="empty">${esc(e.message)}</td></tr>`; }
  }
  $('wdRefresh').onclick = () => loadWdHist();

  route();
})();
