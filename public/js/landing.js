(() => {
  const { api, marketSocket, fmt, setToken, token } = window.Binoex;
  document.getElementById('year').textContent = new Date().getFullYear();
  if (token()) api('/auth/me').then(() => (location.href = '/app')).catch(() => setToken(null));

  // ---- auth modal ----
  const modal = document.getElementById('authModal');
  const form = document.getElementById('authForm');
  const title = document.getElementById('authTitle');
  const submit = document.getElementById('authSubmit');
  const err = document.getElementById('authErr');
  const sw = document.getElementById('authSwitch');
  let mode = 'login';

  function open(m) {
    mode = m; err.textContent = '';
    title.textContent = m === 'login' ? 'Log in' : 'Create your account';
    submit.textContent = m === 'login' ? 'Log in' : 'Create account';
    sw.innerHTML = m === 'login' ? 'No account? <a id="toRegister">Create one</a>' : 'Have an account? <a id="toLogin">Log in</a>';
    modal.classList.add('open');
    form.email.focus();
  }
  document.getElementById('btnLogin').onclick = () => open('login');
  document.getElementById('btnRegister').onclick = () => open('register');
  document.getElementById('btnRegister2').onclick = () => open('register');
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
  sw.addEventListener('click', (e) => { if (e.target.id === 'toRegister') open('register'); if (e.target.id === 'toLogin') open('login'); });

  form.onsubmit = async (e) => {
    e.preventDefault();
    err.textContent = ''; submit.disabled = true;
    submit.textContent = mode === 'login' ? 'Logging in…' : 'Creating your account…';
    try {
      const r = await api('/auth/' + mode, { method: 'POST', body: { email: form.email.value, password: form.password.value } });
      setToken(r.token);
      location.href = '/app';
    } catch (ex) {
      err.textContent = ex.message;
      submit.disabled = false; submit.textContent = mode === 'login' ? 'Log in' : 'Create account';
    }
  };

  // ---- live tickers ----
  const box = document.getElementById('landingTickers');
  const rows = new Map();
  function row(t) {
    const base = t.symbol.replace(/USDT$|USDC$/, ''), quote = t.symbol.slice(base.length);
    const chg = Number(t.price24hPcnt);
    return `<div class="sym">${base}<small>/${quote}</small></div><div class="mono">${fmt.price(t.lastPrice)}</div><div class="${chg >= 0 ? 'up' : 'down'}">${fmt.pct(chg)}</div>`;
  }
  api('/market/tickers?category=spot').then(({ list }) => {
    box.innerHTML = '';
    for (const t of list) {
      const el = document.createElement('div'); el.className = 'row'; el.innerHTML = row(t); box.appendChild(el); rows.set(t.symbol, { el, t });
    }
    const sock = marketSocket();
    for (const t of list) sock.subscribe('spot', 'tickers.' + t.symbol, (msg) => {
      const r = rows.get(t.symbol); Object.assign(r.t, msg.data); r.el.innerHTML = row(r.t);
    });
  }).catch(() => { box.innerHTML = '<div class="row"><div class="sym">Markets offline</div><div></div><div></div></div>'; });
})();
