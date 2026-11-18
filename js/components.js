// Small reusable UI pieces: rings, heatmaps, sheets, toasts.
import {
  addDays, startOfWeek, startOfMonth, endOfMonth, dkey, today, esc, DOW_SHORT,
} from './util.js';
import { COLORS } from './store.js';

export const colorOf = (h) => COLORS[h?.color] || COLORS.blue;

export function ring(ratio, label, { size = 44, stroke = 3.5, color = 'var(--accent)', cls = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, ratio)));
  return `<svg class="ring ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--ring-track)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle">${esc(label)}</text>
  </svg>`;
}

function cellStyle(v, color) {
  if (v == null) return 'class="hm-cell hm-none"';
  if (v === -1) return 'class="hm-cell hm-over"';
  if (v <= 0) return 'class="hm-cell hm-zero"';
  const pct = Math.round(25 + v * 75);
  return `class="hm-cell" style="background:color-mix(in srgb, ${color} ${pct}%, var(--hm-empty))"`;
}

// GitHub-style grid: columns are weeks, rows are weekdays.
export function heatmap(fn, { weeks = 20, color = 'var(--accent)', weekStart = 1 } = {}) {
  const end = today();
  const start = startOfWeek(addDays(end, -(weeks - 1) * 7), weekStart);
  const cols = [];
  const monthLabels = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const colStart = addDays(start, w * 7);
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(colStart, i);
      if (d > end) { cells.push('<i class="hm-cell hm-future"></i>'); continue; }
      cells.push(`<i ${cellStyle(fn(d), color)} title="${dkey(d)}"></i>`);
    }
    const m = colStart.getMonth();
    monthLabels.push(`<span>${m !== lastMonth ? colStart.toLocaleDateString(undefined, { month: 'short' }) : ''}</span>`);
    lastMonth = m;
    cols.push(`<div class="hm-col">${cells.join('')}</div>`);
  }
  const rowLabels = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const dow = (weekStart + i) % 7;
    return `<span>${i % 2 === 0 ? DOW_SHORT[dow][0] : ''}</span>`;
  }).join('');
  return `<div class="heatmap">
    <div class="hm-rows">${rowLabels}</div>
    <div class="hm-scroll"><div class="hm-months">${monthLabels.join('')}</div><div class="hm-grid">${cols.join('')}</div></div>
  </div>`;
}

// Month calendar grid with intensity cells.
export function monthGrid(month, fn, { color = 'var(--accent)', weekStart = 1, showNums = true } = {}) {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const heads = [0, 1, 2, 3, 4, 5, 6].map((i) => `<b>${DOW_SHORT[(weekStart + i) % 7]}</b>`).join('');
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="mg-pad"></span>');
  for (let d = first; d <= last; d = addDays(d, 1)) {
    cells.push(`<span ${cellStyle(fn(d), color).replace('hm-cell', 'mg-cell')}>${showNums ? d.getDate() : ''}</span>`);
  }
  return `<div class="month-grid">${heads}${cells.join('')}</div>`;
}

// Heatmaps show oldest → newest; start scrolled to the newest weeks.
export function scrollHeatmaps(root) {
  root?.querySelectorAll('.hm-scroll').forEach((el) => { el.scrollLeft = el.scrollWidth; });
}

/* ---------- sheet (modal) ---------- */

let sheetCleanup = null;

export function openSheet(html, { onClose, full = false } = {}) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = `<div class="sheet-backdrop" data-act="close-sheet"></div>
    <section class="sheet ${full ? 'sheet-full' : ''}" role="dialog" aria-modal="true">${html}</section>`;
  root.classList.add('open');
  document.body.classList.add('no-scroll');
  sheetCleanup = onClose || null;
  return root.querySelector('.sheet');
}

export function closeSheet() {
  const root = document.getElementById('sheet-root');
  if (!root.classList.contains('open')) return;
  root.classList.remove('open');
  root.innerHTML = '';
  document.body.classList.remove('no-scroll');
  const fn = sheetCleanup;
  sheetCleanup = null;
  if (fn) fn();
}

export const sheetEl = () => document.querySelector('#sheet-root .sheet');

/* ---------- toast ---------- */

let toastTimer;
// toast('Saved') or toast('Logged', [{ label: 'Undo', fn }])
export function toast(msg, actions = [], ms) {
  const list = Array.isArray(actions) ? actions : [actions];
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast"><span>${esc(msg)}</span>${list.map((a, i) => `<button class="toast-btn" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`;
  root.querySelectorAll('.toast-btn').forEach((b) => {
    b.onclick = () => { root.innerHTML = ''; list[+b.dataset.i].fn(); };
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { root.innerHTML = ''; }, ms || (list.length ? 6000 : 2500));
}

export const icons = {
  plus: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  chevD: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  today: '<svg viewBox="0 0 24 24" width="24" height="24"><rect x="3.5" y="5" width="17" height="15.5" rx="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M8 3v4M16 3v4M3.5 10h17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8.5 15l2.3 2.2L15.5 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  stats: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 20V11M12 20V4M19 20v-6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="4.5" cy="6" r="1.5" fill="currentColor"/><circle cx="4.5" cy="12" r="1.5" fill="currentColor"/><circle cx="4.5" cy="18" r="1.5" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  sync: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><path d="M5 3v4h4M19 21v-4h-4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  keypad: '<svg viewBox="0 0 24 24" width="20" height="20">' + [6, 12, 18].map((y) => [6, 12, 18].map((x) => `<circle cx="${x}" cy="${y}" r="2.1" fill="currentColor"/>`).join('')).join('') + '</svg>',
  back: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M9 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-6-6z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><path d="M12 10l4 4M16 10l-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fire: '🔥',
};
