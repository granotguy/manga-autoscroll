// Manga AutoScroll — background service worker
// Routes popup <-> content script messages, handles keyboard shortcuts and the
// toolbar badge, and provides "PDF mode": when the page itself can't be
// scrolled (Chrome's built-in PDF viewer, PDFs in cross-origin iframes,
// canvas readers), it sends real trusted mouse-wheel input to the tab
// via the chrome.debugger API instead.

const DEFAULTS = { speed: 40, direction: 'down' };
const TICK_MS = 16; // ~60Hz; bigger gaps make the PDF viewer visibly step
const pdfSessions = new Map(); // tabId -> { timer, speed, direction, paused }

function getSettings() {
  return chrome.storage.sync.get(DEFAULTS);
}

function setBadge(tabId, mode) {
  const text = mode === 'on' ? 'ON' : mode === 'paused' ? '❚❚' : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (mode) {
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color: mode === 'on' ? '#22c55e' : '#f59e0b',
    }).catch(() => {});
  }
}

function sendToContent(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => null);
}

// Make sure the content script is present (covers tabs opened before install).
async function ensureContent(tabId) {
  if (await sendToContent(tabId, { type: 'status' })) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    return false; // page doesn't allow injection (PDF viewer, chrome:// pages…)
  }
  return !!(await sendToContent(tabId, { type: 'status' }));
}

/* ---------- PDF mode (trusted wheel events) ---------- */

async function startPdf(tabId, settings) {
  const existing = pdfSessions.get(tabId);
  if (existing) {
    existing.paused = false;
    existing.speed = settings.speed;
    existing.direction = settings.direction;
    setBadge(tabId, 'on');
    return {
      ok: true, mode: 'pdf', active: true, paused: false,
      speed: existing.speed, direction: existing.direction,
    };
  }
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    return { ok: false, reason: 'attach-failed', detail: String((e && e.message) || e) };
  }
  const s = {
    speed: settings.speed, direction: settings.direction, paused: false, timer: null,
    last: performance.now(), acc: 0,
  };
  s.timer = setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - s.last) / 1000, 0.2);
    s.last = now;
    if (s.paused) return;
    // Accumulate real elapsed time (setInterval drifts) and send at least a
    // whole pixel per event — sub-pixel wheel deltas get rounded away.
    s.acc += s.speed * dt;
    if (s.acc < 1) return;
    const dy = s.acc * (s.direction === 'up' ? -1 : 1);
    s.acc = 0;
    chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 150,
      y: 300,
      deltaX: 0,
      deltaY: dy,
    }).catch(() => stopPdf(tabId));
  }, TICK_MS);
  pdfSessions.set(tabId, s);
  setBadge(tabId, 'on');
  return { ok: true, mode: 'pdf', active: true, paused: false, speed: s.speed, direction: s.direction };
}

function stopPdf(tabId, alreadyDetached = false) {
  const s = pdfSessions.get(tabId);
  if (!s) return;
  clearInterval(s.timer);
  pdfSessions.delete(tabId);
  if (!alreadyDetached) chrome.debugger.detach({ tabId }).catch(() => {});
  setBadge(tabId, null);
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) stopPdf(source.tabId, true);
});

chrome.tabs.onRemoved.addListener((tabId) => stopPdf(tabId, true));

/* ---------- starting on any page ---------- */

async function startAnywhere(tabId, settings) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const url = (tab && tab.url) || '';
  if (!/^(https?|file|ftp):/i.test(url)) return { ok: false, reason: 'unsupported-page' };

  if (pdfSessions.has(tabId)) return startPdf(tabId, settings);

  if (await ensureContent(tabId)) {
    const res = await sendToContent(tabId, {
      type: 'start', speed: settings.speed, direction: settings.direction,
    });
    if (res && res.ok) return { ok: true, mode: 'content', ...res };
  }
  // Nothing scrollable in the page itself -> fall back to trusted wheel input.
  return startPdf(tabId, settings);
}

/* ---------- messages (popup + content) ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse);
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'stateUpdate': {
      const tabId = sender.tab && sender.tab.id;
      if (tabId != null && !pdfSessions.has(tabId)) {
        const st = msg.state;
        setBadge(tabId, st.active ? (st.paused ? 'paused' : 'on') : null);
      }
      return { ok: true };
    }
    case 'popup:getStatus': {
      const s = pdfSessions.get(msg.tabId);
      if (s) {
        return { mode: 'pdf', active: true, paused: s.paused, speed: s.speed, direction: s.direction };
      }
      const res = await sendToContent(msg.tabId, { type: 'status' });
      return res ? { mode: 'content', ...res } : { mode: 'none' };
    }
    case 'popup:start':
      return startAnywhere(msg.tabId, { speed: msg.speed, direction: msg.direction });
    case 'popup:pause': {
      const s = pdfSessions.get(msg.tabId);
      if (s) {
        s.paused = true;
        setBadge(msg.tabId, 'paused');
        return { ok: true };
      }
      await sendToContent(msg.tabId, { type: 'pause' });
      return { ok: true };
    }
    case 'popup:resume': {
      const s = pdfSessions.get(msg.tabId);
      if (s) {
        s.paused = false;
        setBadge(msg.tabId, 'on');
        return { ok: true };
      }
      await sendToContent(msg.tabId, { type: 'start', speed: msg.speed, direction: msg.direction });
      return { ok: true };
    }
    case 'popup:stop': {
      if (pdfSessions.has(msg.tabId)) {
        stopPdf(msg.tabId);
        return { ok: true };
      }
      await sendToContent(msg.tabId, { type: 'stop' });
      return { ok: true };
    }
    case 'popup:setSpeed': {
      const s = pdfSessions.get(msg.tabId);
      if (s) s.speed = msg.speed;
      else await sendToContent(msg.tabId, { type: 'setSpeed', speed: msg.speed });
      return { ok: true };
    }
    case 'popup:setDirection': {
      const s = pdfSessions.get(msg.tabId);
      if (s) s.direction = msg.direction;
      else await sendToContent(msg.tabId, { type: 'setDirection', direction: msg.direction });
      return { ok: true };
    }
  }
  return { ok: false, reason: 'unknown-message' };
}

/* ---------- keyboard shortcuts ---------- */

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  const tabId = tab.id;
  const settings = await getSettings();

  if (command === 'toggle-scroll') {
    const s = pdfSessions.get(tabId);
    if (s) {
      s.paused = !s.paused;
      setBadge(tabId, s.paused ? 'paused' : 'on');
      return;
    }
    if (await ensureContent(tabId)) {
      const res = await sendToContent(tabId, {
        type: 'toggle', speed: settings.speed, direction: settings.direction,
      });
      if (res && res.ok) return;
    }
    await startPdf(tabId, settings);
    return;
  }

  if (command === 'speed-up' || command === 'speed-down') {
    const factor = command === 'speed-up' ? 1.25 : 0.8;
    const s = pdfSessions.get(tabId);
    if (s) {
      s.speed = Math.max(10, Math.min(2000, Math.round(s.speed * factor)));
      chrome.storage.sync.set({ speed: s.speed });
    } else {
      await sendToContent(tabId, { type: 'speedStep', dir: command === 'speed-up' ? 1 : -1 });
    }
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.sync.get(null);
  if (cur.speed == null) chrome.storage.sync.set(DEFAULTS);
});
