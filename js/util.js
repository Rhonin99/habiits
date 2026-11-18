// Date + formatting helpers. All dates are local-time midnight Date objects
// and are stored as 'YYYY-MM-DD' keys.

export const pad = (n) => String(n).padStart(2, '0');
export const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
export const todayKey = () => dkey(new Date());
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
export const startOfWeek = (d, weekStart = 1) => {
  const diff = (d.getDay() - weekStart + 7) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
};
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const endOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
export const sameDay = (a, b) => dkey(a) === dkey(b);
export const minDate = (a, b) => (a < b ? a : b);
export const maxDate = (a, b) => (a > b ? a : b);

export const DOW_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const DOW_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const round2 = (n) => Math.round(n * 100) / 100;

export const fmtNum = (n) => {
  if (!Number.isFinite(n)) return '0';
  return round2(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
};

// Parses numbers that may come from iOS Shortcuts in various locales:
// "2,444" "2 444" "7,5" "7.5" "1,234.5"
export function parseLooseNumber(input) {
  if (typeof input === 'number') return input;
  let s = String(input ?? '').trim().replace(/[\s  ']/g, '');
  s = s.replace(/[^0-9.,-]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    // whichever comes last is the decimal separator
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  return parseFloat(s);
}

export function relativeDayLabel(d) {
  const t = today();
  const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
