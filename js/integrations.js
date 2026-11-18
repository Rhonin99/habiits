// Bridge to iOS via the Shortcuts app.
//
// A web app can't read Apple Health or Screen Time directly, so an iOS Shortcut
// gathers the data and copies it to the clipboard as plain text, and the app reads it:
//
//   date=2026-11-15
//   steps=6421
//   workout=35
//   sleep=7.4
//   open|Instagram|2026-11-15T10:02:11+05:30
//   close|Instagram|2026-11-15T10:19:40+05:30
//
// `key=value` lines fill habits whose Data source (or name) matches the key, replacing
// that day's value. `open|App|time` / `close|App|time` lines come from Screen-Time-style
// automations and add up into minutes for habits whose source is `app:<App>`.
// JSON is accepted too: { "date": "...", "steps": 123 } or { "days": { "2026-11-15": {...} } }.
import { getState, setLog, commit } from './store.js';
import { dkey, todayKey, parseLooseNumber, DOW_ICS, pad } from './util.js';

export const SOURCES = [
  { id: 'steps', label: 'Steps (Apple Health)', unit: 'steps' },
  { id: 'workout', label: 'Workout minutes (Apple Health)', unit: 'min' },
  { id: 'sleep', label: 'Sleep hours (Apple Health)', unit: 'h' },
  { id: 'active', label: 'Active energy (Apple Health)', unit: 'kcal' },
  { id: 'mindful', label: 'Mindful minutes (Apple Health)', unit: 'min' },
];

const MAX_SESSION_MS = 4 * 3600 * 1000; // ignore an "open" with no close after 4h
const KEEP_EVENTS_DAYS = 120;

export function parseSyncText(text) {
  const out = { days: {}, events: [] };
  const raw = String(text || '').trim();
  if (!raw) return out;

  if (raw.startsWith('{')) {
    try {
      const j = JSON.parse(raw);
      if (j.days && typeof j.days === 'object') {
        for (const [date, vals] of Object.entries(j.days)) addValues(out, date, vals);
      } else {
        const { date, appLog, ...vals } = j;
        addValues(out, normDate(date) || todayKey(), vals);
        if (appLog) parseLines(String(appLog), out);
      }
      return out;
    } catch { /* fall through to line format */ }
  }
  parseLines(raw, out);
  return out;
}

function addValues(out, date, vals) {
  const d = normDate(date);
  if (!d) return;
  for (const [k, v] of Object.entries(vals || {})) {
    const n = parseLooseNumber(v);
    if (Number.isFinite(n)) (out.days[d] ||= {})[k.trim().toLowerCase()] = n;
  }
}

function normDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? dkey(new Date(t)) : null;
}

function parseLines(text, out) {
  let date = todayKey();
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (l.includes('|')) {
      const [type, app, time] = l.split('|').map((x) => x.trim());
      const t = Date.parse(time);
      const ty = type.toLowerCase();
      if ((ty === 'open' || ty === 'close') && app && Number.isFinite(t)) {
        out.events.push({ type: ty, app, t });
      }
      continue;
    }
    const eq = l.indexOf('=') >= 0 ? l.indexOf('=') : l.indexOf(':');
    if (eq < 0) continue;
    const k = l.slice(0, eq).trim().toLowerCase();
    const v = l.slice(eq + 1).trim();
    if (k === 'date') {
      date = normDate(v) || date;
      continue;
    }
    const n = parseLooseNumber(v);
    if (Number.isFinite(n)) (out.days[date] ||= {})[k] = n;
  }
}

// Minutes per app per day from open/close events.
export function appMinutes(events) {
  const sorted = events.slice().sort((a, b) => a.t - b.t);
  const openAt = {};
  const res = {}; // { app(lowercase): { date: minutes } }
  for (const e of sorted) {
    const app = e.app.toLowerCase();
    if (e.type === 'open') {
      openAt[app] = e.t;
    } else if (openAt[app] != null) {
      const dur = e.t - openAt[app];
      if (dur > 0 && dur <= MAX_SESSION_MS) {
        const day = dkey(new Date(openAt[app]));
        ((res[app] ||= {})[day] ||= 0);
        res[app][day] += dur / 60000;
      }
      openAt[app] = null;
    }
  }
  return res;
}

const habitSourceKey = (h) => (h.source || '').toLowerCase();

export function applySync(parsed) {
  const s = getState();
  const habits = s.habits.filter((h) => !h.archived);
  const report = [];

  // 1) key=value metrics
  for (const [date, vals] of Object.entries(parsed.days)) {
    for (const [k, v] of Object.entries(vals)) {
      const targets = habits.filter((h) => habitSourceKey(h) === k || h.name.trim().toLowerCase() === k);
      for (const h of targets) {
        setLog(h.id, date, v, true);
        report.push(`${h.emoji} ${h.name}: ${Math.round(v * 100) / 100} ${h.unit} (${date})`);
      }
    }
  }

  // 2) app usage events: merge, dedupe, recompute affected days
  if (parsed.events.length) {
    const seen = new Set(s.appEvents.map((e) => `${e.type}|${e.app.toLowerCase()}|${e.t}`));
    for (const e of parsed.events) {
      const id = `${e.type}|${e.app.toLowerCase()}|${e.t}`;
      if (!seen.has(id)) { seen.add(id); s.appEvents.push(e); }
    }
    const cutoff = Date.now() - KEEP_EVENTS_DAYS * 86400000;
    s.appEvents = s.appEvents.filter((e) => e.t >= cutoff);
    const affectedDays = new Set(parsed.events.map((e) => dkey(new Date(e.t))));
    const mins = appMinutes(s.appEvents);
    for (const h of habits) {
      const src = habitSourceKey(h);
      if (!src.startsWith('app:')) continue;
      const app = src.slice(4).trim();
      for (const day of affectedDays) {
        const m = Math.round(mins[app]?.[day] || 0);
        setLog(h.id, day, h.unit === 'h' ? m / 60 : m, true);
        if (m) report.push(`${h.emoji} ${h.name}: ${m} min (${day})`);
      }
    }
  }

  s.settings.lastSync = new Date().toISOString();
  commit();
  return report;
}

export function shortcutURL(name, input) {
  let url = `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
  if (input != null) url += `&input=text&text=${encodeURIComponent(String(input))}`;
  return url;
}

export function runShortcut(name, input) {
  window.location.href = shortcutURL(name, input);
}

// Recurring calendar event with an alarm — the only reliable way for an
// offline web app to remind you on iOS without a push server.
export function buildICS(h) {
  const [hh, mm] = (h.reminder || '09:00').split(':');
  const now = new Date();
  const start = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(+hh)}${pad(+mm)}00`;
  let rrule = 'FREQ=DAILY';
  if (h.period === 'day' && h.days?.length && h.days.length < 7) {
    rrule = `FREQ=WEEKLY;BYDAY=${h.days.slice().sort().map((d) => DOW_ICS[d]).join(',')}`;
  } else if (h.period === 'week') rrule = 'FREQ=WEEKLY';
  else if (h.period === 'month') rrule = 'FREQ=MONTHLY';
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const clean = (t) => String(t).replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, ' ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Habits PWA//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${h.id}-${Date.now()}@habits.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    'DURATION:PT15M',
    `RRULE:${rrule}`,
    `SUMMARY:${clean(`${h.emoji} ${h.name}`)}`,
    `DESCRIPTION:${clean(h.description || 'Habit reminder')}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${clean(h.name)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadICS(h) {
  const blob = new Blob([buildICS(h)], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${h.name.replace(/[^\w -]/g, '') || 'habit'}-reminder.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
