// Shared by the home page and the board page: name popup, background, hover-out settings sidebar.
(() => {
  const DEFAULT_BG = '/images/default-bg.jpg';          // <- put your default background here
  const DEFAULTS = { blur: 18, dim: 0, grid: false, cursors: true, cursorNames: true, chat: null, penColor: '#1d2733', penSize: 4 };
  const K = { settings: 'wb-settings', bg: 'wb-bg', name: 'wb-name' };

  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
  const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  const parse = () => { try { return JSON.parse(read(K.settings) || '{}'); } catch { return {}; } };

  let settings = { ...DEFAULTS, ...parse() };
  const listeners = [];
  const emit = (k) => listeners.forEach((f) => { try { f(k); } catch (e) { console.error(e); } });

  const WB = (window.WB = {
    get: (k) => settings[k],
    set(k, v) { settings[k] = v; write(K.settings, JSON.stringify(settings)); sync(); applyBg(); emit(k); },
    onChange: (f) => listeners.push(f),
    name: () => cleanName(read(K.name)),
    setName(n) {
      n = cleanName(n);
      if (!n) return false;
      write(K.name, n); nameField.value = n; emit('name');
      return true;
    },
  });

  // ---------- styles ----------
  const css = document.createElement('style');
  css.textContent = `
    html { background: #d8dde2; }
    body { background: transparent !important; }
    .wb-bg { position: fixed; inset: -60px; z-index: -1; background-size: cover; background-position: center; }
    .wb-side { position: fixed; top: 0; right: 0; bottom: 0; width: 272px; z-index: 4;
      background: #1d2733; color: #e8edf2; transform: translateX(100%); transition: transform .22s ease;
      box-shadow: -8px 0 24px rgba(0,0,0,.25); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .wb-side:hover, .wb-side:focus-within, .wb-side.open { transform: none; }
    .wb-handle { position: absolute; left: -30px; top: 50%; transform: translateY(-50%); width: 30px; height: 96px; border: 0;
      border-radius: 10px 0 0 10px; background: #1d2733; color: #e8edf2; cursor: pointer; display: grid; place-items: center; }
    .wb-scroll { height: 100%; overflow-y: auto; padding: 20px 18px; }
    .wb-side h2 { margin: 0 0 12px; font-size: 18px; }
    .wb-side h3 { margin: 18px 0 8px; font-size: 14px; color: #9fb0c3; font-weight: 600; }
    .wb-side label { display: block; margin: 8px 0; }
    .wb-side .wb-row { display: flex; gap: 8px; flex-wrap: wrap; }
    .wb-side input[type=text] { width: 100%; margin-top: 4px; padding: 7px 10px; font: inherit; color: #1d2733;
      background: #fdfdfc; border: 0; border-radius: 8px; }
    .wb-side input[type=range] { width: 100%; accent-color: #7cb2ff; }
    .wb-side .wb-check { display: flex; gap: 8px; align-items: center; }
    .wb-side button.wb-small { font: inherit; color: #e8edf2; background: transparent; border: 1px solid #3a4756;
      border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    .wb-side button.wb-small:hover { background: #2a3644; }
    .wb-note { margin: 14px 0 0; color: #9fb0c3; font-size: 12px; }
    .wb-side :focus-visible, .wb-handle:focus-visible { outline: 2px solid #7cb2ff; outline-offset: 2px; }
    dialog.wb-dialog { border: 0; border-radius: 14px; padding: 22px 24px; background: #fdfdfc; color: #1d2733;
      width: min(400px, calc(100% - 32px)); box-shadow: 0 20px 50px rgba(0,0,0,.35);
      font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    dialog.wb-dialog::backdrop { background: rgba(29,39,51,.55); backdrop-filter: blur(3px); }
    .wb-dialog h2 { margin: 0 0 6px; font-size: 20px; }
    .wb-dialog p { margin: 0 0 12px; color: #5b6773; }
    .wb-dialog label.wb-field { display: block; margin-top: 12px; font-weight: 600; }
    .wb-dialog .wb-field input, .wb-dialog .wb-field select { display: block; width: 100%; margin-top: 4px; padding: 9px 12px;
      font: inherit; font-weight: 400; color: #1d2733; background: #fff; border: 1px solid #b8c0c8; border-radius: 8px; }
    .wb-dialog label.wb-check { display: flex; gap: 8px; align-items: flex-start; margin-top: 12px; font-weight: 400; }
    .wb-dialog .wb-check input { margin-top: 3px; }
    .wb-dialog .wb-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
    .wb-dialog .wb-btn { font: inherit; padding: 9px 16px; border-radius: 8px; border: 1px solid #b8c0c8; background: #fff;
      color: #1d2733; cursor: pointer; text-decoration: none; }
    .wb-dialog .wb-btn.primary { background: #1d2733; border-color: #1d2733; color: #fff; }
    .wb-dialog .wb-btn:disabled { opacity: .6; cursor: default; }
    .wb-dialog .wb-err { color: #b42318; margin: 10px 0 0; }
    .wb-dialog .wb-err:empty { display: none; }
    .wb-dialog :focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .wb-side { transition: none; } }`;
  document.head.appendChild(css);

  // ---------- background ----------
  const layer = document.createElement('div');
  layer.className = 'wb-bg';
  document.body.prepend(layer);
  function applyBg() {
    const custom = read(K.bg);
    layer.style.backgroundImage = 'url("' + (custom || DEFAULT_BG) + '")';
    layer.style.filter = 'blur(' + settings.blur + 'px) brightness(' + (1 - settings.dim / 100) + ')';
    defaultBtn.hidden = !custom;
  }
  function toDataUrl(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, 1200 / Math.max(img.width, img.height)); // it gets blurred, so small is fine
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  // ---------- sidebar ----------
  const side = document.createElement('aside');
  side.className = 'wb-side';
  side.setAttribute('aria-label', 'Settings');
  side.innerHTML = `
    <button class="wb-handle" type="button" aria-label="Toggle settings">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
    </button>
    <div class="wb-scroll">
    <h2>Settings</h2>
    <h3>You</h3>
    <label>Display name<input type="text" id="wb-name" maxlength="20" autocomplete="off"></label>
    <h3>Background</h3>
    <div class="wb-row">
      <button type="button" class="wb-small" id="wb-pick">Change image</button>
      <button type="button" class="wb-small" id="wb-default" hidden>Use default</button>
    </div>
    <label>Blur <input type="range" id="wb-blur" min="0" max="30"></label>
    <label>Dim <input type="range" id="wb-dim" min="0" max="70"></label>
    <div id="wb-boardonly">
      <h3>Board</h3>
      <label class="wb-check"><input type="checkbox" data-key="grid"> Show grid</label>
      <label class="wb-check"><input type="checkbox" data-key="cursors"> Show other cursors</label>
      <label class="wb-check"><input type="checkbox" data-key="cursorNames"> Show cursor names</label>
      <label class="wb-check"><input type="checkbox" data-key="chat"> Show chat</label>
    </div>
    <h3>Reset</h3>
    <button type="button" class="wb-small" id="wb-reset">Reset settings</button>
    <p class="wb-note">Everything here is saved in this browser only. Your background image never leaves your device.</p>
    </div>`;
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.hidden = true;
  document.body.append(side, fileInput);

  const $ = (id) => side.querySelector('#' + id);
  const nameField = $('wb-name'), defaultBtn = $('wb-default'), blurInput = $('wb-blur'), dimInput = $('wb-dim');
  if (document.body.dataset.page !== 'board') $('wb-boardonly').hidden = true;

  function sync() {
    blurInput.value = settings.blur; dimInput.value = settings.dim;
    side.querySelectorAll('input[type=checkbox][data-key]').forEach((cb) => {
      const v = settings[cb.dataset.key];
      cb.checked = v === null ? innerWidth >= 1100 : !!v;
    });
  }
  side.querySelector('.wb-handle').addEventListener('click', () => side.classList.toggle('open'));
  blurInput.addEventListener('input', () => WB.set('blur', +blurInput.value));
  dimInput.addEventListener('input', () => WB.set('dim', +dimInput.value));
  side.querySelectorAll('input[type=checkbox][data-key]').forEach((cb) =>
    cb.addEventListener('change', () => WB.set(cb.dataset.key, cb.checked)));
  nameField.addEventListener('change', () => { if (!WB.setName(nameField.value)) nameField.value = WB.name(); });
  $('wb-pick').addEventListener('click', () => fileInput.click());
  defaultBtn.addEventListener('click', () => { try { localStorage.removeItem(K.bg); } catch {} applyBg(); });
  $('wb-reset').addEventListener('click', () => {
    settings = { ...DEFAULTS }; write(K.settings, JSON.stringify(settings)); sync(); applyBg(); emit('*');
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; fileInput.value = '';
    if (!file) return;
    try {
      const data = await toDataUrl(file);
      if (!write(K.bg, data)) alert('The background is applied, but could not be saved for next time.');
      layer.style.backgroundImage = 'url("' + data + '")';
      defaultBtn.hidden = false;
    } catch { alert('That file could not be read as an image.'); }
  });
  addEventListener('storage', (e) => {
    if (e.key === K.settings) { settings = { ...DEFAULTS, ...parse() }; sync(); emit('*'); }
    if (e.key === K.bg || e.key === K.settings) applyBg();
    if (e.key === K.name) { nameField.value = WB.name(); emit('name'); }
  });

  // ---------- required name popup ----------
  const dlg = document.createElement('dialog');
  dlg.className = 'wb-dialog';
  dlg.innerHTML = `<form id="wb-nameform">
      <h2>Welcome! What should we call you?</h2>
      <p>Your name shows next to your cursor and in chat.</p>
      <label class="wb-field">Your name<input id="wb-nameinput" type="text" maxlength="20" required autocomplete="off" placeholder="Enter your name"></label>
      <div class="wb-actions"><button class="wb-btn primary" type="submit">Continue</button></div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('cancel', (e) => e.preventDefault());   // cannot be dismissed without a name
  dlg.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (WB.setName(dlg.querySelector('input').value)) dlg.close();
  });

  nameField.value = WB.name();
  sync(); applyBg();
  if (!WB.name()) dlg.showModal();
})();
