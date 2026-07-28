const $ = (id) => document.getElementById(id);

// Log-scale slider: 10–1000 px/s
const MIN = 10, MAX = 1000;
const toSlider = (s) => Math.round(100 * Math.log(s / MIN) / Math.log(MAX / MIN));
const fromSlider = (v) => Math.round(MIN * Math.pow(MAX / MIN, v / 100));

let tabId = null;
let ui = { mode: 'none', active: false, paused: false };
let settings = { speed: 40, direction: 'down' };

function renderStatus() {
  const t = $('statusText');
  const main = $('mainBtn');
  const stop = $('stopBtn');
  $('pdfNote').hidden = !(ui.active && ui.mode === 'pdf');
  if (!ui.active) {
    t.textContent = 'Ready';
    t.classList.remove('live');
    main.textContent = 'Start scrolling';
    stop.hidden = true;
  } else if (ui.paused) {
    t.textContent = 'Paused';
    t.classList.remove('live');
    main.textContent = 'Resume';
    stop.hidden = false;
  } else {
    t.textContent = ui.mode === 'pdf' ? 'Scrolling (PDF mode)' : 'Scrolling';
    t.classList.add('live');
    main.textContent = 'Pause';
    stop.hidden = false;
  }
}

function renderSettings() {
  $('speedSlider').value = toSlider(Math.min(MAX, Math.max(MIN, settings.speed)));
  $('speedVal').textContent = settings.speed + ' px/s';
  $('dirDown').classList.toggle('on', settings.direction !== 'up');
  $('dirUp').classList.toggle('on', settings.direction === 'up');
}

function showError(msg) {
  const e = $('errNote');
  e.textContent = msg;
  e.hidden = false;
}

async function refresh() {
  const res = await chrome.runtime.sendMessage({ type: 'popup:getStatus', tabId }).catch(() => null);
  if (!res) return;
  if (res.mode !== 'none') {
    ui = { mode: res.mode, active: !!res.active, paused: !!res.paused };
    if (res.active && typeof res.speed === 'number') {
      settings.speed = res.speed;
      if (res.direction) settings.direction = res.direction;
      renderSettings();
    }
  } else {
    ui = { mode: 'none', active: false, paused: false };
  }
  renderStatus();
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;
  settings = await chrome.storage.sync.get({ speed: 40, direction: 'down' });
  renderSettings();
  await refresh();
}

$('mainBtn').addEventListener('click', async () => {
  $('errNote').hidden = true;
  if (!ui.active) {
    const res = await chrome.runtime.sendMessage({
      type: 'popup:start', tabId, speed: settings.speed, direction: settings.direction,
    }).catch(() => null);
    if (res && res.ok) {
      ui = { mode: res.mode, active: true, paused: false };
    } else if (res && res.reason === 'unsupported-page') {
      showError("Chrome doesn't let extensions run on this page (settings pages, Web Store, new tab). Switch to your manga tab and try again.");
    } else if (res && res.reason === 'attach-failed') {
      showError('Could not start PDF mode. If DevTools is open on this tab, close it and retry. For local PDF files, enable "Allow access to file URLs" for this extension in chrome://extensions.');
    } else {
      showError('Could not start on this page.');
    }
  } else if (ui.paused) {
    await chrome.runtime.sendMessage({
      type: 'popup:resume', tabId, speed: settings.speed, direction: settings.direction,
    }).catch(() => null);
    ui.paused = false;
  } else {
    await chrome.runtime.sendMessage({ type: 'popup:pause', tabId }).catch(() => null);
    ui.paused = true;
  }
  renderStatus();
});

$('stopBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'popup:stop', tabId }).catch(() => null);
  ui = { mode: 'none', active: false, paused: false };
  renderStatus();
});

let saveT = null;
function applySpeed(speed) {
  settings.speed = speed;
  $('speedVal').textContent = speed + ' px/s';
  clearTimeout(saveT);
  saveT = setTimeout(() => chrome.storage.sync.set({ speed }), 250);
  chrome.runtime.sendMessage({ type: 'popup:setSpeed', tabId, speed }).catch(() => {});
}

$('speedSlider').addEventListener('input', (e) => applySpeed(fromSlider(+e.target.value)));

document.querySelectorAll('.chip').forEach((b) =>
  b.addEventListener('click', () => {
    const speed = +b.dataset.speed;
    $('speedSlider').value = toSlider(speed);
    applySpeed(speed);
  })
);

function setDirection(dir) {
  settings.direction = dir;
  renderSettings();
  chrome.storage.sync.set({ direction: dir });
  chrome.runtime.sendMessage({ type: 'popup:setDirection', tabId, direction: dir }).catch(() => {});
}
$('dirDown').addEventListener('click', () => setDirection('down'));
$('dirUp').addEventListener('click', () => setDirection('up'));

init();
