// Pure habit calculations: progress, completion, streaks, monthly stats.
import {
  dkey, parseKey, today, addDays, startOfWeek, startOfMonth, endOfMonth, minDate, maxDate,
} from './util.js';

export const activeHabits = (s) => s.habits.filter((h) => !h.archived);

export const childrenOf = (s, id) => s.habits
  .filter((h) => h.parentId === id && !h.archived)
  .sort((a, b) => a.order - b.order);

// Top-level = no parent, or its parent is archived/missing.
export function topLevel(s, groupId = 'all') {
  const live = new Set(activeHabits(s).map((h) => h.id));
  return activeHabits(s)
    .filter((h) => !h.parentId || !live.has(h.parentId))
    .filter((h) => groupId === 'all' || h.groupId === groupId)
    .sort((a, b) => a.order - b.order);
}

export const isParent = (s, h) => childrenOf(s, h.id).length > 0;

export function periodRange(h, date, weekStart) {
  if (h.period === 'week') {
    const start = startOfWeek(date, weekStart);
    return [start, addDays(start, 6)];
  }
  if (h.period === 'month') return [startOfMonth(date), endOfMonth(date)];
  return [date, date];
}

// Weekly/monthly habit with a "Mark done" button = check off once per day, count the days.
export const isCheckIn = (h) => h.period !== 'day' && tapModeOf(h) === 'done';

export const dayValue = (s, h, key) => {
  const v = s.logs[h.id]?.[key] || 0;
  return isCheckIn(h) ? (v > 0 ? 1 : 0) : v;
};

// Sum of logged values from the start of the habit's period up to and including `date`.
export function valueAsOf(s, h, date) {
  const [start] = periodRange(h, date, s.settings.weekStart);
  let sum = 0;
  for (let d = start; d <= date; d = addDays(d, 1)) sum += dayValue(s, h, dkey(d));
  return Math.round(sum * 100) / 100;
}

export const isActiveOn = (h, date) => parseKey(h.createdAt) <= date;

// On the schedule for this date (ignores skips) — used to decide what to show.
export function isScheduled(s, h, date) {
  if (!isActiveOn(h, date)) return false;
  const kids = childrenOf(s, h.id);
  if (kids.length) return kids.some((k) => isScheduled(s, k, date));
  if (h.period === 'day' && h.days && h.days.length && h.days.length < 7) {
    return h.days.includes(date.getDay());
  }
  return true;
}

// Skipped for this date (directly, or because its parent was skipped).
export function isSkipped(s, h, date) {
  const day = s.skips?.[dkey(date)];
  return !!day && (h.id in day || (!!h.parentId && h.parentId in day));
}

// Counts toward completion and streaks on this date.
export function isDue(s, h, date) {
  if (isSkipped(s, h, date)) return false;
  const kids = childrenOf(s, h.id);
  if (kids.length) return kids.some((k) => isDue(s, k, date));
  return isScheduled(s, h, date);
}

// Goal kinds: 'min' (at least), 'max' (at most), 'range' (between min and max)
export const hasMin = (h) => h.kind !== 'max';
export const hasMax = (h) => h.kind !== 'min';
// Amount that fills the card's progress bar to 100%
export const scaleOf = (h) => (h.kind === 'min' ? h.min : h.max);
// What the card button does. "Mark as done" makes no sense for an at-most habit.
export const tapModeOf = (h) => (h.tapMode === 'done' && h.kind === 'max' ? 'add' : h.tapMode || 'add');
export const isCheckStyle = (h) => tapModeOf(h) === 'done';

export function metGoal(h, value) {
  if (hasMin(h) && value < h.min) return false;
  if (hasMax(h) && value > h.max) return false;
  return true;
}

// Status of a habit for the period containing `date`, as of `date`.
export function status(s, h, date) {
  const kids = childrenOf(s, h.id);
  if (kids.length) {
    const due = kids.filter((k) => isDue(s, k, date));
    const doneCount = due.filter((k) => status(s, k, date).done).length;
    return {
      parent: true,
      value: doneCount,
      target: due.length,
      ratio: due.length ? doneCount / due.length : 0,
      done: due.length > 0 && doneCount === due.length,
      over: false,
    };
  }
  const value = valueAsOf(s, h, date);
  const scale = scaleOf(h);
  return {
    parent: false,
    value,
    target: scale,
    ratio: scale > 0 ? value / scale : value > 0 ? 1 : 0,
    // progress toward the minimum (1 for at-most habits)
    minRatio: hasMin(h) && h.min > 0 ? Math.min(1, value / h.min) : 1,
    // where the minimum sits on a range habit's bar
    minMark: h.kind === 'range' && h.max > 0 ? h.min / h.max : null,
    done: metGoal(h, value),
    over: hasMax(h) && value > h.max,
  };
}

// Completion of all due top-level habits on a date (used by rings + heatmaps).
export function dayCompletion(s, date, groupId = 'all') {
  const due = topLevel(s, groupId).filter((h) => isDue(s, h, date));
  const done = due.filter((h) => status(s, h, date).done).length;
  return { done, total: due.length, ratio: due.length ? done / due.length : 0 };
}

const effectivePeriod = (s, h) => (isParent(s, h) ? 'day' : h.period);

// Chronological list of { end, done } periods from habit creation to today.
function periodHistory(s, h) {
  const t = today();
  const created = parseKey(h.createdAt);
  const out = [];
  const period = effectivePeriod(s, h);
  if (period === 'day') {
    const startScan = maxDate(created, addDays(t, -730));
    for (let d = startScan; d <= t; d = addDays(d, 1)) {
      if (isDue(s, h, d)) {
        const st = status(s, h, d);
        out.push({ end: d, done: st.done, over: st.over });
      }
    }
  } else {
    let d = period === 'week' ? startOfWeek(created, s.settings.weekStart) : startOfMonth(created);
    while (d <= t) {
      const [, end] = periodRange(h, d, s.settings.weekStart);
      const asOf = minDate(end, t);
      const st = status(s, h, asOf);
      out.push({ end: asOf, done: st.done, over: st.over });
      d = addDays(end, 1);
    }
  }
  return out;
}

export function streaks(s, h) {
  const hist = periodHistory(s, h);
  let best = 0;
  let run = 0;
  for (const p of hist) {
    run = p.done ? run + 1 : 0;
    best = Math.max(best, run);
  }
  let current = 0;
  let i = hist.length - 1;
  // the current (unfinished) period doesn't break a streak if not done yet —
  // unless it's already over its maximum, which has broken it
  if (i >= 0 && !hist[i].done && !hist[i].over) i--;
  for (; i >= 0 && hist[i].done; i--) current++;
  const unit = { day: 'day', week: 'week', month: 'month' }[effectivePeriod(s, h)];
  return { current, best, unit };
}

// Intensity 0..1 for a single day in a habit's heatmap (null = not tracked, -1 = over limit).
export function dayIntensity(s, h, date) {
  if (!isActiveOn(h, date) || date > today()) return null;
  if (isParent(s, h)) return isDue(s, h, date) ? status(s, h, date).ratio : null;
  const dv = dayValue(s, h, dkey(date));
  if (h.period === 'day') {
    if (!isDue(s, h, date)) return null;
    const st = status(s, h, date);
    if (st.over) return -1;
    return h.kind === 'max' ? 1 : st.minRatio;
  }
  const st = status(s, h, date);
  if (st.over) return -1;
  if (dv <= 0) return 0;
  return h.kind === 'max' ? 0.5 : Math.max(0.35, st.minRatio);
}

// Stats for one habit within a calendar month (only counts days up to today).
export function monthStats(s, h, month) {
  const t = today();
  const first = startOfMonth(month);
  const last = minDate(endOfMonth(month), t);
  let due = 0;
  let done = 0;
  let total = 0;
  let activeDays = 0;
  if (first > t) return { due, done, total, rate: 0, activeDays };
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const v = dayValue(s, h, dkey(d));
    total += v;
    if (v > 0) activeDays++;
  }
  const period = effectivePeriod(s, h);
  if (period === 'day') {
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (!isDue(s, h, d)) continue;
      due++;
      if (status(s, h, d).done) done++;
    }
  } else {
    let d = period === 'week' ? startOfWeek(first, s.settings.weekStart) : first;
    while (d <= last) {
      const [, end] = periodRange(h, d, s.settings.weekStart);
      const asOf = minDate(end, t);
      if (isActiveOn(h, asOf)) {
        due++;
        if (status(s, h, asOf).done) done++;
      }
      d = addDays(end, 1);
    }
  }
  return { due, done, total: Math.round(total * 100) / 100, rate: due ? done / due : 0, activeDays };
}

// One habit over one week: per-day states for daily habits, or the weekly result.
export function weekStats(s, h, weekStart) {
  const t = today();
  const days = [];
  let due = 0;
  let done = 0;
  let skipped = 0;
  let total = 0;
  const period = effectivePeriod(s, h);
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    total += dayValue(s, h, dkey(d));
    let st = 'off';
    if (d > t || !isActiveOn(h, d)) st = d > t ? 'future' : 'off';
    else if (isSkipped(s, h, d) && isScheduled(s, h, d)) { st = 'skip'; skipped++; }
    else if (period === 'day' && isDue(s, h, d)) {
      const r = status(s, h, d);
      st = r.done ? 'done' : r.over ? 'over' : 'miss';
      due++;
      if (r.done) done++;
    } else if (period !== 'day' && dayValue(s, h, dkey(d)) > 0) st = 'logged';
    days.push(st);
  }
  if (period === 'week' && isActiveOn(h, minDate(addDays(weekStart, 6), t)) && weekStart <= t) {
    const r = status(s, h, minDate(addDays(weekStart, 6), t));
    due = 1;
    done = r.done ? 1 : 0;
  }
  let progress = null;
  if (period === 'month') {
    const r = status(s, h, minDate(addDays(weekStart, 6), t));
    progress = isParent(s, h) ? r.ratio : r.minRatio;
  }
  return {
    days, due, done, skipped, period, progress,
    total: Math.round(total * 100) / 100,
    rate: due ? done / due : null,
  };
}

export function overallMonth(s, month, groupId = 'all') {
  const t = today();
  const first = startOfMonth(month);
  const last = minDate(endOfMonth(month), t);
  let perfect = 0;
  let trackedDays = 0;
  let sumDone = 0;
  let sumDue = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const c = dayCompletion(s, d, groupId);
    if (c.total) {
      trackedDays++;
      sumDone += c.done;
      sumDue += c.total;
      if (c.done === c.total) perfect++;
    }
  }
  return { perfect, trackedDays, rate: sumDue ? sumDone / sumDue : 0 };
}

export function goalText(h) {
  const per = { day: 'day', week: 'week', month: 'month' }[h.period];
  const u = h.unit;
  let txt = {
    min: `At least ${fmt(h.min)} ${u} per ${per}`,
    max: `At most ${fmt(h.max)} ${u} per ${per}`,
    range: `Between ${fmt(h.min)}–${fmt(h.max)} ${u} per ${per}`,
  }[h.kind] || '';
  if (h.period === 'day' && h.days && h.days.length && h.days.length < 7) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    txt += ` on ${h.days.slice().sort().map((d) => names[d]).join(', ')}`;
  }
  const mode = tapModeOf(h);
  if (isCheckIn(h)) return `${txt}, check off once a day (extra days count too)`;
  if (mode === 'add') return `${txt}, ${fmt(h.step)} ${h.unit} per tap`;
  return `${txt}, ${mode === 'keypad' ? 'enter amounts on a keypad' : 'one tap marks it done'}`;
}

const fmt = (n) => Math.round(n * 100) / 100;
