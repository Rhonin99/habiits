import {
  load, getState, subscribe, getHabit, addLog, setLog, getLog, moveHabit, setArchived, deleteHabit,
  addGroup, renameGroup, deleteGroup, setSetting, exportJSON, importJSON, resetAll, commit,
  addAnomaly, removeAnomaly, reorderHabits,
} from './store.js';
import {
  today, dkey, parseKey, addDays, addMonths, startOfMonth, startOfWeek, esc, fmtNum, todayKey, relativeDayLabel,
} from './util.js';
import {
  status, isDue, topLevel, childrenOf, isParent, valueAsOf, hasMin, tapModeOf, isQuota, quotaStatus, quotaPeriod,
} from './logic.js';
import { renderToday, renderStats, renderHabits, renderSettings } from './views.js';
import {
  openEditor, openDetail, openKeypad, toggleSkip,
} from './sheets.js';
import { initCardGestures } from './gestures.js';
import {
  openSheet, closeSheet, toast, scrollHeatmaps,
} from './components.js';
import { parseSyncText, applySync, runShortcut, downloadICS } from './integrations.js';

load();

const ui = {
  tab: 'today',
  selected: today(),
  todayKey: todayKey(),
  group: 'all',
  collapsed: new Set(),
  anOpen: false,
  backupSnoozed: false,
  statsMode: 'week',
  statsMonth: startOfMonth(today()),
  reviewWeek: startOfWeek(today(), 1),
};

try {
  const saved = JSON.parse(localStorage.getItem('habits.ui') || '{}');
  if (saved.tab) ui.tab = saved.tab;
  if (saved.group && (saved.group === 'all' || getState().groups.some((g) => g.id === saved.group))) ui.group = saved.group;
  if (Array.isArray(saved.collapsed)) ui.collapsed = new Set(saved.collapsed);
  if (saved.statsMode) ui.statsMode = saved.statsMode;
} catch { /* ignore */ }
ui.reviewWeek = startOfWeek(today(), getState().settings.weekStart);

function saveUI() {
  try {
    localStorage.setItem('habits.ui', JSON.stringify({
      tab: ui.tab, group: ui.group, collapsed: [...ui.collapsed], statsMode: ui.statsMode,
    }));
  } catch { /* ignore */ }
}

const app = document.getElementById('app');

function applyTheme() {
  const t = getState().settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function render() {
  const s = getState();
  applyTheme();
  const scroll = window.scrollY;
  const views = { today: renderToday, stats: renderStats, habits: renderHabits, settings: renderSettings };
  // keep an open <details> open across re-renders
  const openDetails = [...app.querySelectorAll('details[open] > summary')].map((x) => x.textContent);
  app.innerHTML = views[ui.tab](s, ui);
  app.querySelectorAll('details > summary').forEach((x) => { if (openDetails.includes(x.textContent)) x.parentElement.open = true; });
  app.dataset.tab = ui.tab;
  scrollHeatmaps(app);
  document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  window.scrollTo(0, scroll);
}

subscribe(render);

function setTab(tab) {
  if (ui.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  ui.tab = tab;
  saveUI();
  render();
  window.scrollTo(0, 0);
}

/* ---------- logging ---------- */

function tapHabit(id) {
  const h = getHabit(id);
  if (!h) return;
  const date = ui.selected;
  const key = dkey(date);
  const s = getState();
  const st = status(s, h, date);
  if (navigator.vibrate) navigator.vibrate(10);
  if (st.parent) {
    // only tappable when every subhabit was skipped
    if (!st.solo) return;
    const before = getLog(id, key);
    setLog(id, key, st.done ? 0 : 1);
    toast(st.done ? `${h.name} unchecked` : `🎉 ${h.name} done!`, [{ label: 'Undo', fn: () => setLog(id, key, before) }]);
    return;
  }
  const mode = tapModeOf(h);

  if (mode === 'keypad') {
    openKeypad(id, date, (hid, d, before) => afterLog(h, d, before, st));
    return;
  }
  const before = getLog(id, key);
  if (mode === 'done') {
    if (st.done) {
      // already complete → tap again to undo today's entry
      setLog(id, key, 0);
      toast(`${h.name} unchecked`, [{ label: 'Undo', fn: () => setLog(id, key, before) }]);
      return;
    }
    setLog(id, key, before + Math.max(0, h.min - valueAsOf(s, h, date)));
  } else {
    addLog(id, key, h.step);
  }
  afterLog(h, date, before, st);
}

// Toast after logging: celebrate / warn, with Undo (and "Send ❤️" for Health-linked habits)
function afterLog(h, date, before, prevStatus) {
  const key = dkey(date);
  const after = status(getState(), h, date);
  const added = Math.round((getLog(h.id, key) - before) * 100) / 100;
  const actions = [{ label: 'Undo', fn: () => setLog(h.id, key, before) }];
  if (h.shortcut) actions.unshift({ label: 'Send ❤️', fn: () => runShortcut(h.shortcut, getLog(h.id, key)) });
  let msg = `${added >= 0 ? '+' : ''}${fmtNum(added)} ${h.unit} · ${h.name}`;
  if (h.kind !== 'max' && after.done && !prevStatus.done) msg = h.kind === 'range' ? `🎉 ${h.name} in range` : `🎉 ${h.name} done!`;
  if (after.over && !prevStatus.over) msg = `⚠️ Over your ${h.name} maximum`;
  if (isQuota(h) && after.done && !prevStatus.done) {
    const q = quotaStatus(getState(), h, date);
    const per = quotaPeriod(h) === 'week' ? 'this week' : 'this month';
    msg = q.met === q.need ? `🎉 ${h.name}: ${q.need}/${q.need} ${per}, goal reached!` : `✓ ${h.name} · ${q.met}/${q.need} ${per}`;
  }
  toast(msg, actions);
}

function completeAll() {
  const s = getState();
  const date = ui.selected;
  const key = dkey(date);
  const changes = [];
  const visit = (h) => {
    if (!isDue(s, h, date)) return;
    if (isParent(s, h)) {
      if (status(s, h, date).solo) { if (!getLog(h.id, key)) changes.push([h.id, 0, 1]); return; }
      childrenOf(s, h.id).forEach(visit);
      return;
    }
    if (!hasMin(h)) return;
    const missing = h.min - valueAsOf(s, h, date);
    if (missing > 0) changes.push([h.id, getLog(h.id, key), getLog(h.id, key) + missing]);
  };
  topLevel(s, ui.group).forEach(visit);
  if (!changes.length) return;
  changes.forEach(([id, , v]) => setLog(id, key, v, true));
  commit();
  toast(`Completed ${changes.length} habit${changes.length > 1 ? 's' : ''}`, [{
    label: 'Undo',
    fn: () => { changes.forEach(([id, prev]) => setLog(id, key, prev, true)); commit(); },
  }]);
}

/* ---------- sync ---------- */

function startSync() {
  const name = getState().settings.syncShortcut || 'Habit Sync';
  sessionStorage.setItem('syncPending', '1');
  runShortcut(name);
}

async function pasteSync() {
  sessionStorage.removeItem('syncPending');
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    // iOS refused (the little "Paste" bubble wasn't tapped) → let the user paste by hand
    openPasteSheet('iOS didn’t let the app read the clipboard. Long-press the box below, tap <b>Paste</b>, then <b>Import</b>.<br><br>Next time: after tapping Paste in the app, iOS shows a small <b>Paste</b> bubble. Tap that bubble to allow it.');
    return;
  }
  importSyncText(text);
}

function openPasteSheet(note) {
  const el = openSheet(`<header class="sheet-head"><span class="icon-btn placeholder"></span><h2>Paste sync data</h2>
      <button class="icon-btn" data-act="close-sheet" aria-label="Close">✕</button></header>
    <div class="card">
      <p class="note">${note}</p>
      <textarea id="paste-box" rows="7" placeholder="Long-press here → Paste"></textarea>
      <button class="btn btn-primary wide" id="paste-go">Import</button>
    </div>`);
  el.querySelector('#paste-go').onclick = () => importSyncText(el.querySelector('#paste-box').value);
}

// Nothing usable in the text: show what arrived and the most likely shortcut mistake.
function syncProblem(text) {
  const t = String(text || '').trim();
  let why;
  if (!t) {
    why = 'Nothing arrived. The clipboard was empty. In the <b>Habit Sync</b> shortcut, make sure the <b>last</b> action is <b>Copy to Clipboard</b> and that it copies the <b>Text</b> action’s result.';
  } else if (/\[[^\]]*\]/.test(t) || !/\d/.test(t)) {
    why = 'The values were typed in as plain text instead of inserted as variables. In the shortcut’s <b>Text</b> action, delete <code>[Steps]</code>, then tap in that spot and pick <b>Steps</b> from the bar above the keyboard. It should appear as a coloured <b>bubble</b>, not as typed text. Do the same for <b>Sleep</b> and for <b>Current Date</b>.';
  } else {
    why = 'The text arrived, but no line looks like <code>steps=6421</code>. Each value needs its own line in the form <code>name=number</code>.';
  }
  openSheet(`<header class="sheet-head"><span class="icon-btn placeholder"></span><h2>Nothing to import</h2>
      <button class="icon-btn" data-act="close-sheet" aria-label="Close">✕</button></header>
    <div class="card">
      <p>${why}</p>
      <p class="note" style="margin-top:12px">What the app received:</p>
      <pre class="sync-preview">${t ? esc(t.slice(0, 800)) : '(empty)'}</pre>
      <p class="note">It should look like:</p>
      <pre class="sync-preview">date=2026-11-19
steps=6421
sleep=7.4</pre>
    </div>`);
}

function importSyncText(text) {
  const parsed = parseSyncText(text);
  const n = Object.keys(parsed.days).length + parsed.events.length;
  if (!n) { syncProblem(text); return; }
  const report = applySync(parsed);
  openSheet(`<header class="sheet-head"><span class="icon-btn placeholder"></span><h2>Synced</h2>
      <button class="icon-btn" data-act="close-sheet" aria-label="Close">✕</button></header>
    <div class="card">${report.length
    ? `<ul class="history">${report.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
    : '<p class="note">Data was read, but no habit is linked to it. Set a habit’s <b>Data source</b> (or name it after the key, e.g. “steps”).</p>'}
    ${parsed.events.length ? `<p class="note">${parsed.events.length} app open/close events read.</p>` : ''}</div>`);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // roll over to the new day if the app was left open overnight
  if (ui.todayKey !== todayKey()) {
    if (dkey(ui.selected) === ui.todayKey) ui.selected = today();
    ui.todayKey = todayKey();
    render();
  }
  if (sessionStorage.getItem('syncPending')) {
    toast('Back from Shortcuts — import the data?', [{ label: 'Paste', fn: pasteSync }], 15000);
  }
});

/* ---------- backups ---------- */

function markBackedUp() {
  setSetting('lastBackup', new Date().toISOString());
}

// Copies the backup to the clipboard and runs the "Habit Backup" shortcut,
// which saves it to iCloud Drive/Shortcuts/Habit Backups/.
async function backupViaShortcut() {
  try {
    await navigator.clipboard.writeText(exportJSON());
  } catch {
    toast('Couldn’t copy the backup — use “Save backup file…” instead.');
    return;
  }
  markBackedUp();
  runShortcut(getState().settings.backupShortcut || 'Habit Backup');
}

async function backupToFile() {
  const name = `habits-backup-${todayKey()}.json`;
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Habits backup' }); // → "Save to Files"
      markBackedUp();
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  markBackedUp();
}

/* ---------- group picker ---------- */

function pickGroup() {
  const s = getState();
  const opts = [{ id: 'all', name: 'All habits' }, ...s.groups];
  openSheet(`<header class="sheet-head"><span class="icon-btn placeholder"></span><h2>Show</h2>
    <button class="icon-btn" data-act="close-sheet" aria-label="Close">✕</button></header>
    <div class="card picker">${opts.map((g) => `<button class="pick${ui.group === g.id ? ' sel' : ''}" data-act="set-group" data-id="${g.id}">${esc(g.name)}</button>`).join('')}</div>`);
}

/* ---------- click delegation ---------- */

const SHEET_SAFE = new Set(['close-sheet', 'edit-habit', 'set-group']);

const actions = {
  'close-sheet': () => closeSheet(),
  tab: (b) => setTab(b.dataset.tab),
  'new-habit': () => openEditor(null, ui.group !== 'all' ? { groupId: ui.group } : {}),
  'edit-habit': (b) => { closeSheet(); openEditor(b.dataset.id); },
  'open-habit': (b) => openDetail(b.dataset.id, ui.tab === 'today' ? ui.selected : today()),
  tap: (b) => tapHabit(b.dataset.id),
  'toggle-kids': (b) => {
    const id = b.dataset.id;
    if (ui.collapsed.has(id)) ui.collapsed.delete(id); else ui.collapsed.add(id);
    saveUI();
    render();
  },
  'select-day': (b) => { ui.selected = parseKey(b.dataset.date); render(); },
  'stats-mode': (b) => { ui.statsMode = b.dataset.mode; saveUI(); render(); },
  'shift-week': (b) => { ui.reviewWeek = addDays(ui.reviewWeek, 7 * Number(b.dataset.n)); render(); },
  'open-review': (b) => {
    ui.reviewWeek = parseKey(b.dataset.week);
    ui.statsMode = 'week';
    setSetting('reviewSeen', b.dataset.week);
    setTab('stats');
  },
  'dismiss-review': (b) => setSetting('reviewSeen', b.dataset.week),
  'backup-now': backupViaShortcut,
  'backup-file': backupToFile,
  'backup-later': () => { ui.backupSnoozed = true; render(); },
  'goto-day': (b) => { ui.selected = parseKey(b.dataset.date); setTab('today'); },
  'an-open': () => {
    if (ui.anOpen) return;
    ui.anOpen = true;
    render();
    focusAnomalyInput();
  },
  'an-close': () => { ui.anOpen = false; render(); },
  'an-del': (b) => removeAnomaly(dkey(ui.selected), b.dataset.id),
  'shift-day': (b) => { ui.selected = addDays(ui.selected, Number(b.dataset.n)); render(); },
  'go-today': () => { ui.selected = today(); render(); },
  'shift-month': (b) => { ui.statsMonth = addMonths(ui.statsMonth, Number(b.dataset.n)); render(); },
  'pick-group': pickGroup,
  'set-group': (b) => { ui.group = b.dataset.id; saveUI(); closeSheet(); render(); },
  'complete-all': completeAll,
  sync: startSync,
  'paste-sync': pasteSync,
  'import-sync-text': () => importSyncText(document.getElementById('sync-text').value),
  move: (b) => moveHabit(b.dataset.id, Number(b.dataset.n)),
  unarchive: (b) => setArchived(b.dataset.id, false),
  'delete-habit': (b) => {
    const h = getHabit(b.dataset.id);
    if (h && confirm(`Delete “${h.name}” and all its history? This can't be undone.`)) deleteHabit(h.id);
  },
  'new-group': () => { const n = prompt('Group name'); if (n && n.trim()) addGroup(n); },
  'rename-group': (b) => {
    const g = getState().groups.find((x) => x.id === b.dataset.id);
    const n = prompt('Rename group', g?.name);
    if (n && n.trim()) renameGroup(b.dataset.id, n);
  },
  'delete-group': (b) => {
    if (confirm('Delete this group? Its habits are kept, just ungrouped.')) {
      if (ui.group === b.dataset.id) ui.group = 'all';
      deleteGroup(b.dataset.id);
    }
  },
  ics: (b) => downloadICS(getHabit(b.dataset.id)),
  reset: (b) => {
    const samples = b.dataset.samples === '1';
    const msg = samples
      ? 'Replace ALL your habits and history with the sample habits?'
      : 'Erase ALL habits and history on this device? Export a backup first if unsure.';
    if (confirm(msg)) { ui.group = 'all'; resetAll(samples); toast('Done'); }
  },
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  // a plain input/button nested inside an action area (e.g. the anomalies form) behaves natively
  const inner = e.target.closest('input, textarea, select, button');
  if (inner && inner !== b && !inner.dataset.act && b.contains(inner)) return;
  const act = b.dataset.act;
  // sheets handle their own buttons; only a few actions are global inside them
  if (b.closest('.sheet') && !SHEET_SAFE.has(act)) return;
  const fn = actions[act];
  if (fn) { e.preventDefault(); fn(b); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.setting) {
    const k = t.dataset.setting;
    setSetting(k, k === 'weekStart' ? Number(t.value) : t.value);
  }
  if (t.dataset.actChange === 'import-file' && t.files[0]) {
    try {
      const text = await t.files[0].text();
      if (confirm('Replace everything on this device with this backup?')) {
        importJSON(text);
        toast('Backup restored');
      }
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
    t.value = '';
  }
});

function focusAnomalyInput() {
  const input = document.querySelector('#an-form input');
  if (input) input.focus({ preventScroll: false });
}

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'an-form') return;
  e.preventDefault();
  const text = e.target.elements.text.value;
  if (text.trim()) addAnomaly(dkey(ui.selected), text); // re-renders, keeping the form open
  focusAnomalyInput();
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ---------- habit card gestures: hold to reorder, swipe left to skip ---------- */

initCardGestures(app, {
  onDragStart: () => { if (!getState().settings.gestureHintSeen) getState().settings.gestureHintSeen = true; },
  onReorder: (ids) => reorderHabits(ids),
  onSwipe: (id) => toggleSkip(id, ui.selected),
});

/* ---------- swipe the week strip ---------- */

let touchX = null;
app.addEventListener('touchstart', (e) => {
  touchX = e.target.closest('#week-strip') ? e.touches[0].clientX : null;
}, { passive: true });
app.addEventListener('touchend', (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) {
    ui.selected = addDays(ui.selected, dx < 0 ? 7 : -7);
    render();
  }
});

/* ---------- boot ---------- */

render();

if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Update available', [{ label: 'Reload', fn: () => location.reload() }], 15000);
        }
      });
    });
  }).catch((err) => console.warn('SW registration failed', err));
}
