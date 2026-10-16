import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { addDays, addMonths, monthGrid, monthTitle, shortDate, WEEKDAY, weekday } from '../lib/dates.ts';
import { Icon } from './icons.tsx';

/**
 * Month-grid date picker. Days before `today` are disabled; `marked` (the task's current
 * date) gets a ring. Arrow keys, Home/End and PageUp/PageDown move around, and a
 * horizontal swipe changes the month.
 */
export function Calendar({
  today,
  marked,
  weekStart = 1,
  onPick,
}: {
  today: string;
  marked?: string | null;
  /** ISO weekday the week starts on (Todoist's `startDay`). */
  weekStart?: number;
  onPick: (day: string) => void;
}) {
  // The day that holds keyboard focus; the visible month is always its month.
  const [focus, setFocus] = useState(() => (marked && marked > today ? marked : today));
  const [slide, setSlide] = useState('');
  const fromKeys = useRef(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const daysRef = useRef<HTMLDivElement>(null);

  const month = focus.slice(0, 7);
  const days = monthGrid(month, weekStart);

  const go = (day: string, keys = false) => {
    const next = day < today ? today : day;
    if (next.slice(0, 7) !== month) setSlide(next > focus ? 'next' : 'prev');
    fromKeys.current = keys;
    setFocus(next);
  };

  useLayoutEffect(() => {
    if (fromKeys.current) daysRef.current?.querySelector<HTMLElement>(`[data-day="${focus}"]`)?.focus();
    fromKeys.current = false;
  }, [focus]);

  const col = (d: string) => (weekday(d) - weekStart + 7) % 7;
  const onKey = (e: KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      Home: () => addDays(focus, -col(focus)),
      End: () => addDays(focus, 6 - col(focus)),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
    };
    if (!moves[e.key]) return;
    e.preventDefault();
    go(moves[e.key](), true);
  };

  const onPointerUp = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) {
      swiped.current = true;
      go(addMonths(focus, dx < 0 ? 1 : -1));
    }
  };

  const thisMonth = today.slice(0, 7);
  return (
    <div class="cal">
      <div class="cal-head">
        <span class="cal-title" aria-live="polite">
          {monthTitle(month)}
        </span>
        {month !== thisMonth && (
          <button class="cal-jump" onClick={() => go(today)}>
            Today
          </button>
        )}
        <button class="cal-nav" onClick={() => go(addMonths(focus, -1))} disabled={month <= thisMonth} aria-label="Previous month">
          <Icon name="left" size={18} />
        </button>
        <button class="cal-nav" onClick={() => go(addMonths(focus, 1))} aria-label="Next month">
          <Icon name="right" size={18} />
        </button>
      </div>
      <div class="cal-week" aria-hidden="true">
        {days.slice(0, 7).map((d) => (
          <span key={d}>{WEEKDAY[weekday(d) - 1]}</span>
        ))}
      </div>
      <div
        key={month}
        ref={daysRef}
        class={`cal-days ${slide}`}
        role="group"
        aria-label={monthTitle(month)}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          swiped.current = false;
          swipe.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
        onClickCapture={(e) => {
          // A swipe that ends on a day shouldn't also pick it.
          if (swiped.current) e.stopPropagation();
          swiped.current = false;
        }}
      >
        {days.map((d) => {
          const cls = ['cal-day', d.slice(0, 7) !== month && 'out', d === today && 'today', d === marked && 'due'].filter(Boolean).join(' ');
          return (
            <button
              key={d}
              data-day={d}
              class={cls}
              tabIndex={d === focus ? 0 : -1}
              disabled={d < today}
              aria-label={`${shortDate(d, today)}${d === today ? ', today' : ''}${d === marked ? ', current date' : ''}`}
              aria-current={d === today ? 'date' : undefined}
              onClick={() => onPick(d)}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
