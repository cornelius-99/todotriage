import { describe, expect, it } from 'vitest';
import { calendarColor, eventsOn, textOn, toCalendar, toEvent, type GCalendar } from './gcal.ts';

const TZ = 'Europe/Berlin';
const cal: GCalendar = { id: 'me@example.com', name: 'Me', color: '#039be5', primary: true, selected: true };

describe('calendar colours', () => {
  it('shows palette colours the way Google Calendar does', () => {
    expect(calendarColor({ colorId: '14', backgroundColor: '#9fe1e7' })).toBe('#039be5');
    expect(calendarColor({ colorId: '3', backgroundColor: '#F83A22' })).toBe('#d50000');
  });

  it('keeps a custom colour', () => {
    expect(calendarColor({ colorId: '14', backgroundColor: '#123456' })).toBe('#123456');
  });

  it('names the calendar by its override first', () => {
    expect(toCalendar({ id: 'x', summary: 'Work', summaryOverride: 'Job', colorId: '1', backgroundColor: '#ac725e', selected: true }).name).toBe('Job');
  });

  it('picks readable text', () => {
    expect(textOn('#f6bf26')).toBe('#1f1f1f');
    expect(textOn('#3f51b5')).toBe('#fff');
  });
});

describe('events', () => {
  it('uses the event colour over the calendar colour', () => {
    const e = toEvent({ id: '1', summary: 'Lunch', colorId: '11', start: { dateTime: '2026-10-20T12:00:00+02:00' }, end: { dateTime: '2026-10-20T13:00:00+02:00' } }, cal, TZ)!;
    expect(e.color).toBe('#d50000');
    expect(toEvent({ id: '2', start: { dateTime: '2026-10-20T12:00:00+02:00' }, end: { dateTime: '2026-10-20T13:00:00+02:00' } }, cal, TZ)!.color).toBe(cal.color);
  });

  it('skips cancelled, declined and working-location entries', () => {
    const when = { start: { dateTime: '2026-10-20T12:00:00Z' }, end: { dateTime: '2026-10-20T13:00:00Z' } };
    expect(toEvent({ id: '1', status: 'cancelled', ...when }, cal, TZ)).toBeNull();
    expect(toEvent({ id: '2', eventType: 'workingLocation', ...when }, cal, TZ)).toBeNull();
    expect(toEvent({ id: '3', attendees: [{ self: true, responseStatus: 'declined' }], ...when }, cal, TZ)).toBeNull();
  });

  it('places timed events in the user timezone', () => {
    const e = toEvent({ id: '1', summary: 'Call', start: { dateTime: '2026-10-20T07:30:00Z' }, end: { dateTime: '2026-10-20T08:15:00Z' } }, cal, TZ)!;
    const { timed } = eventsOn([e], '2026-10-20', TZ);
    expect(timed).toEqual([{ event: e, start: 9 * 60 + 30, length: 45 }]);
  });

  it('splits an event across midnight', () => {
    const e = toEvent({ id: '1', start: { dateTime: '2026-10-20T22:00:00+02:00' }, end: { dateTime: '2026-10-21T01:00:00+02:00' } }, cal, TZ)!;
    expect(eventsOn([e], '2026-10-20', TZ).timed[0]).toMatchObject({ start: 22 * 60, length: 120 });
    expect(eventsOn([e], '2026-10-21', TZ).timed[0]).toMatchObject({ start: 0, length: 60 });
    expect(eventsOn([e], '2026-10-22', TZ).timed).toEqual([]);
  });

  it('lists all-day events on each day they cover', () => {
    const e = toEvent({ id: '1', summary: 'Trip', start: { date: '2026-10-20' }, end: { date: '2026-10-22' } }, cal, TZ)!;
    expect(eventsOn([e], '2026-10-20', TZ).allDay).toEqual([e]);
    expect(eventsOn([e], '2026-10-21', TZ).allDay).toEqual([e]);
    expect(eventsOn([e], '2026-10-22', TZ).allDay).toEqual([]);
  });
});
