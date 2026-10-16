import type { Task } from '../api/types.ts';
import { dueDay, dueStatus, dueTime } from './dates.ts';

export type Reason = 'overdue' | 'today' | 'inbox';
export type QueueId = 'all' | Reason;

export const QUEUES: { id: QueueId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'inbox', label: 'Inbox' },
];

export interface QueueContext {
  today: string;
  tz: string;
  inboxId: string;
  tasks: Map<string, Task>;
  /** Tasks completed or deleted this session. */
  gone: Set<string>;
  /** Tasks whose date the user explicitly decided on this session. */
  dateAck: Set<string>;
}

const includes = (queue: QueueId, r: Reason) => queue === 'all' || queue === r;

/**
 * Why a task still needs triage in `queue`. A task leaves the queue once this is empty:
 * date reasons are settled by any explicit date decision, the inbox reason by moving it out.
 */
export function reasonsFor(task: Task, queue: QueueId, ctx: QueueContext): Reason[] {
  if (ctx.gone.has(task.id)) return [];
  const out: Reason[] = [];
  if (!ctx.dateAck.has(task.id)) {
    const s = dueStatus(task.due, ctx.today, ctx.tz);
    if (s === 'overdue' && includes(queue, 'overdue')) out.push('overdue');
    if (s === 'today' && includes(queue, 'today')) out.push('today');
  }
  if (task.projectId === ctx.inboxId && includes(queue, 'inbox')) out.push('inbox');
  return out;
}

export function isPending(id: string, queue: QueueId, ctx: QueueContext, depth = 0): boolean {
  const task = ctx.tasks.get(id);
  if (!task || reasonsFor(task, queue, ctx).length === 0) return false;
  // A subtask rides along with its parent's card while the parent is still in the queue.
  if (task.parentId && depth < 8 && isPending(task.parentId, queue, ctx, depth + 1)) return false;
  return true;
}

const RANK: Record<Reason, number> = { overdue: 0, today: 1, inbox: 2 };

/** Stable triage order: overdue (oldest first), then today (timed first, by priority), then inbox (oldest first). */
export function buildOrder(queue: QueueId, ctx: QueueContext): string[] {
  const rows = [...ctx.tasks.values()]
    .map((task) => ({ task, reasons: reasonsFor(task, queue, ctx) }))
    .filter((r) => r.reasons.length > 0);
  const key = (t: Task) => (t.due ? dueDay(t.due, ctx.tz) : '9999');
  const time = (t: Task) => (t.due ? (dueTime(t.due, ctx.tz) ?? '99:99') : '99:99');
  rows.sort((a, b) => {
    const ra = RANK[a.reasons[0]];
    const rb = RANK[b.reasons[0]];
    if (ra !== rb) return ra - rb;
    const r = a.reasons[0];
    if (r === 'overdue') {
      return key(a.task).localeCompare(key(b.task)) || b.task.priority - a.task.priority || a.task.childOrder - b.task.childOrder;
    }
    if (r === 'today') {
      return time(a.task).localeCompare(time(b.task)) || b.task.priority - a.task.priority || a.task.childOrder - b.task.childOrder;
    }
    return (a.task.addedAt?.getTime() ?? 0) - (b.task.addedAt?.getTime() ?? 0) || a.task.childOrder - b.task.childOrder;
  });
  return rows.map((r) => r.task.id);
}

export function countPending(queue: QueueId, ctx: QueueContext): number {
  let n = 0;
  for (const id of ctx.tasks.keys()) if (isPending(id, queue, ctx)) n++;
  return n;
}

/** The id to focus after `id` stops being current: the next pending one after it in `order`, else null. */
export function nextAfter(id: string | null, order: string[], pending: (id: string) => boolean): string | null {
  const start = id === null ? -1 : order.indexOf(id);
  for (let i = start + 1; i < order.length; i++) if (pending(order[i])) return order[i];
  return null;
}

export function prevBefore(id: string | null, order: string[], pending: (id: string) => boolean): string | null {
  const start = id === null ? order.length : order.indexOf(id);
  for (let i = start - 1; i >= 0; i--) if (pending(order[i])) return order[i];
  return null;
}
