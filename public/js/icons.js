/* Inline SVG line icons (24x24, stroke = currentColor). Use <i data-icon="name"></i> in HTML or ICON('name') in JS. */
(() => {
  const P = {
    wallet: '<path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M16 12h5v4h-5a2 2 0 010-4z"/>',
    'arrow-down': '<path d="M12 4v16m0 0l-6-6m6 6l6-6"/>',
    'arrow-up': '<path d="M12 20V4m0 0l-6 6m6-6l6 6"/>',
    'arrow-right': '<path d="M5 12h14m0 0l-6-6m6 6l-6 6"/>',
    history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.5 2.8L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>',
    'trending-up': '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
    coins: '<circle cx="9" cy="9" r="6"/><path d="M15.5 9.5A6 6 0 1113 20.3"/><path d="M7 9h4M9 7v4"/>',
    bank: '<path d="M3 10l9-6 9 6"/><path d="M4 10v9M8 10v9M12 10v9M16 10v9M20 10v9"/><path d="M2 20h20"/>',
    snowflake: '<path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    'file-text': '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0114 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 15a5 5 0 016 5"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    gift: '<rect x="3" y="8" width="18" height="4"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8c-2-3-5-3-5-1s3 1 5 1zm0 0c2-3 5-3 5-1s-3 1-5 1z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    book: '<path d="M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4z"/><path d="M20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7z"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    apple: '<path d="M16.5 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.8 3-.8s1.8.8 3 .7c1.3 0 2-1.1 2.8-2.3.9-1.3 1.2-2.6 1.3-2.7-.1 0-2.5-1-2.5-3.5zM14.2 5.8c.6-.8 1.1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z"/>',
    play: '<path d="M6 4l14 8-14 8z"/>',
    download: '<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
    x: '<path d="M4 4l16 16M20 4L4 20"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
    youtube: '<path d="M22 8.5a3 3 0 00-2-2C18 6 12 6 12 6s-6 0-8 .5a3 3 0 00-2 2A31 31 0 002 12a31 31 0 00.5 3.5 3 3 0 002 2c2 .5 7.5.5 7.5.5s6 0 8-.5a3 3 0 002-2 31 31 0 00.5-3.5 31 31 0 00-.5-3.5z"/><path d="M10 9.5v5l4.5-2.5z"/>',
    linkedin: '<path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-4 0v7h-4v-7a6 6 0 016-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
    discord: '<path d="M8.5 3C6 3.5 4 5 4 5S2 9 2 14c0 0 2 3 5 3l1-2c-2-.5-3-1.5-3-1.5 3 1.5 11 1.5 14 0 0 0-1 1-3 1.5l1 2c3 0 5-3 5-3 0-5-2-9-2-9s-2-1.5-4.5-2l-.5 1a16 16 0 00-6 0z"/><circle cx="9" cy="11" r="1.2"/><circle cx="15" cy="11" r="1.2"/>',
  };
  const ICON = (name, size = 18) => `<svg class="i i-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  window.ICON = ICON;
  const swap = () => document.querySelectorAll('i[data-icon]').forEach((el) => { el.outerHTML = ICON(el.dataset.icon, el.dataset.size || 18); });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', swap) : swap();
})();
