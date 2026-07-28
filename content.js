// Manga AutoScroll — content script (page mode)
// Smooth requestAnimationFrame scrolling of the page or the reader panel,
// plus a small floating HUD with pause / speed / stop controls.
(() => {
  if (window.__mangaAutoScroll) return;
  window.__mangaAutoScroll = true;

  const state = {
    active: false,
    paused: false,
    speed: 120,      // pixels per second
    direction: 1,    // 1 = down, -1 = up
    target: null,
    raf: null,
    acc: 0,          // fractional pixel accumulator (for very slow speeds)
    lastTs: 0,
    lastProgressTs: 0,
    lastFindTs: 0,
  };

  const IDLE_STOP_MS = 6000; // auto-stop after 6s stuck at the end (lets lazy images load first)

  chrome.storage.sync.get({ speed: 120, direction: 'down' }, (v) => {
    state.speed = v.speed;
    state.direction = v.direction === 'up' ? -1 : 1;
  });

  /* ---------- finding what to scroll ---------- */

  function isScrollableStyle(el) {
    const oy = getComputedStyle(el).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }

  function findTarget() {
    let best = null;
    const consider = (el, score, room) => {
      if (room < 60) return;
      if (!best || score > best.score) best = { el, score };
    };

    // 1) the document itself (slight preference)
    const doc = document.scrollingElement || document.documentElement;
    if (doc) consider(doc, innerWidth * innerHeight * 1.2, doc.scrollHeight - doc.clientHeight);

    // 2) big scrollable panels (custom readers, pdf.js viewers, Drive preview…)
    for (const el of document.querySelectorAll('*')) {
      if (el === doc) continue;
      const room = el.scrollHeight - el.clientHeight;
      if (room < 150 || !isScrollableStyle(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 150) continue;
      consider(el, r.width * r.height, room);
    }

    // 3) same-origin iframes (readers embedded in the page)
    for (const fr of document.querySelectorAll('iframe')) {
      let idoc = null;
      try { idoc = fr.contentDocument; } catch (e) { continue; }
      if (!idoc) continue;
      const fRect = fr.getBoundingClientRect();
      if (fRect.width < 200 || fRect.height < 200) continue;
      const isc = idoc.scrollingElement || idoc.documentElement;
      if (isc) consider(isc, fRect.width * fRect.height * 1.1, isc.scrollHeight - isc.clientHeight);
      for (const el of idoc.querySelectorAll('*')) {
        if (el === isc) continue;
        const room = el.scrollHeight - el.clientHeight;
        if (room < 150) continue;
        let oy;
        try { oy = idoc.defaultView.getComputedStyle(el).overflowY; } catch (e) { continue; }
        if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 150 || r.height < 150) continue;
        consider(el, r.width * r.height, room);
      }
    }

    return best ? best.el : null;
  }

  /* ---------- the scroll engine ---------- */

  function tick(ts) {
    if (!state.active) return;
    if (!state.paused && state.target) {
      const dt = state.lastTs ? Math.min((ts - state.lastTs) / 1000, 0.1) : 0;
      state.acc += state.speed * dt * state.direction;
      const whole = state.acc >= 0 ? Math.floor(state.acc) : Math.ceil(state.acc);
      if (whole !== 0) {
        state.acc -= whole;
        const before = state.target.scrollTop;
        state.target.scrollTop = before + whole;
        if (state.target.scrollTop !== before) {
          state.lastProgressTs = ts;
        } else {
          // Stuck — maybe the layout changed; occasionally look for a new target.
          if (ts - state.lastProgressTs > 1500 && ts - state.lastFindTs > 1000) {
            state.lastFindTs = ts;
            const t = findTarget();
            if (t && t !== state.target) state.target = t;
          }
          if (ts - state.lastProgressTs > IDLE_STOP_MS) {
            stop(); // reached the end
            return;
          }
        }
      }
    }
    state.lastTs = ts;
    state.raf = requestAnimationFrame(tick);
  }

  function publicState() {
    return {
      active: state.active,
      paused: state.paused,
      speed: state.speed,
      direction: state.direction === -1 ? 'up' : 'down',
    };
  }

  function report() {
    try {
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: publicState() }).catch(() => {});
    } catch (e) { /* extension was reloaded */ }
  }

  function start(opts = {}) {
    if (typeof opts.speed === 'number') state.speed = opts.speed;
    if (opts.direction) state.direction = opts.direction === 'up' ? -1 : 1;
    if (!state.target || !document.contains(state.target)) state.target = findTarget();
    if (!state.target) return { ok: false, reason: 'no-target' };
    state.paused = false;
    if (!state.active) {
      state.active = true;
      state.lastTs = 0;
      state.acc = 0;
      state.lastProgressTs = performance.now();
      state.raf = requestAnimationFrame(tick);
    }
    showHud();
    report();
    return { ok: true, ...publicState() };
  }

  function stop() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null;
    state.active = false;
    state.paused = false;
    hideHud();
    report();
  }

  function toggle(opts) {
    if (!state.active) return start(opts);
    state.paused = !state.paused;
    updateHud();
    report();
    return { ok: true, ...publicState() };
  }

  function setSpeed(v, save) {
    state.speed = Math.max(10, Math.min(2000, Math.round(v)));
    updateHud();
    report();
    if (save) {
      clearTimeout(setSpeed._t);
      setSpeed._t = setTimeout(() => {
        try { chrome.storage.sync.set({ speed: state.speed }); } catch (e) {}
      }, 250);
    }
    return state.speed;
  }

  /* ---------- floating HUD ---------- */

  let hudHost = null;
  let hudRefs = null;

  const HUD_CSS = `
    .pill {
      display: flex; align-items: center; gap: 2px;
      background: rgba(17, 17, 27, .88);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, .14);
      border-radius: 999px; padding: 6px 10px;
      font: 12px/1 -apple-system, 'Segoe UI', system-ui, sans-serif;
      color: #eee; box-shadow: 0 4px 18px rgba(0, 0, 0, .35);
      user-select: none;
    }
    button {
      all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; color: #eee; text-align: center;
    }
    button:hover { background: rgba(255, 255, 255, .14); }
    .spd { min-width: 44px; text-align: center; font-weight: 600; color: #c4b5fd; }
    .x { font-size: 11px; color: #999; margin-left: 2px; }
    .x:hover { color: #fff; background: rgba(255, 80, 80, .25); }
  `;

  function ensureHud() {
    if (hudHost && document.documentElement.contains(hudHost)) return;
    const mk = (tag, cls, text, title) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      if (title) n.title = title;
      return n;
    };
    hudHost = document.createElement('manga-autoscroll-hud');
    hudHost.style.cssText =
      'all:initial !important; position:fixed !important; right:18px !important;' +
      'bottom:18px !important; z-index:2147483647 !important; display:block !important;';
    const root = hudHost.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(HUD_CSS);
    root.adoptedStyleSheets = [sheet];

    const pill = mk('div', 'pill');
    const pp = mk('button', 'pp', '⏸', 'Pause / resume (Alt+S)');
    const minus = mk('button', null, '−', 'Slower (Alt+↓)');
    const spd = mk('span', 'spd', String(state.speed), 'pixels per second');
    const plus = mk('button', null, '+', 'Faster (Alt+↑)');
    const x = mk('button', 'x', '✕', 'Stop');
    pp.addEventListener('click', () => toggle());
    minus.addEventListener('click', () => setSpeed(state.speed * 0.8, true));
    plus.addEventListener('click', () => setSpeed(state.speed * 1.25, true));
    x.addEventListener('click', () => stop());
    pill.append(pp, minus, spd, plus, x);
    root.append(pill);
    hudRefs = { pp, spd };
    document.documentElement.appendChild(hudHost);
  }

  function updateHud() {
    if (!hudRefs) return;
    hudRefs.pp.textContent = state.paused ? '▶' : '⏸';
    hudRefs.spd.textContent = String(state.speed);
  }

  function showHud() {
    ensureHud();
    hudHost.style.setProperty('display', 'block', 'important');
    updateHud();
  }

  function hideHud() {
    if (hudHost) hudHost.style.setProperty('display', 'none', 'important');
  }

  /* ---------- messages ---------- */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'start':
        sendResponse(start(msg));
        break;
      case 'toggle':
        sendResponse(toggle(msg));
        break;
      case 'pause':
        if (state.active) { state.paused = true; updateHud(); report(); }
        sendResponse({ ok: true, ...publicState() });
        break;
      case 'stop':
        stop();
        sendResponse({ ok: true, ...publicState() });
        break;
      case 'setSpeed':
        setSpeed(msg.speed, false);
        sendResponse({ ok: true });
        break;
      case 'setDirection':
        state.direction = msg.direction === 'up' ? -1 : 1;
        sendResponse({ ok: true });
        break;
      case 'speedStep':
        sendResponse({ ok: true, speed: setSpeed(state.speed * (msg.dir > 0 ? 1.25 : 0.8), true) });
        break;
      case 'status':
        sendResponse({ ok: true, ...publicState() });
        break;
    }
  });
})();
