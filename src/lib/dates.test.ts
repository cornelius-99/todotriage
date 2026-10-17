import { describe, expect, it } from 'vitest';
import type { Due } from '../api/types.ts';
import { addDays, addMonths, clockTime, datePresets, dayLabel, dueAtTime, dueDay, dueStatus, dueTime, minutesNow, monthGrid, monthTitle, moveDueDate, nextWeekday, overdueBy, todayIn, weekday } from './dates.ts';

const due = (date: string, extra: Partial<Due> = {}): Due => ({ date, string: date, isRecurring: false, ...extra });

describe('day math', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows weekdays (2026-10-16 is a Friday)', () => {
    expect(weekday('2026-10-16')).toBe(5);
    expect(weekday('2026-10-18')).toBe(7);
  });

  it('finds the next weekday strictly after today', () => {
    expect(nextWeekday('2026-10-16', 6)).toBe('2026-10-17'); // Fri → Sat
    expect(nextWeekday('2026-10-16', 1)).toBe('2026-10-19'); // Fri → Mon
    expect(nextWeekday('2026-10-19', 1)).toBe('2026-10-26'); // Mon → next Mon
  });

  it('adds months, clamping to shorter months', () => {
    expect(addMonths('2026-10-16', 1)).toBe('2026-11-16');
    expect(addMonths('2026-12-05', 1)).toBe('2027-01-05');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-03-31', -1)).toBe('2028-02-29');
    expect(addMonths('2026-10-16', -12)).toBe('2025-10-16');
  });

  it('lays out six weeks for a month from the chosen week start', () => {
    const mon = monthGrid('2026-10', 1); // Oct 1 2026 is a Thursday
    expect(mon).toHaveLength(42);
    expect(mon[0]).toBe('2026-09-28');
    expect(mon[3]).toBe('2026-10-01');
    expect(mon[41]).toBe('2026-11-08');
    expect(monthGrid('2026-10', 7)[0]).toBe('2026-09-27');
    expect(monthGrid('2026-06', 1)[0]).toBe('2026-06-01'); // starts on a Monday: no leading days
    expect(monthTitle('2026-10')).toBe('October 2026');
  });

  it('computes today in a timezone', () => {
    const instant = new Date('2026-10-16T23:30:00Z');
    expect(todayIn('Europe/Zurich', instant)).toBe('2026-10-17');
    expect(todayIn('America/New_York', instant)).toBe('2026-10-16');
  });
});

describe('due dates', () => {
  it('reads day and time for all-day, floating and fixed-zone dates', () => {
    expect(dueDay(due('2026-10-16'), 'Europe/Zurich')).toBe('2026-10-16');
    expect(dueTime(due('2026-10-16'), 'Europe/Zurich')).toBeNull();
    expect(dueTime(due('2026-10-16T14:00:00'), 'Europe/Zurich')).toBe('14:00');
    // 22:30 UTC is already the next day in Zurich.
    expect(dueDay(due('2026-10-16T22:30:00Z'), 'Europe/Zurich')).toBe('2026-10-17');
    expect(dueTime(due('2026-10-16T22:30:00Z'), 'Europe/Zurich')).toBe('00:30');
  });

  it('classifies due status', () => {
    expect(dueStatus(null, '2026-10-16', 'UTC')).toBe('none');
    expect(dueStatus(due('2026-10-15'), '2026-10-16', 'UTC')).toBe('overdue');
    expect(dueStatus(due('2026-10-16T09:00:00'), '2026-10-16', 'UTC')).toBe('today');
    expect(dueStatus(due('2026-10-20'), '2026-10-16', 'UTC')).toBe('future');
  });

  it('moves a date while keeping its time of day', () => {
    expect(moveDueDate(null, '2026-10-20', 'UTC')).toBe('2026-10-20');
    expect(moveDueDate(due('2026-10-12'), '2026-10-20', 'UTC')).toBe('2026-10-20');
    expect(moveDueDate(due('2026-10-12T14:00:00'), '2026-10-20', 'UTC')).toBe('2026-10-20T14:00:00');
    // 09:00 in Zurich: UTC+2 in October (summer time), UTC+1 after the switch on Oct 25.
    const fixed = due('2026-10-12T07:00:00Z', { timezone: 'Europe/Zurich' });
    expect(moveDueDate(fixed, '2026-10-20', 'UTC')).toBe('2026-10-20T07:00:00Z');
    expect(moveDueDate(fixed, '2026-10-27', 'UTC')).toBe('2026-10-27T08:00:00Z');
  });

  it('puts a date at a time picked on the user\'s clock', () => {
    expect(dueAtTime(null, '2026-10-20', '15:30', 'Europe/Zurich')).toBe('2026-10-20T15:30:00');
    expect(dueAtTime(due('2026-10-12'), '2026-10-20', '09:00', 'Europe/Zurich')).toBe('2026-10-20T09:00:00');
    // A due pinned to a timezone stays pinned: 15:30 in Zurich is 13:30 UTC in summer time, 14:30 after Oct 25.
    const fixed = due('2026-10-12T07:00:00Z', { timezone: 'America/New_York' });
    expect(dueAtTime(fixed, '2026-10-20', '15:30', 'Europe/Zurich')).toBe('2026-10-20T13:30:00Z');
    expect(dueAtTime(fixed, '2026-10-27', '15:30', 'Europe/Zurich')).toBe('2026-10-27T14:30:00Z');
  });

  it('reads and writes clock times', () => {
    expect(clockTime(0)).toBe('00:00');
    expect(clockTime(9 * 60 + 5)).toBe('09:05');
    expect(clockTime(23 * 60 + 45)).toBe('23:45');
    expect(minutesNow('Europe/Zurich', new Date('2026-10-16T22:30:00Z'))).toBe(30);
    expect(minutesNow('America/New_York', new Date('2026-10-16T22:30:00Z'))).toBe(18 * 60 + 30);
  });

  it('labels days relative to today', () => {
    expect(dayLabel('2026-10-16', '2026-10-16')).toBe('Today');
    expect(dayLabel('2026-10-17', '2026-10-16')).toBe('Tomorrow');
    expect(dayLabel('2026-10-15', '2026-10-16')).toBe('Yesterday');
    expect(dayLabel('2026-10-20', '2026-10-16')).toBe('Tue');
    expect(dayLabel('2026-11-03', '2026-10-16')).toBe('Tue 3 Nov');
    expect(dayLabel('2027-01-05', '2026-10-16')).toBe('5 Jan 2027');
    expect(overdueBy(due('2026-10-13'), '2026-10-16', 'UTC')).toBe('3 days overdue');
  });

  it('builds presets from user settings', () => {
    const p = Object.fromEntries(datePresets('2026-10-16', { weekendStart: 6, nextWeek: 1 }).map((x) => [x.id, x]));
    expect(p.today.day).toBe('2026-10-16');
    expect(p.tomorrow.day).toBe('2026-10-17');
    expect(p.weekend.day).toBe('2026-10-17');
    expect(p.nextweek.day).toBe('2026-10-19');
    expect(p.nextmonth.day).toBe('2026-11-01');
    expect(p.none.day).toBeNull();
    expect(datePresets('2026-12-20').find((x) => x.id === 'nextmonth')!.day).toBe('2027-01-01');
  });
});
