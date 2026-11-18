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

function rangeOf(period, date, weekStart) {
  if (period === 'week') {
    const start = startOfWeek(date, weekStart);
    return [start, addDays(start, 6)];
  }
  if (period === 'month') return [startOfMonth(date), endOfMonth(date)];
  return [date, date];
}

// Goal period: the window the goal value is measured over (day / week / month).
export const periodRange = (h, date, weekStart) => rangeOf(h.period, date, weekStart);

// Task days: when the habit is required.
//  'every' | 'weekdays' (h.days) | 'monthDays' (h.monthDays)
//  'perWeek' / 'perMonth' = meet the daily goal on h.perCount days of the week/month;
//  the other days don't count for or against you.
export const taskDaysOf = (h) => h.taskDays || 'every';
export const isQuota = (h) => h.period === 'day' && (h.taskDays === 'perWeek' || h.taskDays === 'perMonth');
export const quotaPeriod = (h) => (h.taskDays === 'perWeek' ? 'week' : 'month');

// The window success is judged over: the goal period, or the week/month of a quota habit.
export const cycleRange = (h, date, weekStart) => rangeOf(isQuota(h) ? quotaPeriod(h) : h.period, date, weekStart);

export const dayValue = (s, h, key) => s.logs[h.id]?.[key] || 0;

// Days in the week/month (up to today) on which the daily goal was met.
export function quotaStatus(s, h, date) {
  const [start, end] = cycleRange(h, date, s.settings.weekStart);
  const last = minDate(end, today());
  let met = 0;
  for (let d = start; d <= last; d = addDays(d, 1)) {
    if (!isActiveOn(h, d)) continue;
    const v = dayValue(s, h, dkey(d));
    if ((v > 0 || !hasMin(h)) && metGoal(h, v)) met++;
  }
  const need = Math.max(1, Math.round(h.perCount || 1));
  return { met, need, done: met >= need };
}

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
  const td = taskDaysOf(h);
  if (td === 'weekdays' && h.days?.length) return h.days.includes(date.getDay());
  if (td === 'monthDays' && h.monthDays?.length) {
    const dom = date.getDate();
    if (h.monthDays.includes(dom)) return true;
    // "the 31st" falls on the last day of shorter months
    const lastDom = endOfMonth(date).getDate();
    return dom === lastDom && h.monthDays.some((x) => x > lastDom);
  }
  return true;
}

// Skipped for this date (directly, or because its parent was skipped).
export function isSkipped(s, h, date) {
  const day = s.skips?.[dkey(date)];
  return !!day && (h.id in day || (!!h.parentId && h.parentId in day));
}

// A parent whose scheduled subhabits were all skipped (but the parent itself wasn't):
// it stays on the list and can be checked off or skipped on its own.
export function kidsAllSkipped(s, h, date) {
  if (isSkipped(s, h, date)) return false;
  const kids = childrenOf(s, h.id).filter((k) => isScheduled(s, k, date));
  return kids.length > 0 && kids.every((k) => isSkipped(s, k, date));
}

// Counts toward completion and streaks on this date.
export function isDue(s, h, date) {
  if (isSkipped(s, h, date)) return false;
  const kids = childrenOf(s, h.id);
  if (kids.length) return kids.some((k) => isDue(s, k, date)) || kidsAllSkipped(s, h, date);
  // a "3 days a week" habit only counts on the days you actually did it
  if (isQuota(h)) return isScheduled(s, h, date) && status(s, h, date).done;
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
    if (kidsAllSkipped(s, h, date)) {
      // checked off directly: stored as a log on the parent for that day
      const done = (s.logs[h.id]?.[dkey(date)] || 0) > 0;
      return { parent: true, solo: true, value: done ? 1 : 0, target: 1, ratio: done ? 1 : 0, done, over: false };
    }
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

// The period streaks and stats are counted in.
export const cyclePeriod = (s, h) => (isParent(s, h) ? 'day' : isQuota(h) ? quotaPeriod(h) : h.period);
const effectivePeriod = cyclePeriod;

// Was the goal met for the week/month (or goal period) ending at `asOf`?
function cycleResult(s, h, asOf) {
  if (isQuota(h)) return { done: quotaStatus(s, h, asOf).done, over: false };
  const st = status(s, h, asOf);
  return { done: st.done, over: st.over };
}

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
      const [, end] = cycleRange(h, d, s.settings.weekStart);
      const asOf = minDate(end, t);
      out.push({ end: asOf, ...cycleResult(s, h, asOf) });
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
  if (isQuota(h)) {
    const st = status(s, h, date);
    if (st.over) return -1;
    return dv > 0 ? Math.max(0.35, st.minRatio) : 0;
  }
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
      const [, end] = cycleRange(h, d, s.settings.weekStart);
      const asOf = minDate(end, t);
      if (isActiveOn(h, asOf)) {
        due++;
        if (cycleResult(s, h, asOf).done) done++;
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
    else if (isQuota(h)) {
      const r = status(s, h, d);
      st = r.done ? 'done' : dayValue(s, h, dkey(d)) > 0 ? 'logged' : 'off';
    } else if (period === 'day' && isDue(s, h, d)) {
      const r = status(s, h, d);
      st = r.done ? 'done' : r.over ? 'over' : 'miss';
      due++;
      if (r.done) done++;
    } else if (period !== 'day' && dayValue(s, h, dkey(d)) > 0) st = 'logged';
    days.push(st);
  }
  if (period === 'week' && isActiveOn(h, minDate(addDays(weekStart, 6), t)) && weekStart <= t) {
    due = 1;
    done = cycleResult(s, h, minDate(addDays(weekStart, 6), t)).done ? 1 : 0;
  }
  let progress = null;
  if (period === 'month') {
    const asOf = minDate(addDays(weekStart, 6), t);
    if (isQuota(h)) {
      const q = quotaStatus(s, h, asOf);
      progress = Math.min(1, q.met / q.need);
    } else {
      const r = status(s, h, asOf);
      progress = isParent(s, h) ? r.ratio : r.minRatio;
    }
  }
  return {
    days, due, done, skipped, period, progress, quota: isQuota(h),
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
  const td = taskDaysOf(h);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const n = Math.round(h.perCount || 1);
  if (td === 'weekdays' && h.days?.length && h.days.length < 7) {
    txt += ` on ${h.days.slice().sort().map((d) => names[d]).join(', ')}`;
  } else if (td === 'monthDays' && h.monthDays?.length) {
    txt += ` on day ${h.monthDays.slice().sort((a, b) => a - b).join(', ')} of the month`;
  } else if (isQuota(h)) {
    txt += `, ${n} day${n > 1 ? 's' : ''} a ${quotaPeriod(h)}`;
  }
  const mode = tapModeOf(h);
  if (mode === 'add') return `${txt}, ${fmt(h.step)} ${h.unit} per tap`;
  return `${txt}, ${mode === 'keypad' ? 'enter amounts on a keypad' : 'one tap marks it done'}`;
}

const fmt = (n) => Math.round(n * 100) / 100;
