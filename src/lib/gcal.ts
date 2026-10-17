/// <reference types="@maxim_mazurok/gapi.client.calendar-v3" />
import { addDays, zonedToUtc } from './dates.ts';

// Google Calendar data, reduced to what the schedule view draws. Pure, so it's testable.

/** A calendar from the user's Google calendar list. */
export interface GCalendar {
  id: string;
  name: string;
  color: string;
  primary: boolean;
  /** Whether it's ticked in Google Calendar itself; the default for showing it here. */
  selected: boolean;
}

export interface GEvent {
  id: string;
  calendarId: string;
  title: string;
  color: string;
  /** All-day events span days `startDay` up to (not including) `endDay`; for timed ones these are informational. */
  allDay: boolean;
  startDay: string;
  endDay: string;
  /** Epoch ms; for all-day events, midnight UTC of the days (unused when drawing). */
  start: number;
  end: number;
}

/** Google's generated types for the Calendar API, as its JavaScript client returns it. */
export type ApiCalendar = gapi.client.calendar.CalendarListEntry;
export type ApiEvent = gapi.client.calendar.Event;

// The API still reports Google's original pastel palette; the Calendar apps draw each of those
// palette entries in a newer, stronger colour. Map them so events look the way they do in Google Calendar.
const CALENDAR_PALETTE: Record<string, [api: string, shown: string]> = {
  '1': ['#ac725e', '#795548'], // Cocoa
  '2': ['#d06b64', '#e67c73'], // Flamingo
  '3': ['#f83a22', '#d50000'], // Tomato
  '4': ['#fa573c', '#f4511e'], // Tangerine
  '5': ['#ff7537', '#ef6c00'], // Pumpkin
  '6': ['#ffad46', '#f09300'], // Mango
  '7': ['#42d692', '#009688'], // Eucalyptus
  '8': ['#16a765', '#0b8043'], // Basil
  '9': ['#7bd148', '#7cb342'], // Pistachio
  '10': ['#b3dc6c', '#c0ca33'], // Avocado
  '11': ['#fbe983', '#e4c441'], // Citron
  '12': ['#fad165', '#f6bf26'], // Banana
  '13': ['#92e1c0', '#33b679'], // Sage
  '14': ['#9fe1e7', '#039be5'], // Peacock
  '15': ['#9fc6e7', '#4285f4'], // Cobalt
  '16': ['#4986e7', '#3f51b5'], // Blueberry
  '17': ['#9a9cff', '#7986cb'], // Lavender
  '18': ['#b99aff', '#b39ddb'], // Wisteria
  '19': ['#c2c2c2', '#616161'], // Graphite
  '20': ['#cabdbf', '#a79b8e'], // Birch
  '21': ['#cca6ac', '#ad1457'], // Radicchio
  '22': ['#f691b2', '#d81b60'], // Cherry blossom
  '23': ['#cd74e6', '#8e24aa'], // Grape
  '24': ['#a47ae2', '#9e69af'], // Amethyst
};

/** Per-event colours, as Google Calendar shows them (the API's `colors.event`, by id). */
const EVENT_PALETTE: Record<string, string> = {
  '1': '#7986cb', // Lavender
  '2': '#33b679', // Sage
  '3': '#8e24aa', // Grape
  '4': '#e67c73', // Flamingo
  '5': '#f6bf26', // Banana
  '6': '#f4511e', // Tangerine
  '7': '#039be5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3f51b5', // Blueberry
  '10': '#0b8043', // Basil
  '11': '#d50000', // Tomato
};

const FALLBACK = '#039be5';

/** A calendar's colour: the palette colour Google shows, or the custom colour the user picked. */
export function calendarColor(c: Pick<ApiCalendar, 'colorId' | 'backgroundColor'>): string {
  const bg = c.backgroundColor?.toLowerCase();
  const palette = c.colorId ? CALENDAR_PALETTE[c.colorId] : undefined;
  if (palette && (!bg || bg === palette[0])) return palette[1];
  return bg || FALLBACK;
}

export function toCalendar(c: ApiCalendar): GCalendar {
  return {
    id: c.id ?? '',
    name: c.summaryOverride || c.summary || c.id || '',
    color: calendarColor(c),
    primary: !!c.primary,
    selected: !!c.selected,
  };
}

/** Readable text on a coloured block: dark on light colours (Banana, Citron), white otherwise. */
export function textOn(hex: string): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1f1f1f' : '#fff';
}

/** Turn an API event into one we draw, or null for ones Google Calendar wouldn't show in the grid. */
export function toEvent(e: ApiEvent, cal: GCalendar, tz: string): GEvent | null {
  if (e.status === 'cancelled' || e.eventType === 'workingLocation') return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;
  const color = (e.colorId && EVENT_PALETTE[e.colorId]) || cal.color;
  const base = { id: `${cal.id}/${e.id}`, calendarId: cal.id, title: e.summary || '(No title)', color };
  if (e.start?.date) {
    const startDay = e.start.date;
    const endDay = e.end?.date && e.end.date > startDay ? e.end.date : addDays(startDay, 1);
    return { ...base, allDay: true, startDay, endDay, start: Date.parse(startDay), end: Date.parse(endDay) };
  }
  if (!e.start?.dateTime) return null;
  const start = Date.parse(e.start.dateTime);
  const end = e.end?.dateTime ? Date.parse(e.end.dateTime) : start;
  if (Number.isNaN(start)) return null;
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  return { ...base, allDay: false, startDay: day(start), endDay: day(Math.max(start, end - 1)), start, end: Math.max(start, end) };
}

/** A timed event's piece on one day, in minutes since that day's midnight in `tz`. */
export interface EventSlice {
  event: GEvent;
  start: number;
  length: number;
}

/** What to draw for `day`: timed events clipped to the day, and the all-day ones covering it. */
export function eventsOn(events: GEvent[], day: string, tz: string): { timed: EventSlice[]; allDay: GEvent[] } {
  const timed: EventSlice[] = [];
  const allDay: GEvent[] = [];
  const from = zonedToUtc(day, '00:00', tz).getTime();
  const to = zonedToUtc(addDays(day, 1), '00:00', tz).getTime();
  for (const e of events) {
    if (e.allDay) {
      if (e.startDay <= day && day < e.endDay) allDay.push(e);
      continue;
    }
    if (e.end < from || e.start >= to) continue;
    const s = Math.max(e.start, from);
    const end = Math.min(e.end, to);
    if (end < s || (end === s && e.end > e.start)) continue;
    timed.push({ event: e, start: Math.round((s - from) / 60_000), length: Math.round((end - s) / 60_000) });
  }
  return { timed, allDay };
}
