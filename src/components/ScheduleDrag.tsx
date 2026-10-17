import { batch, signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Task } from '../api/types.ts';
import { todoistColor } from '../lib/colors.ts';
import { addDays, clockTime, dayLabel, diffDays, dueDay, dueTime, minutesNow, shortDate, WEEKDAY, weekday } from '../lib/dates.ts';
import { current, gone, projectById, scheduleAt, scheduleDay, sheet, tasks, today, tz, upcoming } from '../store.ts';
import { Icon } from './icons.tsx';
import { finger, usePressDrag } from './press.ts';

// Press the Schedule button and drag up: a few days of calendar open under the finger, and
// letting go over a slot schedules the task right then. Over a day's header it gets the day
// without a time; back down at the button it's cancelled.

/** Where letting go would put the task: a day, at minutes since midnight or (null) with no time. */
interface Aim {
  day: string;
  minutes: number | null;
}
type Pointing = Aim | 'cancel' | 'past';

const SLOT = 15;
/** How long a task without a duration is drawn. Nothing about duration is sent to Todoist. */
const DEFAULT_MINUTES = 30;
/** The first hour in view when the calendar opens. */
const START_HOUR = 8;
/** Hours that fit on screen before it scrolls. */
const VISIBLE_HOURS = 12;
const GUTTER = 46;
/** Slots are picked a little above the fingertip so it doesn't hide them. */
const AIM_ABOVE = 28;
/** Height of the zones at the top and bottom of the grid that scroll it. */
const EDGE = 44;
/** How long to hold at a side edge to page by a day. */
const DWELL = 550;
/** How long to stay in a top or bottom zone before it scrolls, so passing through doesn't. */
const SCROLL_DELAY = 180;
const LAND_MS = 420;
const CLOSE_MS = 180;

const stage = signal<'closed' | 'open' | 'landing' | 'closing'>('closed');
const landed = signal<Aim | null>(null);
let pointing: Pointing = 'cancel';

const sameAim = (a: Pointing, b: Pointing) =>
  a === b || (typeof a === 'object' && typeof b === 'object' && a.day === b.day && a.minutes === b.minutes);

function begin() {
  if (stage.value !== 'closed') return;
  pointing = 'cancel';
  stage.value = 'open';
}

function finish(cancelled: boolean) {
  if (stage.value !== 'open') return;
  const aim = !cancelled && typeof pointing === 'object' ? pointing : null;
  const close = () => {
    stage.value = 'closing';
    setTimeout(() => batch(() => ((stage.value = 'closed'), (landed.value = null))), CLOSE_MS);
  };
  if (!aim) return close();
  const id = current.value?.id;
  batch(() => ((landed.value = aim), (stage.value = 'landing')));
  setTimeout(() => {
    close();
    if (aim.minutes === null) scheduleDay(aim.day, dayLabel(aim.day, today.value), id);
    else scheduleAt(aim.day, clockTime(aim.minutes), id);
  }, LAND_MS);
}

/** The big round button in the phone bar. Tap for the date sheet; press and drag up to drop the task on a time. */
export function ScheduleButton({ disabled }: { disabled: boolean }) {
  const press = usePressDrag({ disabled, idle: () => stage.value === 'closed', open: begin, release: finish, tap: () => (sheet.value = 'schedule') });
  return (
    <button class={`bar-btn sched-fab ${stage.value !== 'closed' ? 'held' : ''}`} disabled={disabled} {...press} aria-label="Schedule (drag up to pick a time)">
      <Icon name="calendarClock" size={26} />
      <span>Schedule</span>
    </button>
  );
}

export function ScheduleOverlay() {
  return stage.value === 'closed' ? null : <Overlay />;
}

interface Block {
  task: Task;
  start: number;
  length: number;
  lane: number;
  lanes: number;
}

/** Timed tasks laid out side by side where they overlap; untimed ones are only counted. */
function dayPlan(all: Task[], day: string, zone: string) {
  const timed: Omit<Block, 'lane' | 'lanes'>[] = [];
  let untimed = 0;
  for (const task of all) {
    if (!task.due || dueDay(task.due, zone) !== day) continue;
    const time = dueTime(task.due, zone);
    if (!time) {
      untimed++;
      continue;
    }
    const [h, m] = time.split(':').map(Number);
    const length = task.duration?.unit === 'minute' ? task.duration.amount : DEFAULT_MINUTES;
    timed.push({ task, start: h * 60 + m, length });
  }
  timed.sort((a, b) => a.start - b.start || b.length - a.length);
  const blocks: Block[] = [];
  let group: Block[] = [];
  let groupEnd = -1;
  const settle = () => {
    const lanes = Math.max(0, ...group.map((b) => b.lane)) + 1;
    for (const b of group) b.lanes = lanes;
    group = [];
  };
  for (const t of timed) {
    if (t.start >= groupEnd) settle();
    const taken = new Set(group.filter((b) => b.start + b.length > t.start).map((b) => b.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    const b = { ...t, lane, lanes: 1 };
    group.push(b);
    blocks.push(b);
    groupEnd = Math.max(groupEnd, t.start + t.length);
  }
  settle();
  return { blocks, untimed };
}

function Overlay() {
  const task = current.value;
  const gridRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [cols] = useState(() => Math.max(3, Math.min(7, Math.floor((window.innerWidth - GUTTER) / 80))));
  const [offset, setOffset] = useState(0);
  const [hourPx, setHourPx] = useState(48);
  const [aim, setAim] = useState<Pointing>('cancel');
  const [edge, setEdge] = useState<'up' | 'down' | 'left' | 'right' | null>(null);
  // The frame loop reads these without waiting for a re-render.
  const live = useRef({ offset, hourPx });
  live.current = { offset, hourPx };

  const day0 = today.value;
  const zone = tz.value;
  const now = minutesNow(zone);
  const days = Array.from({ length: cols }, (_, i) => addDays(day0, offset + i));

  useLayoutEffect(() => {
    const grid = gridRef.current!;
    const px = Math.max(40, Math.min(80, grid.clientHeight / VISIBLE_HOURS));
    live.current.hourPx = px;
    setHourPx(px);
    grid.scrollTop = START_HOUR * px - 10;
  }, []);

  useEffect(() => {
    let raf = 0;
    // Coming up from the button passes through the bottom scroll zone; only scroll there once the finger has been higher.
    let armed = false;
    let dwell: { dir: 'left' | 'right'; since: number } | null = null;
    let inZone: { dir: -1 | 1; since: number } | null = null;
    let last = performance.now();

    const pointAt = (x: number, y: number, grid: HTMLDivElement, r: DOMRect): Pointing => {
      if (y > r.bottom) return 'cancel';
      const { offset, hourPx } = live.current;
      const colW = (r.width - GUTTER) / cols;
      const col = Math.max(0, Math.min(cols - 1, Math.floor((x - r.left - GUTTER) / colW)));
      const day = addDays(today.value, offset + col);
      const aimY = y - AIM_ABOVE;
      const head = headRef.current!.getBoundingClientRect();
      if (aimY < r.top) return aimY >= head.top - 60 ? { day, minutes: null } : 'cancel';
      const raw = ((aimY - r.top + grid.scrollTop) / hourPx) * 60;
      const minutes = Math.max(0, Math.min(24 * 60 - SLOT, Math.round(raw / SLOT) * SLOT));
      if (day === today.value && minutes < minutesNow(tz.value)) return 'past';
      return { day, minutes };
    };

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // Scroll speeds are per 60 Hz frame; this keeps them the same at 120 Hz.
      const frames = Math.min(3, (t - last) / 16.7);
      last = t;
      const grid = gridRef.current;
      if (!grid || stage.value !== 'open') return;
      const r = grid.getBoundingClientRect();
      const { x, y } = finger;
      const aimY = y - AIM_ABOVE;

      if (y < r.bottom - EDGE * 1.5) armed = true;
      let v = 0;
      if (aimY >= r.top && aimY < r.top + EDGE) v = -(1 + 4.5 * ((r.top + EDGE - aimY) / EDGE) ** 2);
      else if (armed && y > r.bottom - EDGE && y <= r.bottom) v = 1 + 4.5 * ((y - (r.bottom - EDGE)) / EDGE) ** 2;
      const dir = Math.sign(v) as -1 | 0 | 1;
      if (!dir) inZone = null;
      else if (inZone?.dir !== dir) inZone = { dir, since: t };
      const before = grid.scrollTop;
      if (inZone && t - inZone.since > SCROLL_DELAY) grid.scrollTop += v * frames;
      const scrolling = grid.scrollTop !== before ? (v < 0 ? 'up' : 'down') : null;

      const side = x > window.innerWidth - 22 ? 'right' : x < r.left + GUTTER * 0.6 && live.current.offset > 0 && aimY > r.top ? 'left' : null;
      if (!side) dwell = null;
      else if (dwell?.dir !== side) dwell = { dir: side, since: t };
      else if (t - dwell.since > DWELL) {
        dwell.since = t;
        const next = Math.max(0, live.current.offset + (side === 'right' ? 1 : -1));
        live.current.offset = next;
        setOffset(next);
      }
      setEdge(scrolling ?? side);

      const p = pointAt(x, y, grid, r);
      if (!sameAim(p, pointing)) {
        pointing = p;
        setAim(p);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const all = new Map<string, Task>();
  for (const t of upcoming.value) all.set(t.id, t);
  for (const t of tasks.value.values()) all.set(t.id, t);
  for (const id of gone.value) all.delete(id);
  if (task) all.delete(task.id);
  const plans = days.map((d) => dayPlan([...all.values()], d, zone));

  const s = stage.value;
  const shown = s === 'landing' || s === 'closing' ? landed.value : typeof aim === 'object' ? aim : null;
  const y = (min: number) => (min / 60) * hourPx;
  const name = (d: string) => (Math.abs(diffDays(d, day0)) <= 1 ? dayLabel(d, day0) : shortDate(d, day0));

  let readout: string;
  if (shown) readout = shown.minutes === null ? `${name(shown.day)}, no time` : `${name(shown.day)} · ${clockTime(shown.minutes)}`;
  else if (aim === 'past') readout = 'That time has passed';
  else readout = 'Let go here to cancel';

  return (
    <div class={`sd ${s}`} role="dialog" aria-label="Pick a time">
      <div class="sd-head">
        <div class="sd-task">
          <Icon name="calendarClock" size={15} />
          <span>{task?.content.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}</span>
        </div>
        <div class={`sd-readout ${shown ? 'on' : aim}`} aria-live="polite">
          {s !== 'open' && shown && <Icon name="check" size={22} />}
          {readout}
        </div>
      </div>

      <div class="sd-days" ref={headRef} style={{ '--cols': cols }}>
        <div class="sd-gutter-head">
          {offset > 0 && (
            <span class={`sd-page ${edge === 'left' ? 'on' : ''}`}>
              <Icon name="left" size={16} />
            </span>
          )}
        </div>
        {days.map((d, i) => {
          const { untimed } = plans[i];
          const on = shown?.day === d && shown.minutes === null;
          return (
            <div key={d} class={`sd-day ${d === day0 ? 'today' : ''} ${shown?.day === d ? 'aimed' : ''} ${on ? 'allday' : ''}`}>
              <span class="sd-dow">{d === day0 ? 'Today' : WEEKDAY[weekday(d) - 1]}</span>
              <span class="sd-num">{Number(d.slice(8))}</span>
              <span class="sd-untimed">{on ? 'no time' : untimed ? `${untimed} task${untimed > 1 ? 's' : ''}` : ''}</span>
            </div>
          );
        })}
        <span class={`sd-page right ${edge === 'right' ? 'on' : ''}`}>
          <Icon name="right" size={16} />
        </span>
      </div>

      <div class={`sd-body ${edge === 'up' || edge === 'down' ? `scroll-${edge}` : ''}`}>
        <div class="sd-grid" ref={gridRef}>
          <div class="sd-canvas" key={offset} style={{ height: `${24 * hourPx}px`, '--hour': `${hourPx}px`, '--cols': cols }}>
            <div class="sd-hours" aria-hidden="true">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} class={`sd-hour ${shown?.minutes != null && Math.abs(shown.minutes - h * 60) < 25 ? 'covered' : ''}`} style={{ top: `${y(h * 60)}px` }}>
                  {h ? clockTime(h * 60) : ''}
                </span>
              ))}
            </div>
            {days.map((d, i) => {
              const { blocks } = plans[i];
              return (
                <div key={d} class={`sd-col ${shown?.day === d && shown.minutes !== null ? 'aimed' : ''}`}>
                  {d === day0 && <div class="sd-past" style={{ height: `${y(now)}px` }} />}
                  {blocks.map((b) => {
                    const project = projectById.value.get(b.task.projectId);
                    return (
                      <div
                        key={b.task.id}
                        class={`sd-event ${b.length < 45 ? 'short' : ''}`}
                        style={{
                          top: `${y(b.start)}px`,
                          height: `${Math.max(16, y(b.length) - 2)}px`,
                          left: `${(b.lane / b.lanes) * 100}%`,
                          width: `${100 / b.lanes}%`,
                          '--c': todoistColor(project?.color ?? 'charcoal'),
                        }}
                      >
                        <span>{b.task.content}</span>
                      </div>
                    );
                  })}
                  {d === day0 && <div class="sd-now" style={{ top: `${y(now)}px` }} />}
                  {shown?.day === d && shown.minutes !== null && (
                    <div class={`sd-drop ${s !== 'open' ? 'landed' : ''}`} style={{ top: `${y(shown.minutes)}px`, height: `${y(DEFAULT_MINUTES) - 2}px` }}>
                      <strong>{clockTime(shown.minutes)}</strong>
                      <span>{task?.content}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {shown && shown.minutes !== null && (
              <div class="sd-guide" style={{ top: `${y(shown.minutes)}px` }}>
                <span class="sd-bubble">{clockTime(shown.minutes)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div class={`sd-cancel ${aim === 'cancel' && s === 'open' ? 'on' : ''}`}>
        <span class="sd-cancel-ring">
          <Icon name="x" size={24} />
        </span>
        <span>Let go here to cancel</span>
      </div>
    </div>
  );
}
