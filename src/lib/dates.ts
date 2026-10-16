import type { Due } from '../api/types.ts';

// All "days" in this module are ISO `YYYY-MM-DD` strings in the user's Todoist timezone.

const pad = (n: number) => String(n).padStart(2, '0');

function partsIn(instant: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

export function safeTz(tz: string | undefined | null): string {
  if (!tz) return Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}

export function todayIn(tz: string, now = new Date()): string {
  return partsIn(now, tz).day;
}

function toUTC(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(day: string, n: number): string {
  const d = toUTC(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86_400_000);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekday(day: string): number {
  return ((toUTC(day).getUTCDay() + 6) % 7) + 1;
}

/** Next date strictly after `day` that falls on ISO weekday `target`. */
export function nextWeekday(day: string, target: number): string {
  const delta = ((target - weekday(day) + 7) % 7) || 7;
  return addDays(day, delta);
}

/** The calendar day a due date falls on, in the user's timezone. */
export function dueDay(due: Due, tz: string): string {
  const raw = due.datetime ?? due.date;
  if (/Z$|[+-]\d\d:\d\d$/.test(raw)) return partsIn(new Date(raw), tz).day;
  return raw.slice(0, 10);
}

/** `HH:MM` if the due date has a time, else null. */
export function dueTime(due: Due, tz: string): string | null {
  const raw = due.datetime ?? due.date;
  if (!raw.includes('T')) return null;
  if (/Z$|[+-]\d\d:\d\d$/.test(raw)) return partsIn(new Date(raw), tz).time.slice(0, 5);
  return raw.slice(11, 16);
}

/** Convert a wall-clock time in `tz` to a UTC instant. */
function zonedToUtc(day: string, time: string, tz: string): Date {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi, s = 0] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = wall;
  // Two passes settle DST transitions.
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), tz);
    const [py, pmo, pd] = p.day.split('-').map(Number);
    const [ph, pmi, ps] = p.time.split(':').map(Number);
    const seen = Date.UTC(py, pmo - 1, pd, ph, pmi, ps);
    guess += wall - seen;
  }
  return new Date(guess);
}

/**
 * The `date` value to send when moving `due` to `day`, keeping its time of day (and its
 * fixed timezone, if it has one).
 */
export function moveDueDate(due: Due | null, day: string, tz: string): string {
  if (!due) return day;
  const raw = due.datetime ?? due.date;
  if (!raw.includes('T')) return day;
  if (/Z$|[+-]\d\d:\d\d$/.test(raw)) {
    const zone = safeTz(due.timezone ?? tz);
    const time = partsIn(new Date(raw), zone).time;
    return zonedToUtc(day, time, zone).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return `${day}${raw.slice(10)}`;
}

export type DueStatus = 'overdue' | 'today' | 'future' | 'none';

export function dueStatus(due: Due | null, today: string, tz: string): DueStatus {
  if (!due) return 'none';
  const d = dueDay(due, tz);
  if (d < today) return 'overdue';
  if (d === today) return 'today';
  return 'future';
}

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri 16 Oct", or "Fri 16 Oct 2027" outside the current year. */
export function shortDate(day: string, today: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const base = `${WEEKDAY[weekday(day) - 1]} ${d} ${MONTH[m - 1]}`;
  return y === Number(today.slice(0, 4)) ? base : `${base} ${y}`;
}

/** Human label for a calendar day relative to today: "Today", "Tomorrow", "Fri", "Mon 3 Nov", "3 Nov 2027". */
export function dayLabel(day: string, today: string): string {
  const delta = diffDays(day, today);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  const wd = WEEKDAY[weekday(day) - 1];
  if (delta > 1 && delta < 7) return wd;
  if (y !== Number(today.slice(0, 4))) return `${d} ${MONTH[m - 1]} ${y}`;
  return `${wd} ${d} ${MONTH[m - 1]}`;
}

export function describeDue(due: Due, today: string, tz: string): string {
  const day = dueDay(due, tz);
  const time = dueTime(due, tz);
  return time ? `${dayLabel(day, today)} ${time}` : dayLabel(day, today);
}

export function overdueBy(due: Due, today: string, tz: string): string {
  const n = diffDays(today, dueDay(due, tz));
  if (n <= 0) return '';
  if (n === 1) return '1 day overdue';
  if (n < 14) return `${n} days overdue`;
  if (n < 60) return `${Math.round(n / 7)} weeks overdue`;
  return `${Math.round(n / 30)} months overdue`;
}

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const s = (now - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86_400);
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  if (d < 730) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export interface DatePreset {
  id: 'today' | 'tomorrow' | 'weekend' | 'nextweek' | 'nextmonth' | 'none';
  label: string;
  /** Target day, or null to clear the date. */
  day: string | null;
}

export function datePresets(today: string, opts: { weekendStart?: number; nextWeek?: number } = {}): DatePreset[] {
  const weekendStart = opts.weekendStart || 6;
  const nextWeek = opts.nextWeek || 1;
  const [y, m] = today.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return [
    { id: 'today', label: 'Today', day: today },
    { id: 'tomorrow', label: 'Tomorrow', day: addDays(today, 1) },
    { id: 'weekend', label: weekday(today) >= weekendStart ? 'Next weekend' : 'This weekend', day: nextWeekday(today, weekendStart) },
    { id: 'nextweek', label: 'Next week', day: nextWeekday(today, nextWeek) },
    { id: 'nextmonth', label: 'Next month', day: nextMonth },
    { id: 'none', label: 'No date', day: null },
  ];
}
