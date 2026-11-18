// Main tab views. Each returns an HTML string; app.js wires up events via data-act.
import {
  esc, dkey, parseKey, today, addDays, startOfWeek, fmtNum, relativeDayLabel, MONTHS, DOW_SHORT,
} from './util.js';
import {
  topLevel, childrenOf, isDue, isScheduled, isSkipped, status, streaks, dayCompletion, monthStats,
  overallMonth, dayIntensity, goalText, isParent, hasMin, tapModeOf, weekStats, isQuota, quotaStatus, quotaPeriod, cyclePeriod,
} from './logic.js';
import { skipReason, isSkippedOn } from './store.js';
import { ring, heatmap, monthGrid, colorOf, icons } from './components.js';
import { SOURCES } from './integrations.js';

const groupName = (s, id) => (id === 'all' ? 'All' : s.groups.find((g) => g.id === id)?.name || 'All');

function groupPill(s, ui) {
  return `<button class="pill group-pill" data-act="pick-group">${esc(groupName(s, ui.group))} ${icons.chevD}</button>`;
}

/* ================= TODAY ================= */

export function progressLabel(h, st) {
  if (st.parent) return `${st.value}/${st.target} done`;
  const u = esc(h.unit);
  if (h.kind === 'range') return `${fmtNum(st.value)} · ${fmtNum(h.min)}–${fmtNum(h.max)} ${u}`;
  return `${fmtNum(st.value)}/${fmtNum(h.kind === 'max' ? h.max : h.min)} ${u}`;
}

const periodHint = (h) => (h.period === 'week' ? 'this week' : h.period === 'month' ? 'this month' : '');

function kindHint(h, st) {
  if (st.parent) return '';
  if (st.over) return h.kind === 'range' ? 'over max' : 'over limit';
  if (h.kind === 'max') return 'limit';
  if (h.kind === 'range') return st.done ? 'in range' : 'range';
  return '';
}

// "3 days a week": one dot per required day, filled for each day done this week/month
function quotaDots(q) {
  if (q.need > 10) return `<span class="qcount">${q.met}/${q.need}</span>`;
  const n = Math.max(q.need, Math.min(q.met, 10));
  return `<span class="qdots" aria-label="${q.met} of ${q.need} days">${Array.from({ length: n }, (_, i) => `<i class="${i < q.met ? 'on' : ''}${i >= q.need ? ' extra' : ''}"></i>`).join('')}</span>`;
}

function actionButton(h, st, future) {
  if (future || st.parent) return '';
  const mode = tapModeOf(h);
  let inner = mode === 'done' ? icons.check : mode === 'keypad' ? icons.keypad : icons.plus;
  let cls = 'hbtn';
  if (st.done && h.kind === 'min') { inner = icons.check; cls += ' hbtn-done'; }
  return `<button class="${cls}" data-act="tap" data-id="${h.id}" aria-label="Log ${esc(h.name)}">${inner}</button>`;
}

// Order on Today: still to do → done → skipped (each group keeps your manual order)
function sinkFinished(s, list, date) {
  const rank = (h) => {
    if (isSkipped(s, h, date)) return 2;
    const st = status(s, h, date);
    if (st.done && h.kind !== 'max') return 1;
    // weekly/monthly quota already met → nothing required today
    return isQuota(h) && quotaStatus(s, h, date).done ? 1 : 0;
  };
  return list.map((h, i) => ({ h, i, r: rank(h) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.h);
}

function habitCard(s, h, date, ui, future, child = false) {
  const key = dkey(date);
  const skipped = isSkipped(s, h, date);
  const st = status(s, h, date);
  const color = colorOf(h);
  const fill = skipped ? 0 : Math.min(1, st.ratio);
  const sk = streaks(s, h);
  const kids = childrenOf(s, h.id).filter((k) => isScheduled(s, k, date));
  const collapsed = ui.collapsed.has(h.id);
  const kindCls = skipped ? '' : st.over ? ' over' : h.kind === 'max' ? ' quit' : '';
  // "done" look: reached the minimum (and, for ranges, not over the max)
  const doneCls = !skipped && st.done && h.kind !== 'max' ? ' done' : '';
  const q = isQuota(h) && !st.parent ? quotaStatus(s, h, date) : null;
  const hint = q ? `${q.need}×/${quotaPeriod(h)}` : periodHint(h);
  const kHint = kindHint(h, st);
  const group = !child && h.groupId ? s.groups.find((g) => g.id === h.groupId) : null;
  const streakTxt = !skipped && sk.current > 0 ? `<span class="hstreak">${icons.fire} ${sk.current} ${sk.unit}${sk.current > 1 ? 's' : ''}</span>` : '';
  const reason = skipped ? skipReason(key, h.id) || (h.parentId ? skipReason(key, h.parentId) : null) : null;
  let meta = skipped
    ? `<span class="hbadge">Skipped</span>${reason ? `<span class="bubble mini">⚡ ${esc(reason.text)}</span>` : ''}`
    : `<span class="hbadge">${progressLabel(h, st)}</span>${hint ? `<span class="hhint">${hint}</span>` : ''}${kHint ? `<span class="hhint">${kHint}</span>` : ''}`;
  const kidsHtml = kids.length && !collapsed
    ? `<div class="hkids">${sinkFinished(s, kids, date).map((k) => habitCard(s, k, date, ui, future, true)).join('')}</div>` : '';
  const directlySkipped = isSkippedOn(key, h.id);
  const noSwipe = future || (skipped && !directlySkipped);
  return `<article class="hcard${doneCls}${kindCls}${child ? ' hchild' : ''}${skipped ? ' skipped' : ''}" style="--c:${color}" data-hid="${h.id}"${noSwipe ? ' data-noswipe="1"' : ''}>
    <div class="hslide">
      <div class="hswipe"><span>${directlySkipped ? '↩ Unskip' : '⤼ Skip today'}</span></div>
      <div class="hface">
        <div class="hfill" style="width:${(fill * 100).toFixed(1)}%"></div>
        ${!skipped && st.minMark != null && !st.done && !st.over ? `<div class="hmin" style="left:${(st.minMark * 100).toFixed(1)}%" title="minimum"></div>` : ''}
        <div class="hrow">
          <button class="hmain" data-act="open-habit" data-id="${h.id}">
            <span class="hemoji">${esc(h.emoji)}</span>
            <span class="htext">
              <span class="hname">${esc(h.name)}${group ? ` <span class="hgroup">(${esc(group.name)})</span>` : ''}</span>
              <span class="hmeta">${meta}</span>
            </span>
          </button>
          <div class="hside">
            ${streakTxt}
            ${kids.length ? `<button class="hbtn hbtn-ghost" data-act="toggle-kids" data-id="${h.id}" aria-label="Show subhabits">${collapsed ? icons.down : icons.up}</button>` : ''}
            ${q ? `<div class="hbtn-col">${skipped ? '' : actionButton(h, st, future)}${quotaDots(q)}</div>` : skipped ? '' : actionButton(h, st, future)}
          </div>
        </div>
      </div>
    </div>
    ${kidsHtml}
  </article>`;
}

export function backupDue(s) {
  const every = s.settings.backupEvery;
  if (every === 'off' || !s.habits.length) return false;
  if (!s.settings.lastBackup) return true;
  const days = (Date.now() - new Date(s.settings.lastBackup)) / 86400000;
  return days >= (every === 'daily' ? 1 : 7);
}

// Weekly review banner: shown for the first 3 days of a week, until opened or dismissed.
export function pendingReview(s) {
  const t = today();
  const thisWs = startOfWeek(t, s.settings.weekStart);
  if ((t - thisWs) / 86400000 >= 3) return null;
  const prev = addDays(thisWs, -7);
  const key = dkey(prev);
  if (s.settings.reviewSeen === key) return null;
  if (!s.habits.some((h) => !h.archived && parseKey(h.createdAt) <= addDays(prev, 6))) return null;
  return prev;
}

export const weekLabel = (ws) => {
  const f = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${f(ws)} – ${f(addDays(ws, 6))}`;
};

function banners(s, ui) {
  const out = [];
  const rev = pendingReview(s);
  if (rev) {
    out.push(`<div class="banner">
      <button class="banner-main" data-act="open-review" data-week="${dkey(rev)}">📊 <span><b>Your weekly review is ready</b><small>${esc(weekLabel(rev))}</small></span></button>
      <button class="banner-x" data-act="dismiss-review" data-week="${dkey(rev)}" aria-label="Dismiss">×</button></div>`);
  }
  if (!ui.backupSnoozed && backupDue(s)) {
    const last = s.settings.lastBackup ? `Last backup ${new Date(s.settings.lastBackup).toLocaleDateString()}` : 'No backup yet';
    out.push(`<div class="banner banner-backup">
      <button class="banner-main" data-act="backup-now">☁️ <span><b>Back up to iCloud Drive</b><small>${esc(last)} · tap to back up</small></span></button>
      <button class="banner-x" data-act="backup-later" aria-label="Later">×</button></div>`);
  }
  return out.join('');
}

export function renderToday(s, ui) {
  const sel = ui.selected;
  const t = today();
  const future = sel > t;
  const ws = startOfWeek(sel, s.settings.weekStart);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const c = dayCompletion(s, d, ui.group);
    const isSel = dkey(d) === dkey(sel);
    const isToday = dkey(d) === dkey(t);
    days.push(`<button class="day${isSel ? ' sel' : ''}${isToday ? ' is-today' : ''}${d > t ? ' future' : ''}" data-act="select-day" data-date="${dkey(d)}">
      <span class="dow">${DOW_SHORT[d.getDay()]}</span>
      ${ring(d > t ? 0 : c.ratio, String(d.getDate()), { size: 40, stroke: 3, cls: c.total && c.done === c.total ? 'ring-full' : '' })}
      <i class="an-dot${s.anomalies[dkey(d)]?.length ? ' on' : ''}"></i>
    </button>`);
  }

  const habits = sinkFinished(s, topLevel(s, ui.group).filter((h) => isScheduled(s, h, sel)), sel);
  const cards = habits.map((h) => habitCard(s, h, sel, ui, future)).join('');

  const pending = !future && habits.some((h) => {
    const st = status(s, h, sel);
    return isDue(s, h, sel) && hasMin(h) && !st.done && !st.over;
  });

  const empty = s.habits.filter((h) => !h.archived).length === 0
    ? `<div class="empty"><div class="empty-emoji">🌱</div><p>No habits yet.</p><button class="btn btn-primary" data-act="new-habit">Create your first habit</button></div>`
    : habits.length === 0 ? `<div class="empty"><p>Nothing due ${sel.getTime() === t.getTime() ? 'today' : 'on this day'}.</p></div>` : '';

  return `<header class="top">
      ${groupPill(s, ui)}
      <div class="top-title">
        <button class="icon-btn sm" data-act="shift-day" data-n="-1" aria-label="Previous day">${icons.chevL}</button>
        <h1 data-act="go-today">${esc(relativeDayLabel(sel))}</h1>
        <button class="icon-btn sm" data-act="shift-day" data-n="1" aria-label="Next day">${icons.chevR}</button>
      </div>
      <button class="icon-btn" data-act="sync" aria-label="Sync from iPhone">${icons.sync}</button>
    </header>
    <div class="week-strip" id="week-strip">${days.join('')}</div>
    ${banners(s, ui)}
    ${future ? '<p class="note center">Future day — you can look, but not log.</p>' : ''}
    <div class="habit-list" id="habit-list">${cards}${empty}</div>
    ${habits.length && !s.settings.gestureHintSeen ? '<p class="note center gesture-hint">Hold a habit to drag it · swipe left to skip it today</p>' : ''}
    ${pending ? '<div class="center"><button class="pill pill-soft" data-act="complete-all">✅ Complete all</button></div>' : ''}
    ${anomalySection(s, ui)}`;
}

/* ---------- anomalies: one-off events that knocked the routine off ---------- */

export const bubbles = (list, removable = false) => list.map((a) => `<span class="bubble">${esc(a.text)}${removable
  ? `<button type="button" data-act="an-del" data-id="${a.id}" aria-label="Remove">×</button>` : ''}</span>`).join('');

function anomalySection(s, ui) {
  const list = s.anomalies[dkey(ui.selected)] || [];
  return `<section class="card anomalies" data-act="an-open">
    <div class="an-head"><h2>⚡ Anomalies</h2>${!list.length && !ui.anOpen ? '<small>Anything off-routine? Tap to add.</small>' : ''}</div>
    ${list.length || !ui.anOpen ? `<div class="bubbles">${bubbles(list, true)}${ui.anOpen ? '' : '<span class="bubble bubble-add">+ Add</span>'}</div>` : ''}
    ${ui.anOpen ? `<form class="an-form" id="an-form" autocomplete="off">
      <input name="text" placeholder="e.g. Out late with friends" maxlength="120" enterkeyhint="done">
      <button class="btn btn-primary sm">Add</button>
      <button type="button" class="btn sm" data-act="an-close">Done</button>
    </form>` : ''}
  </section>`;
}

/* ================= STATS ================= */

const statsSwitch = (ui) => `<div class="switch">
  <button class="${ui.statsMode === 'week' ? 'on' : ''}" data-act="stats-mode" data-mode="week">Weekly review</button>
  <button class="${ui.statsMode !== 'week' ? 'on' : ''}" data-act="stats-mode" data-mode="month">Month</button>
</div>`;

const pct = (r) => `${Math.round(r * 100)}%`;
const DAY_MARK = { done: '✓', miss: '', over: '!', skip: '⤼', off: '', future: '', logged: '•' };

export function renderStats(s, ui) {
  if (ui.statsMode === 'week') return renderWeekReview(s, ui);
  const m = ui.statsMonth;
  const ov = overallMonth(s, m, ui.group);
  const habits = topLevel(s, ui.group);
  const flat = [];
  habits.forEach((h) => { flat.push(h); childrenOf(s, h.id).forEach((k) => flat.push(k)); });
  let checkins = 0;
  let bestStreak = { n: 0, h: null };
  const cards = flat.map((h) => {
    const ms = monthStats(s, h, m);
    const sk = streaks(s, h);
    checkins += ms.activeDays;
    if (sk.current > bestStreak.n) bestStreak = { n: sk.current, h };
    const color = colorOf(h);
    const unitLabel = sk.unit + (sk.best === 1 ? '' : 's');
    const totalTxt = isParent(s, h) ? `${ms.done} complete days` : `${fmtNum(ms.total)} ${esc(h.unit)} logged`;
    return `<button class="stat-habit${h.parentId ? ' stat-child' : ''}" data-act="open-habit" data-id="${h.id}" style="--c:${color}">
      <div class="sh-head">
        <span class="hemoji sm">${esc(h.emoji)}</span>
        <div class="sh-title"><b>${esc(h.name)}</b><small>${ms.done}/${ms.due} ${cyclePeriod(s, h)}s · ${totalTxt}</small></div>
        ${ring(ms.rate, `${Math.round(ms.rate * 100)}%`, { size: 46, stroke: 4, color })}
      </div>
      <div class="sh-body">
        ${monthGrid(m, (d) => dayIntensity(s, h, d), { color, weekStart: s.settings.weekStart, showNums: false })}
        <div class="sh-streak"><div><b>${sk.current}</b><small>current</small></div><div><b>${sk.best}</b><small>best ${unitLabel}</small></div></div>
      </div>
    </button>`;
  }).join('');

  const isCurrentMonth = m.getFullYear() === today().getFullYear() && m.getMonth() === today().getMonth();
  return `<header class="top">
      ${groupPill(s, ui)}
      <div class="top-title">
        <button class="icon-btn sm" data-act="shift-month" data-n="-1" aria-label="Previous month">${icons.chevL}</button>
        <h1>${MONTHS[m.getMonth()].slice(0, 3)} ${m.getFullYear()}</h1>
        <button class="icon-btn sm" data-act="shift-month" data-n="1" aria-label="Next month" ${isCurrentMonth ? 'disabled' : ''}>${icons.chevR}</button>
      </div>
      <span class="icon-btn placeholder"></span>
    </header>
    ${statsSwitch(ui)}
    <div class="tiles">
      <div class="tile"><b>${Math.round(ov.rate * 100)}%</b><small>completion</small></div>
      <div class="tile"><b>${ov.perfect}</b><small>perfect days</small></div>
      <div class="tile"><b>${checkins}</b><small>check-ins</small></div>
      <div class="tile"><b>${bestStreak.n}</b><small>${bestStreak.h ? `top streak · ${esc(bestStreak.h.emoji)}` : 'top streak'}</small></div>
    </div>
    <section class="card">
      <h2>Month overview</h2>
      ${monthGrid(m, (d) => (d > today() ? null : (() => { const c = dayCompletion(s, d, ui.group); return c.total ? c.ratio : null; })()), { weekStart: s.settings.weekStart })}
    </section>
    ${monthAnomalies(s, m)}
    <section class="card">
      <h2>Last 6 months</h2>
      ${heatmap((d) => { const c = dayCompletion(s, d, ui.group); return c.total ? c.ratio : null; }, { weeks: 26, weekStart: s.settings.weekStart })}
      <div class="legend"><span>Less</span><i class="hm-cell hm-zero"></i><i class="hm-cell" style="background:color-mix(in srgb, var(--accent) 45%, var(--hm-empty))"></i><i class="hm-cell" style="background:color-mix(in srgb, var(--accent) 75%, var(--hm-empty))"></i><i class="hm-cell" style="background:var(--accent)"></i><span>More</span></div>
    </section>
    <h2 class="section-title">Habits</h2>
    <div class="stat-list">${cards || '<p class="note">No habits to show.</p>'}</div>`;
}

/* ---------- weekly review ---------- */

function weekOverview(s, ws, groupId) {
  const t = today();
  let done = 0;
  let total = 0;
  let perfect = 0;
  let anDone = 0;
  let anTotal = 0;
  let normDone = 0;
  let normTotal = 0;
  const daily = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    if (d > t) { daily.push(null); continue; }
    const c = dayCompletion(s, d, groupId);
    daily.push(c);
    done += c.done;
    total += c.total;
    if (c.total && c.done === c.total) perfect++;
    if (s.anomalies[dkey(d)]?.length) { anDone += c.done; anTotal += c.total; } else { normDone += c.done; normTotal += c.total; }
  }
  return {
    daily, perfect, rate: total ? done / total : null,
    anomalyRate: anTotal ? anDone / anTotal : null,
    normalRate: normTotal ? normDone / normTotal : null,
  };
}

function renderWeekReview(s, ui) {
  const ws = ui.reviewWeek;
  const prevWs = addDays(ws, -7);
  const t = today();
  const isCurrent = dkey(ws) === dkey(startOfWeek(t, s.settings.weekStart));
  const ov = weekOverview(s, ws, ui.group);
  const prev = weekOverview(s, prevWs, ui.group);

  const flat = [];
  topLevel(s, ui.group).forEach((h) => { flat.push(h); childrenOf(s, h.id).forEach((k) => flat.push(k)); });
  const rows = flat
    .filter((h) => parseKey(h.createdAt) <= addDays(ws, 6))
    .map((h) => ({ h, w: weekStats(s, h, ws), p: weekStats(s, h, prevWs) }));

  let skips = 0;
  const anomalyDays = [];
  for (let i = 0; i < 7; i++) {
    const k = dkey(addDays(ws, i));
    skips += Object.keys(s.skips[k] || {}).length;
    if (s.anomalies[k]?.length) anomalyDays.push(k);
  }

  // highlights
  const rated = rows.filter((r) => r.w.rate != null && r.w.due >= 2);
  const best = rated.slice().sort((a, b) => b.w.rate - a.w.rate || b.w.due - a.w.due)[0];
  const worst = rated.slice().sort((a, b) => a.w.rate - b.w.rate || b.w.due - a.w.due)[0];
  const improved = rows
    .filter((r) => r.w.rate != null && r.p.rate != null)
    .map((r) => ({ ...r, d: r.w.rate - r.p.rate }))
    .sort((a, b) => b.d - a.d)[0];
  const lines = [];
  if (best && best.w.rate > 0) lines.push(`🏆 <b>Best:</b> ${esc(best.h.emoji)} ${esc(best.h.name)} — ${best.w.done}/${best.w.due} (${pct(best.w.rate)})`);
  if (worst && worst !== best && worst.w.rate < 1) lines.push(`🎯 <b>Needs attention:</b> ${esc(worst.h.emoji)} ${esc(worst.h.name)} — ${worst.w.done}/${worst.w.due} (${pct(worst.w.rate)})`);
  if (improved && improved.d > 0.05) lines.push(`📈 <b>Most improved:</b> ${esc(improved.h.emoji)} ${esc(improved.h.name)} (+${Math.round(improved.d * 100)} pts)`);
  if (ov.anomalyRate != null && ov.normalRate != null) {
    lines.push(`⚡ <b>Anomaly days:</b> ${pct(ov.anomalyRate)} done vs ${pct(ov.normalRate)} on normal days`);
  }
  const overs = rows.filter((r) => r.w.days.includes('over'));
  if (overs.length) lines.push(`⚠️ <b>Went over a maximum:</b> ${overs.map((r) => `${esc(r.h.emoji)} ${esc(r.h.name)} (${r.w.days.filter((x) => x === 'over').length}×)`).join(', ')}`);

  const delta = ov.rate != null && prev.rate != null ? Math.round((ov.rate - prev.rate) * 100) : null;
  const deltaHtml = delta == null ? '<small>completion</small>'
    : `<small class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} pts vs last week</small>`;

  const bars = ov.daily.map((c, i) => {
    const d = addDays(ws, i);
    const h = c && c.total ? c.ratio : 0;
    return `<button class="bar" data-act="goto-day" data-date="${dkey(d)}">
      <span class="bar-track"><span class="bar-fill" style="height:${Math.round(h * 100)}%"></span></span>
      <small>${DOW_SHORT[d.getDay()]}</small>
      <i class="an-dot${s.anomalies[dkey(d)]?.length ? ' on' : ''}"></i>
    </button>`;
  }).join('');

  const habitRows = rows.map(({ h, w, p }) => {
    const color = colorOf(h);
    let right = '';
    if (w.period === 'month') right = `<span class="wr-rate">${pct(w.progress || 0)}<small>of month</small></span>`;
    else if (w.rate != null) {
      const dd = p.rate != null ? Math.round((w.rate - p.rate) * 100) : null;
      right = `<span class="wr-rate">${pct(w.rate)}${dd ? `<small class="${dd > 0 ? 'up' : 'down'}">${dd > 0 ? '▲' : '▼'}${Math.abs(dd)}</small>` : '<small>&nbsp;</small>'}</span>`;
    }
    const dots = w.period === 'day' || w.quota || isParent(s, h)
      ? `<span class="wr-days">${w.days.map((st) => `<i class="wd wd-${st}">${DAY_MARK[st]}</i>`).join('')}</span>`
      : `<span class="wr-note">${w.period === 'week' ? (w.done ? '✓ weekly goal met' : `${fmtNum(w.total)} ${esc(h.unit)} logged`) : `${fmtNum(w.total)} ${esc(h.unit)} this week`}</span>`;
    return `<button class="wr-row${h.parentId ? ' stat-child' : ''}" data-act="open-habit" data-id="${h.id}" style="--c:${color}">
      <span class="hemoji sm">${esc(h.emoji)}</span>
      <span class="wr-mid"><b>${esc(h.name)}</b>${dots}</span>
      ${right}
    </button>`;
  }).join('');

  return `<header class="top">
      ${groupPill(s, ui)}
      <div class="top-title">
        <button class="icon-btn sm" data-act="shift-week" data-n="-1" aria-label="Previous week">${icons.chevL}</button>
        <h1 class="h1-sm">${esc(weekLabel(ws))}</h1>
        <button class="icon-btn sm" data-act="shift-week" data-n="1" aria-label="Next week" ${isCurrent ? 'disabled' : ''}>${icons.chevR}</button>
      </div>
      <span class="icon-btn placeholder"></span>
    </header>
    ${statsSwitch(ui)}
    ${isCurrent ? '<p class="note center">This week so far</p>' : ''}
    <div class="tiles">
      <div class="tile"><b>${ov.rate == null ? '–' : pct(ov.rate)}</b>${deltaHtml}</div>
      <div class="tile"><b>${ov.perfect}</b><small>perfect days</small></div>
      <div class="tile"><b>${skips}</b><small>skips</small></div>
      <div class="tile"><b>${anomalyDays.length}</b><small>anomaly days</small></div>
    </div>
    <section class="card"><h2>Day by day</h2><div class="bars">${bars}</div></section>
    ${lines.length ? `<section class="card highlights"><h2>Highlights</h2>${lines.map((l) => `<p>${l}</p>`).join('')}</section>` : ''}
    <section class="card"><h2>Habits</h2>
      <div class="wr-legend"><i class="wd wd-done">✓</i> done <i class="wd wd-miss"></i> missed <i class="wd wd-over">!</i> over max <i class="wd wd-skip">⤼</i> skipped</div>
      ${habitRows || '<p class="note">No habits this week.</p>'}
    </section>
    ${anomalyDays.length ? `<section class="card"><h2>⚡ Anomalies</h2>${anomalyDays.map((k) => {
    const d = parseKey(k);
    return `<button class="an-day" data-act="goto-day" data-date="${k}">
        <span class="an-date"><b>${d.getDate()}</b><small>${DOW_SHORT[d.getDay()]}</small></span>
        <span class="bubbles">${bubbles(s.anomalies[k])}</span></button>`;
  }).join('')}</section>` : ''}`;
}

function monthAnomalies(s, m) {
  const prefix = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-`;
  const days = Object.keys(s.anomalies).filter((k) => k.startsWith(prefix) && s.anomalies[k].length).sort();
  if (!days.length) return '';
  return `<section class="card">
    <h2>⚡ Anomalies this month</h2>
    ${days.map((k) => {
    const d = parseKey(k);
    const c = dayCompletion(s, d);
    return `<button class="an-day" data-act="goto-day" data-date="${k}">
      <span class="an-date"><b>${d.getDate()}</b><small>${DOW_SHORT[d.getDay()]}</small></span>
      <span class="bubbles">${bubbles(s.anomalies[k])}</span>
      ${c.total ? `<small class="an-score">${c.done}/${c.total}</small>` : ''}
    </button>`;
  }).join('')}
  </section>`;
}

/* ================= HABITS (manage) ================= */

function manageRow(s, h, child = false) {
  return `<div class="mrow${child ? ' mchild' : ''}" style="--c:${colorOf(h)}">
    <button class="mmain" data-act="edit-habit" data-id="${h.id}">
      <span class="hemoji sm">${esc(h.emoji)}</span>
      <span class="mtext"><b>${esc(h.name)}</b><small>${isParent(s, h) ? `${childrenOf(s, h.id).length} subhabits` : esc(goalText(h))}${h.source ? ` · ⇄ ${esc(sourceLabel(h.source))}` : ''}</small></span>
    </button>
    <button class="icon-btn sm" data-act="move" data-id="${h.id}" data-n="-1" aria-label="Move up">${icons.up}</button>
    <button class="icon-btn sm" data-act="move" data-id="${h.id}" data-n="1" aria-label="Move down">${icons.down}</button>
  </div>`;
}

export function sourceLabel(src) {
  if (src.startsWith('app:')) return `${src.slice(4)} screen time`;
  return SOURCES.find((x) => x.id === src)?.label.replace(' (Apple Health)', '') || src;
}

export function renderHabits(s) {
  const tl = topLevel(s, 'all');
  const sections = [...s.groups, { id: null, name: 'No group' }].map((g) => {
    const list = tl.filter((h) => (h.groupId || null) === g.id);
    if (!list.length && g.id === null) return '';
    const rows = list.map((h) => manageRow(s, h) + childrenOf(s, h.id).map((k) => manageRow(s, k, true)).join('')).join('');
    return `<section class="card mgroup">
      <div class="mgroup-head">
        <h2>${esc(g.name)}</h2>
        ${g.id ? `<button class="link" data-act="rename-group" data-id="${g.id}">Rename</button><button class="link danger" data-act="delete-group" data-id="${g.id}">Delete</button>` : ''}
      </div>
      ${rows || '<p class="note">No habits in this group.</p>'}
    </section>`;
  }).join('');
  const archived = s.habits.filter((h) => h.archived);
  return `<header class="top"><span class="icon-btn placeholder"></span><h1>Habits</h1><span class="icon-btn placeholder"></span></header>
    <div class="btn-row">
      <button class="btn btn-primary" data-act="new-habit">${icons.plus} New habit</button>
      <button class="btn" data-act="new-group">New group</button>
    </div>
    ${sections}
    ${archived.length ? `<section class="card"><h2>Archived</h2>${archived.map((h) => `<div class="mrow" style="--c:${colorOf(h)}">
        <span class="mmain"><span class="hemoji sm">${esc(h.emoji)}</span><span class="mtext"><b>${esc(h.name)}</b></span></span>
        <button class="link" data-act="unarchive" data-id="${h.id}">Restore</button>
        <button class="link danger" data-act="delete-habit" data-id="${h.id}">Delete</button></div>`).join('')}</section>` : ''}`;
}

/* ================= SETTINGS ================= */

export function renderSettings(s) {
  const st = s.settings;
  const last = st.lastSync ? new Date(st.lastSync).toLocaleString() : 'never';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return `<header class="top"><span class="icon-btn placeholder"></span><h1>Settings</h1><span class="icon-btn placeholder"></span></header>
    ${standalone ? '' : `<section class="card callout">
      <h2>📲 Install on your iPhone</h2>
      <p>Open this page in <b>Safari</b>, tap <b>Share</b> → <b>Add to Home Screen</b>. It then opens full-screen like a normal app and works offline.</p>
    </section>`}
    <section class="card">
      <h2>Appearance</h2>
      <label class="field-row"><span>Theme</span>
        <select data-setting="theme">${['auto', 'light', 'dark'].map((v) => `<option value="${v}" ${st.theme === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>
      <label class="field-row"><span>Week starts on</span>
        <select data-setting="weekStart"><option value="1" ${st.weekStart === 1 ? 'selected' : ''}>Monday</option><option value="0" ${st.weekStart === 0 ? 'selected' : ''}>Sunday</option></select></label>
    </section>

    <section class="card">
      <h2>Sync from iPhone (Apple Health · Mi Fitness · Screen time)</h2>
      <p class="note">Last sync: ${esc(last)}</p>
      <label class="field-row"><span>Sync shortcut name</span><input type="text" data-setting="syncShortcut" value="${esc(st.syncShortcut)}"></label>
      <div class="btn-row">
        <button class="btn btn-primary" data-act="sync">${icons.sync} Run sync</button>
        <button class="btn" data-act="paste-sync">Paste from clipboard</button>
      </div>
      <details class="manual"><summary>Paste data manually</summary>
        <textarea id="sync-text" rows="5" placeholder="date=2026-11-15&#10;steps=6421&#10;sleep=7.5"></textarea>
        <button class="btn" data-act="import-sync-text">Import</button>
      </details>
    </section>

    <section class="card guides">
      <h2>Setup guides</h2>
      ${GUIDES}
    </section>

    <section class="card">
      <h2>☁️ Backups</h2>
      <p class="note">Your data lives only inside this app. If you delete the Home Screen icon, it's gone, so keep copies in iCloud Drive.</p>
      <p class="note">Last backup: <b>${st.lastBackup ? esc(new Date(st.lastBackup).toLocaleString()) : 'never'}</b>${backupDue(s) ? ' · <span class="warn">due</span>' : ''}</p>
      <div class="btn-row">
        <button class="btn btn-primary" data-act="backup-now">Back up via Shortcut</button>
        <button class="btn" data-act="backup-file">Save backup file…</button>
      </div>
      <label class="field-row"><span>Remind me to back up</span>
        <select data-setting="backupEvery">${[['daily', 'Daily'], ['weekly', 'Weekly'], ['off', 'Never']].map(([v, l]) => `<option value="${v}" ${st.backupEvery === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field-row"><span>Backup shortcut name</span><input type="text" data-setting="backupShortcut" value="${esc(st.backupShortcut)}"></label>
      <h3 style="margin-top:14px">Restore</h3>
      <p class="note">Pick a backup file. Find it in Files → iCloud Drive → Shortcuts → Habit Backups. Restoring <b>replaces</b> everything in the app.</p>
      <div class="btn-row">
        <label class="btn">Restore from backup…<input type="file" accept="application/json,.json,text/plain,.txt" data-act-change="import-file" hidden></label>
      </div>
    </section>

    <section class="card">
      <h2>Danger zone</h2>
      <div class="btn-row">
        <button class="btn danger" data-act="reset" data-samples="0">Erase everything</button>
        <button class="btn" data-act="reset" data-samples="1">Reload sample habits</button>
      </div>
    </section>
    <p class="note center">Habits · offline web app · v6</p>`;
}

const GUIDES = `
<details><summary>1 · Get Mi Band data into Apple Health</summary>
  <ol>
    <li>Open the <b>Mi Fitness</b> app → <b>Profile</b> → <b>Third-party data</b> (or <b>Connect to other apps</b>) → <b>Apple Health</b>.</li>
    <li>Turn on sharing and allow <b>Steps</b>, <b>Workouts</b>, <b>Sleep</b> and anything else you want.</li>
    <li>From now on Mi Fitness writes your band's data into Apple Health, and the sync shortcut below reads it from there.</li>
  </ol>
</details>
<details><summary>2 · Create the “Habit Sync” shortcut (Health → this app)</summary>
  <ol>
    <li>Open <b>Shortcuts</b> → <b>+</b> and name it exactly <b>Habit Sync</b> (or change the name in the field above).</li>
    <li><b>Find Health Samples</b> → Type <b>Steps</b>, Start Date <b>is today</b>. Add <b>Calculate Statistics</b> → <b>Sum</b>. Then <b>Set Variable</b> <code>Steps</code>.</li>
    <li><b>Find Health Samples</b> → Type <b>Workouts</b>, Start Date <b>is today</b>. Add <b>Get Details of Health Sample</b> → <b>Duration</b>, then <b>Calculate Statistics</b> → <b>Sum</b>. Use <b>Convert Measurement</b> to <b>minutes</b> if needed. <b>Set Variable</b> <code>Workout</code>.</li>
    <li><b>Find Health Samples</b> → Type <b>Sleep Analysis</b>, Start Date <b>is in the last 1 day</b>, Value <b>is not In Bed</b> and <b>is not Awake</b>. Get <b>Duration</b>, <b>Sum</b> it, convert to <b>hours</b>. <b>Set Variable</b> <code>Sleep</code>.</li>
    <li>(Optional, for screen time) <b>Get File</b> from <b>Shortcuts</b> folder → path <code>habit-apps.txt</code>, turn off “Error if not found”. <b>Set Variable</b> <code>AppLog</code>.</li>
    <li>Add a <b>Text</b> action with these lines:<pre>date=[Current Date, format yyyy-MM-dd]
steps=[Steps]
workout=[Workout]
sleep=[Sleep]
[AppLog]</pre></li>
    <li><b>Copy to Clipboard</b> (the Text). Optionally then <b>Delete Files</b> on habit-apps.txt — the app remembers events it has already seen.</li>
    <li>In this app: tap <b>Run sync</b>. When the shortcut finishes, switch back here and tap <b>Paste</b> on the banner.</li>
  </ol>
  <p class="note">Any line <code>key=value</code> fills habits whose <b>Data source</b> or <b>name</b> matches the key — e.g. <code>drink water=2</code>.</p>
</details>
<details><summary>3 · Track time in Instagram (or any app)</summary>
  <ol>
    <li>Shortcuts → <b>Automation</b> → <b>+</b> → <b>App</b> → choose Instagram → tick <b>Is Opened</b> → <b>Run Immediately</b>.</li>
    <li>Action: <b>Append to Text File</b> in <b>Shortcuts</b> folder, file <code>habit-apps.txt</code>, text: <pre>open|Instagram|[Current Date, format ISO 8601, include time]</pre></li>
    <li>Make a second automation: same app, <b>Is Closed</b>, appending <pre>close|Instagram|[Current Date, ISO 8601]</pre></li>
    <li>Create a habit with type <b>Quit</b>, unit <b>min</b>, and Data source <b>Screen time</b> → app name <b>Instagram</b>. Sync adds up the minutes.</li>
  </ol>
  <p class="note">Apple doesn’t let web apps read Screen Time directly, so this open/close log is the workaround. Repeat for other apps.</p>
</details>
<details><summary>4 · Send sleep to Apple Health (this app → Health)</summary>
  <ol>
    <li>Create a shortcut named <b>Log Sleep</b> that receives <b>Text</b> input.</li>
    <li>Add <b>Get Numbers from Input</b>, then <b>Adjust Date</b>: Current Date <b>minus</b> [Numbers] <b>hours</b>.</li>
    <li>Add <b>Log Health Sample</b>: Type <b>Sleep Analysis</b>, Value <b>Asleep</b>, Start Date = adjusted date, End Date = Current Date.</li>
    <li>On your Sleep habit set <b>Run shortcut after logging</b> to <code>Log Sleep</code>. After you log sleep, tap <b>Send</b> on the popup.</li>
  </ol>
  <p class="note">This works for anything Health accepts (water, mindful minutes…) — make one shortcut per type.</p>
</details>
<details><summary>5 · Automatic backups to iCloud Drive</summary>
  <p><b>How it works:</b> a web app can't write to iCloud Drive itself. When a backup is due, the app shows a banner. Tap it and the app copies your data and runs a <b>Habit Backup</b> shortcut, which saves it as a dated file in iCloud Drive. Then switch back to the app.</p>
  <p><b>Note:</b> Habits won't appear in the Shortcuts app's list of apps. That's normal for a Home Screen web app. The shortcut only uses built-in actions; find each one with the <b>Search Actions</b> bar.</p>
  <ol>
    <li>In Shortcuts, tap <b>+</b>. Tap the name at the top and rename it <b>Habit Backup</b>. The name must match exactly.</li>
    <li>Search <b>Get Clipboard</b> and tap it.</li>
    <li>Search <b>Set Name</b> and tap it. It shows “Set name of <i>Clipboard</i> to <i>Name</i>”. Tap <i>Name</i> and type <code>habits-</code>. Above the keyboard, tap <b>Current Date</b>. Tap the inserted Current Date, choose <b>Custom</b> format and enter <code>yyyy-MM-dd</code>. After it, type <code>.json</code>.</li>
    <li>Search <b>Save File</b> and tap it. It should read “Save <i>Renamed Item</i>”. Tap the <b>›</b> arrow to expand it. Turn <b>Ask Where to Save</b> off, set Subpath to <code>/Habit Backups/</code> and turn <b>Overwrite If File Exists</b> on.</li>
    <li>(Optional) Add <b>Show Notification</b> “Habits backed up ✅”.</li>
  </ol>
  <p>Files land in <b>iCloud Drive → Shortcuts → Habit Backups</b>, one per day you back up. They sync to your other devices and to iCloud.com.</p>
  <p><b>No Shortcut?</b> Use <b>Save backup file…</b>, then <b>Save to Files</b> → iCloud Drive.</p>
  <p><b>To recover</b> (new phone, reinstalled app, or a mistake):</p>
  <ol>
    <li>Open the app (add it to the Home Screen again if needed) → <b>Settings → Restore from backup…</b></li>
    <li>Tap <b>Browse</b> → <b>iCloud Drive → Shortcuts → Habit Backups</b>. Pick the newest file, or an older one to go back in time.</li>
    <li>Confirm. Everything in the app is replaced with that backup.</li>
  </ol>
</details>
<details><summary>6 · Reminders</summary>
  <p>Web apps on iOS can’t schedule notifications offline. Set a reminder time on a habit, open it, and tap <b>Add reminder to Calendar</b>. That creates a repeating calendar event with an alert.</p>
</details>
<details><summary>7 · Laptop activity</summary>
  <p>Not connected yet. Getting laptop data onto your phone needs a small sync service. Ask Claude to add it when you're ready.</p>
</details>`;
