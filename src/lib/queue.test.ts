import { describe, expect, it } from 'vitest';
import type { Task } from '../api/types.ts';
import { buildOrder, countPending, isPending, nextAfter, prevBefore, reasonsFor, type QueueContext } from './queue.ts';

const task = (id: string, extra: Partial<Task> = {}): Task =>
  ({ id, content: id, projectId: 'p', sectionId: null, parentId: null, labels: [], priority: 1, due: null, childOrder: 0, addedAt: null, ...extra }) as Task;
const due = (date: string) => ({ date, string: date, isRecurring: false });

function ctx(tasks: Task[], extra: Partial<QueueContext> = {}): QueueContext {
  return { today: '2026-10-16', tz: 'UTC', inboxId: 'inbox', tasks: new Map(tasks.map((t) => [t.id, t])), gone: new Set(), dateAck: new Set(), ...extra };
}

describe('queue membership', () => {
  const tasks = [
    task('old', { due: due('2026-10-01') }),
    task('late', { due: due('2026-10-14'), priority: 4 }),
    task('now', { due: due('2026-10-16') }),
    task('later', { due: due('2026-10-20') }),
    task('in1', { projectId: 'inbox', addedAt: new Date('2026-10-10') }),
    task('in0', { projectId: 'inbox', addedAt: new Date('2026-10-01') }),
    task('inLate', { projectId: 'inbox', due: due('2026-10-15') }),
  ];

  it('collects reasons per queue', () => {
    const c = ctx(tasks);
    expect(reasonsFor(tasks[0], 'all', c)).toEqual(['overdue']);
    expect(reasonsFor(tasks[6], 'all', c)).toEqual(['overdue', 'inbox']);
    expect(reasonsFor(tasks[6], 'today', c)).toEqual([]);
    expect(reasonsFor(tasks[3], 'all', c)).toEqual([]);
  });

  it('orders overdue (oldest), then today, then inbox (oldest added)', () => {
    expect(buildOrder('all', ctx(tasks))).toEqual(['old', 'late', 'inLate', 'now', 'in0', 'in1']);
    expect(countPending('inbox', ctx(tasks))).toBe(3);
  });

  it('settles date reasons on an explicit date decision but keeps the inbox reason', () => {
    const c = ctx(tasks, { dateAck: new Set(['inLate', 'now']) });
    expect(reasonsFor(tasks[6], 'all', c)).toEqual(['inbox']);
    expect(isPending('now', 'all', c)).toBe(false);
  });

  it('drops tasks that are gone', () => {
    expect(isPending('old', 'all', ctx(tasks, { gone: new Set(['old']) }))).toBe(false);
  });

  it('hides subtasks while their parent is still queued', () => {
    const fam = [task('parent', { projectId: 'inbox' }), task('kid', { projectId: 'inbox', parentId: 'parent' })];
    expect(isPending('kid', 'inbox', ctx(fam))).toBe(false);
    expect(isPending('kid', 'inbox', ctx(fam, { gone: new Set(['parent']) }))).toBe(true);
  });
});

describe('navigation', () => {
  const order = ['a', 'b', 'c', 'd'];
  const pending = (id: string) => id !== 'c';
  it('steps over settled tasks', () => {
    expect(nextAfter('b', order, pending)).toBe('d');
    expect(nextAfter('d', order, pending)).toBeNull();
    expect(nextAfter(null, order, pending)).toBe('a');
    expect(prevBefore('d', order, pending)).toBe('b');
    expect(prevBefore(null, order, pending)).toBe('d');
  });
});
