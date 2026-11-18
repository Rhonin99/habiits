// Persistent state. Everything lives in localStorage on the device.
import { uid, todayKey, round2 } from './util.js';

const KEY = 'habits.state.v1';

export const COLORS = {
  blue: '#4a6cf7',
  sky: '#22b3d4',
  indigo: '#6c7fd8',
  purple: '#7c5ce0',
  pink: '#e8578f',
  red: '#e9574a',
  orange: '#f0882c',
  yellow: '#d9a40a',
  green: '#2eaa63',
  teal: '#16a08e',
  slate: '#6f7689',
};

export const UNITS = ['times', 'min', 'h', 'L', 'mL', 'glasses', 'steps', 'km', 'pages', 'kcal'];

let state;
const listeners = new Set();

function defaults() {
  return {
    version: 1,
    habits: [],
    groups: [],
    logs: {}, // { habitId: { 'YYYY-MM-DD': number } }
    appEvents: [], // [{ type: 'open'|'close', app, t: ms }]
    anomalies: {}, // { 'YYYY-MM-DD': [{ id, text }] } — one-off events that disrupted routine
    skips: {}, // { 'YYYY-MM-DD': { habitId: anomalyId | null } } — habits skipped that day, and why
    settings: {
      weekStart: 1,
      theme: 'auto',
      syncShortcut: 'Habit Sync',
      lastSync: null,
      backupShortcut: 'Habit Backup',
      backupEvery: 'weekly', // 'off' | 'daily' | 'weekly'
      lastBackup: null,
      reviewSeen: null, // week-start key of the last weekly review opened
    },
  };
}

export function newHabit(partial = {}) {
  const h = {
    id: uid(),
    name: '',
    emoji: '✅',
    description: '',
    color: 'blue',
    groupId: null,
    parentId: null,
    // 'min' = at least `min` (habit to increase), 'max' = at most `max` (habit to reduce),
    // 'range' = between `min` and `max` (enjoy it, but not too much)
    kind: 'min',
    period: 'day', // 'day' | 'week' | 'month'
    min: 1,
    max: 0,
    unit: 'times',
    step: 1, // amount added per tap (tapMode 'add')
    // what the card's button does: 'done' = complete the goal in one tap,
    // 'add' = add `step`, 'keypad' = pop up a keypad to enter any amount
    tapMode: '',
    // task days: 'every' | 'weekdays' (days) | 'monthDays' (monthDays) | 'perWeek' / 'perMonth' (perCount)
    taskDays: '',
    days: [0, 1, 2, 3, 4, 5, 6], // weekdays (Date.getDay values) for 'weekdays'
    monthDays: [], // 1..31 for 'monthDays'
    perCount: 3, // days per week/month for 'perWeek' / 'perMonth'
    timeRange: 'any',
    reminder: '',
    source: '', // '', 'steps', 'workout', 'sleep', 'active', 'mindful', 'app:<Name>'
    shortcut: '', // iOS Shortcut to run after logging (e.g. to write to Apple Health)
    createdAt: todayKey(),
    archived: false,
    order: Date.now(),
    ...upgradeGoal(partial),
  };
  if (!h.tapMode) h.tapMode = h.kind === 'min' && h.step >= h.min ? 'done' : 'add';
  if (!h.taskDays) h.taskDays = h.days?.length && h.days.length < 7 ? 'weekdays' : 'every';
  return h;
}

// v1 habits had kind 'build'|'quit' with a single `target`.
function upgradeGoal(p) {
  if (!('target' in p) && p.kind !== 'build' && p.kind !== 'quit') return p;
  const { target, ...rest } = p;
  if (p.kind === 'quit') return { ...rest, kind: 'max', max: target ?? p.max ?? 1, min: 0 };
  return { ...rest, kind: p.kind === 'build' || !p.kind ? 'min' : p.kind, min: target ?? p.min ?? 1 };
}

function seed() {
  const s = defaults();
  const health = { id: uid(), name: 'Health' };
  const mind = { id: uid(), name: 'Mind' };
  const digital = { id: uid(), name: 'Digital' };
  s.groups = [health, mind, digital];
  let o = 1;
  const routine = newHabit({ name: 'Morning routine', emoji: '🌅', color: 'orange', groupId: mind.id, order: o++ });
  s.habits = [
    newHabit({ name: 'Drink water', emoji: '💧', color: 'sky', groupId: health.id, min: 3, unit: 'L', step: 1, order: o++ }),
    newHabit({ name: 'Workout', emoji: '💪', color: 'blue', groupId: health.id, min: 30, unit: 'min', step: 10, source: 'workout', order: o++ }),
    newHabit({ name: 'Walk', emoji: '🚶', color: 'indigo', groupId: health.id, min: 6000, unit: 'steps', step: 1000, source: 'steps', order: o++ }),
    newHabit({ name: 'Sleep', emoji: '🛏️', color: 'purple', groupId: health.id, min: 7, unit: 'h', step: 1, tapMode: 'keypad', shortcut: 'Log Sleep', order: o++ }),
    routine,
    newHabit({ name: 'Make bed', emoji: '🛌', color: 'orange', groupId: mind.id, parentId: routine.id, order: o++ }),
    newHabit({ name: 'Meditate', emoji: '🧘', color: 'orange', groupId: mind.id, parentId: routine.id, min: 10, unit: 'min', step: 10, order: o++ }),
    newHabit({ name: 'Read', emoji: '📚', color: 'green', groupId: mind.id, min: 1, unit: 'times', step: 1, tapMode: 'done', taskDays: 'perWeek', perCount: 3, order: o++ }),
    newHabit({ name: 'Instagram', emoji: '📱', color: 'pink', groupId: digital.id, kind: 'max', max: 30, unit: 'min', step: 5, source: 'app:Instagram', order: o++ }),
    newHabit({ name: 'Gaming', emoji: '🎮', color: 'teal', groupId: digital.id, kind: 'range', min: 20, max: 60, unit: 'min', step: 10, order: o++ }),
  ];
  return s;
}

const COUNT_UNIT = /^(times?|x|days?|sessions?|workouts?|)$/i;

function migrate(s) {
  const d = defaults();
  const out = {
    ...d,
    ...s,
    habits: (s.habits || []).map((h) => newHabit(h)),
    settings: { ...d.settings, ...(s.settings || {}) },
  };
  // v6: "N times a week/month" habits become a daily goal of 1 with task days
  // "N days per week/month". Runs once, so later edits stick.
  if (!out.settings.taskDaysV6) {
    out.habits.forEach((h) => {
      if (h.period !== 'day' && h.kind === 'min' && h.tapMode !== 'keypad'
        && (h.tapMode === 'done' || h.step === 1) && COUNT_UNIT.test(h.unit.trim())) {
        h.taskDays = h.period === 'week' ? 'perWeek' : 'perMonth';
        h.perCount = Math.min(h.period === 'week' ? 7 : 31, Math.max(1, Math.round(h.min)));
        h.period = 'day';
        h.min = 1;
        h.step = 1;
        h.tapMode = 'done';
      }
    });
    out.settings.taskDaysV6 = true;
  }
  return out;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? migrate(JSON.parse(raw)) : seed();
  } catch (e) {
    console.error('Failed to load state', e);
    state = seed();
  }
  if (!localStorage.getItem(KEY)) persist();
  return state;
}

export const getState = () => state;
export const subscribe = (fn) => listeners.add(fn);

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save', e);
    alert('Could not save data on this device: ' + e.message);
  }
}

export function commit() {
  persist();
  listeners.forEach((fn) => fn());
}

/* ---------- habits ---------- */

export const getHabit = (id) => state.habits.find((h) => h.id === id);

export function saveHabit(h) {
  const i = state.habits.findIndex((x) => x.id === h.id);
  if (i >= 0) state.habits[i] = h;
  else state.habits.push(h);
  // a habit that is someone's parent can't itself have a parent
  if (state.habits.some((x) => x.parentId === h.id)) h.parentId = null;
  commit();
}

export function deleteHabit(id) {
  state.habits = state.habits.filter((h) => h.id !== id);
  state.habits.forEach((h) => { if (h.parentId === id) h.parentId = null; });
  delete state.logs[id];
  for (const day of Object.values(state.skips)) delete day[id];
  commit();
}

export function setArchived(id, archived) {
  const h = getHabit(id);
  if (!h) return;
  h.archived = archived;
  commit();
}

// Move a habit up/down among its siblings (same parent).
export function moveHabit(id, dir) {
  const h = getHabit(id);
  const sibs = state.habits
    .filter((x) => x.parentId === h.parentId && !x.archived)
    .sort((a, b) => a.order - b.order);
  const i = sibs.indexOf(h);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  [sibs[i].order, sibs[j].order] = [sibs[j].order, sibs[i].order];
  if (sibs[i].order === sibs[j].order) sibs[j].order += dir;
  commit();
}

// Drag-and-drop: `ids` are the visible siblings in their new order. Their existing
// order values are redistributed, so habits not shown today keep their place.
export function reorderHabits(ids) {
  const hs = ids.map(getHabit).filter(Boolean);
  const slots = hs.map((h) => h.order).sort((a, b) => a - b);
  for (let i = 1; i < slots.length; i++) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 0.001;
  hs.forEach((h, i) => { h.order = slots[i]; });
  commit();
}

/* ---------- logs ---------- */

export function getLog(habitId, key) {
  return state.logs[habitId]?.[key] || 0;
}

export function setLog(habitId, key, value, silent = false) {
  const v = Math.max(0, round2(Number(value) || 0));
  if (!state.logs[habitId]) state.logs[habitId] = {};
  if (v === 0) delete state.logs[habitId][key];
  else state.logs[habitId][key] = v;
  if (!silent) commit();
}

export function addLog(habitId, key, delta) {
  setLog(habitId, key, getLog(habitId, key) + delta);
}

/* ---------- anomalies ---------- */

export const getAnomalies = (key) => state.anomalies[key] || [];

export function addAnomaly(key, text) {
  const t = text.trim();
  if (!t) return null;
  const a = { id: uid(), text: t.slice(0, 120) };
  (state.anomalies[key] ||= []).push(a);
  commit();
  return a;
}

export function removeAnomaly(key, id) {
  const list = (state.anomalies[key] || []).filter((a) => a.id !== id);
  if (list.length) state.anomalies[key] = list;
  else delete state.anomalies[key];
  const sk = state.skips[key];
  if (sk) for (const hid of Object.keys(sk)) if (sk[hid] === id) sk[hid] = null;
  commit();
}

/* ---------- skips (a habit skipped for one day, optionally linked to an anomaly) ---------- */

export const isSkippedOn = (key, habitId) => !!state.skips[key] && habitId in state.skips[key];
export const skipReason = (key, habitId) => {
  const aid = state.skips[key]?.[habitId];
  return aid ? (state.anomalies[key] || []).find((a) => a.id === aid) || null : null;
};

export function skipHabit(key, habitId, anomalyId = null) {
  (state.skips[key] ||= {})[habitId] = anomalyId;
  commit();
}

export function unskipHabit(key, habitId) {
  if (!state.skips[key]) return;
  delete state.skips[key][habitId];
  if (!Object.keys(state.skips[key]).length) delete state.skips[key];
  commit();
}

/* ---------- groups ---------- */

export function addGroup(name) {
  const g = { id: uid(), name: name.trim() };
  state.groups.push(g);
  commit();
  return g;
}

export function renameGroup(id, name) {
  const g = state.groups.find((x) => x.id === id);
  if (g) g.name = name.trim();
  commit();
}

export function deleteGroup(id) {
  state.groups = state.groups.filter((g) => g.id !== id);
  state.habits.forEach((h) => { if (h.groupId === id) h.groupId = null; });
  commit();
}

/* ---------- settings / backup ---------- */

export function setSetting(k, v) {
  state.settings[k] = v;
  commit();
}

export function exportJSON() {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.habits) || typeof data.logs !== 'object') {
    throw new Error('This file is not a habit backup.');
  }
  state = migrate(data);
  commit();
}

export function resetAll(withSamples) {
  state = withSamples ? seed() : defaults();
  commit();
}
