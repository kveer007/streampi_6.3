// This page is public, so it holds nothing about any particular Pi. The Pi's address
// is typed in once per device (and kept only on that device); everything else, like
// where the live streams are, comes from the Pi after logging in.
const APP_VERSION = 'v6.3';
const FRESH_SECS = 20;            // a level reading older than this counts as "no live sound"
const AUDIO_RE = /^audio-\d{8}-\d{4}(\d{2})?\.(ogg|m4a)$/;   // .m4a with exact seconds since v4.1
const CLIP_RE = /^motion-\d{14}\.mp4$/;
const THUMB_RE = /^motion-\d{14}\.jpg$/;
const SAVED_ID_RE = /^s\d{8}-\d{6}-[0-9a-f]{4}$/;

let PI_ADDR = '';                 // "name:port", as typed on this device
let AUTH = null;                  // {addr, token, expires, streamUser, streamKey, streams}
let VIEW = 'camera', TAB = 'live';
let appStarted = false;
let connState = 'connecting';     // connecting | ok | offline
// Live sound meter worked out on this phone while listening (Web Audio)
const meter = { ctx: null, timer: null, peak: 0, ticks: 0, level: null };
let waveHistory = new Array(200).fill(0);
let audFiles = [], clipList = [], savedList = [];
let timers = [];
const busy = {};

// ── SMALL HELPERS ─────────────────────────────────────
function $(id) { return document.getElementById(id); }
function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function storageDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function pad(n) { return String(n).padStart(2, '0'); }
function nowSec() { return Date.now() / 1000; }
function playSafe(m) { const p = m.play(); if (p && p.catch) p.catch(() => {}); }

function fmtClock(ts) { const d = new Date(ts * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
function fmtHM(ts) { const d = new Date(ts * 1000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function dayStart(ts) { const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; }
function nextDay(ds) { return dayStart(ds + 86400 + 7200); }      // also right on 23/25-hour days
function fmtDate(ts) { return new Date(ts * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); }
function dayLabel(ds) {
  const today = dayStart(nowSec());
  if (ds === today) return 'Today';
  if (ds === dayStart(today - 3600)) return 'Yesterday';
  return fmtDate(ds);
}
function fmtDuration(secs) {
  secs = Math.max(0, Math.round(secs));
  if (secs < 60) return secs + ' s';
  if (secs < 3600) return Math.floor(secs / 60) + ' min' + (secs % 60 ? ' ' + (secs % 60) + ' s' : '');
  return Math.floor(secs / 3600) + ' h ' + Math.round((secs % 3600) / 60) + ' min';
}
function fmtSize(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function levelColor(l, a) { return l > 70 ? 'rgba(255,107,107,' + a + ')' : l > 40 ? 'rgba(255,182,92,' + a + ')' : 'rgba(79,214,238,' + a + ')'; }

// Line icons (fixed strings, never anything from the Pi)
const ICON = {
  play: '<path d="M7 4l13 8-13 8z"/>',
  pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  cam: '<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/>',
  soundOn: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  soundOff: '<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M23 9l-6 6M17 9l6 6"/>',
  fs: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  fsExit: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><path d="M12 2v10"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  swap: '<path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/>'
};
function svg(name, cls) {
  return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>';
}
// A button with an icon and a label
function setIconText(b, icon, cls, text) { b.innerHTML = svg(icon, cls); b.appendChild(document.createTextNode(text)); }
function iconEl(tag, cls, icon) { const e = el(tag, cls); e.innerHTML = svg(icon); return e; }

// The small "i" buttons: one plain explanation each
const HELP = {
  live: ['Live camera', 'The picture is about 2 seconds behind real time.\n\nPinch it to zoom in (on a computer: scroll), then drag to look around. Double-tap to zoom in or back out.\n\nThe camera button saves a photo of the picture to this phone. Full screen fills the whole screen; turn the phone sideways for a bigger picture.'],
  timeline: ['Movement on this day', 'Each mark is one motion clip, placed at the time of day it started (00 = midnight, 12 = noon, 24 = the end of the day).\n\nBlue = new, not watched yet. Red = still recording. White = playing now.\n\nTap near a mark to play that clip. Play all plays the whole day, oldest first.'],
  keep: ['Keep this day', "A kept day is never auto-deleted: its sound recordings, sound levels and camera clips stay until you un-keep it.\n\nUn-keeping needs your web password."],
  level: ['Sound level', 'A number from 0 (silent) to 100 (very loud). Under 40 is quiet, over 70 is loud.\n\nWhile you listen, this phone measures it. Otherwise the Pi sends a reading every 2 seconds.'],
  autodelete: ['Auto-delete old recordings', 'When on, the Pi deletes sound recordings and camera clips that are older than the days you choose. It checks once an hour.\n\nDays you kept (★) and everything in Saved are never deleted.\n\nSwitching it on, or keeping fewer days, needs your web password.\n\nSeparately, a low-space guard always watches the memory card: if less than 3 GB is free, the oldest recordings are deleted to make room. It never touches kept days, Saved items or the last 24 hours.'],
  power: ['Turning it on and off', 'The line shows whether the camera (or audio) is on, and since when.\n\nWhile the camera is on, motion detection is watching and records clips. While audio is on, sound is recorded all the time, a new file every hour.\n\nThe Pi menu decides what this page may do, and the Pi menu always wins.\n\nMenu Camera or Audio: this page can turn that one off (needs your web password) and back on (no password). Off stays off, also after a Pi restart.\n\nMenu "Website chooses": this page picks Camera, Audio or nothing. Turning one on from nothing needs no password; switching between them or turning off needs it.'],
  health: ['Pi health', 'Temperature: the Pi slows itself down at 80 °C.\n\nPower: a weak power supply or cable makes the Pi slow and unreliable. Any warning since the last restart shows here.\n\nHow busy: how much of the Pi\'s computing power is in use right now, for everything on it.\n\nSpace left: room for recordings on the memory card.'],
  sensitivity: ['Motion sensitivity', 'How much has to move before a clip starts.\n\nLess: only bigger movement, e.g. a person. Fewer clips from curtains, pets or light changes.\nNormal: the setting tested in light and dark.\nMore: smaller movement too, so more clips.\n\nChanging it restarts the camera: about 5 seconds without picture.'],
  app: ['Use StreamPi like an app', 'On iPhone: open this page in Safari, tap Share, then Add to Home Screen.\n\nOpen StreamPi from the new icon and log in once. It then opens full screen, like an app.']
};
function help(k) { const h = HELP[k]; if (h) dialog(h[0], h[1], 'OK', null, 'info'); }

let toastTimer = null;
function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast' + (isError ? ' error' : ''); t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, isError ? 5000 : 3000);
}

// A small dialog: confirm (returns true/null) or, with a placeholder, ask for a name (text/null);
// inputType 'password' asks for the web password (hidden while typing), 'info' just explains (OK only)
function dialog(title, text, okLabel, inputPlaceholder, inputType) {
  return new Promise(resolve => {
    $('modal-title').textContent = title;
    $('modal-text').textContent = text;
    $('modal-ok').textContent = okLabel || 'OK';
    $('modal-ok').className = 'btn ' + (okLabel === 'Delete' ? 'danger' : 'primary');
    $('modal-cancel').style.display = inputType === 'info' ? 'none' : '';
    const inp = $('modal-input');
    inp.style.display = inputPlaceholder ? 'block' : 'none';
    inp.type = inputType === 'password' ? 'password' : 'text';
    inp.maxLength = inputType === 'password' ? 200 : 60;
    inp.autocomplete = inputType === 'password' ? 'current-password' : 'off';
    inp.value = ''; inp.placeholder = inputPlaceholder || '';
    $('modal').classList.add('open');
    if (inputPlaceholder) setTimeout(() => inp.focus(), 50);
    const done = v => {
      $('modal').classList.remove('open');
      $('modal-ok').onclick = $('modal-cancel').onclick = inp.onkeydown = null;
      resolve(v);
    };
    $('modal-ok').onclick = () => done(inputPlaceholder ? inp.value : true);
    $('modal-cancel').onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value); };
  });
}

// ── ADDRESS + REQUESTS ────────────────────────────────
// Turn what was typed or pasted into "name:port", or '' if it isn't a usable Tailscale address
function normalizeAddr(v) {
  const m = String(v || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '')
    .match(/^([a-z0-9.-]+\.ts\.net):(\d{1,5})(?:[\/?#].*)?$/);
  return m && +m[2] > 0 && +m[2] < 65536 ? m[1] + ':' + m[2] : '';
}
const ADDR_HELP = 'Enter the Pi address exactly as your Pi shows it (name:number).';
function apiUrl(path) { return 'https://' + PI_ADDR + path; }
function loginUrl(addr) { return 'https://' + addr + '/login'; }
// Audio/video/image elements can't send a login header, so the token goes in the address
function mediaUrl(path, download) {
  return apiUrl(path) + '?t=' + encodeURIComponent(AUTH ? AUTH.token : '') + (download ? '&dl=1' : '');
}

function ApiError(status, code) { this.status = status; this.code = code; }
function isAuthError(e) { return e instanceof ApiError && (e.status === 401 || e.status === 503); }

// fetch with a time limit, so a Pi that doesn't answer can't pile up requests
async function api(path, body, timeoutMs) {
  const ctl = window.AbortController ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs || 10000) : null;
  try {
    const opt = { cache: 'no-store', signal: ctl ? ctl.signal : undefined, headers: {} };
    if (AUTH) opt.headers.Authorization = 'Bearer ' + AUTH.token;
    if (body) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(apiUrl(path), opt);
    if (!r.ok) {
      let code = '';
      try { code = (await r.json()).error || ''; } catch (e) {}
      throw new ApiError(r.status, code);
    }
    return await r.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── LOGIN ─────────────────────────────────────────────
function loadAuth() {
  try {
    const a = JSON.parse(storageGet('pisentinel_auth') || 'null');
    if (a && a.token && a.streamKey && a.streams && a.addr === PI_ADDR && a.expires * 1000 > Date.now()) return a;
  } catch (e) {}
  return null;
}
function saveAuth(a) { AUTH = a; storageSet('pisentinel_auth', JSON.stringify(a)); }
function clearAuth() { AUTH = null; storageDel('pisentinel_auth'); }
const NO_PASSWORD_MSG = 'No web password is set on the Pi yet. Set one there first.';

function requireLogin(message) {
  stopPolling();
  stopAllPlayback();
  clearAuth();
  $('app').style.display = 'none';
  $('setup-ip').value = PI_ADDR;
  $('setup-pw').value = '';
  $('setup-error').textContent = message || '';
  $('addr-group').style.display = PI_ADDR ? 'none' : 'block';
  $('btn-change-addr').style.display = PI_ADDR ? 'block' : 'none';
  $('setup-screen').style.display = 'flex';
}

function showAddressBox() {
  $('addr-group').style.display = 'block';
  $('btn-change-addr').style.display = 'none';
  $('setup-ip').value = PI_ADDR;
  $('setup-ip').focus();
}

async function login() {
  const askingAddr = $('addr-group').style.display !== 'none';
  const addr = askingAddr ? normalizeAddr($('setup-ip').value) : PI_ADDR;
  if (!addr) { showAddressBox(); $('setup-error').textContent = ADDR_HELP; return; }
  const pw = $('setup-pw').value;
  if (!pw) { $('setup-error').textContent = 'Enter the password.'; return; }
  const btn = $('btn-login');
  btn.disabled = true; btn.textContent = 'LOGGING IN…';
  $('setup-error').textContent = '';
  const ctl = window.AbortController ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 15000) : null;
  try {
    const r = await fetch(loginUrl(addr), {
      method: 'POST', cache: 'no-store', signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw })
    });
    let j = {};
    try { j = await r.json(); } catch (e) {}
    if (r.ok && j.token && j.streamKey && j.streams) {
      PI_ADDR = addr;
      storageSet('pisentinel_addr', PI_ADDR);
      saveAuth({ addr: addr, token: j.token, expires: j.expires, streamUser: j.streamUser,
                 streamKey: j.streamKey, streams: j.streams });
      $('setup-pw').value = '';
      launchApp();
      return;
    }
    $('setup-error').textContent =
      j.error === 'wrong-password' ? 'Wrong password.' :
      j.error === 'locked'         ? 'Too many wrong tries. Wait ' + Math.ceil((j.wait || 300) / 60) + ' min, then try again.' :
      j.error === 'no-password'    ? NO_PASSWORD_MSG : "Couldn't log in (error " + r.status + ').';
  } catch (e) {
    $('setup-error').textContent = "Can't reach the Pi. Is Tailscale on, and is the address right?";
  } finally {
    if (timer) clearTimeout(timer);
    btn.disabled = false; btn.textContent = 'LOG IN';
  }
}

function logout() { closeSettings(); requireLogin('Logged out.'); }

function resetApp() {
  ['pisentinel_addr', 'pisentinel_auth', 'stream_view', 'stream_tab_camera', 'stream_tab_audio',
   'streampi_seen_clips', 'streampi_clip_view', 'streampi_cam_muted',
   'pisentinel_v3', 'pisentinel_v2', 'pisentinel_config'].forEach(storageDel);
  location.reload();
}

// ── START ─────────────────────────────────────────────
window.addEventListener('load', () => {
  document.querySelectorAll('.app-version').forEach(e => { e.textContent = APP_VERSION; });
  PI_ADDR = normalizeAddr(storageGet('pisentinel_addr'));
  if (!PI_ADDR) {
    // Settings saved by older versions of this page: turn them into "name:port"
    ['pisentinel_v3', 'pisentinel_v2', 'pisentinel_config'].some(k => {
      try {
        const c = JSON.parse(storageGet(k) || 'null');
        if (c && (c.host || c.ip) && c.apiPort) PI_ADDR = normalizeAddr((c.host || c.ip) + ':' + c.apiPort);
      } catch (e) {}
      return !!PI_ADDR;
    });
    if (PI_ADDR) storageSet('pisentinel_addr', PI_ADDR);
  }
  ['pisentinel_v3', 'pisentinel_v2', 'pisentinel_config'].forEach(storageDel);
  VIEW = storageGet('stream_view') === 'audio' ? 'audio' : 'camera';
  seen = loadSeen();
  $('setup-pw').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('setup-ip').addEventListener('keydown', e => { if (e.key === 'Enter') $('setup-pw').focus(); });
  AUTH = PI_ADDR ? loadAuth() : null;
  if (AUTH) { launchApp(); return; }
  requireLogin('');
});

function launchApp() {
  $('setup-screen').style.display = 'none';
  $('app').style.display = 'block';
  if (!appStarted) {
    appStarted = true;
    initWaveform();
    initGraph();
    initAudioPlayer();
    initClipPlayer();
    initCamLive();
    initTimeline();
    setListenButton();
    document.addEventListener('visibilitychange', () => {
      if (!AUTH) return;
      if (document.hidden) { stopPolling(); return; }
      startPolling();
      // graphs aren't drawn while the page is hidden: catch up now
      if (shown('audio', 'rec')) drawGraph();
      if (shown('audio', 'live')) updateLiveLevel();
    });
  }
  connState = 'connecting'; liveNow = { cam: false, audio: false };
  startPolling();
  setView(VIEW);
}

// ── VIEW (Camera / Audio) + TABS (Live / Recordings / Saved) ──
function setView(v) {
  VIEW = v === 'audio' ? 'audio' : 'camera';
  storageSet('stream_view', VIEW);
  $('view-select').value = VIEW;
  $('view-ico').innerHTML = ICON[VIEW === 'audio' ? 'mic' : 'cam'];
  stopAllPlayback();
  const t = storageGet('stream_tab_' + VIEW);
  setTab(t === 'rec' || t === 'saved' ? t : 'live');
}

function setTab(t) {
  TAB = t;
  storageSet('stream_tab_' + VIEW, t);
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  $('p-' + VIEW + '-' + t).classList.add('active');
  window.scrollTo(0, 0);
  if (VIEW === 'camera' && t === 'rec') { renderClips(); loadClips(); }
  if (VIEW === 'camera' && t === 'live') loadClips();          // for "N new clips"
  updateClipBadges();
  if (VIEW === 'audio' && t === 'rec') openAudioRecordings();
  if (VIEW === 'audio' && t === 'live') { updateLiveLevel(); fetchLiveLevels(); }
  if (t === 'saved') { renderSaved(); loadSaved(); renderKeptLists(); }
  if (AUTH) updateStatus();
}

function shown(view, tab) { return VIEW === view && TAB === tab && !document.hidden; }

// ── POLLING ───────────────────────────────────────────
// Only what the screen being looked at needs, so the Pi stays quiet
function startPolling() {
  stopPolling();
  fetchStatus();
  timers = [
    setInterval(fetchStatus, 15000),                // which live streams are on; still logged in?
    setInterval(() => { if (shown('audio', 'live') && !meter.timer) fetchLiveLevels(); }, 3000),
    // (the clip list is also checked on the camera's Live tab, for the "new clips" count)
    setInterval(() => { if (shown('audio', 'rec')) loadFiles(); if (shown('camera', 'rec') || shown('camera', 'live')) loadClips(); }, 60000),
    // Today's recordings follow "now": only the new sound readings every 5 s (a few hundred
    // bytes; they also move the newest recording's end along), and the clip list every 15 s
    setInterval(() => { if (shown('audio', 'rec') && audDay === dayStart(nowSec())) refreshDayData(); }, 5000),
    setInterval(() => { if (shown('camera', 'rec') && clipDay === dayStart(nowSec())) loadClips(); }, 15000),
  ];
}
function stopPolling() { timers.forEach(clearInterval); timers = []; }

// Runs at most one request of each kind at a time
async function once(key, fn) {
  if (busy[key] || !AUTH) return;
  busy[key] = true;
  try { await fn(); } finally { busy[key] = false; }
}

function handleAuthError(e) {
  if (!isAuthError(e)) return false;
  requireLogin(e.code === 'no-password' ? NO_PASSWORD_MSG : 'Please log in again.');
  return true;
}

// One light question to the Pi: is it reachable, still logged in, which live streams are on
let liveNow = { cam: false, audio: false };
let liveSince = { cam: null, audio: null };   // since when each live stream has been on (the Pi's hub knows)
// What the Pi menu allows this page to switch (null = a Pi without this feature):
// { mode: camera|audio|web|off, running: camera|audio|off, webOff, since }
let POWER = null;
// The Pi's low-space guard (null = a Pi without it): { free_gb, limit_gb, low, stuck, last: { time, count, mb } | null }
let SPACE = null;
function fetchStatus() {
  return once('status', async () => {
    try {
      const s = await api('/status');
      if (s && s.live) liveNow = s.live;
      liveSince = s && s.liveSince ? s.liveSince : { cam: null, audio: null };
      SPACE = s && s.space ? Object.assign({ free_gb: s.disk ? s.disk.free_gb : null }, s.space) : null;
      POWER = s && s.power && typeof s.power.mode === 'string' ? s.power : null;
      if (s && Array.isArray(s.kept)) setKeptDays(s.kept);
      connState = 'ok';
    } catch (e) {
      if (handleAuthError(e)) return;
      connState = 'offline';
    }
    if (AUTH) updateStatus();
  });
}

// Live tab, while not listening: just the new lines of today's sound-level file
function fetchLiveLevels() {
  return once('livelevels', async () => {
    try {
      await fetchLevels(dayStart(nowSec()));
      if (shown('audio', 'live')) updateLiveLevel();
    } catch (e) { handleAuthError(e); }
  });
}

function latestPiLevel() {
  const st = levelStore[dayKey(dayStart(nowSec()))];
  return st && st.ts.length ? { t: st.ts[st.ts.length - 1], l: st.lv[st.lv.length - 1] } : null;
}
function hasFreshLevel() { const p = latestPiLevel(); return !!p && nowSec() - p.t < FRESH_SECS; }

// Header badge (green LIVE, amber OFF = the Pi answers but this one is switched off,
// red OFFLINE = the Pi doesn't answer) and the on / off card on the Live tab
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function fmtWhen(ts) { return dayStart(ts) === dayStart(nowSec()) ? fmtHM(ts) : fmtDate(ts) + ' ' + fmtHM(ts); }
let powerBusy = false;                  // a switch is on its way to the Pi
let starting = null, startTimer = null; // a server that was just turned on: { server, until }

function updateStatus() {
  const view = VIEW === 'audio' ? 'audio' : 'camera', other = view === 'audio' ? 'camera' : 'audio';
  const on = view === 'audio' ? liveNow.audio : liveNow.cam;
  const state = connState === 'offline' ? 'offline' : connState === 'connecting' ? 'connecting' : on ? 'live' : 'off';
  $('live-badge').className = 'live-badge ' + state;
  $('live-status').textContent = state === 'connecting' ? '…' : state.toUpperCase();
  const name = cap(view), P = connState === 'ok' ? POWER : null;
  const since = view === 'audio' ? liveSince.audio : liveSince.cam;      // on since when
  // short, so the line fits a phone: "14:05" today, "Sat 14:05" in the last days, "10 Oct" before that
  const short = ts => { const d = new Date(ts * 1000), age = dayStart(nowSec()) - dayStart(ts);
    return age <= 0 ? fmtHM(ts) : age < 6 * 86400 ? d.toLocaleDateString([], { weekday: 'short' }) + ' ' + fmtHM(ts)
                                                 : d.toLocaleDateString([], { day: 'numeric', month: 'short' }); };
  // The slim on / off line: a few words (the first ones bold), and at most one small button.
  // What turning off means is explained in the confirm box and behind the (i).
  let main = 'Checking…', rest = '', cls = state === 'live' ? 'on' : state, act = null;
  if (state === 'offline') { main = "Can't reach the Pi"; rest = 'is Tailscale on?'; }
  else if (state === 'connecting') { /* Checking… */ }
  else if (!P) {                        // a Pi without on/off from the web page
    main = name + (on ? ' on' : ' off');
    rest = on ? (since ? 'since ' + short(since) : '') : 'switch it on in the Pi menu';
  } else if (P.running === view) {
    if (on) { main = name + ' on'; rest = since ? 'since ' + short(since) : ''; act = { icon: 'lock', text: 'Turn off', to: 'off' }; }
    else { main = name + ' starting…'; cls = 'starting'; }
  } else if (P.webOff && P.mode === view) {
    main = name + ' off'; rest = 'from web ' + short(P.since); act = { icon: 'power', text: 'Turn on', to: view };
  } else if (P.mode === 'web' && P.running === 'off') {
    main = 'Nothing is on'; act = { icon: 'power', text: 'Turn ' + view + ' on', to: view };
  } else if (P.mode === 'web' && P.running === other) {
    main = name + ' off'; rest = other + ' is on'; act = { icon: 'swap', text: 'Switch', to: view };
  } else if (P.mode === other) {
    main = name + ' off'; rest = other + ' chosen in the Pi menu';
  } else {
    main = name + ' off'; rest = 'off in the Pi menu';
  }
  const line = $((view === 'audio' ? 'aud' : 'cam') + '-status');
  line.className = 'status-line ' + cls;
  const tx = line.querySelector('.st-text');
  tx.textContent = '';
  tx.appendChild(el('b', null, main));
  if (rest) tx.appendChild(el('span', null, ' · ' + rest));
  const ab = line.querySelector('.st-act');
  if (act) { setIconText(ab, act.icon, '', act.text); ab.disabled = powerBusy; ab.onclick = () => powerTo(act.to); ab.style.display = ''; }
  else ab.style.display = 'none';
  // Other tabs: one short line for a lost connection, or when it was switched off from here
  let hint = '', hcls = 'hint offline';
  if (connState === 'offline' && TAB !== 'live') hint = "Can't reach the Pi. Is Tailscale on?";
  else if (TAB !== 'live' && P && P.webOff && P.mode === view) { hint = name + ' off since ' + fmtWhen(P.since) + ' · turn it on in Live'; hcls = 'hint'; }
  const h = $('conn-hint');
  h.textContent = hint; h.className = hcls; h.style.display = hint ? 'block' : 'none';
  // Low space on the Pi (its guard deletes the oldest recordings below the limit)
  const low = connState === 'ok' && SPACE && SPACE.low, sh = $('space-hint');
  sh.textContent = !low ? '' : 'Space on the Pi is low (' + SPACE.free_gb + ' GB free). ' +
    (SPACE.stuck ? 'Nothing more can be deleted automatically: kept days, Saved items and the last 24 hours are protected. Free up space on the Pi.'
                 : 'The oldest recordings are being deleted to make room.');
  sh.style.display = low ? 'block' : 'none';
  // Watch / Listen can't work while that server is known to be off
  const camOff = !!P && P.running !== 'camera', audOff = !!P && P.running !== 'audio';
  $('btn-cam-live').disabled = !camLive && camOff;
  $('btn-play-stream').disabled = !streamAudio && audOff;
  if (!camLive) $('cam-placeholder').textContent = state === 'offline' ? "Can't reach the Pi"
    : (P ? camOff : state === 'off') ? 'No live picture while the camera is off'
    : !on ? 'The camera is starting…' : 'Tap Watch live below';
}

// Turn a server on / off, or switch, as far as the Pi menu allows (the Pi checks it again).
// Anything that stops a running server needs the web password.
async function powerTo(server) {
  if (!POWER || powerBusy) return;
  const cur = POWER.running;
  let pw = '';
  if (cur !== 'off') {
    const stops = cur === 'audio' ? 'no live sound, no recording' : 'no live picture, no recording, no motion detection';
    const title = server === 'off' ? 'Turn the ' + cur + ' off?' : 'Switch to ' + server + '?';
    const text = (server === 'off'
      ? 'While it is off: ' + stops + '.' + (POWER.mode === 'web' ? '' : ' It stays off, also after a Pi restart, until you turn it back on here or in the Pi menu.')
      : 'The ' + cur + ' stops (' + stops + ') and the ' + server + ' starts.') + '\n\nConfirm with your web password.';
    pw = await dialog(title, text, server === 'off' ? 'Turn off' : 'Switch', 'Web password', 'password');
    if (pw == null) return;
  }
  powerBusy = true; updateStatus();
  try {
    const r = await api('/power', { server: server, password: pw }, 60000);
    if (r.power) POWER = r.power;
    if (r.live) liveNow = r.live;
    if (cur === 'camera' && server !== 'camera') stopCamLive();
    if (cur === 'audio' && server !== 'audio') stopStream();
    if (server === 'off') toast(cap(cur) + ' is off.');
    else { toast('Turning the ' + server + ' on. It takes a few seconds.'); watchStarting(server); }
  } catch (e) {
    if (!handleAuthError(e)) toast(passwordError(e) ||
      (e.code === 'no-camera' ? "The Pi can't find the camera. Check its cable (power the Pi off first)."
       : e.code === 'not-allowed' ? "The Pi menu doesn't allow that right now." : "Couldn't switch it. Try again."), true);
  } finally {
    powerBusy = false;
    updateStatus();
    fetchStatus();
  }
}
// After turning a server on: ask every 2 s until it is live (at most 45 s)
function watchStarting(server) {
  starting = { server: server, until: Date.now() + 45000 };
  clearInterval(startTimer);
  startTimer = setInterval(() => {
    const on = server === 'audio' ? liveNow.audio : liveNow.cam;
    if (on || Date.now() > starting.until) {
      clearInterval(startTimer); startTimer = null; starting = null;
      if (on) toast(cap(server) + ' is on.');
      else toast(cap(server) + " hasn't come on yet. If it stays off, check the Pi menu.", true);
      updateStatus();
      return;
    }
    fetchStatus();
  }, 2000);
}

// ── PLAYBACK HOUSEKEEPING ─────────────────────────────
function stopAllPlayback(except) {
  if (except !== 'live') stopStream();
  if (except !== 'cam') stopCamLive();
  if (except !== 'aud' && aPlayer) aPlayer.pause();
  if (except !== 'clip') $('clip-video').pause();
  if (except !== 'saved') { $('saved-audio').pause(); $('saved-video').pause(); }
}

// Live streams check the stream key from the login on every request.
// Uses hls.js where possible (it can send the key; that includes iPhones on iOS 17.1+).
function attachHls(media, url, onFail, lowLatency) {
  const user = AUTH ? AUTH.streamUser : '', key = AUTH ? AUTH.streamKey : '';
  if (!url) { onFail(0); return null; }
  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls(Object.assign({
      backBufferLength: 10,
      xhrSetup: xhr => xhr.setRequestHeader('Authorization', 'Basic ' + btoa(user + ':' + key))
    }, lowLatency
      // Camera: tiny 0.27-s pieces, start 1.5 s behind the newest picture; more than 6 s behind
      // (e.g. after the page was in the background) -> jump straight back to now.
      ? { lowLatencyMode: true, liveSyncDuration: 1.5, liveMaxLatencyDuration: 6 }
      // Sound: whole 2-s pieces. Low-latency mode stuttered with the sound-only stream (tiny gaps
      // in the first half-minute that each added delay); this plays smoothly about 3 s behind.
      // More than 8 s behind -> jump straight back to now.
      : { lowLatencyMode: false, liveSyncDuration: 3, liveMaxLatencyDuration: 8 }));
    let netRetries = 0, mediaRecovered = false, failed = false;
    hls.on(Hls.Events.ERROR, (e, d) => {
      if (!d.fatal || failed) return;
      const status = d.response && d.response.code;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR && d.details !== Hls.ErrorDetails.MANIFEST_LOAD_ERROR && netRetries++ < 3) {
        setTimeout(() => { try { hls.startLoad(); } catch (err) {} }, 2000);
        return;
      }
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovered) { mediaRecovered = true; hls.recoverMediaError(); return; }
      failed = true;
      onFail(status || 0);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => { if (media.paused) playSafe(media); });
    media.disableRemotePlayback = true;   // needed by iPhones' streaming engine
    hls.loadSource(url);
    hls.attachMedia(media);
    return hls;
  }
  if (media.canPlayType('application/vnd.apple.mpegurl')) {
    const u = new URL(url);              // older iPhones: built-in player, key in the address
    u.username = user; u.password = key;
    media.addEventListener('error', () => onFail(0), { once: true });
    media.src = u.toString();
    return null;
  }
  onFail(-1);
  return null;
}

// While a live stream plays, it shows how far behind the Pi it is (from the stream's own clock):
// on the picture for the camera, under the sound level for audio. The built-in iPhone player
// can't tell, so then it just says LIVE.
let delayTimer = null;
function showLiveDelay() {
  const behind = (h, media, hi, lo) => {
    const pd = h && h.playingDate;
    if (!pd) return null;
    const b = (Date.now() - pd.getTime()) / 1000;
    steerLive(media, b, hi, lo);
    return Math.max(0, Math.round(b));
  };
  if (camLive) {
    const b = behind(camHls, $('cam-video'), 2.5, 1.8);
    $('cam-label').textContent = b == null ? 'LIVE' : 'LIVE · ' + b + ' s behind';
  }
  if (streamAudio) {
    const b = behind(hlsInstance, streamAudio, 4, 3.2);
    $('aud-live-note').textContent = b == null ? '' : ($('level-src').textContent ? ' · ' : '') + 'about ' + b + ' s behind';
  }
}
// Live slowly drifts behind (hiccups add up, and the live sound measured ~0.6 s a minute), so:
// more than `hi` seconds behind -> play 5% faster (10% if 2 s more) until back under `lo`, as
// long as there is something waiting to catch up on. Pitch is kept; it isn't noticeable.
function steerLive(media, behind, hi, lo) {
  const b = media.buffered, ahead = b.length ? b.end(b.length - 1) - media.currentTime : 0;
  if (behind > hi && ahead > 0.5) media.playbackRate = behind > hi + 2 ? 1.1 : 1.05;
  else if (behind < lo || ahead < 0.3) media.playbackRate = 1;
}
function updateLiveDelay() {
  const on = camLive || !!streamAudio;
  if (on && !delayTimer) delayTimer = setInterval(showLiveDelay, 1000);
  if (!on && delayTimer) { clearInterval(delayTimer); delayTimer = null; }
  if (!camLive) $('cam-label').textContent = 'LIVE';
  if (!streamAudio) $('aud-live-note').textContent = '';
  if (on) showLiveDelay();
}

// ── AUDIO · LIVE ──────────────────────────────────────
let hlsInstance = null, streamAudio = null;

function updateLiveLevel() {
  const num = $('level-num');
  let lv = null, from = '';
  if (meter.timer && meter.level != null) {
    lv = meter.level; from = 'Measured on this phone while you listen';
  } else if (hasFreshLevel()) {
    const raw = rawLevels(dayStart(nowSec()));
    lv = raw.lv[raw.lv.length - 1]; from = 'From the Pi, every 2 seconds';
    waveHistory = raw.lv.slice(-200);
    while (waveHistory.length < 200) waveHistory.unshift(0);
  }
  const bar = $('level-bar');
  if (lv == null) {
    num.textContent = '—'; num.style.color = 'var(--text-dim)'; bar.style.width = '0%';
    $('level-word').textContent = '';
  } else {
    const c = lv > 70 ? 'var(--danger)' : lv > 40 ? 'var(--warn)' : 'var(--accent)';
    num.textContent = lv; num.style.color = c;
    bar.style.width = lv + '%'; bar.style.background = c;
    $('level-word').textContent = lv > 70 ? 'loud' : lv > 40 ? 'some sound' : 'quiet';
  }
  $('level-src').textContent = from;
  drawWaveform();
}

// While listening, this phone measures the level of what it's playing (the Pi does nothing extra).
// Works when the live sound comes through hls.js; the built-in iPhone player can't be measured,
// so then the Pi's readings are shown instead.
function startPhoneMeter(media) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !hlsInstance) return;
  try {
    meter.ctx = meter.ctx || new Ctx();
    if (meter.ctx.resume) meter.ctx.resume();
    const an = meter.ctx.createAnalyser();
    an.fftSize = 2048;
    const src = meter.ctx.createMediaElementSource(media);
    src.connect(an); an.connect(meter.ctx.destination);
    const buf = new Float32Array(an.fftSize);
    meter.peak = 0; meter.ticks = 0; meter.level = null;
    meter.timer = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > meter.peak) meter.peak = v; }
      if (++meter.ticks < 5) return;              // every 0.5 s: the loudest of the last 5 looks
      const db = 20 * Math.log10(meter.peak || 1e-6);
      meter.level = Math.max(0, Math.min(100, Math.round((db + 60) / 60 * 100)));   // same scale as the Pi
      meter.peak = 0; meter.ticks = 0;
      waveHistory.push(meter.level); waveHistory.shift();
      if (shown('audio', 'live')) updateLiveLevel();
    }, 100);
  } catch (e) { stopPhoneMeter(); }
}
function stopPhoneMeter() { clearInterval(meter.timer); meter.timer = null; meter.level = null; }

function initWaveform() {
  const c = $('waveform-canvas');
  const fit = () => { if (c.offsetWidth) { c.width = c.offsetWidth; drawWaveform(); } };
  if (window.ResizeObserver) new ResizeObserver(fit).observe(c); else window.addEventListener('resize', fit);
  fit();
}

function drawWaveform() {
  const c = $('waveform-canvas'), ctx = c.getContext('2d'), w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  const bw = Math.max(2, w / waveHistory.length - 1);
  waveHistory.forEach((v, i) => {
    const bh = Math.max(2, (v / 100) * h * .85);
    ctx.fillStyle = levelColor(v, .35 + (i / waveHistory.length) * .65);
    ctx.fillRect(i * (bw + 1), h - bh, bw, bh);
  });
}

const LIVE_ERR = "Live sound isn't available. Is Audio mode on, on the Pi?";
function stopStream() {
  if (hlsInstance) { try { hlsInstance.destroy(); } catch (e) {} hlsInstance = null; }
  if (streamAudio) { streamAudio.pause(); streamAudio.removeAttribute('src'); streamAudio.load(); streamAudio = null; }
  stopPhoneMeter();
  setListenButton();
  updateLiveDelay();
  if (shown('audio', 'live')) { updateLiveLevel(); fetchLiveLevels(); }
}
function setListenButton() {
  const b = $('btn-play-stream');
  if (streamAudio) setIconText(b, 'stop', '', 'Stop listening'); else setIconText(b, 'play', 'fill', 'Listen live');
}
function toggleStream() {
  if (streamAudio) { stopStream(); return; }
  stopAllPlayback('live');
  const audio = new Audio();
  streamAudio = audio;
  setListenButton();
  hlsInstance = attachHls(audio, AUTH && AUTH.streams.audio, status => {
    if (streamAudio !== audio) return;
    stopStream();
    toast(status === 401 ? 'Live sound refused the login. Log out and in again.' :
          status === -1 ? "This browser can't play live sound." : LIVE_ERR, true);
  });
  if (streamAudio) { playSafe(audio); startPhoneMeter(audio); }   // inside the tap, so phones allow it
  updateLiveDelay();
}

// ── CAMERA · LIVE ─────────────────────────────────────
let camHls = null, camLive = false;
const CAM_ERR = "Live camera isn't available. Is Camera mode on, on the Pi?";
function setCamLiveView() {
  $('cam-placeholder').style.display = camLive ? 'none' : 'flex';
  $('cam-label').style.display = camLive ? 'flex' : 'none';
  $('cam-card').classList.toggle('playing', camLive);
  const b = $('btn-cam-live');
  if (camLive) setIconText(b, 'stop', '', 'Stop watching'); else setIconText(b, 'play', 'fill', 'Watch live');
  if (!camLive) { exitFullScreen(); resetZoom(); }
}

// Everything below happens on this phone only: the Pi does no extra work for zoom or photos.
function initCamLive() {
  setCamMuted(storageGet('streampi_cam_muted') === '1');
  $('btn-cam-fs').innerHTML = svg('fs');
  setCamLiveView();
  initCamZoom();
  const exitIfLeft = () => { if (camFs && !(document.fullscreenElement || document.webkitFullscreenElement)) exitFullScreen(); };
  document.addEventListener('fullscreenchange', exitIfLeft);
  document.addEventListener('webkitfullscreenchange', exitIfLeft);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && camFs) exitFullScreen(); });
  window.addEventListener('resize', () => applyZoom());
}

function setCamMuted(m) {
  $('cam-video').muted = m;
  storageSet('streampi_cam_muted', m ? '1' : '');
  const b = $('btn-cam-sound');
  b.innerHTML = svg(m ? 'soundOff' : 'soundOn');
  b.setAttribute('aria-label', m ? 'Sound is off. Tap to switch it on' : 'Sound is on. Tap to switch it off');
}
function toggleCamSound() { setCamMuted(!$('cam-video').muted); }

// A photo of the live picture, saved on this phone (share sheet -> Save Image), or downloaded on a computer.
// Done in one go inside the tap, because phones only allow sharing straight after a tap.
function snapshot() {
  const v = $('cam-video');
  if (!camLive || !v.videoWidth) { toast('Wait until the picture shows, then try again.'); return; }
  let blob;
  try {
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const bin = atob(c.toDataURL('image/jpeg', 0.92).split(',')[1]), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    blob = new Blob([bytes], { type: 'image/jpeg' });
  } catch (e) {
    toast("This browser's player doesn't allow a photo of the live picture.", true);
    return;
  }
  const f = $('cam-flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  const d = new Date();
  const name = 'streampi-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
               pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.jpg';
  let file = null;
  try { file = new File([blob], name, { type: 'image/jpeg' }); } catch (e) {}
  const phone = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  if (phone && file && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch(err => { if (!err || err.name !== 'AbortError') downloadBlob(blob, name); });
    return;
  }
  downloadBlob(blob, name);
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('Photo saved: ' + name);
}

// Full screen: the picture fills the screen (on iPhone the page does this itself; elsewhere the
// browser's own full screen is asked for too)
let camFs = false;
function toggleFullScreen() { if (camFs) exitFullScreen(); else enterFullScreen(); }
function enterFullScreen() {
  const card = $('cam-card');
  camFs = true;
  card.classList.add('fs'); document.body.classList.add('fs-open');
  $('btn-cam-fs').innerHTML = svg('fsExit'); $('btn-cam-fs').setAttribute('aria-label', 'Leave full screen');
  resetZoom();
  try {
    const p = card.requestFullscreen ? card.requestFullscreen() : card.webkitRequestFullscreen ? card.webkitRequestFullscreen() : null;
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}
function exitFullScreen() {
  if (!camFs) return;
  camFs = false;
  $('cam-card').classList.remove('fs'); document.body.classList.remove('fs-open');
  $('btn-cam-fs').innerHTML = svg('fs'); $('btn-cam-fs').setAttribute('aria-label', 'Full screen');
  resetZoom();
  try {
    if (document.fullscreenElement && document.exitFullscreen) { const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {}); }
    else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch (e) {}
}

// Pinch to zoom (up to 5x), drag to look around, double-tap to zoom in or back out.
// Positions are measured from the middle of the picture.
const zoom = { s: 1, x: 0, y: 0 };
function applyZoom() {
  const card = $('cam-card'), w = card.clientWidth, h = card.clientHeight;
  zoom.s = Math.min(5, Math.max(1, zoom.s));
  if (zoom.s < 1.02) { zoom.s = 1; zoom.x = 0; zoom.y = 0; }
  const mx = (zoom.s - 1) * w / 2, my = (zoom.s - 1) * h / 2;      // don't let the picture's edge come inside
  zoom.x = Math.min(mx, Math.max(-mx, zoom.x));
  zoom.y = Math.min(my, Math.max(-my, zoom.y));
  $('cam-video').style.transform = zoom.s === 1 ? '' : 'translate(' + zoom.x + 'px,' + zoom.y + 'px) scale(' + zoom.s + ')';
  card.classList.toggle('zoomed', zoom.s > 1);
  $('zoom-tag').textContent = zoom.s.toFixed(1) + '× · tap for 1×';
}
function resetZoom() { zoom.s = 1; zoom.x = 0; zoom.y = 0; applyZoom(); }
// Zoom by `f`, keeping the point (px, py) of the picture under the fingers where it is
function zoomAt(f, px, py) {
  const s2 = Math.min(5, Math.max(1, zoom.s * f)), k = s2 / zoom.s;
  zoom.x = px - (px - zoom.x) * k; zoom.y = py - (py - zoom.y) * k; zoom.s = s2;
  applyZoom();
}
function initCamZoom() {
  const card = $('cam-card'), ptrs = new Map();
  let moved = false, downAt = 0, start = null, lastTap = 0;
  const at = e => { const r = card.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };
  const skip = e => !camLive || (e.target.closest && e.target.closest('.vbtns, .zoom-tag'));
  card.addEventListener('pointerdown', e => {
    if (skip(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = at(e);
    ptrs.set(e.pointerId, p);
    try { card.setPointerCapture(e.pointerId); } catch (err) {}
    if (ptrs.size === 1) { moved = false; downAt = Date.now(); start = p; } else moved = true;
  });
  card.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const old = Array.from(ptrs.values()), p = at(e);
    ptrs.set(e.pointerId, p);
    const now = Array.from(ptrs.values());
    if (now.length >= 2) {
      const d0 = Math.hypot(old[0][0] - old[1][0], old[0][1] - old[1][1]);
      const d1 = Math.hypot(now[0][0] - now[1][0], now[0][1] - now[1][1]);
      const m0 = [(old[0][0] + old[1][0]) / 2, (old[0][1] + old[1][1]) / 2];
      const m1 = [(now[0][0] + now[1][0]) / 2, (now[0][1] + now[1][1]) / 2];
      zoom.x += m1[0] - m0[0]; zoom.y += m1[1] - m0[1];
      if (d0 > 0) zoomAt(d1 / d0, m1[0], m1[1]); else applyZoom();
    } else {
      if (start && Math.hypot(p[0] - start[0], p[1] - start[1]) > 8) moved = true;
      if (zoom.s > 1) { zoom.x += p[0] - old[0][0]; zoom.y += p[1] - old[0][1]; applyZoom(); }
    }
  });
  const end = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (e.type !== 'pointerup' || ptrs.size || moved || Date.now() - downAt > 350) return;
    // a tap: resume a paused picture; a second tap straight after zooms in (or back out)
    const v = $('cam-video');
    if (v.paused) { playSafe(v); return; }
    if (Date.now() - lastTap < 350) {
      lastTap = 0;
      if (zoom.s > 1) resetZoom(); else { const p = at(e); zoomAt(2.5, p[0], p[1]); }
    } else lastTap = Date.now();
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  // stop the page itself from zooming or scrolling while two fingers are on the picture
  card.addEventListener('touchmove', e => { if (camLive && (e.touches.length > 1 || zoom.s > 1)) e.preventDefault(); }, { passive: false });
  card.addEventListener('gesturestart', e => { if (camLive) e.preventDefault(); });
  card.addEventListener('wheel', e => {
    if (!camLive) return;
    e.preventDefault();
    const p = at(e);
    zoomAt(Math.exp(-e.deltaY * 0.0015), p[0], p[1]);
  }, { passive: false });
}
function stopCamLive() {
  if (camHls) { try { camHls.destroy(); } catch (e) {} camHls = null; }
  const v = $('cam-video');
  v.pause(); v.removeAttribute('src'); v.load();
  camLive = false; setCamLiveView();
  updateLiveDelay();
}
function toggleCamLive() {
  if (camLive) { stopCamLive(); return; }
  stopAllPlayback('cam');
  const v = $('cam-video');
  camLive = true; setCamLiveView();
  camHls = attachHls(v, AUTH && AUTH.streams.cam, status => {
    if (!camLive) return;
    stopCamLive();
    if (status === 404) { liveNow.cam = false; updateStatus(); }
    toast(status === 401 ? 'The camera refused the login. Log out and in again.' :
          status === -1 ? "This browser can't play the live camera." : CAM_ERR, true);
  }, true);                                        // low-latency mode for the camera
  if (camLive) playSafe(v);
  updateLiveDelay();
}

// ── FILE LISTS ────────────────────────────────────────
function loadFiles() {
  return once('files', async () => {
    try {
      const data = await api('/files');
      audFiles = (Array.isArray(data) ? data : []).filter(f => f && AUDIO_RE.test(f.name) &&
        typeof f.start === 'number' && typeof f.end === 'number' && f.end > f.start);
      if (shown('audio', 'rec')) { renderDays(); renderDayList(); drawGraph(); }
    } catch (e) { handleAuthError(e); }
  });
}

function loadClips() {
  return once('clips', async () => {
    try {
      const data = await api('/clips');
      clipList = (Array.isArray(data) ? data : []).filter(c => c && CLIP_RE.test(c.name) &&
        typeof c.start === 'number' && typeof c.end === 'number');
      clipsLoaded = true;
      updateSeen();
      updateClipBadges();
      if (shown('camera', 'rec')) renderClips();
    } catch (e) {
      if (handleAuthError(e)) return;
      if (!clipList.length && shown('camera', 'rec')) {
        const l = $('clips-list'); l.textContent = ''; l.appendChild(el('div', 'empty', "Can't reach the Pi right now."));
      }
    }
  });
}

// hasNew(day): optional, puts a small dot on days with clips not watched yet
function renderChips(id, days, current, onPick, hasNew) {
  const box = $(id); box.textContent = '';
  days.forEach(d => {
    const c = el('button', 'chip' + (d === current ? ' active' : ''), (isKept(d) ? '★ ' : '') + dayLabel(d));
    if (hasNew && hasNew(d)) c.appendChild(el('span', 'ndot'));
    c.onclick = () => onPick(d);
    box.appendChild(c);
  });
}

// ── AUDIO · RECORDINGS: day graph + precise player ────
// Everything works in real clock time; the player finds which hourly file holds a moment.
let audDay = null;                              // start of the chosen day (unix seconds)
let dayData = { ds: null, ts: [], lv: [] };     // the day's sound levels in 10-second steps
let loudCache = null;
let winStart = 0, winSpan = 86400;              // the part of the day the graph shows
let aPlayer = null, aFile = null, scrubbing = false;
let mark = { start: null, end: null };

async function openAudioRecordings() {
  await loadFiles();
  if (audDay == null) selectDay(dayStart(nowSec()));
  else { renderDays(); renderDayList(); drawGraph(); refreshDayData(); }
}

function fileAt(ts) {
  let best = null;
  audFiles.forEach(f => { if (f.start <= ts && ts < f.end && (!best || f.start > best.start)) best = f; });
  return best;
}
// Current position in clock time. Right after a jump the recording may still be loading
// (its own position isn't valid yet), so the moment that was asked for is used until it is.
let pendingPos = null;
function absPos() {
  if (!aFile) return null;
  return pendingPos != null ? pendingPos : aFile.start + (aPlayer.currentTime || 0);
}

function renderDays() {
  const days = new Set([dayStart(nowSec())]);
  audFiles.forEach(f => { for (let d = dayStart(f.start); d < f.end; d = nextDay(d)) days.add(d); });
  if (audDay != null) days.add(audDay);
  renderChips('aud-days', Array.from(days).sort((a, b) => b - a), audDay, selectDay);
  renderKeep('aud-keep', audDay);
}

function selectDay(ds) {
  audDay = ds;
  winSpan = 86400; winStart = ds;
  dayData = { ds: ds, ts: [], lv: [] }; loudCache = null;
  renderDays(); renderDayList(); setZoomButtons(); drawGraph();
  refreshDayData();
}

// ── SOUND LEVELS ──────────────────────────────────────
// The Pi hands over each day's file exactly as stored (a reading every 2 s), and after the
// first time only the new part. All the working out - graph, zoom, loud moments - is done here.
const levelStore = {};            // 'YYYYMMDD' -> { offset, ts: [...], lv: [...] }

function dayKey(ds) { const d = new Date(ds * 1000); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); }
function rawLevels(ds) { return levelStore[dayKey(ds)] || { ts: [], lv: [] }; }

async function fetchLevels(ds) {
  const key = dayKey(ds);
  let st = levelStore[key];
  if (!st) {
    st = levelStore[key] = { offset: 0, ts: [], lv: [] };
    const others = Object.keys(levelStore).filter(k => k !== key).sort();
    while (others.length > 3) delete levelStore[others.shift()];   // keep a few days in memory
  }
  const headers = { Authorization: 'Bearer ' + AUTH.token };
  if (st.offset) headers.Range = 'bytes=' + st.offset + '-';
  const ctl = window.AbortController ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
  let r;
  try { r = await fetch(apiUrl('/levels/' + key), { cache: 'no-store', headers: headers, signal: ctl ? ctl.signal : undefined }); }
  finally { if (timer) clearTimeout(timer); }
  if (r.status === 204 || r.status === 416 || r.status === 404) return st;   // nothing new yet / no readings that day
  if (!r.ok) {
    let code = '';
    try { code = (await r.json()).error || ''; } catch (e) {}
    throw new ApiError(r.status, code);
  }
  if (r.status === 200 && st.offset) { st.offset = 0; st.ts = []; st.lv = []; }   // whole file came back
  const text = await r.text();
  const end = text.lastIndexOf('\n') + 1;   // whole lines only; a half-written last line comes next time
  st.offset += end;                         // plain text: characters = bytes
  let last = st.ts.length ? st.ts[st.ts.length - 1] : 0;
  text.slice(0, end).split('\n').forEach(line => {
    let t, l;
    if (line.charAt(0) === '{') { try { const d = JSON.parse(line); t = d.t; l = d.l; } catch (e) { return; } }
    else { const p = line.split(','); t = +p[0]; l = +p[1]; }   // "time,level"
    if (t > last && l >= 0 && l <= 100) { st.ts.push(t); st.lv.push(l); last = t; }
  });
  return st;
}

// The day overview: loudest reading in each 10 seconds
function bucketize(st, ds, step) {
  const out = { ds: ds, ts: [], lv: [] };
  for (let i = 0; i < st.ts.length; i++) {
    const b = st.ts[i] - st.ts[i] % step, n = out.ts.length;
    if (n && out.ts[n - 1] === b) { if (st.lv[i] > out.lv[n - 1]) out.lv[n - 1] = st.lv[i]; }
    else { out.ts.push(b); out.lv.push(st.lv[i]); }
  }
  return out;
}

function refreshDayData() {
  return once('day', async () => {
    const ds = audDay;
    if (ds == null) return;
    try {
      const st = await fetchLevels(ds);
      if (audDay !== ds) return;
      if (ds === dayStart(nowSec())) followLiveRecording(st);
      dayData = bucketize(st, ds, 10);
      loudCache = null;
      drawGraph(); renderDayList();
    } catch (e) { handleAuthError(e); }
  });
}

// Today's newest recording is still being written (the Pi adds to it every 2 s). The sound
// readings arrive every 5 s anyway, so they move its end along with the clock; the list of
// files is only fetched again when a new hourly file must have started.
function followLiveRecording(st) {
  if (!st.ts.length || !audFiles.length) return;
  const heard = st.ts[st.ts.length - 1] + 2;                  // a reading covers the 2 s after it
  const newest = audFiles.reduce((a, f) => (f.start > a.start ? f : a));
  const gap = heard - newest.end;
  if (gap <= 0) return;
  const hourEnd = (Math.floor(newest.start / 3600) + 1) * 3600;
  if (gap > 30 || heard > hourEnd) loadFiles();               // a newer file exists (or the list is old)
  else newest.end = heard;
}

// Loud moments: readings well above the day's usual level, at least 20 s apart
let loudThr = 55;
function loudMoments() {
  if (loudCache) return loudCache;
  const lv = dayData.lv;
  if (!lv.length) return (loudCache = []);
  const sorted = lv.slice().sort((a, b) => a - b);
  loudThr = Math.max(55, sorted[Math.floor(sorted.length / 2)] + 20);
  const out = []; let last = -1e12;
  dayData.ts.forEach((t, i) => { if (lv[i] >= loudThr) { if (t - last > 20) out.push(t); last = t; } });
  return (loudCache = out);
}

// --- graph ---
let G = null;
function initGraph() {
  const c = $('g-canvas'), css = getComputedStyle(document.documentElement);
  G = { c: c, bg: css.getPropertyValue('--graph-bg').trim(), dim: css.getPropertyValue('--text-dim').trim(),
        accent: css.getPropertyValue('--accent').trim(), pink: css.getPropertyValue('--accent2').trim() };
  document.querySelectorAll('#zoom-seg button').forEach(b => { b.onclick = () => zoomTo(+b.dataset.span); });
  // tap = play from that moment; drag sideways = move the window
  let down = null;
  c.addEventListener('pointerdown', e => { down = { x: e.clientX, start: winStart, moved: false }; try { c.setPointerCapture(e.pointerId); } catch (err) {} });
  c.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - down.x;
    if (Math.abs(dx) > 8) down.moved = true;
    if (down.moved) { winStart = down.start - dx / c.clientWidth * winSpan; clampWindow(); drawGraph(); }
  });
  c.addEventListener('pointerup', e => {
    if (!down) return;
    const tap = !down.moved; down = null;
    if (tap) { const r = c.getBoundingClientRect(); seekAbs(winStart + (e.clientX - r.left) / r.width * winSpan, true); }
  });
  c.addEventListener('pointercancel', () => { down = null; });
  if (window.ResizeObserver) new ResizeObserver(() => drawGraph()).observe(c);
}

function clampWindow() {
  if (audDay == null) return;
  winStart = Math.max(audDay, Math.min(winStart, nextDay(audDay) - winSpan));
}
function setZoomButtons() {
  document.querySelectorAll('#zoom-seg button').forEach(b => b.classList.toggle('active', +b.dataset.span === winSpan));
}
function zoomTo(span) {
  const p = absPos();
  const center = p != null && p >= winStart && p <= winStart + winSpan ? p : winStart + winSpan / 2;
  winSpan = span; winStart = center - span / 2; clampWindow();
  setZoomButtons(); drawGraph();
}
function panGraph(dir) { winStart += dir * winSpan * .5; clampWindow(); drawGraph(); }

// Keep a moment in view, switching day if needed
function showMoment(ts) {
  if (audDay == null || ts < audDay || ts >= nextDay(audDay)) {
    audDay = dayStart(ts); dayData = { ds: audDay, ts: [], lv: [] }; loudCache = null;
    renderDays(); refreshDayData(true);
  }
  if (ts < winStart || ts > winStart + winSpan) { winStart = ts - winSpan * .25; clampWindow(); }
}

function drawGraph() {
  if (!G || !shown('audio', 'rec')) return;
  const c = G.c, dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = G.bg; ctx.fillRect(0, 0, w, h);
  if (audDay == null) return;
  const x = t => (t - winStart) / winSpan * w, top = 18, bottom = h - 4;

  // shaded where sound was recorded
  ctx.fillStyle = 'rgba(185,163,255,0.10)';
  audFiles.forEach(f => { if (f.end > winStart && f.start < winStart + winSpan) ctx.fillRect(x(f.start), top, x(f.end) - x(f.start), bottom - top); });

  // the part being chosen for saving
  if (mark.start != null) {
    const a = mark.start, b = mark.end != null ? mark.end : absPos();
    if (b != null) { ctx.fillStyle = 'rgba(255,111,156,0.22)'; ctx.fillRect(x(Math.min(a, b)), top, Math.max(2, Math.abs(x(b) - x(a))), bottom - top); }
  }

  // sound levels: every reading when zoomed in, else 10-second steps
  const useDetail = winSpan <= 3600;
  const src = useDetail ? rawLevels(audDay) : dayData;
  const barW = Math.max(1.5, (useDetail ? 2 : 10) / winSpan * w);
  for (let i = 0; i < src.ts.length; i++) {
    const t = src.ts[i];
    if (t < winStart - 10 || t > winStart + winSpan) continue;
    const l = src.lv[i], bh = Math.max(1.5, l / 100 * (bottom - top));
    ctx.fillStyle = levelColor(l, l > 40 ? .9 : .6);
    ctx.fillRect(x(t), bottom - bh, barW, bh);
  }

  // time grid
  const step = winSpan >= 86400 ? 10800 : winSpan >= 21600 ? 3600 : winSpan >= 3600 ? 600 : 60;
  ctx.font = '10px Space Mono, monospace'; ctx.textBaseline = 'top';
  for (let t = Math.ceil((winStart - audDay) / step) * step + audDay; t <= winStart + winSpan; t += step) {
    const gx = x(t);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(gx, top, 1, bottom - top);
    ctx.fillStyle = G.dim; ctx.fillText(fmtHM(t), gx + 3, 3);
  }

  // "now" line, and the playhead
  const n = nowSec();
  if (n >= winStart && n <= winStart + winSpan) { ctx.fillStyle = G.accent; ctx.fillRect(x(n) - 1, top, 2, bottom - top); }
  const p = absPos();
  if (p != null && p >= winStart && p <= winStart + winSpan) {
    ctx.fillStyle = G.pink; ctx.fillRect(x(p) - 1, 0, 3, h);
    ctx.beginPath(); ctx.arc(x(p) + .5, 6, 5, 0, Math.PI * 2); ctx.fill();
  }
  $('g-range').textContent = fmtHM(winStart) + ' – ' + fmtEnd(winStart + winSpan);
  updateScrubRange();
}

// The end of the day reads 24:00, not 00:00
function fmtEnd(t) { return audDay != null && t >= nextDay(audDay) - 1 ? '24:00' : fmtHM(t); }

// --- recordings on the chosen day ---
function renderDayList() {
  const box = $('aud-list'); box.textContent = '';
  if (audDay == null) return;
  const de = nextDay(audDay);
  const files = audFiles.filter(f => f.end > audDay && f.start < de).sort((a, b) => b.start - a.start);
  if (!files.length) { box.appendChild(el('div', 'empty', 'No sound recordings on this day.\nThey are made while Audio mode is on.')); return; }
  files.forEach(f => {
    const item = el('div', 'item' + (aFile && aFile.name === f.name ? ' active' : ''));
    item.onclick = () => seekAbs(f.start, true);
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', fmtHM(f.start) + ' – ' + fmtHM(f.end)));
    const meta = el('div', 'item-meta');
    meta.append(el('span', null, fmtDuration(f.end - f.start)), el('span', null, fmtSize(f.size)));
    if (nowSec() - f.end < 90) meta.appendChild(el('span', 'rec-dot', '● recording'));
    main.appendChild(meta);
    const mini = el('canvas', 'mini'); mini.width = 140; mini.height = 56;
    const sv = iconEl('button', 'btn small', 'star'); sv.title = 'Save this recording'; sv.setAttribute('aria-label', 'Save this recording');
    sv.onclick = e => { e.stopPropagation(); saveRecording(f); };
    const acts = el('div', 'item-actions'); acts.appendChild(sv);
    item.append(iconEl('div', 'item-ico', 'mic'), main, mini, acts);
    box.appendChild(item);
    drawMini(mini, f);
  });
}

function drawMini(c, f) {
  const ctx = c.getContext('2d'), span = f.end - f.start;
  ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < dayData.ts.length; i++) {
    const t = dayData.ts[i];
    if (t < f.start || t >= f.end) continue;
    const l = dayData.lv[i], bh = Math.max(2, l / 100 * c.height);
    ctx.fillStyle = levelColor(l, .85);
    ctx.fillRect((t - f.start) / span * c.width, c.height - bh, Math.max(1, 10 / span * c.width), bh);
  }
}

// --- player ---
function initAudioPlayer() {
  aPlayer = new Audio();
  aPlayer.preload = 'metadata';
  aPlayer.addEventListener('play', updatePlayButton);
  aPlayer.addEventListener('pause', updatePlayButton);
  aPlayer.addEventListener('timeupdate', onAudioTime);
  const settle = () => {
    // the player has reached the asked-for moment: trust its own position again
    if (pendingPos != null && aFile && aPlayer.readyState >= 1 &&
        Math.abs(aFile.start + aPlayer.currentTime - pendingPos) < 1.5) pendingPos = null;
  };
  aPlayer.addEventListener('seeked', settle);
  aPlayer.addEventListener('loadedmetadata', settle);
  aPlayer.addEventListener('timeupdate', settle);
  aPlayer.addEventListener('ended', () => {
    // carry straight on into the next recording, if it follows on
    const next = audFiles.filter(f => f.start > aFile.start && f.start - aFile.end < 120).sort((a, b) => a.start - b.start)[0];
    if (next) { seekAbs(next.start, true); return; }
    // The newest recording has grown since it was loaded. Loading it again downloads it from the
    // start (it has no index while it's being written), so that's only done when at least a
    // minute of new sound is waiting; otherwise point to Live for what's happening now.
    const reached = aFile.start + aPlayer.currentTime;
    if (aFile.end - reached >= 60) { aPlayer.dataset.src = ''; seekAbs(reached, true); return; }
    updatePlayButton();
    if (nowSec() - aFile.end < 30) toast("That's the newest sound so far. For what's happening now, use Live.");
  });
  aPlayer.addEventListener('error', () => { if (aPlayer.getAttribute('src')) toast("Couldn't load this recording.", true); });
  const s = $('a-scrub');
  s.addEventListener('input', () => { scrubbing = true; $('a-clock').textContent = fmtClock(+s.value); });
  s.addEventListener('change', () => { scrubbing = false; seekAbs(+s.value, true); });
}

function updatePlayButton() {
  const playing = aPlayer && !aPlayer.paused;
  const b = $('a-play');
  b.innerHTML = playing ? svg('pause', 'fill') : svg('play', 'fill');
  b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function onAudioTime() {
  const p = absPos();
  if (p == null) return;
  if (!scrubbing) { $('a-clock').textContent = fmtClock(p); $('a-scrub').value = Math.round(p); }
  if (!aPlayer.paused && (p > winStart + winSpan || p < winStart)) { winStart = p - winSpan * .1; clampWindow(); }
  drawGraph();
  if (mark.start != null && mark.end == null) updateSel();
}

function updateScrubRange() {
  const s = $('a-scrub');
  s.min = Math.floor(winStart); s.max = Math.ceil(winStart + winSpan);
  $('a-scrub-start').textContent = fmtHM(winStart);
  $('a-scrub-end').textContent = fmtEnd(winStart + winSpan);
  const p = absPos();
  if (p != null && !scrubbing) s.value = Math.round(p);
}

// Play from a real clock time. Called straight from taps, so phones allow playback.
let lastSeek = null;               // the last moment asked for
function seekAbs(ts, play) {
  ts = Math.floor(ts);
  lastSeek = ts;
  const f = fileAt(ts);
  if (!f) {
    toast(ts > nowSec() ? "That time hasn't happened yet." : 'Nothing was recorded at ' + fmtClock(ts) + '.');
    return false;
  }
  stopAllPlayback('aud');
  const url = mediaUrl('/audio/' + encodeURIComponent(f.name));
  const offset = ts - f.start;
  if (aPlayer.dataset.src === url && aPlayer.readyState >= 1) {
    aPlayer.currentTime = offset;
  } else {
    aPlayer.dataset.src = url;
    aPlayer.src = url + '#t=' + offset;          // start position in the address
  }
  const changedFile = !aFile || aFile.name !== f.name;
  aFile = f;
  pendingPos = ts;
  if (play) playSafe(aPlayer);
  showMoment(ts);
  $('a-clock').textContent = fmtClock(ts);
  $('a-sub').textContent = fmtDate(ts) + ' · recording ' + fmtHM(f.start) + '–' + fmtHM(f.end);
  if (changedFile) renderDayList();
  drawGraph();
  return true;
}

function togglePlay() {
  if (!aFile) {
    // nothing chosen yet: start a minute before the end of the latest recording
    const last = audFiles.slice().sort((a, b) => b.start - a.start)[0];
    if (last) seekAbs(Math.max(last.start, last.end - 60), true); else toast('No recordings yet.');
    return;
  }
  if (aPlayer.paused) { stopAllPlayback('aud'); playSafe(aPlayer); } else aPlayer.pause();
}

function skip(sec) {
  const p = absPos();
  if (p == null) { toast('Pick a moment first: tap the graph or a recording.'); return; }
  seekAbs(p + sec, !aPlayer.paused);
}

function jumpLoud(dir) {
  const p = absPos() != null ? absPos() : (dir > 0 ? winStart : winStart + winSpan);
  const loud = loudMoments();
  // the moment just played counts as "this one", not the previous (moments are ≥ 20 s apart)
  const t = dir > 0 ? loud.find(x => x > p + 3) : loud.slice().reverse().find(x => x < p - 15);
  if (t == null) { toast(dir > 0 ? 'No later loud moment on this day.' : 'No earlier loud moment on this day.'); return; }
  if (winSpan > 3600) { winSpan = 3600; setZoomButtons(); }
  winStart = t - winSpan / 2; clampWindow();
  // The overview uses 10-second steps: find the exact 2-second reading and start 2 s before it
  const raw = rawLevels(audDay);
  let at = t - 3;
  for (let i = 0; i < raw.ts.length; i++) {
    if (raw.ts[i] < t) continue;
    if (raw.ts[i] > t + 12) break;
    if (raw.lv[i] >= loudThr) { at = raw.ts[i] - 2; break; }
  }
  seekAbs(at, true);                           // inside the tap, so phones allow playback
}

function gotoTime() {
  const v = $('a-goto').value;
  if (!v) { toast('Choose a time first.'); return; }
  const parts = v.split(':').map(Number);
  const d = new Date((audDay != null ? audDay : dayStart(nowSec())) * 1000);
  d.setHours(parts[0], parts[1], parts[2] || 0, 0);
  const ts = d.getTime() / 1000;
  if (winSpan > 600) { winSpan = 600; setZoomButtons(); }
  winStart = ts - winSpan / 2; clampWindow();
  seekAbs(ts, true);
}

// --- save a part ---
function toggleSaveBox(open) {
  const box = $('a-save-box');
  const show = open === undefined ? box.style.display !== 'block' : open;
  box.style.display = show ? 'block' : 'none';
  $('a-save-toggle').classList.toggle('on', show);
  if (!show) { mark = { start: null, end: null }; $('a-label').value = ''; }
  updateSel(); drawGraph();
}
function markPart(which) {
  const p = absPos();
  if (p == null) { toast('Play the recording first, then mark.'); return; }
  mark[which] = Math.round(p);
  if (mark.start != null && mark.end != null && mark.end < mark.start) { const t = mark.start; mark.start = mark.end; mark.end = t; }
  updateSel(); drawGraph();
}
function updateSel() {
  const s = mark.start != null ? fmtClock(mark.start) : '--:--:--';
  const e = mark.end != null ? fmtClock(mark.end) : '--:--:--';
  const len = mark.start != null && mark.end != null ? '  (' + fmtDuration(mark.end - mark.start) + ')' : '';
  $('a-sel').textContent = 'Start: ' + s + '  →  End: ' + e + len;
}
async function savePart() {
  if (mark.start == null || mark.end == null) { toast('Mark both a start and an end first.'); return; }
  if (mark.end - mark.start < 1) { toast('The part must be at least 1 second long.'); return; }
  const btn = $('a-save-btn'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/save', { kind: 'audio', start: mark.start, end: mark.end, label: $('a-label').value }, 60000);
    toast('Saved ✓  Find it (and download it) in the Saved tab.');
    toggleSaveBox(false);
  } catch (e) {
    if (!handleAuthError(e)) toast(e.code === 'nothing-recorded' ? 'Nothing was recorded in that part.' :
                                   e.code === 'bad-length' ? 'A saved part can be up to 3 hours long.' : "Couldn't save it. Try again.", true);
  } finally { btn.disabled = false; btn.textContent = '★ Save'; }
}

// --- save a whole recording (like "Save clip"): it goes to Saved and stays until deleted there.
// Recordings and clips are downloaded from the Saved tab only.
function saveHour() {
  if (!aFile) { toast('Pick a recording first: tap the graph or a recording below.'); return; }
  saveRecording(aFile);
}
async function saveRecording(f) {
  const growing = nowSec() - f.end < 90;
  const name = await dialog('Save this recording',
    fmtDate(f.start) + ', ' + fmtHM(f.start) + ' – ' + fmtHM(f.end) + ' (' + fmtDuration(f.end - f.start) + ', ' + fmtSize(f.size) + ').\n' +
    (growing ? 'It is still recording: what is there up to now gets saved.\n' : '') +
    'It will be kept until you delete it. You can give it a name:', 'Save', 'Name (optional)');
  if (name === null) return;
  toast('Saving…');
  try {
    await api('/save', { kind: 'audio', start: f.start, end: f.end, label: name }, 150000);
    toast('Saved ✓  Find it (and download it) in the Saved tab.');
  } catch (e) {
    if (!handleAuthError(e)) toast(e.code === 'nothing-recorded' ? 'Nothing was recorded there.' :
                                   e.code === 'bad-length' ? 'A saved recording can be up to 3 hours long.' : "Couldn't save it. Try again.", true);
  }
}

// ── CAMERA · RECORDINGS (motion clips) ────────────────
let clipDay = null, clipDayPicked = false, currentClip = null, clipsLoaded = false;
let clipView = storageGet('streampi_clip_view') === 'grid' ? 'grid' : 'list';   // list or gallery, remembered
let playAll = false;                            // playing the whole day, one clip after the other

// NEW clips: remembered on this device only. The first time, everything already there counts as
// watched; after that a clip is new until it has been played (or marked as seen).
let seen = null;                                // { since: newest clip's start the first time, names: Set }
function loadSeen() {
  try {
    const s = JSON.parse(storageGet('streampi_seen_clips') || 'null');
    if (s && typeof s.since === 'number' && Array.isArray(s.names)) return { since: s.since, names: new Set(s.names) };
  } catch (e) {}
  return null;
}
function saveSeen() { if (seen) storageSet('streampi_seen_clips', JSON.stringify({ since: seen.since, names: Array.from(seen.names) })); }
function isNewClip(c) { return !!seen && c.start > seen.since && !seen.names.has(c.name); }
function markSeen(list) {
  let changed = false;
  list.forEach(c => { if (isNewClip(c)) { seen.names.add(c.name); changed = true; } });
  if (changed) { saveSeen(); updateClipBadges(); }
}
// After each clip list: start remembering, and forget clips that are gone from the Pi
function updateSeen() {
  if (!seen) { seen = { since: clipList.reduce((m, c) => Math.max(m, c.start), 0), names: new Set() }; saveSeen(); return; }
  const have = new Set(clipList.map(c => c.name)), n = seen.names.size;
  seen.names.forEach(x => { if (!have.has(x)) seen.names.delete(x); });
  if (seen.names.size !== n) saveSeen();
}
// The count on the Recordings tab, and the "N NEW · motion clips today" link under the live picture
function updateClipBadges() {
  const n = clipList.filter(isNewClip).length;
  const nb = $('nav-badge');
  nb.textContent = n > 99 ? '99+' : n;
  nb.style.display = VIEW === 'camera' && n ? 'flex' : 'none';
  const pill = $('cam-new-pill');
  pill.textContent = n + ' NEW'; pill.style.display = n ? '' : 'none';
  const today = clipsOfDay(dayStart(nowSec()));
  const latest = today.reduce((m, c) => Math.max(m, c.start), 0);
  $('cam-clips-text').textContent = !clipsLoaded ? 'Motion clips'
    : today.length ? (today.length === 1 ? '1 motion clip' : today.length + ' motion clips') + ' today · latest ' + fmtHM(latest)
    : 'No motion clips today';
}
// From the live picture: open the day of the newest unwatched clip, or else today
function openNewClips() {
  const fresh = clipList.filter(isNewClip).sort((a, b) => b.start - a.start);
  clipDay = dayStart(fresh.length ? fresh[0].start : nowSec()); clipDayPicked = true;
  setTab('rec');
}
function markDaySeen() { markSeen(clipsOfDay(clipDay)); renderClips(); }

function clipsOfDay(ds) { return clipList.filter(c => dayStart(c.start) === ds); }
function setClipView(v) { clipView = v; storageSet('streampi_clip_view', v); renderClips(); }

function initClipPlayer() {
  const v = $('clip-video');
  v.addEventListener('error', () => { if (currentClip && v.getAttribute('src')) toast("Couldn't play this clip.", true); });
  // A clip that is still recording has grown since it was loaded. Loading it again downloads
  // it from the start, so that's only done when at least 30 s of new picture are waiting.
  v.addEventListener('ended', () => {
    const c = currentClip && clipList.find(x => x.name === currentClip.name);
    if (c && c.recording) {
      if (c.end - c.start - v.duration >= 30) {
        v.src = mediaUrl('/clip/' + encodeURIComponent(c.name)) + '#t=' + Math.floor(v.currentTime);
        playSafe(v);
      } else toast('This clip is still recording. For what\'s happening now, use Live.');
      return;
    }
    // Play all: on to the next clip of the same day
    if (!playAll || !currentClip) return;
    const next = clipsOfDay(dayStart(currentClip.start)).sort((a, b) => a.start - b.start).find(x => x.start > currentClip.start);
    if (next) playClip(next, true);
    else { playAll = false; showClipMeta(); toast('That was the last clip of the day.'); }
  });
}

// The day's clips as marks on a 00-24 strip; a tap plays the clip nearest to that time
function initTimeline() {
  $('tl-strip').addEventListener('click', e => {
    if (clipDay == null) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = clipDay + (e.clientX - r.left) / r.width * (nextDay(clipDay) - clipDay);
    let best = null, bestGap = Infinity;
    clipsOfDay(clipDay).forEach(c => {
      const gap = t < c.start ? c.start - t : t > c.end ? t - c.end : 0;
      if (gap < bestGap) { bestGap = gap; best = c; }
    });
    if (best) playClip(best);
  });
}
function renderTimeline(list) {
  const ds = clipDay, span = nextDay(ds) - ds, strip = $('tl-strip');
  const isToday = ds === dayStart(nowSec());
  strip.textContent = '';
  $('tl-title').textContent = 'Movement ' + (isToday ? 'today' : dayLabel(ds) === 'Yesterday' ? 'yesterday' : 'on ' + fmtDate(ds));
  const fresh = list.filter(isNewClip).length;
  $('tl-count').textContent = !list.length ? 'No clips' : (list.length === 1 ? '1 clip' : list.length + ' clips') + (fresh ? ' · ' + fresh + ' new' : '');
  $('tl-seen').style.display = fresh ? '' : 'none';
  if (isToday) { const f = el('div', 'tl-future'); f.style.left = Math.min(100, (nowSec() - ds) / span * 100) + '%'; strip.appendChild(f); }
  list.slice().sort((a, b) => a.start - b.start).forEach(c => {
    const cls = currentClip && currentClip.name === c.name ? ' cur' : c.recording ? ' rec' : isNewClip(c) ? ' new' : '';
    const m = el('div', 'tl-mark' + cls);
    m.style.left = ((c.start - ds) / span * 100) + '%';
    m.style.width = 'max(4px, ' + (Math.max(0, Math.min(c.end, ds + span) - c.start) / span * 100) + '%)';
    strip.appendChild(m);
  });
}

// Thumbnails are kept between list refreshes, so they aren't fetched again every 15 s
// (the newest 300; older ones come from the phone's own cache if they're needed again)
const thumbCache = new Map();
function thumbImg(name) {
  const url = mediaUrl('/clip/' + encodeURIComponent(name));     // includes the login, so a new login gets new images
  let th = thumbCache.get(url);
  if (!th) {
    th = el('img', 'thumb'); th.alt = ''; th.loading = 'lazy'; th.src = url;
    thumbCache.set(url, th);
    if (thumbCache.size > 300) thumbCache.delete(thumbCache.keys().next().value);
  }
  return th;
}

function renderClips() {
  const days = new Set([dayStart(nowSec())]);
  clipList.forEach(c => days.add(dayStart(c.start)));
  const dayList = Array.from(days).sort((a, b) => b - a);
  // until a day is tapped, show the latest day that has clips
  if (!clipDayPicked || clipDay == null || !days.has(clipDay)) clipDay = dayList.find(d => clipList.some(c => dayStart(c.start) === d)) || dayList[0];
  renderChips('clip-days', dayList, clipDay, d => { clipDay = d; clipDayPicked = true; renderClips(); },
              d => clipsOfDay(d).some(isNewClip));
  renderKeep('clip-keep', clipDay);
  const list = clipsOfDay(clipDay).sort((a, b) => b.start - a.start);
  renderTimeline(list);
  const pa = $('btn-play-all'), today = dayStart(nowSec());
  setIconText(pa, 'play', 'fill', 'Play all ' + (clipDay === today ? 'today ' : dayLabel(clipDay) === 'Yesterday' ? 'yesterday ' : '') + '(' + list.length + ')');
  pa.disabled = !list.length;
  $('view-list').classList.toggle('active', clipView === 'list');
  $('view-grid').classList.toggle('active', clipView === 'grid');
  const box = $('clips-list'); box.textContent = '';
  box.className = list.length && clipView === 'grid' ? 'grid' : 'list';
  if (!clipsLoaded) { box.appendChild(el('div', 'empty', 'Loading clips…')); return; }
  if (!list.length) { box.appendChild(el('div', 'empty', 'No motion clips on this day.\nThey appear when Camera mode sees movement.')); return; }
  list.forEach(c => box.appendChild(clipView === 'grid' ? clipTile(c) : clipRow(c)));
}
function clipThumb(c) {
  if (typeof c.thumb === 'string' && THUMB_RE.test(c.thumb)) return thumbImg(c.thumb);
  return iconEl('div', 'thumb', 'cam');
}
function fmtLen(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + pad(s % 60); }
function clipRow(c) {
  const item = el('div', 'item' + (currentClip && currentClip.name === c.name ? ' active' : ''));
  item.onclick = () => playClip(c);
  const main = el('div', 'item-main'), title = el('div', 'item-title', fmtClock(c.start));
  if (isNewClip(c)) title.appendChild(el('span', 'new-pill', 'NEW'));
  main.appendChild(title);
  const meta = el('div', 'item-meta');
  meta.appendChild(c.recording ? el('span', 'rec-dot', '● recording…') : el('span', null, fmtDuration(c.end - c.start)));
  meta.appendChild(el('span', null, fmtSize(c.size)));
  main.appendChild(meta);
  item.append(clipThumb(c), main);
  return item;
}
function clipTile(c) {
  const t = el('button', 'tile' + (currentClip && currentClip.name === c.name ? ' active' : ''));
  t.onclick = () => playClip(c);
  const img = el('div', 'tile-img');
  img.appendChild(clipThumb(c));
  if (isNewClip(c)) img.appendChild(el('span', 'new-pill', 'NEW'));
  img.appendChild(el('span', 'tile-len' + (c.recording ? ' rec' : ''), c.recording ? '● REC' : fmtLen(c.end - c.start)));
  t.append(img, el('div', 'tile-time', fmtClock(c.start)));
  return t;
}

// auto: true when Play all moves on by itself (anything tapped ends Play all)
function playClip(c, auto) {
  if (!auto) playAll = false;
  stopAllPlayback('clip');
  currentClip = c;
  clipDay = dayStart(c.start); clipDayPicked = true;
  $('clip-player').style.display = 'block';
  $('clip-title').textContent = fmtDate(c.start) + ' · ' + fmtClock(c.start);
  showClipMeta();
  const v = $('clip-video');
  v.src = mediaUrl('/clip/' + encodeURIComponent(c.name));
  playSafe(v);
  markSeen([c]);
  renderClips();
  if (!auto) $('clip-player').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function showClipMeta() {
  const c = currentClip;
  if (!c) return;
  let txt = c.recording ? 'Still recording…' : fmtDuration(c.end - c.start) + ' · ' + fmtSize(c.size);
  if (playAll) {
    const day = clipsOfDay(dayStart(c.start)).sort((a, b) => a.start - b.start);
    txt = 'Playing all · ' + (day.findIndex(x => x.name === c.name) + 1) + ' of ' + day.length + ' · ' + txt;
  }
  $('clip-meta').textContent = txt;
}
// Every clip of the chosen day, oldest first, one after the other
function playAllDay() {
  const list = clipsOfDay(clipDay).sort((a, b) => a.start - b.start);
  if (!list.length) return;
  playAll = true;
  playClip(list[0], true);
  $('clip-player').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clipSkip(sec) {
  const v = $('clip-video');
  if (!currentClip) return;
  v.currentTime = Math.max(0, Math.min((v.duration || 1e9) - .5, v.currentTime + sec));
}

function clipStep(dir) {
  const all = clipList.slice().sort((a, b) => a.start - b.start);
  if (!currentClip) { if (all.length) playClip(all[all.length - 1]); return; }
  const next = all[all.findIndex(c => c.name === currentClip.name) + dir];
  if (next) playClip(next); else toast(dir > 0 ? 'This is the newest clip.' : 'This is the oldest clip.');
}

async function saveClip() {
  if (!currentClip) return;
  if (currentClip.recording) { toast('This clip is still recording. Try again in a moment.'); return; }
  const name = await dialog('Save this clip', 'It will be kept until you delete it. You can give it a name:', 'Save', 'Name (optional)');
  if (name === null) return;
  try {
    await api('/save', { kind: 'clip', name: currentClip.name, label: name }, 60000);
    toast('Saved ✓  Find it (and download it) in the Saved tab.');
  } catch (e) {
    if (!handleAuthError(e)) toast(e.code === 'still-recording' ? 'This clip is still recording. Try again in a moment.' : "Couldn't save it. Try again.", true);
  }
}

// ── SAVED ─────────────────────────────────────────────
function loadSaved() {
  return once('saved', async () => {
    try {
      const data = await api('/saved');
      savedList = (Array.isArray(data) ? data : []).filter(m => m && SAVED_ID_RE.test(m.id) && (m.kind === 'audio' || m.kind === 'clip'));
      renderSaved(true);
    } catch (e) {
      if (handleAuthError(e)) return;
      ['saved-audio-list', 'saved-clip-list'].forEach(id => { const b = $(id); b.textContent = ''; b.appendChild(el('div', 'empty', "Can't reach the Pi right now.")); });
    }
  });
}

function savedTitle(m) { return m.label || (m.kind === 'clip' ? 'Clip ' : 'Sound ') + fmtDate(m.start) + ' ' + fmtClock(m.start); }

function renderSaved(loaded) {
  [['audio', 'saved-audio-list'], ['clip', 'saved-clip-list']].forEach(([kind, id]) => {
    const box = $(id); box.textContent = '';
    const list = savedList.filter(m => m.kind === kind);
    if (!list.length) {
      box.appendChild(el('div', 'empty', !loaded ? 'Loading…' : kind === 'audio'
        ? 'Nothing saved yet.\nIn Recordings, tap ★ Save recording, or use Save a part.'
        : 'Nothing saved yet.\nOpen a clip in Recordings and tap ★ Save clip.'));
      return;
    }
    list.forEach(m => {
      const item = el('div', 'item');
      item.onclick = () => playSaved(m);
      let th;
      if (kind === 'clip' && m.thumb) { th = el('img', 'thumb'); th.alt = ''; th.loading = 'lazy'; th.src = mediaUrl('/saved/' + m.id + '.jpg'); }
      else th = kind === 'clip' ? iconEl('div', 'thumb', 'cam') : iconEl('div', 'item-ico', 'mic');
      const main = el('div', 'item-main');
      main.appendChild(el('div', 'item-title', savedTitle(m)));
      const meta = el('div', 'item-meta');
      meta.append(el('span', null, fmtDate(m.start) + ' ' + fmtClock(m.start) + ' → ' + fmtClock(m.end)),
                  el('span', null, fmtDuration(m.end - m.start)), el('span', null, fmtSize(m.size || 0)));
      main.appendChild(meta);
      const acts = el('div', 'item-actions');
      const dl = iconEl('a', 'btn small', 'download'); dl.title = 'Download'; dl.setAttribute('aria-label', 'Download');
      dl.href = mediaUrl('/saved/' + m.file, true); dl.onclick = e => e.stopPropagation();
      const del = iconEl('button', 'btn small danger', 'trash'); del.title = 'Delete'; del.setAttribute('aria-label', 'Delete');
      del.onclick = e => { e.stopPropagation(); deleteSaved(m); };
      acts.append(dl, del);
      item.append(th, main, acts);
      box.appendChild(item);
    });
  });
}

function playSaved(m) {
  stopAllPlayback('saved');
  const isClip = m.kind === 'clip';
  const card = $(isClip ? 'saved-video-card' : 'saved-audio-card');
  const media = $(isClip ? 'saved-video' : 'saved-audio');
  card.style.display = 'block';
  $(isClip ? 'saved-video-title' : 'saved-audio-title').textContent = savedTitle(m);
  media.src = mediaUrl('/saved/' + m.file);
  playSafe(media);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteSaved(m) {
  // Deleting is for good, so the Pi asks for the web password (like everything else that deletes)
  const pw = await dialog('Delete "' + savedTitle(m) + '"?', "It will be removed from the Pi for good. This can't be undone.\n\nConfirm with your web password.",
                          'Delete', 'Web password', 'password');
  if (pw == null) return;
  if (!pw) { toast('Type your web password to delete it.', true); return; }
  try {
    await api('/saved/delete', { id: m.id, password: pw }, 20000);
    ['saved-audio', 'saved-video'].forEach(id => {
      const x = $(id);
      if ((x.getAttribute('src') || '').indexOf(m.id) !== -1) { x.pause(); x.removeAttribute('src'); x.load(); x.closest('.card').style.display = 'none'; }
    });
    savedList = savedList.filter(x => x.id !== m.id); renderSaved(true);
    toast('Deleted.');
  } catch (e) { if (!handleAuthError(e)) toast(passwordError(e) || "Couldn't delete it. Try again.", true); }
}

// ── KEEP THIS DAY ─────────────────────────────────────
// A kept day's sound recordings, sound levels and camera clips are never auto-deleted.
// Nothing is copied: the Pi just remembers the day. Un-keeping needs the web password.
let keptDays = new Set();                       // 'YYYYMMDD'
function isKept(ds) { return keptDays.has(dayKey(ds)); }
function keyToDay(k) { return new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)).getTime() / 1000; }
function setKeptDays(list) {
  const next = new Set(list);
  if (next.size === keptDays.size && list.every(d => keptDays.has(d))) return;
  keptDays = next;
  refreshKeepViews();
}
function refreshKeepViews() {
  if (TAB === 'rec' && VIEW === 'audio') renderDays();
  if (TAB === 'rec' && VIEW === 'camera') renderClips();
  if (TAB === 'saved') renderKeptLists();
}
function renderKeep(id, ds) {
  const box = $(id); box.textContent = '';
  if (ds == null) return;
  const kept = isKept(ds);
  const b = el('button', 'btn small' + (kept ? ' on' : ''), kept ? '★ Kept' : '☆ Keep this day');
  b.onclick = () => toggleKeep(ds);
  const i = el('button', 'info-btn', 'i'); i.setAttribute('aria-label', 'What does Keep this day do?');
  i.onclick = () => help('keep');
  box.append(b, i, el('span', 'note', kept ? 'Never auto-deleted. Tap ★ Kept to un-keep.' : 'Never auto-deleted once kept'));
}
async function toggleKeep(ds) {
  const keep = !isKept(ds);
  let pw = '';
  if (!keep) {
    pw = await dialog('Un-keep ' + dayLabel(ds) + '?', 'Auto-delete may then remove this day\'s recordings. Confirm with your web password.',
                      'Un-keep', 'Web password', 'password');
    if (pw == null) return;
  }
  try {
    const r = await api('/keep', { day: dayKey(ds), keep: keep, password: pw }, 20000);
    keptDays = new Set(r.kept || []); refreshKeepViews();
    toast(keep ? '★ ' + dayLabel(ds) + ' is kept. It will never be auto-deleted.' : dayLabel(ds) + ' is no longer kept.');
  } catch (e) {
    if (!handleAuthError(e)) toast(passwordError(e) || "Couldn't change it. Try again.", true);
  }
}
function passwordError(e) {
  return e.code === 'wrong-password' ? 'Wrong password. Nothing changed.'
       : e.code === 'locked' ? 'Too many wrong tries. Wait 5 minutes.' : '';
}
// Saved tab: the kept days, newest first; tap one to open it in Recordings
function renderKeptLists() {
  [['audio', 'kept-list-audio'], ['camera', 'kept-list-camera']].forEach(([view, id]) => {
    const box = $(id); box.textContent = '';
    const days = Array.from(keptDays).sort().reverse();
    if (!days.length) { box.appendChild(el('div', 'empty', 'No kept days.\nIn Recordings, tap ☆ Keep this day.')); return; }
    days.forEach(k => {
      const ds = keyToDay(k);
      const item = el('div', 'item');
      item.onclick = () => {
        if (view === 'audio') { setTab('rec'); selectDay(ds); }
        else { clipDay = ds; clipDayPicked = true; setTab('rec'); }
      };
      const main = el('div', 'item-main');
      main.append(el('div', 'item-title', dayLabel(ds) === fmtDate(ds) ? fmtDate(ds) : dayLabel(ds) + ' · ' + fmtDate(ds)),
                  el('div', 'item-meta', 'Never auto-deleted · tap to open'));
      item.append(el('div', 'item-ico', '★'), main);
      box.appendChild(item);
    });
  });
}

// ── AUTO-DELETE (in Settings) ─────────────────────────
// Switching on or keeping fewer days needs the web password (it can delete recordings for
// good); switching off or keeping more days doesn't. The Pi deletes right away when switched
// on, then every hour; kept days and Saved items are never touched.
let adSaved = null, adTimer = null;             // adSaved: what the Pi has now
function adForm() { return { enabled: $('ad-on').checked, days: parseInt($('ad-days').value, 10) }; }
function showAutoDelete(r) {
  adSaved = { enabled: !!(r && r.enabled), days: (r && r.days) || 3 };
  $('ad-on').checked = adSaved.enabled; $('ad-days').value = adSaved.days;
  adChanged();
}
function adChanged() {
  const f = adForm(), ok = f.days >= 1 && f.days <= 60;
  $('ad-apply').disabled = !adSaved || !ok || (f.enabled === adSaved.enabled && f.days === adSaved.days);
  clearTimeout(adTimer);
  if (!ok) { $('ad-preview').textContent = 'Choose from 1 to 60 days.'; return; }
  if (!f.enabled) { $('ad-preview').textContent = 'Off: nothing is deleted.'; return; }
  $('ad-preview').textContent = 'Checking what that would delete…';
  adTimer = setTimeout(async () => {
    try {
      const p = await api('/retention/preview?days=' + f.days, null, 60000);
      const now = adForm();
      if (now.days === f.days && now.enabled) $('ad-preview').textContent = previewText(p, f.days);
    } catch (e) { if (!handleAuthError(e)) $('ad-preview').textContent = "Couldn't check that right now."; }
  }, 500);
}
function previewText(p, days) {
  const n = (c, one) => c + ' ' + one + (c === 1 ? '' : 's');
  const parts = [];
  if (p.sound && p.sound.count) parts.push(n(p.sound.count, 'sound recording') + ' (' + Math.round(p.sound.mb) + ' MB)');
  if (p.clips && p.clips.count) parts.push(n(p.clips.count, 'camera clip') + ' (' + Math.round(p.clips.mb + (p.thumbs ? p.thumbs.mb : 0)) + ' MB)');
  const later = 'After that, every hour, anything older than ' + n(days, 'day') + ' is deleted.';
  return parts.length ? 'Right now this deletes ' + parts.join(' and ') + ', the oldest from ' + fmtDate(p.oldest) + '. ' + later
                      : 'Nothing is older than ' + n(days, 'day') + ' yet. ' + later;
}
async function applyAutoDelete() {
  const f = adForm();
  let pw = '';
  if (f.enabled && (!adSaved.enabled || f.days < adSaved.days)) {
    pw = await dialog('Confirm with your web password', 'Auto-delete removes recordings for good.', 'Confirm', 'Web password', 'password');
    if (pw == null) return;
  }
  const btn = $('ad-apply'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await api('/retention', { enabled: f.enabled, days: f.days, password: pw }, 300000);
    showAutoDelete(r.retention);
    const d = r.deleted, freed = d && d.mb ? ' ' + Math.round(d.mb) + ' MB deleted now.' : '';
    toast(r.retention.enabled ? 'Auto-delete is on: keeping the last ' + r.retention.days + ' days.' + freed : 'Auto-delete is off.');
  } catch (e) {
    if (handleAuthError(e)) return;
    toast(passwordError(e) || "Couldn't change it. Try again.", true);
    adChanged();
  } finally { btn.textContent = 'Apply'; }
}

// ── SETTINGS ──────────────────────────────────────────
async function openSettings() {
  $('settings-ip').value = PI_ADDR; $('settings-error').textContent = '';
  $('i-disk').textContent = '…'; $('i-disk-bar').style.width = '0';
  const left = AUTH ? Math.ceil((AUTH.expires - nowSec()) / 86400) : 0;
  $('i-login').textContent = left > 1 ? 'for ' + left + ' more days' : 'until tomorrow at the latest';
  adSaved = null; $('ad-apply').disabled = true; $('ad-preview').textContent = '…';
  $('health-rows').textContent = '';
  $('settings').classList.add('open');
  loadHealth();
  try {
    const s = await api('/status');
    showAutoDelete(s.retention);
    if (Array.isArray(s.kept)) setKeptDays(s.kept);
    showDisk(s.disk);
    showSpaceNote(s.space);
    showSensitivity(s.sensitivity);
  } catch (e) {
    if (handleAuthError(e)) return;
    $('i-disk').textContent = '—'; $('ad-preview').textContent = "Can't reach the Pi right now.";
  }
}
function showDisk(d) {
  if (!d || !(d.total_gb > 0)) { $('i-disk').textContent = '—'; return; }
  const free = d.free_gb / d.total_gb, bar = $('i-disk-bar');
  $('i-disk').textContent = d.free_gb + ' of ' + d.total_gb + ' GB';
  bar.style.width = Math.round((1 - free) * 100) + '%';         // the filled part is what's used
  bar.style.background = free < 0.1 ? 'var(--danger)' : free < 0.2 ? 'var(--warn)' : 'var(--live)';
}

// The low-space guard (a Pi without it: no note)
function showSpaceNote(sp) {
  const n = $('space-note');
  if (!sp || !sp.limit_gb) { n.textContent = ''; return; }
  let t = 'If less than ' + sp.limit_gb + ' GB is free, the oldest recordings are deleted to make room (never kept days ★, Saved items or the last 24 hours).';
  if (sp.last && sp.last.time) t += ' Last time: ' + fmtWhen(sp.last.time) + ' – ' + sp.last.count + (sp.last.count === 1 ? ' file, ' : ' files, ') + Math.round(sp.last.mb) + ' MB.';
  n.textContent = t;
}

// ── PI HEALTH (Settings) ──────────────────────────────
// Asked only when Settings opens. A Pi without it just shows the space left.
async function loadHealth() {
  try { renderHealth(await api('/health', null, 15000)); }
  catch (e) { handleAuthError(e); }
}
function fmtUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? d + (d === 1 ? ' day ' : ' days ') + h + ' h' : h ? h + ' h ' + m + ' min' : m + ' min';
}
function renderHealth(hh) {
  const box = $('health-rows'); box.textContent = '';
  const G = 'var(--live)', A = 'var(--warn)', R = 'var(--danger)', D = 'var(--text-dim)';
  const row = (label, detail, value, color) => {
    const r = el('div', 'h-row'), dot = el('span', 'h-dot'), m = el('div', 'h-main');
    dot.style.background = color;
    m.append(el('div', 'h-label', label), el('div', 'h-detail', detail));
    r.append(dot, m, el('div', 'h-val', value));
    box.appendChild(r);
  };
  const t = hh.temp;
  if (t != null) row('Temperature', t >= 80 ? 'Hot: the Pi is slowing itself down' : t >= 70 ? 'Warm: it slows down at 80 °C' : 'Normal',
                     Math.round(t) + ' °C', t >= 80 ? R : t >= 70 ? A : G);
  const th = hh.throttled;                    // the firmware's warning bits
  if (th == null) row('Power', "Couldn't be read", '—', D);
  else if (th & 0x1) row('Power', 'Too little power right now. Check the power supply and cable', 'LOW', R);
  else if (th & 0x10000) row('Power', 'Too little power since the last restart. Check the power supply and cable', 'WARN', A);
  else if (th & 0xE) row('Power', 'Slowed down right now (too warm or too little power)', 'SLOW', A);
  else if (th & 0xE0000) row('Power', 'It was slowed down since the last restart', 'WARN', A);
  else row('Power', 'No warnings since the last restart', 'OK', G);
  const b = hh.busy;
  if (b != null) row('How busy', b >= 90 ? 'Very busy: things may lag' : b >= 70 ? 'Busy' : 'The whole Pi, right now', b + '%', b >= 90 ? R : b >= 70 ? A : G);
  if (hh.boot) row('Last restart', 'Running for ' + fmtUptime(nowSec() - hh.boot), dayStart(hh.boot) === dayStart(nowSec()) ? fmtHM(hh.boot)
                   : new Date(hh.boot * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' }), G);
  if (hh.disk) showDisk(hh.disk);
}

// ── MOTION SENSITIVITY (Settings) ─────────────────────
let sensNow = null, sensBusy = false;
function showSensitivity(level) {
  sensNow = ['less', 'normal', 'more'].indexOf(level) >= 0 ? level : null;
  $('sens-sec').style.display = sensNow ? '' : 'none';      // hidden on a Pi without it
  document.querySelectorAll('#sens-seg button').forEach(b => {
    b.classList.toggle('active', b.dataset.level === sensNow); b.disabled = sensBusy;
  });
}
async function setSensitivity(level) {
  if (sensBusy || level === sensNow) return;
  const camOn = POWER ? POWER.running === 'camera' : liveNow.cam;
  sensBusy = true; showSensitivity(sensNow);
  if (camOn) { stopCamLive(); toast('Changing it. The camera restarts (about 5 s)…'); }
  try {
    const r = await api('/sensitivity', { level: level }, 120000);
    sensBusy = false; showSensitivity(r.sensitivity);
    toast('Motion sensitivity: ' + cap(r.sensitivity) + '.' + (camOn ? ' The camera is back in a few seconds.' : ' It applies when the camera is on.'));
  } catch (e) {
    sensBusy = false; showSensitivity(sensNow);
    if (!handleAuthError(e)) toast("Couldn't change it. Try again.", true);
  }
}
function closeSettings() { $('settings').classList.remove('open'); }
function saveSettings() {
  const addr = normalizeAddr($('settings-ip').value);
  if (!addr) { $('settings-error').textContent = ADDR_HELP; return; }
  const changed = addr !== PI_ADDR;
  PI_ADDR = addr; storageSet('pisentinel_addr', PI_ADDR);
  closeSettings(); stopAllPlayback();
  if (changed) { requireLogin('Log in to the new address.'); return; }
  launchApp();
}

// ── BUTTONS ───────────────────────────────────────────
// The page's safety rule (CSP) allows no code inside the HTML. So every button there only says
// what it does (data-click, plus data-arg where needed) and is wired up here, once.
const CLICK = {
  login, showAddressBox, openSettings, closeSettings, help, resetZoom, toggleCamSound, snapshot, toggleFullScreen,
  toggleCamLive, openNewClips, saveClip, markDaySeen, playAllDay, setClipView, toggleStream, togglePlay, gotoTime,
  markPart, savePart, saveHour, setTab, setSensitivity, applyAutoDelete, saveSettings, logout, resetApp,
  clipStep: a => clipStep(+a), clipSkip: a => clipSkip(+a), panGraph: a => panGraph(+a),
  skip: a => skip(+a), jumpLoud: a => jumpLoud(+a),
  toggleSaveBox: a => toggleSaveBox(a === 'false' ? false : undefined)
};
document.querySelectorAll('[data-click]').forEach(b => {
  const f = CLICK[b.dataset.click];
  if (f) b.addEventListener('click', () => f(b.dataset.arg));
  else console.error('No action for button', b.dataset.click);
});
$('view-select').addEventListener('change', e => setView(e.target.value));
$('ad-on').addEventListener('change', adChanged);
$('ad-days').addEventListener('input', adChanged);
$('settings').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });   // tap beside the sheet
