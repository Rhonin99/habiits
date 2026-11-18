// Habit editor + habit detail sheets.
import {
  esc, dkey, today, fmtNum, parseLooseNumber, relativeDayLabel, addDays, DOW_SHORT,
} from './util.js';
import {
  getState, getHabit, newHabit, saveHabit, deleteHabit, setArchived, setLog, getLog, addGroup,
  addAnomaly, skipHabit, unskipHabit, isSkippedOn, COLORS, UNITS,
} from './store.js';
import {
  status, streaks, monthStats, dayIntensity, goalText, isParent, childrenOf, topLevel, scaleOf,
  isScheduled, hasMin, isQuota, quotaStatus, quotaPeriod,
} from './logic.js';
import {
  openSheet, closeSheet, sheetEl, heatmap, monthGrid, colorOf, icons, toast, ring, scrollHeatmaps,
} from './components.js';
import { SOURCES, runShortcut, downloadICS } from './integrations.js';

const EMOJIS = ['💧', '💪', '🚶', '🏃', '🛏️', '🧘', '📚', '✍️', '🥗', '🍎', '💊', '🦷', '🧹', '💻',
  '🎸', '🗣️', '🙏', '☀️', '🌙', '📵', '🚭', '🍺', '☕', '🍬', '📱', '💰', '🌱', '🎯', '❤️', '🧠'];

/* ================= EDITOR ================= */

export function openEditor(id, preset = {}) {
  const s = getState();
  const existing = id ? getHabit(id) : null;
  const h = existing
    ? { ...existing, days: [...existing.days], monthDays: [...(existing.monthDays || [])] }
    : newHabit({ order: Date.now(), ...preset });
  const hasKids = existing && isParent(s, existing);
  const parents = topLevel(s, 'all').filter((p) => p.id !== h.id && !p.parentId);
  const src = h.source.startsWith('app:') ? 'app' : h.source;

  const html = `
  <header class="sheet-head">
    <button class="icon-btn" data-act="close-sheet" aria-label="Close">${icons.close}</button>
    <h2>${existing ? 'Edit habit' : 'New habit'}</h2>
    <button class="btn btn-primary sm" data-act="save-habit">Save</button>
  </header>
  <form class="editor" id="editor" autocomplete="off" onsubmit="return false">
    <div class="card">
      <div class="name-row">
        <button type="button" class="emoji-btn" data-act="toggle-emojis" id="emoji-preview">${esc(h.emoji)}</button>
        <div class="name-fields">
          <input name="name" placeholder="Habit name" value="${esc(h.name)}" required maxlength="60">
          <input name="description" placeholder="Description (optional)" value="${esc(h.description)}" maxlength="140">
        </div>
      </div>
      <div class="emoji-picker" id="emoji-picker" hidden>
        <input name="emoji" class="emoji-input" value="${esc(h.emoji)}" maxlength="8" aria-label="Type any emoji">
        <div class="emoji-grid">${EMOJIS.map((e) => `<button type="button" data-act="pick-emoji" data-e="${e}">${e}</button>`).join('')}</div>
      </div>
      <div class="field"><span>Color</span>
        <div class="swatches">${Object.entries(COLORS).map(([k, v]) => `<label class="swatch" style="--c:${v}"><input type="radio" name="color" value="${k}" ${h.color === k ? 'checked' : ''}><i></i></label>`).join('')}</div>
      </div>
      <label class="field-row"><span>Group</span>
        <select name="groupId"><option value="">None</option>${s.groups.map((g) => `<option value="${g.id}" ${h.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}<option value="__new">+ New group…</option></select></label>
      ${hasKids ? '<p class="note">This habit has subhabits, so its progress comes from them.</p>' : `
      <label class="field-row"><span>Subhabit of</span>
        <select name="parentId"><option value="">None (top level)</option>${parents.map((p) => `<option value="${p.id}" ${h.parentId === p.id ? 'selected' : ''}>${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}</select></label>`}
    </div>

    <div class="card ${hasKids ? 'disabled-block' : ''}">
      <div class="field"><span>Goal type</span>
        <div class="seg">${seg('kind', [['min', '↑ Minimum'], ['max', '↓ Maximum'], ['range', '↕ Min & max']], h.kind)}</div>
        <p class="note" id="kind-help"></p></div>
      <div class="field"><span>Goal period</span>
        <div class="seg">${seg('period', [['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']], h.period)}</div>
        <p class="note">The goal value below is measured per this period.</p></div>
      <div class="field-grid">
        <label id="min-field"><span>Minimum</span><input name="min" inputmode="decimal" value="${num(h.min)}"></label>
        <label id="max-field"><span>Maximum</span><input name="max" inputmode="decimal" value="${num(h.max)}"></label>
        <label><span>Unit</span><input name="unit" list="units" value="${esc(h.unit)}" maxlength="12"></label>
      </div>
      <label class="field-row"><span>Task days</span>
        <select name="taskDays" id="task-days"></select></label>
      <div class="field" id="days-field"><span>Days of the week</span>
        <div class="dow-picks">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" name="days" value="${d}" ${h.taskDays === 'weekdays' && h.days.includes(d) ? 'checked' : ''}><i>${DOW_SHORT[d]}</i></label>`).join('')}</div></div>
      <div class="field" id="mdays-field"><span>Days of the month</span>
        <div class="mday-picks">${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<label><input type="checkbox" name="monthDays" value="${d}" ${h.monthDays.includes(d) ? 'checked' : ''}><i>${d}</i></label>`).join('')}</div>
        <p class="note">Picking 29–31 also covers the last day of shorter months.</p></div>
      <label class="field-row" id="count-field"><span id="count-label">Days per week</span>
        <input name="perCount" inputmode="numeric" value="${h.perCount || 3}" style="max-width:80px"></label>
      <p class="note" id="task-help"></p>
      <div class="field"><span>Habit button</span>
        <div class="seg">${seg('tapMode', [['done', '✓ Check off'], ['add', '＋ Add amount'], ['keypad', '⌨ Keypad']], h.tapMode)}</div>
        <p class="note" id="tap-help"></p>
        <label class="field-row" id="step-field"><span>Amount per tap</span><input name="step" inputmode="decimal" value="${num(h.step)}"></label>
      </div>
      <datalist id="units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
      <p class="summary" id="goal-summary"></p>
    </div>

    <div class="card">
      <div class="field"><span>Time of day</span>
        <div class="seg">${seg('timeRange', [['any', 'Anytime'], ['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']], h.timeRange)}</div></div>
      <label class="field-row"><span>Reminder</span><input type="time" name="reminder" value="${esc(h.reminder)}"></label>
      ${h.reminder && existing ? `<button type="button" class="link" data-act="ics" data-id="${h.id}">📅 Add reminder to Calendar</button>` : '<p class="note">After saving, open the habit to add the reminder to your Calendar.</p>'}
    </div>

    <div class="card ${hasKids ? 'disabled-block' : ''}">
      <h3>Integrations</h3>
      <label class="field-row"><span>Data source</span>
        <select name="source"><option value="">None (manual)</option>
          ${SOURCES.map((o) => `<option value="${o.id}" ${src === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
          <option value="app" ${src === 'app' ? 'selected' : ''}>Screen time for an app</option></select></label>
      <label class="field-row" id="app-field" ${src === 'app' ? '' : 'hidden'}><span>App name</span><input name="appName" value="${esc(h.source.startsWith('app:') ? h.source.slice(4) : '')}" placeholder="Instagram"></label>
      <label class="field-row"><span>Run shortcut after logging</span><input name="shortcut" value="${esc(h.shortcut)}" placeholder="e.g. Log Sleep"></label>
      <p class="note">Data source = filled in when you sync. Shortcut = sends what you log to Apple Health. See Settings → Setup guides.</p>
    </div>

    ${existing ? `<div class="btn-row">
      <button type="button" class="btn" data-act="archive" data-id="${h.id}">Archive</button>
      <button type="button" class="btn danger" data-act="delete-habit" data-id="${h.id}">Delete</button></div>` : ''}
  </form>`;

  const el = openSheet(html, { full: true });
  const form = el.querySelector('#editor');

  const readForm = () => {
    const f = new FormData(form);
    const out = { ...h };
    out.name = (f.get('name') || '').trim();
    out.description = (f.get('description') || '').trim();
    out.emoji = (f.get('emoji') || '').trim() || '✅';
    out.color = f.get('color') || 'blue';
    const gid = f.get('groupId');
    out.groupId = gid && gid !== '__new' ? gid : null;
    if (!hasKids) out.parentId = f.get('parentId') || null;
    out.kind = f.get('kind');
    out.tapMode = f.get('tapMode') || 'add';
    out.period = f.get('period');
    out.min = Math.max(0, parseLooseNumber(f.get('min')) || 0);
    out.max = Math.max(0, parseLooseNumber(f.get('max')) || 0);
    out.unit = (f.get('unit') || '').trim() || 'times';
    out.step = Math.max(0.01, parseLooseNumber(f.get('step')) || 1);
    out.taskDays = f.get('taskDays') || 'every';
    out.days = f.getAll('days').map(Number);
    out.monthDays = f.getAll('monthDays').map(Number);
    out.perCount = Math.round(parseLooseNumber(f.get('perCount')) || 0);
    out.timeRange = f.get('timeRange');
    out.reminder = f.get('reminder') || '';
    const source = f.get('source');
    const appName = (f.get('appName') || '').trim();
    out.source = source === 'app' ? (appName ? `app:${appName}` : '') : source || '';
    out.shortcut = (f.get('shortcut') || '').trim();
    return out;
  };

  const refresh = () => {
    const cur = readForm();
    el.querySelector('#goal-summary').textContent = `*${goalText(cur)}`;
    // task-day choices depend on the goal period (and "N days" needs a minimum)
    const sel = form.elements.taskDays;
    const opts = TASK_DAYS.filter(([v]) => (TASK_OK[cur.period] || []).includes(v) && !(cur.kind === 'max' && v.startsWith('per')));
    const want = opts.some(([v]) => v === (sel.value || h.taskDays)) ? (sel.value || h.taskDays) : 'every';
    if (sel.dataset.sig !== opts.map((o) => o[0]).join()) {
      sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
      sel.dataset.sig = opts.map((o) => o[0]).join();
    }
    sel.value = want;
    cur.taskDays = want;
    el.querySelector('#days-field').hidden = want !== 'weekdays';
    el.querySelector('#mdays-field').hidden = want !== 'monthDays';
    el.querySelector('#count-field').hidden = !want.startsWith('per');
    el.querySelector('#count-label').textContent = want === 'perWeek' ? 'Days per week' : 'Days per month';
    el.querySelector('#task-help').textContent = TASK_HELP[want] || '';
    el.querySelector('#goal-summary').textContent = `*${goalText(cur)}`;
    el.querySelector('#min-field').hidden = cur.kind === 'max';
    el.querySelector('#max-field').hidden = cur.kind === 'min';
    el.querySelector('#kind-help').textContent = KIND_HELP[cur.kind];
    const doneOpt = form.querySelector('input[name="tapMode"][value="done"]');
    doneOpt.disabled = cur.kind === 'max';
    doneOpt.parentElement.classList.toggle('seg-disabled', cur.kind === 'max');
    if (cur.kind === 'max' && doneOpt.checked) {
      form.querySelector('input[name="tapMode"][value="add"]').checked = true;
      cur.tapMode = 'add';
    }
    el.querySelector('#step-field').hidden = cur.tapMode !== 'add';
    el.querySelector('#tap-help').textContent = tapHelp(cur);
    el.querySelector('#app-field').hidden = form.elements.source.value !== 'app';
    el.querySelector('#emoji-preview').textContent = cur.emoji;
  };

  form.addEventListener('input', refresh);
  form.addEventListener('change', async (e) => {
    if (e.target.name === 'groupId' && e.target.value === '__new') {
      const name = prompt('New group name');
      if (name && name.trim()) {
        const g = addGroup(name);
        const opt = new Option(g.name, g.id, true, true);
        e.target.insertBefore(opt, e.target.querySelector('option[value="__new"]'));
      } else e.target.value = '';
    }
    // switching to a range with no sensible max yet: suggest double the min
    if (e.target.name === 'kind' && e.target.value === 'range') {
      const mn = parseLooseNumber(form.elements.min.value) || 0;
      const mx = parseLooseNumber(form.elements.max.value) || 0;
      if (mx <= mn) form.elements.max.value = num(mn ? mn * 2 : 1);
    }
    if (e.target.name === 'kind' && e.target.value === 'max' && !(parseLooseNumber(form.elements.max.value) > 0)) {
      form.elements.max.value = form.elements.min.value;
    }
    if (e.target.name === 'source') {
      const meta = SOURCES.find((x) => x.id === e.target.value);
      if (meta) form.elements.unit.value = meta.unit;
      if (e.target.value === 'app') form.elements.unit.value = 'min';
    }
    refresh();
  });
  refresh();

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'toggle-emojis') el.querySelector('#emoji-picker').hidden ^= true;
    if (act === 'pick-emoji') {
      form.elements.emoji.value = b.dataset.e;
      el.querySelector('#emoji-picker').hidden = true;
      refresh();
    }
    if (act === 'save-habit') {
      const out = readForm();
      if (!out.name) { toast('Give the habit a name'); form.elements.name.focus(); return; }
      if (!hasKids) {
        if (out.kind === 'min' && out.min <= 0) { toast('Minimum must be more than 0'); return; }
        if (out.kind === 'range' && out.max <= out.min) { toast('Maximum must be bigger than the minimum'); return; }
      }
      if (out.taskDays === 'weekdays') {
        if (!out.days.length) { toast('Pick at least one day of the week'); return; }
        if (out.days.length === 7) out.taskDays = 'every';
      }
      if (out.taskDays === 'monthDays' && !out.monthDays.length) { toast('Pick at least one day of the month'); return; }
      if (out.taskDays !== 'weekdays') out.days = [0, 1, 2, 3, 4, 5, 6];
      if (out.taskDays.startsWith('per')) {
        const cap = out.taskDays === 'perWeek' ? 7 : 31;
        if (out.perCount < 1 || out.perCount > cap) { toast(`Days per ${out.taskDays === 'perWeek' ? 'week' : 'month'} must be 1–${cap}`); return; }
      }
      if (out.parentId) {
        const p = getHabit(out.parentId);
        if (p && !out.groupId) out.groupId = p.groupId;
      }
      saveHabit(out);
      closeSheet();
      toast(existing ? 'Saved' : `Added ${out.name}`);
    }
    if (act === 'ics') downloadICS(readForm());
    if (act === 'archive') { setArchived(h.id, true); closeSheet(); toast('Archived'); }
    if (act === 'delete-habit') {
      if (confirm(`Delete “${h.name}” and all its history? This can't be undone.`)) {
        deleteHabit(h.id);
        closeSheet();
        toast('Deleted');
      }
    }
  });
}

const num = (n) => fmtNum(n).replace(/,/g, '');

const TASK_DAYS = [
  ['every', 'Every day'],
  ['weekdays', 'Specific days of the week'],
  ['perWeek', 'Number of days per week'],
  ['monthDays', 'Specific days of the month'],
  ['perMonth', 'Number of days per month'],
];
const TASK_OK = {
  day: ['every', 'weekdays', 'perWeek', 'monthDays', 'perMonth'],
  week: ['every', 'weekdays'],
  month: ['every', 'weekdays', 'monthDays'],
};
const TASK_HELP = {
  every: 'Shows up and counts every day.',
  weekdays: 'Only shows up, and only counts, on the days you pick.',
  monthDays: 'Only shows up, and only counts, on these dates.',
  perWeek: 'Shows up every day. Meet the daily goal on this many days each week. Days you skip or miss have no effect; the dots under the button fill as you go.',
  perMonth: 'Shows up every day. Meet the daily goal on this many days each month. Days you skip or miss have no effect.',
};

const KIND_HELP = {
  min: 'For a habit you want to increase: reach at least the minimum.',
  max: 'For a habit you want to reduce: stay at or under the maximum.',
  range: 'For something you enjoy but can overdo: land between the two.',
};

function tapHelp(h) {
  if (h.tapMode === 'done') {
    return `One tap completes the goal (fills it up to ${num(h.min)} ${h.unit}). Tap again to undo.`;
  }
  if (h.tapMode === 'keypad') return 'Tap opens a keypad, so you can log any amount, e.g. 1 L in the morning and 0.5 L later.';
  return 'Each tap adds the amount below.';
}

function seg(name, opts, value) {
  return opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${value === v ? 'checked' : ''}><span>${l}</span></label>`).join('');
}

/* ================= DETAIL ================= */

export function openDetail(id, date) {
  const render = () => {
    const s = getState();
    const h = getHabit(id);
    if (!h) { closeSheet(); return; }
    const color = colorOf(h);
    const parent = isParent(s, h);
    const st = status(s, h, date);
    const sk = streaks(s, h);
    const ms = monthStats(s, h, today());
    const key = dkey(date);
    const dayVal = getLog(h.id, key);
    const future = date > today();
    const history = [];
    for (let i = 0; i < 30 && history.length < 10; i++) {
      const d = addDays(today(), -i);
      const v = getLog(h.id, dkey(d));
      const an = s.anomalies[dkey(d)] || [];
      if (v || an.length) {
        history.push(`<li><span>${esc(relativeDayLabel(d))}${an.length ? `<span class="bubbles sm">${an.map((a) => `<span class="bubble">⚡ ${esc(a.text)}</span>`).join('')}</span>` : ''}</span><b>${fmtNum(v)} ${esc(h.unit)}</b></li>`);
      }
    }
    return `<header class="sheet-head">
      <button class="icon-btn" data-act="close-sheet" aria-label="Close">${icons.close}</button>
      <h2>${esc(h.emoji)} ${esc(h.name)}</h2>
      <button class="btn sm" data-act="edit-habit" data-id="${h.id}">Edit</button>
    </header>
    <div class="detail" style="--c:${color}">
      ${h.description ? `<p class="note">${esc(h.description)}</p>` : ''}
      <div class="card detail-hero">
        ${ring(st.ratio, `${Math.round(Math.min(st.ratio, 9.99) * 100)}%`, { size: 96, stroke: 8, color: st.over ? 'var(--danger)' : color })}
        <div>
          <div class="big">${parent ? `${st.value}/${st.target}` : `${fmtNum(st.value)}<small>${h.kind === 'range' ? ` · ${fmtNum(h.min)}–${fmtNum(h.max)}` : `/${fmtNum(scaleOf(h))}`} ${esc(h.unit)}</small>`}</div>
          <p class="note">${esc(relativeDayLabel(date))}${h.period !== 'day' && !parent ? ` · ${h.period === 'week' ? 'this week' : 'this month'}` : ''}</p>
          ${!parent && isQuota(h) ? (() => { const q = quotaStatus(s, h, date); return `<p class="note"><b>${q.met}/${q.need} days</b> ${quotaPeriod(h) === 'week' ? 'this week' : 'this month'}</p>`; })() : ''}
          <p class="note">${parent ? `${childrenOf(s, h.id).length} subhabits` : esc(goalText(h))}</p>
        </div>
      </div>
      ${!parent && !future ? `<div class="card">
        <div class="stepper">
          <button class="round" data-act="d-step" data-n="-1" aria-label="Remove ${fmtNum(h.step)}">${icons.minus}</button>
          <div class="stepper-mid"><b>${fmtNum(dayVal)} ${esc(h.unit)}</b><small>logged ${esc(relativeDayLabel(date).toLowerCase())}</small></div>
          <button class="round primary" data-act="d-step" data-n="1" aria-label="Add ${fmtNum(h.step)}">${icons.plus}</button>
        </div>
        <div class="set-row"><input id="d-set" inputmode="decimal" placeholder="Set exact amount"><button class="btn sm" data-act="d-set">Set</button></div>
        ${h.shortcut ? `<button class="btn wide" data-act="d-shortcut">❤️ Send ${fmtNum(dayVal)} ${esc(h.unit)} via “${esc(h.shortcut)}”</button>` : ''}
      </div>` : ''}
      ${!future && isScheduled(s, h, date) && !(h.parentId && isSkippedOn(key, h.parentId))
    ? `<button class="btn wide" data-act="d-skip">${isSkippedOn(key, h.id) ? '↩ Unskip' : '⤼ Skip'} ${esc(relativeDayLabel(date).toLowerCase())}</button>` : ''}
      <div class="tiles">
        <div class="tile"><b>${sk.current}</b><small>current ${sk.unit}s</small></div>
        <div class="tile"><b>${sk.best}</b><small>best streak</small></div>
        <div class="tile"><b>${Math.round(ms.rate * 100)}%</b><small>this month</small></div>
        <div class="tile"><b>${parent ? ms.done : fmtNum(ms.total)}</b><small>${parent ? 'full days' : `${esc(h.unit)} this month`}</small></div>
      </div>
      <div class="card"><h3>This month</h3>${monthGrid(today(), (d) => dayIntensity(s, h, d), { color, weekStart: s.settings.weekStart })}</div>
      <div class="card"><h3>Heatmap</h3>${heatmap((d) => dayIntensity(s, h, d), { weeks: 22, color, weekStart: s.settings.weekStart })}</div>
      ${history.length ? `<div class="card"><h3>Recent logs</h3><ul class="history">${history.join('')}</ul></div>` : ''}
      ${h.reminder ? `<button class="btn wide" data-act="ics" data-id="${h.id}">📅 Add ${esc(h.reminder)} reminder to Calendar</button>` : ''}
    </div>`;
  };

  const el = openSheet(render());
  scrollHeatmaps(el);
  const rerender = () => { const e = sheetEl(); if (e) { e.innerHTML = render(); scrollHeatmaps(e); } };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const h = getHabit(id);
    const key = dkey(date);
    if (b.dataset.act === 'd-step') {
      setLog(id, key, getLog(id, key) + h.step * Number(b.dataset.n));
      rerender();
    }
    if (b.dataset.act === 'd-set') {
      const v = parseLooseNumber(el.querySelector('#d-set').value);
      if (Number.isFinite(v)) { setLog(id, key, v); rerender(); }
    }
    if (b.dataset.act === 'd-shortcut') runShortcut(h.shortcut, getLog(id, key));
    if (b.dataset.act === 'ics') downloadICS(h);
    if (b.dataset.act === 'd-skip') toggleSkip(id, date);
  });
}

/* ================= SKIP ================= */

// Skip (or unskip) a habit for one day. Skipping asks for an optional anomaly as the reason.
export function toggleSkip(id, date) {
  const key = dkey(date);
  const h = getHabit(id);
  if (!h) return;
  if (isSkippedOn(key, id)) {
    unskipHabit(key, id);
    closeSheet();
    toast(`${h.name} is back on for ${relativeDayLabel(date).toLowerCase()}`);
    return;
  }
  skipHabit(key, id);
  openSkipReason(id, date);
}

function openSkipReason(id, date) {
  const key = dkey(date);
  const h = getHabit(id);
  const existing = getState().anomalies[key] || [];
  const el = openSheet(`<header class="sheet-head"><span class="icon-btn placeholder"></span>
      <h2>Skipped ${esc(h.emoji)} ${esc(h.name)}</h2>
      <button class="icon-btn" data-act="close-sheet" aria-label="Close">${icons.close}</button></header>
    <div class="card">
      <p style="margin-top:0">Was there an anomaly behind it? Add it as the reason. It also goes into ${esc(relativeDayLabel(date).toLowerCase())}'s anomalies.</p>
      ${existing.length ? `<p class="note">Pick one already logged:</p>
        <div class="bubbles">${existing.map((a) => `<button type="button" class="bubble bubble-pick" data-act="sr-pick" data-id="${a.id}">⚡ ${esc(a.text)}</button>`).join('')}</div>
        <p class="note">…or add a new one:</p>` : ''}
      <form class="an-form" id="sr-form" autocomplete="off">
        <input name="text" placeholder="e.g. Sick, travelling, late night" maxlength="120" enterkeyhint="done">
        <button class="btn btn-primary sm">Add</button>
      </form>
      <div class="btn-row" style="margin-top:14px">
        <button type="button" class="btn" data-act="sr-none">Skip without a reason</button>
        <button type="button" class="btn" data-act="sr-undo">Undo skip</button>
      </div>
    </div>`);
  const done = (msg) => { closeSheet(); toast(msg, [{ label: 'Undo', fn: () => unskipHabit(key, id) }]); };
  el.querySelector('#sr-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = e.target.elements.text.value;
    if (!text.trim()) return;
    const a = addAnomaly(key, text);
    skipHabit(key, id, a.id);
    done(`Skipped ${h.name} · ${a.text}`);
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'sr-pick') {
      skipHabit(key, id, b.dataset.id);
      done(`Skipped ${h.name}`);
    }
    if (b.dataset.act === 'sr-none') done(`Skipped ${h.name}`);
    if (b.dataset.act === 'sr-undo') { unskipHabit(key, id); closeSheet(); }
  });
}

/* ================= KEYPAD ================= */

export function openKeypad(id, date, onLogged) {
  const key = dkey(date);
  let entry = '';
  const render = () => {
    const s = getState();
    const h = getHabit(id);
    const st = status(s, h, date);
    const remaining = hasMin(h) ? Math.round(Math.max(0, h.min - st.value) * 100) / 100 : 0;
    const chips = [];
    if (h.step > 0) chips.push([h.step, `${num(h.step)} ${h.unit}`]);
    if (remaining > 0 && remaining !== h.step) chips.push([remaining, `Rest of goal · ${num(remaining)}`]);
    return `<header class="sheet-head"><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icons.close}</button>
        <h2>${esc(h.emoji)} ${esc(h.name)}</h2><span class="icon-btn placeholder"></span></header>
      <div class="keypad" style="--c:${colorOf(h)}">
        <p class="note center">${esc(relativeDayLabel(date))}: <b>${fmtNum(st.value)}</b> ${esc(h.unit)}${h.period !== 'day' ? ` this ${h.period}` : ''} · ${esc(goalText(h).split(',')[0])}</p>
        <div class="kp-display">${esc(entry || '0')}<small>${esc(h.unit)}</small></div>
        ${chips.length ? `<div class="kp-chips">${chips.map(([v, l]) => `<button class="pill" data-act="kp-chip" data-v="${v}">${esc(l)}</button>`).join('')}</div>` : ''}
        <div class="kp-grid">
          ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map((k) => `<button data-act="kp-key" data-k="${k}">${k}</button>`).join('')}
          <button data-act="kp-back" aria-label="Delete">${icons.back}</button>
        </div>
        <div class="btn-row">
          <button class="btn" data-act="kp-set" ${entry ? '' : 'disabled'}>Set day total</button>
          <button class="btn btn-primary" data-act="kp-add" ${entry ? '' : 'disabled'}>Add ${esc(entry || '')} ${esc(h.unit)}</button>
        </div>
      </div>`;
  };
  const rerender = () => { const e = sheetEl(); if (e) e.innerHTML = render(); };
  const press = (k) => {
    if (k === 'back') entry = entry.slice(0, -1);
    else if (k === '.') { if (!entry.includes('.')) entry = (entry || '0') + '.'; }
    else if (entry.replace('.', '').length < 7) entry = entry === '0' ? k : entry + k;
    rerender();
  };
  const commitEntry = (mode) => {
    const v = parseFloat(entry);
    if (!Number.isFinite(v) || v < 0) return;
    const before = getLog(id, key);
    setLog(id, key, mode === 'add' ? before + v : v);
    closeSheet();
    onLogged?.(id, date, before);
  };
  const onKey = (e) => {
    if (/^[0-9.]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter' && entry) commitEntry('add');
  };
  document.addEventListener('keydown', onKey);
  const el = openSheet(render(), { onClose: () => document.removeEventListener('keydown', onKey) });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'kp-key') press(b.dataset.k);
    if (act === 'kp-back') press('back');
    if (act === 'kp-chip') { entry = String(Number(b.dataset.v)); rerender(); }
    if (act === 'kp-add') commitEntry('add');
    if (act === 'kp-set') commitEntry('set');
  });
}
