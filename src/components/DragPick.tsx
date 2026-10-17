import { batch, signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Task } from '../api/types.ts';
import { PRIORITY_COLOR, todoistColor, uiPriority } from '../lib/colors.ts';
import { current, type Destination, destinations, labels, moveTo, setLabels, setPriority, sheet } from '../store.ts';
import { Icon, type IconName } from './icons.tsx';
import { edgeSpeed, edgeZone, finger, usePressDrag, useSecondFinger } from './press.ts';

// Press Move, Labels or Priority and drag up: the choices open as a list under the finger, and letting go on one
// applies it right then. Off the list, or back down at the bar, it's cancelled. A tap still opens the full sheet.

export type PickKind = 'move' | 'labels' | 'priority';

const KIND: Record<PickKind, { label: string; icon: IconName; noun: string; tone: string }> = {
  move: { label: 'Move', icon: 'move', noun: 'project', tone: 'var(--move)' },
  labels: { label: 'Labels', icon: 'tag', noun: 'label', tone: 'var(--label)' },
  priority: { label: 'Priority', icon: 'flag', noun: 'priority', tone: 'var(--muted)' },
};

interface Choice {
  /** Prefixed by kind, so it can't clash with `'cancel'` or `'none'`. */
  id: string;
  label: string;
  /** What letting go here does, shown large at the top. */
  readout: string;
  color: string;
  icon?: IconName;
  indent?: number;
  /** Already true of the task: its project, one of its labels, its priority. */
  on: boolean;
  /** Letting go here would change nothing. */
  noop?: boolean;
  run: () => void;
}

/** A choice's id, below the list (`cancel`), or anywhere else that isn't a choice. */
type Pointing = string | 'cancel' | 'none';

/** How long to stay in a scroll zone before it scrolls, so passing through doesn't. */
const SCROLL_DELAY = 180;
const LAND_MS = 360;
const CLOSE_MS = 180;

const kind = signal<PickKind>('move');
const stage = signal<'closed' | 'open' | 'landing' | 'closing'>('closed');
const landed = signal<string | null>(null);
let pointing: Pointing = 'cancel';

/** The top-level projects in reverse, each keeping its sections and subprojects under it in order, so the first ones
 * (Inbox, then usually the most used) sit at the bottom, nearest the finger coming up from the bar. */
function bottomUp(list: Destination[]): Destination[] {
  const blocks: Destination[][] = [];
  for (const d of list) {
    if (d.depth === 0 || !blocks.length) blocks.push([d]);
    else blocks[blocks.length - 1].push(d);
  }
  return blocks.reverse().flat();
}

/** What the list offers for the task. Built again on release, so it acts on the task as it is then. */
function choicesFor(k: PickKind, task: Task): Choice[] {
  const id = task.id;
  if (k === 'move') {
    return bottomUp(destinations.value).map((d) => {
      const here = task.projectId === d.projectId && (task.sectionId ?? null) === d.sectionId;
      // A subtask in its parent's project still moves out from under the parent.
      const noop = here && !task.parentId;
      return {
        id: `m:${d.projectId}:${d.sectionId ?? ''}`,
        label: d.name,
        readout: noop ? `Already in ${d.name}` : `Move to ${d.path}`,
        color: d.color,
        icon: d.sectionId ? 'subtasks' : undefined,
        indent: d.depth,
        on: here,
        noop,
        run: () => moveTo({ projectId: d.projectId, sectionId: d.sectionId }, id),
      };
    });
  }
  if (k === 'labels') {
    const names = [...new Set([...labels.value.map((l) => l.name), ...task.labels])];
    return names.map((name) => {
      const on = task.labels.includes(name);
      return {
        id: `l:${name}`,
        label: name,
        readout: `${on ? 'Remove' : 'Add'} @${name}`,
        color: todoistColor(labels.value.find((l) => l.name === name)?.color),
        on,
        run: () => setLabels(on ? task.labels.filter((l) => l !== name) : [...task.labels, name], id),
      };
    });
  }
  const now = uiPriority(task.priority);
  return [1, 2, 3, 4].map((p) => ({
    id: `p:${p}`,
    label: `Priority ${p}`,
    readout: p === now ? `Already priority ${p}` : `Priority ${p}`,
    color: PRIORITY_COLOR[p],
    icon: 'flag',
    on: p === now,
    noop: p === now,
    run: () => setPriority(p, id),
  }));
}

function begin(k: PickKind) {
  if (stage.value !== 'closed') return;
  pointing = 'cancel';
  batch(() => ((kind.value = k), (stage.value = 'open')));
}

function finish(cancelled: boolean) {
  if (stage.value !== 'open') return;
  const task = current.value;
  const choice = !cancelled && task ? choicesFor(kind.value, task).find((c) => c.id === pointing && !c.noop) : undefined;
  const close = () => {
    stage.value = 'closing';
    setTimeout(() => batch(() => ((stage.value = 'closed'), (landed.value = null))), CLOSE_MS);
  };
  if (!choice) return close();
  batch(() => ((landed.value = choice.id), (stage.value = 'landing')));
  setTimeout(() => {
    close();
    choice.run();
  }, LAND_MS);
}

/** A phone bar button: tap for its sheet, or press and drag up to pick from a list without lifting the finger. */
export function PickButton({ kind: k, disabled }: { kind: PickKind; disabled: boolean }) {
  const press = usePressDrag({ disabled, idle: () => stage.value === 'closed', open: () => begin(k), release: finish, tap: () => (sheet.value = k) });
  const task = current.value;
  // The flag shows the task's priority.
  const tone = k === 'priority' && task ? `p${uiPriority(task.priority)}` : '';
  return (
    <button class={`bar-btn drag-btn ${tone}`} disabled={disabled} {...press} aria-label={`${KIND[k].label} (drag up to pick a ${KIND[k].noun})`}>
      <Icon name={KIND[k].icon} size={22} />
      <span>{KIND[k].label}</span>
    </button>
  );
}

export function PickOverlay() {
  return stage.value === 'closed' ? null : <Overlay />;
}

function Overlay() {
  const task = current.value;
  const k = kind.value;
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [aim, setAim] = useState<Pointing>('cancel');
  const [edge, setEdge] = useState<'up' | 'down' | null>(null);
  // Which ends of a long list have more past them, for the fades.
  const [more, setMore] = useState('');

  // The move list is bottom-up, so a long one opens scrolled to its end.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && k === 'move') box.scrollTop = box.scrollHeight;
  }, []);

  useEffect(() => {
    let raf = 0;
    // Coming up from the button passes through the bottom scroll zone; only scroll there once the finger has been higher.
    let armed = false;
    let inZone: { dir: -1 | 1; since: number } | null = null;
    let last = performance.now();

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // Scroll speeds are per 60 Hz frame; this keeps them the same at 120 Hz.
      const frames = Math.min(3, (t - last) / 16.7);
      last = t;
      const box = boxRef.current;
      if (!box || stage.value !== 'open') return;
      const r = box.getBoundingClientRect();
      const { y } = finger;
      const zone = edgeZone(r.height);

      if (y < r.bottom - zone * 1.5) armed = true;
      let v = 0;
      // Up past the list, over the header, scrolls at full speed.
      if (y < r.top + zone) v = -edgeSpeed((r.top + zone - y) / zone);
      else if (armed && y > r.bottom - zone && y <= r.bottom) v = edgeSpeed((y - (r.bottom - zone)) / zone);
      const dir = Math.sign(v) as -1 | 0 | 1;
      if (!dir) inZone = null;
      else if (inZone?.dir !== dir) inZone = { dir, since: t };
      const before = box.scrollTop;
      if (inZone && t - inZone.since > SCROLL_DELAY) box.scrollTop += v * frames;
      setEdge(box.scrollTop !== before ? (v < 0 ? 'up' : 'down') : null);
      setMore(`${box.scrollTop > 0 ? 'more-up' : ''} ${box.scrollTop + box.clientHeight < box.scrollHeight - 1 ? 'more-down' : ''}`);

      // Rows span the width, so only the height matters.
      let p: Pointing = y > r.bottom ? 'cancel' : 'none';
      if (y >= r.top && y <= r.bottom) {
        for (const row of listRef.current?.children ?? []) {
          const b = row.getBoundingClientRect();
          if (y >= b.top && y < b.bottom) {
            p = (row as HTMLElement).dataset.id!;
            break;
          }
        }
      }
      if (p !== pointing) {
        pointing = p;
        setAim(p);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const twoFinger = useSecondFinger((_, dy) => {
    if (boxRef.current) boxRef.current.scrollTop -= dy;
  });

  const choices = task ? choicesFor(k, task) : [];
  const s = stage.value;
  const shownId = s === 'open' ? aim : landed.value;
  const shown = choices.find((c) => c.id === shownId);
  const live = !!shown && !shown.noop;
  const tone = k === 'priority' ? (shown?.color ?? PRIORITY_COLOR[task ? uiPriority(task.priority) : 4]) : KIND[k].tone;

  return (
    <div class={`sd dp dp-${k} ${s}`} style={{ '--tone': tone }} role="dialog" aria-label={`Pick a ${KIND[k].noun}`} {...twoFinger}>
      <div class="sd-head">
        <div class="sd-task">
          <Icon name={KIND[k].icon} size={15} />
          <span>{task?.content.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}</span>
        </div>
        <div class={`sd-readout ${live ? 'on' : 'cancel'}`} aria-live="polite">
          {s !== 'open' && live && <Icon name="check" size={22} />}
          <span>{shown ? shown.readout : `Slide onto a ${KIND[k].noun}`}</span>
        </div>
      </div>

      <div class={`sd-body ${more} ${edge ? `scroll-${edge}` : ''}`}>
        <div class="dp-box" ref={boxRef}>
          {choices.length > 0 && (
            <ul class="dp-list" ref={listRef}>
              {choices.map((c) => (
                <li
                  key={c.id}
                  data-id={c.id}
                  class={`dp-row ${c.id === shownId ? 'aimed' : ''} ${c.noop ? 'noop' : ''} ${c.id === landed.value ? 'landed' : ''}`}
                  style={{ '--c': c.color, '--indent': c.indent ?? 0 }}
                >
                  {k === 'labels' && <span class={`tick ${c.on ? 'on' : ''}`}>{c.on && <Icon name="check" size={12} />}</span>}
                  {c.icon ? <Icon name={c.icon} size={k === 'priority' ? 22 : 17} /> : <span class="dot" />}
                  <span class="dp-label">{c.label}</span>
                  {c.on && k !== 'labels' && <span class="pill">current</span>}
                </li>
              ))}
            </ul>
          )}
          {k === 'labels' && task && !choices.length && <p class="dp-empty">No labels yet. Tap Labels to create one.</p>}
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
