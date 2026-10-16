(async () => {
  const { chrome, api, setToken, qs, me, STATIC } = BX;
  chrome();
  if (await me()) { location.href = 'assets.html'; return; }

  const $ = (id) => document.getElementById(id);
  const form = $('form');
  let mode = qs('mode', 'login') === 'register' ? 'register' : 'login';
  if (qs('email')) form.email.value = qs('email');

  function apply() {
    const reg = mode === 'register';
    document.title = reg ? 'Binoex | Sign Up' : 'Binoex | Log In';
    $('title').textContent = reg ? 'Create Account' : 'Log In';
    $('submit').textContent = reg ? 'Sign Up' : 'Log In';
    $('refField').classList.toggle('hidden', !reg);
    $('agree').classList.toggle('hidden', !reg);
    form.password.autocomplete = reg ? 'new-password' : 'current-password';
    $('switch').innerHTML = reg ? 'Already have an account? <a class="link" id="sw">Log In</a>' : 'Don\'t have an account? <a class="link" id="sw">Sign Up</a>';
    $('sw').onclick = () => { mode = reg ? 'login' : 'register'; history.replaceState(null, '', 'login.html?mode=' + mode); $('err').textContent = ''; apply(); };
  }
  apply();

  $('togglePw').onclick = () => { const p = form.password; p.type = p.type === 'password' ? 'text' : 'password'; $('togglePw').textContent = p.type === 'password' ? 'Show' : 'Hide'; };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('err'); err.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value)) return (err.textContent = 'Please enter a valid email address.');
    if (form.password.value.length < 8) return (err.textContent = 'Password must be at least 8 characters.');
    if (mode === 'register' && !form.agree.checked) return (err.textContent = 'Please agree to the Terms of Service.');
    const btn = $('submit'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api('/auth/' + mode, { method: 'POST', body: { email: form.email.value.trim(), password: form.password.value } });
      setToken(r.token);
      location.href = qs('next', 'assets.html');
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false; btn.textContent = mode === 'register' ? 'Sign Up' : 'Log In';
    }
  };
  if (STATIC) $('err').textContent = 'Preview site — accounts activate once the backend is deployed.';
})();
