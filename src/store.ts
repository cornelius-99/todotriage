import { batch, computed, signal } from '@preact/signals';
import { DemoBackend } from './api/demo.ts';
import { loadAuth, revoke, saveAuth, startSignIn, finishSignIn, TokenSource, type Auth } from './auth.ts';
import { isAuthError, TodoistBackend } from './api/todoist.ts';
import type { Backend, Due, Label, MoveTarget, Project, Section, SyncDueDate, Task, User } from './api/types.ts';
import { apiPriority } from './lib/colors.ts';
import { moveDueDate, safeTz, todayIn } from './lib/dates.ts';
import { buildOrder, countPending, isPending, nextAfter, prevBefore, QUEUES, reasonsFor, type QueueContext, type QueueId, type Reason } from './lib/queue.ts';

// ---------------------------------------------------------------------------
// Persistence helpers (storage can throw in private mode / previews)

const QUEUE_KEY = 'todotriage.queue';

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // not persisted; fine
  }
}

// ---------------------------------------------------------------------------
// State

export type Sheet = 'schedule' | 'move' | 'labels' | 'edit' | 'help' | 'more' | 'priority';
export type ExitDir = 'right' | 'left' | 'up' | 'down' | 'fade';
/** What gets stamped on a card as it leaves the queue. */
export interface Stamp {
  kind: 'done' | 'deleted' | 'scheduled' | 'unscheduled' | 'moved' | 'skipped';
  text: string;
}

/** A card that just left the queue, as it looked right before. */
export interface Exit {
  task: Task;
  dir: ExitDir;
  key: number;
  stamp?: Stamp;
  /** Where a swipe let go of it. */
  from?: { x: number; y: number };
  reasons: Reason[];
  pos: number;
  total: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
  undo?: boolean;
}

export interface Stats {
  completed: number;
  scheduled: number;
  moved: number;
  deleted: number;
  kept: number;
}

const emptyStats = (): Stats => ({ completed: 0, scheduled: 0, moved: 0, deleted: 0, kept: 0 });

let backend: Backend | null = null;

export const phase = signal<'setup' | 'loading' | 'ready' | 'error'>('setup');
export const loadError = signal('');
export const isDemo = signal(false);
export const user = signal<User | null>(null);
export const projects = signal<Project[]>([]);
export const sections = signal<Section[]>([]);
export const labels = signal<Label[]>([]);
export const tasks = signal(new Map<string, Task>());
export const gone = signal(new Set<string>());
export const dateAck = signal(new Set<string>());
export const kept = signal(new Set<string>());
const storedQueue = storageGet(QUEUE_KEY) as QueueId | null;
export const queue = signal<QueueId>(QUEUES.some((q) => q.id === storedQueue) ? storedQueue! : 'all');
export const order = signal<string[]>([]);
export const currentId = signal<string | null>(null);
export const sheet = signal<Sheet | null>(null);
export const toasts = signal<Toast[]>([]);
export const stats = signal<Stats>(emptyStats());
export const refreshing = signal(false);
/** Rendered briefly as a "ghost" so the card can be stamped and animate out. */
export const exiting = signal<Exit | null>(null);

const clock = signal(Date.now());
let lastLoadAt = 0;

export const tz = computed(() => safeTz(user.value?.tzInfo?.timezone));
export const today = computed(() => {
  clock.value;
  return todayIn(tz.value);
});
export const inboxId = computed(() => user.value?.inboxProjectId ?? projects.value.find((p) => 'inboxProject' in p && p.inboxProject)?.id ?? '');

const ctx = computed<QueueContext>(() => ({
  today: today.value,
  tz: tz.value,
  inboxId: inboxId.value,
  tasks: tasks.value,
  gone: gone.value,
  dateAck: dateAck.value,
}));

const pending = (id: string) => isPending(id, queue.value, ctx.value);

export const list = computed(() => order.value.filter((id) => isPending(id, queue.value, ctx.value)));
export const remaining = computed(() => list.value.filter((id) => !kept.value.has(id)).length);
export const current = computed(() => (currentId.value ? (tasks.value.get(currentId.value) ?? null) : null));
/** The task that takes over once the current one is dealt with. Kept cards were already seen; prefer the next unseen one. */
const successor = (id: string) => nextAfter(id, order.value, (x) => pending(x) && !kept.value.has(x)) ?? nextAfter(id, order.value, pending);
export const upNext = computed(() => {
  const id = currentId.value && successor(currentId.value);
  return id ? (tasks.value.get(id) ?? null) : null;
});

/** Snapshot a card before it changes, so its exit ghost still shows its buckets and place in the queue. */
function exitOf(task: Task, dir: ExitDir, stamp?: Stamp): Exit {
  const ids = list.value;
  return { task, dir, key: Date.now(), stamp, reasons: reasonsFor(task, queue.value, ctx.value), pos: ids.indexOf(task.id), total: ids.length };
}
export const counts = computed(() => {
  const c = ctx.value;
  return Object.fromEntries(QUEUES.map((q) => [q.id, countPending(q.id, c)])) as Record<QueueId, number>;
});
export const projectById = computed(() => new Map(projects.value.map((p) => [p.id, p])));
export const sectionById = computed(() => new Map(sections.value.map((s) => [s.id, s])));

export function childrenOf(id: string, map = tasks.value): Task[] {
  const out: Task[] = [];
  for (const t of map.values()) {
    if (t.parentId === id && !gone.value.has(t.id)) out.push(t, ...childrenOf(t.id, map));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Toasts

let toastSeq = 0;
export function toast(text: string, opts: { kind?: Toast['kind']; undo?: boolean; ms?: number } = {}) {
  const t: Toast = { id: ++toastSeq, text, kind: opts.kind ?? 'info', undo: opts.undo };
  toasts.value = [...toasts.value.filter((x) => x.kind === 'error').slice(-1), t];
  setTimeout(() => dismissToast(t.id), opts.ms ?? (t.kind === 'error' ? 7000 : 4500));
}
export function dismissToast(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Setup / loading

export const loadingText = signal('Loading your tasks…');
let tokens: TokenSource | null = null;

function useAuth(auth: Auth) {
  tokens = new TokenSource(auth);
  backend = new TodoistBackend(tokens);
  isDemo.value = false;
}

/** Sign in with a personal API token pasted by the user. */
export async function connect(token: string) {
  const auth: Auth = { kind: 'token', accessToken: token.trim() };
  useAuth(auth);
  const ok = await load(true);
  if (ok) saveAuth(auth);
  return ok;
}

/** Sign in with a Todoist account (redirects away to todoist.com). */
export async function signIn() {
  loadError.value = '';
  try {
    await startSignIn();
  } catch (e) {
    loadError.value = errorText(e);
  }
}

export function startDemo() {
  backend = new DemoBackend();
  isDemo.value = true;
  void load(true);
}

export async function boot() {
  try {
    loadingText.value = 'Signing you in…';
    phase.value = 'loading';
    const fresh = await finishSignIn();
    if (fresh) saveAuth(fresh);
  } catch (e) {
    loadError.value = errorText(e);
  }
  loadingText.value = 'Loading your tasks…';
  const auth = loadAuth();
  if (auth) {
    useAuth(auth);
    void load(true);
  } else {
    phase.value = 'setup';
  }
}

export function signOut(message = '') {
  flushDeletes();
  const auth = tokens?.current ?? loadAuth();
  if (auth && !message) revoke(auth);
  saveAuth(null);
  backend = null;
  tokens = null;
  batch(() => {
    resetSession();
    tasks.value = new Map();
    user.value = null;
    isDemo.value = false;
    sheet.value = null;
    loadError.value = message;
    phase.value = 'setup';
  });
}

function sessionEnded() {
  signOut(
    tokens?.current.kind === 'token'
      ? 'Todoist rejected that token. Paste a fresh one from Settings → Integrations → Developer.'
      : 'Your Todoist session ended. Please sign in again.',
  );
}

function resetSession() {
  gone.value = new Set();
  dateAck.value = new Set();
  kept.value = new Set();
  stats.value = emptyStats();
  history.length = 0;
}

/** Fetch everything. Returns false if it failed. */
export async function load(initial = false): Promise<boolean> {
  if (!backend) return false;
  if (initial) phase.value = 'loading';
  refreshing.value = true;
  flushDeletes();
  try {
    const snap = await backend.load();
    lastLoadAt = Date.now();
    clock.value = Date.now();
    const map = new Map<string, Task>();
    for (const t of [...snap.overdue, ...snap.today, ...snap.inbox]) map.set(t.id, t);
    batch(() => {
      if (initial) resetSession();
      user.value = snap.user;
      projects.value = snap.projects.filter((p) => !p.isArchived).sort((a, b) => a.childOrder - b.childOrder);
      sections.value = snap.sections.filter((s) => !s.isArchived).sort((a, b) => a.sectionOrder - b.sectionOrder);
      labels.value = [...snap.labels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      tasks.value = map;
      rebuild();
      phase.value = 'ready';
    });
    return true;
  } catch (e) {
    if (isAuthError(e)) {
      sessionEnded();
      return false;
    }
    if (initial) {
      loadError.value = errorText(e);
      phase.value = loadAuth() ? 'error' : 'setup';
    } else {
      toast(`Refresh failed: ${errorText(e)}`, { kind: 'error' });
    }
    return false;
  } finally {
    refreshing.value = false;
  }
}

/** Recompute the order for the current queue, keeping focus where it was if possible. */
function rebuild() {
  order.value = buildOrder(queue.value, ctx.value);
  const keep = currentId.value && pending(currentId.value) ? currentId.value : null;
  currentId.value = keep ?? firstOpen();
}

function firstOpen() {
  return list.value.find((id) => !kept.value.has(id)) ?? null;
}

export function setQueue(q: QueueId) {
  if (q === queue.value) return;
  storageSet(QUEUE_KEY, q);
  batch(() => {
    queue.value = q;
    order.value = buildOrder(q, ctx.value);
    currentId.value = firstOpen();
    sheet.value = null;
  });
}

// Keep "today" honest and refresh stale data when the app comes back to the foreground.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushDeletes();
      return;
    }
    const dayBefore = today.value;
    clock.value = Date.now();
    if (phase.value === 'ready' && (Date.now() - lastLoadAt > 10 * 60_000 || today.value !== dayBefore)) void load();
  });
  window.addEventListener('pagehide', flushDeletes);
  setInterval(() => (clock.value = Date.now()), 60_000);
}

// ---------------------------------------------------------------------------
// Navigation

export function skip() {
  const id = currentId.value;
  if (!id) return;
  const leaving = exitOf(tasks.value.get(id)!, 'up', { kind: 'skipped', text: 'Skipped' });
  batch(() => {
    if (!kept.value.has(id)) {
      kept.value = new Set(kept.value).add(id);
      stats.value = { ...stats.value, kept: stats.value.kept + 1 };
    }
    exiting.value = leaving;
    currentId.value = nextAfter(id, order.value, pending);
  });
}

export function prev() {
  const id = prevBefore(currentId.value, order.value, pending);
  if (id) currentId.value = id;
}

export function next() {
  const id = nextAfter(currentId.value, order.value, pending);
  if (id) currentId.value = id;
}

export function goTo(id: string) {
  if (pending(id)) currentId.value = id;
}

export function reviewKept() {
  batch(() => {
    kept.value = new Set();
    currentId.value = list.value[0] ?? null;
  });
}

// ---------------------------------------------------------------------------
// Actions

interface UndoEntry {
  label: string;
  id: string;
  before: Task[];
  flags: { gone: boolean; ack: boolean; kept: boolean };
  stat?: keyof Stats;
  revert: () => Promise<unknown>;
}

const history: UndoEntry[] = [];

// Serialize API calls per task so e.g. "priority, then move" land in order.
const chains = new Map<string, Promise<unknown>>();
function chain<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prevCall = chains.get(id) ?? Promise.resolve();
  const p = prevCall.catch(() => {}).then(fn);
  chains.set(id, p);
  void p.finally(() => chains.get(id) === p && chains.delete(id)).catch(() => {});
  return p;
}

function api(): Backend {
  if (!backend) throw new Error('Not connected');
  return backend;
}

function setTasks(updated: Task[]) {
  const map = new Map(tasks.value);
  for (const t of updated) map.set(t.id, t);
  tasks.value = map;
}

function toggleIn(sig: typeof gone, id: string, on: boolean) {
  if (sig.value.has(id) === on) return;
  const s = new Set(sig.value);
  if (on) s.add(id);
  else s.delete(id);
  sig.value = s;
}

interface ActionSpec {
  label: string;
  /** Local change, applied immediately (optimistic). Returns the updated task. */
  apply?: (t: Task) => Task;
  /** Also apply to subtasks (for moves). */
  applyChildren?: (t: Task) => Task;
  gone?: boolean;
  goneChildren?: boolean;
  ack?: boolean;
  stat?: keyof Stats;
  dir?: ExitDir;
  stamp?: Stamp;
  call: (b: Backend) => Promise<unknown>;
  revert: (b: Backend) => Promise<unknown>;
  quiet?: boolean;
}

async function perform(id: string | null | undefined, spec: ActionSpec) {
  if (!id || !backend) return;
  const before = tasks.value.get(id);
  if (!before) return;
  const kids = childrenOf(id);
  const entry: UndoEntry = {
    label: spec.label,
    id,
    before: [before, ...kids],
    flags: { gone: gone.value.has(id), ack: dateAck.value.has(id), kept: kept.value.has(id) },
    stat: spec.stat,
    revert: () => spec.revert(api()),
  };
  const leaving = exitOf(before, spec.dir ?? 'fade', spec.stamp);

  batch(() => {
    const updated: Task[] = [];
    if (spec.apply) updated.push(spec.apply({ ...before }));
    if (spec.applyChildren) updated.push(...kids.map((k) => spec.applyChildren!({ ...k })));
    if (updated.length) setTasks(updated);
    if (spec.gone) {
      toggleIn(gone, id, true);
      if (spec.goneChildren) for (const k of kids) toggleIn(gone, k.id, true);
    }
    if (spec.ack) toggleIn(dateAck, id, true);
    if (spec.stat) stats.value = { ...stats.value, [spec.stat]: stats.value[spec.stat] + 1 };
    if (currentId.value === id && !pending(id)) {
      exiting.value = leaving;
      currentId.value = successor(id);
    }
  });
  history.push(entry);
  if (!spec.quiet) toast(spec.label, { undo: true });

  try {
    await chain(id, () => spec.call(api()));
  } catch (e) {
    const i = history.indexOf(entry);
    if (i !== -1) history.splice(i, 1);
    restore(entry);
    if (isAuthError(e)) {
      sessionEnded();
      return;
    }
    toast(`Couldn't ${spec.label.toLowerCase()}: ${errorText(e)}`, { kind: 'error' });
  }
}

function restore(entry: UndoEntry) {
  batch(() => {
    exiting.value = null;
    setTasks(entry.before);
    toggleIn(gone, entry.id, entry.flags.gone);
    for (const k of entry.before.slice(1)) toggleIn(gone, k.id, false);
    toggleIn(dateAck, entry.id, entry.flags.ack);
    toggleIn(kept, entry.id, entry.flags.kept);
    if (entry.stat) stats.value = { ...stats.value, [entry.stat]: Math.max(0, stats.value[entry.stat] - 1) };
    if (!order.value.includes(entry.id)) order.value = buildOrder(queue.value, ctx.value);
    if (pending(entry.id)) currentId.value = entry.id;
  });
}

export async function undo() {
  const entry = history.pop();
  if (!entry) {
    toast('Nothing to undo');
    return;
  }
  restore(entry);
  toast(`Undone: ${entry.label}`);
  try {
    await chain(entry.id, entry.revert);
  } catch (e) {
    toast(`Undo failed: ${errorText(e)}. Refreshing…`, { kind: 'error' });
    void load();
  }
}

/** The due fields the Sync API accepts back, used to restore a date exactly (recurrence included). */
function dueForSync(due: Due | null): SyncDueDate {
  if (!due) return null;
  return {
    date: due.datetime ?? due.date,
    string: due.string,
    isRecurring: due.isRecurring,
    ...(due.timezone ? { timezone: due.timezone } : {}),
    ...(due.lang ? { lang: due.lang } : {}),
  };
}

const short = (t: Task) => (t.content.length > 40 ? `${t.content.slice(0, 38)}…` : t.content);

export function complete(id = currentId.value) {
  const t = id ? tasks.value.get(id) : null;
  if (!t || !id) return;
  const kids = childrenOf(id).filter((k) => !gone.value.has(k.id));
  void perform(id, {
    label: `Completed “${short(t)}”`,
    gone: true,
    goneChildren: true,
    stat: 'completed',
    dir: 'right',
    stamp: { kind: 'done', text: 'Done' },
    call: (b) => b.close(id),
    // Recurring tasks don't close, they roll forward; put the old date back instead.
    revert: async (b) => {
      if (t.due?.isRecurring) return b.setDue(id, dueForSync(t.due));
      await b.reopen(id);
      await Promise.all(kids.map((k) => b.reopen(k.id).catch(() => {})));
    },
  });
}

export function scheduleDay(day: string | null, label?: string, id = currentId.value) {
  const t = id ? tasks.value.get(id) : null;
  if (!t || !id) return;
  const newDue: SyncDueDate =
    day === null
      ? null
      : t.due?.isRecurring
        ? { ...dueForSync(t.due), date: moveDueDate(t.due, day, tz.value) }
        : {
            date: moveDueDate(t.due, day, tz.value),
            ...(t.due?.timezone && t.due.date.includes('T') ? { timezone: t.due.timezone } : {}),
          };
  void perform(id, {
    label: day === null ? `Removed date from “${short(t)}”` : `Scheduled “${short(t)}” for ${label ?? day}`,
    apply: (x) => ({
      ...x,
      due: newDue ? ({ string: label ?? day ?? '', isRecurring: false, ...t.due, ...newDue, datetime: null } as Due) : null,
    }),
    ack: true,
    stat: 'scheduled',
    dir: 'left',
    stamp: day === null ? { kind: 'unscheduled', text: 'No date' } : { kind: 'scheduled', text: label ?? 'Scheduled' },
    call: (b) => b.setDue(id, newDue),
    revert: (b) => b.setDue(id, dueForSync(t.due)),
  });
}

/** Natural-language date, parsed by Todoist ("next fri 3pm", "every other monday"). */
export function scheduleText(text: string, id = currentId.value) {
  const t = id ? tasks.value.get(id) : null;
  if (!t || !id || !text.trim()) return;
  void perform(id, {
    label: `Scheduled “${short(t)}”: ${text.trim()}`,
    ack: true,
    stat: 'scheduled',
    dir: 'left',
    stamp: { kind: 'scheduled', text: text.trim() },
    call: async (b) => {
      const updated = await b.update(id, { dueString: text.trim() });
      setTasks([{ ...tasks.value.get(id)!, due: updated.due }]);
    },
    revert: (b) => b.setDue(id, dueForSync(t.due)),
  });
}

export function moveTo(target: { projectId: string; sectionId?: string | null }, id = currentId.value) {
  const t = id ? tasks.value.get(id) : null;
  if (!t || !id) return;
  const { projectId, sectionId = null } = target;
  if (t.projectId === projectId && t.sectionId === sectionId && !t.parentId) return;
  const project = projectById.value.get(projectId);
  const section = sectionId ? sectionById.value.get(sectionId) : null;
  const where = section ? `${project?.name ?? 'project'} / ${section.name}` : (project?.name ?? 'project');
  const to: MoveTarget = sectionId ? { sectionId } : { projectId };
  const back: MoveTarget = t.parentId ? { parentId: t.parentId } : t.sectionId ? { sectionId: t.sectionId } : { projectId: t.projectId };
  void perform(id, {
    label: `Moved “${short(t)}” to ${where}`,
    apply: (x) => ({ ...x, projectId: projectId, sectionId: sectionId, parentId: null }),
    applyChildren: (x) => ({ ...x, projectId: projectId, sectionId: sectionId }),
    stat: 'moved',
    dir: 'down',
    stamp: { kind: 'moved', text: where },
    call: (b) => b.move(id, to),
    revert: (b) => b.move(id, back),
  });
}

export function setPriority(ui: number, id = currentId.value) {
  const t = id ? tasks.value.get(id) : null;
  if (!t || !id) return;
  const p = apiPriority(ui);
  if (t.priority === p) return;
  void perform(id, {
    label: `Priority P${ui}`,
    apply: (x) => ({ ...x, priority: p }),
    call: (b) => b.update(id, { priority: p }),
    revert: (b) => b.update(id, { priority: t.priority }),
    quiet: true,
  });
}

export function setLabels(next: string[], id = currentId.value) {
  const t = id ? tasks.value.get(id) : null;
  if (!t || !id) return;
  if (next.length === t.labels.length && next.every((l) => t.labels.includes(l))) return;
  void perform(id, {
    label: next.length ? `Labels: ${next.join(', ')}` : 'Removed labels',
    apply: (x) => ({ ...x, labels: next }),
    call: (b) => b.update(id, { labels: next }),
    revert: (b) => b.update(id, { labels: t.labels }),
    quiet: true,
  });
  // Labels created on the fly show up in the picker straight away.
  const known = new Set(labels.value.map((l) => l.name));
  const fresh = next.filter((n) => !known.has(n));
  if (fresh.length) {
    labels.value = [...labels.value, ...fresh.map((name, i) => ({ id: `new-${name}`, name, color: 'charcoal', order: 9999 + i, isFavorite: false }))];
  }
}

export function editTask(content: string, description: string, id = currentId.value) {
  const t = id ? tasks.value.get(id) : null;
  if (!t || !id || !content.trim()) return;
  if (t.content === content && t.description === description) return;
  void perform(id, {
    label: 'Saved changes',
    apply: (x) => ({ ...x, content, description }),
    call: (b) => b.update(id, { content, description }),
    revert: (b) => b.update(id, { content: t.content, description: t.description }),
  });
}

// Deletes wait a few seconds before hitting the API so they can be undone.
const DELETE_DELAY = 8000;
const pendingDeletes = new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>();

function flushDeletes() {
  for (const { timer, run } of [...pendingDeletes.values()]) {
    clearTimeout(timer);
    run();
  }
}

export function remove(id = currentId.value) {
  const t = id ? tasks.value.get(id) : null;
  if (!t || !id) return;
  void perform(id, {
    label: `Deleted “${short(t)}”`,
    gone: true,
    goneChildren: true,
    stat: 'deleted',
    dir: 'fade',
    stamp: { kind: 'deleted', text: 'Deleted' },
    // Only schedules the delete, so an undo queued behind it on the task's chain runs right away.
    call: async (b) => {
      const run = () => {
        pendingDeletes.delete(id);
        b.remove(id).catch((e) => {
          toast(`Couldn't delete “${short(t)}”: ${errorText(e)}`, { kind: 'error' });
          void load();
        });
      };
      pendingDeletes.set(id, { timer: setTimeout(run, DELETE_DELAY), run });
    },
    revert: async () => {
      const p = pendingDeletes.get(id);
      if (!p) throw new Error('already deleted in Todoist');
      clearTimeout(p.timer);
      pendingDeletes.delete(id);
    },
  });
}

export function openInTodoist(id = currentId.value) {
  const url = id ? tasks.value.get(id)?.url : null;
  if (url) window.open(url, '_blank', 'noopener');
}
