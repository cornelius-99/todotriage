import { datePresets } from './lib/dates.ts';
import { QUEUES, type QueueId } from './lib/queue.ts';
import {
  complete,
  currentId,
  load,
  openInTodoist,
  prev,
  queue,
  remove,
  scheduleDay,
  setPriority,
  setQueue,
  sheet,
  skip,
  today,
  undo,
  user,
  type Sheet,
} from './store.ts';

export interface Shortcut {
  /** `KeyboardEvent.key` values that trigger it. */
  keys: string[];
  /** How the keys are shown in hints and the help sheet. */
  show: string[];
  label: string;
  group: 'Triage' | 'Dates' | 'Organize' | 'Navigate';
  /** Only fires when a task is focused. */
  needsTask?: boolean;
  run: () => void;
}

function preset(id: 'today' | 'tomorrow' | 'weekend' | 'nextweek') {
  const u = user.value;
  const p = datePresets(today.value, { weekendStart: u?.weekendStartDay, nextWeek: u?.nextWeek }).find((x) => x.id === id)!;
  scheduleDay(p.day, p.label);
}

const open = (s: Sheet) => () => (sheet.value = s);

export const SHORTCUTS: Shortcut[] = [
  { keys: ['e', 'd'], show: ['E'], label: 'Done', group: 'Triage', needsTask: true, run: () => complete() },
  { keys: ['j', 'ArrowRight', 'ArrowDown'], show: ['J', '→'], label: 'Skip (keep as is)', group: 'Triage', needsTask: true, run: skip },
  { keys: ['Delete', 'Backspace', '#'], show: ['⌫'], label: 'Delete', group: 'Triage', needsTask: true, run: () => remove() },
  { keys: ['z'], show: ['Z'], label: 'Undo', group: 'Triage', run: () => void undo() },

  { keys: ['t'], show: ['T'], label: 'Today', group: 'Dates', needsTask: true, run: () => preset('today') },
  { keys: ['m'], show: ['M'], label: 'Tomorrow', group: 'Dates', needsTask: true, run: () => preset('tomorrow') },
  { keys: ['w'], show: ['W'], label: 'This weekend', group: 'Dates', needsTask: true, run: () => preset('weekend') },
  { keys: ['n'], show: ['N'], label: 'Next week', group: 'Dates', needsTask: true, run: () => preset('nextweek') },
  { keys: ['s'], show: ['S'], label: 'Pick a date…', group: 'Dates', needsTask: true, run: open('schedule') },

  { keys: ['v', 'p'], show: ['V'], label: 'Move to project…', group: 'Organize', needsTask: true, run: open('move') },
  { keys: ['l'], show: ['L'], label: 'Labels…', group: 'Organize', needsTask: true, run: open('labels') },
  { keys: ['1'], show: ['1'], label: 'Priority 1', group: 'Organize', needsTask: true, run: () => setPriority(1) },
  { keys: ['2'], show: ['2'], label: 'Priority 2', group: 'Organize', needsTask: true, run: () => setPriority(2) },
  { keys: ['3'], show: ['3'], label: 'Priority 3', group: 'Organize', needsTask: true, run: () => setPriority(3) },
  { keys: ['4'], show: ['4'], label: 'Priority 4', group: 'Organize', needsTask: true, run: () => setPriority(4) },
  { keys: ['r', 'Enter'], show: ['R', '↵'], label: 'Edit title & description', group: 'Organize', needsTask: true, run: open('edit') },
  { keys: ['o'], show: ['O'], label: 'Open in Todoist', group: 'Organize', needsTask: true, run: () => openInTodoist() },

  { keys: ['k', 'ArrowLeft', 'ArrowUp'], show: ['K', '←'], label: 'Previous task', group: 'Navigate', run: prev },
  { keys: ['q'], show: ['Q'], label: 'Next queue', group: 'Navigate', run: cycleQueue },
  { keys: ['R'], show: ['⇧R'], label: 'Refresh from Todoist', group: 'Navigate', run: () => void load() },
  { keys: ['?', 'h'], show: ['?'], label: 'All shortcuts', group: 'Navigate', run: open('help') },
];

/** `g` then a letter jumps to a queue, Gmail-style. */
export const QUEUE_CHORDS: Record<string, QueueId> = { a: 'all', o: 'overdue', t: 'today', i: 'inbox' };

function cycleQueue() {
  const i = QUEUES.findIndex((q) => q.id === queue.value);
  setQueue(QUEUES[(i + 1) % QUEUES.length].id);
}

export const hint = (label: string) => SHORTCUTS.find((s) => s.label === label)?.show[0];

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

let chordUntil = 0;

/** Global key handler for the triage screen. Sheets handle their own keys. */
export function handleKey(e: KeyboardEvent) {
  if (e.defaultPrevented || isTyping(e.target) || sheet.value) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    void undo();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (Date.now() < chordUntil) {
    chordUntil = 0;
    const q = QUEUE_CHORDS[e.key.toLowerCase()];
    if (q) {
      e.preventDefault();
      setQueue(q);
      return;
    }
  }
  if (e.key === 'g') {
    chordUntil = Date.now() + 1200;
    return;
  }

  const sc = SHORTCUTS.find((s) => s.keys.includes(e.key));
  if (!sc) return;
  // Buttons keep focus after a click; Enter/Space there should press the button, not trigger a shortcut.
  if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement)?.tagName === 'BUTTON') return;
  if (sc.needsTask && !currentId.value) return;
  e.preventDefault();
  sc.run();
}
