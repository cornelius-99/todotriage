import { addDays, safeTz, todayIn } from '../lib/dates.ts';
import type { Backend, Due, Label, MoveTarget, Project, Section, Snapshot, SyncDueDate, Task, TaskPatch, User } from './types.ts';

// In-memory backend so the app can be explored without a Todoist token.

const delay = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));

type Seed = Partial<Task> & Pick<Task, 'id' | 'content' | 'projectId'>;

function makeTask(seed: Seed): Task {
  return {
    description: '',
    userId: 'demo',
    sectionId: null,
    parentId: null,
    addedByUid: 'demo',
    assignedByUid: null,
    responsibleUid: null,
    labels: [],
    deadline: null,
    duration: null,
    checked: false,
    isDeleted: false,
    addedAt: null,
    completedAt: null,
    updatedAt: null,
    due: null,
    priority: 1,
    childOrder: 0,
    dayOrder: 0,
    isCollapsed: false,
    isUncompletable: false,
    url: `https://app.todoist.com/app/task/${seed.id}`,
    ...seed,
  };
}

function makeProject(p: { id: string; name: string; color: string; parentId: string | null; childOrder: number; inboxProject?: boolean }): Project {
  return {
    canAssignTasks: false,
    createdAt: null,
    isArchived: false,
    isDeleted: false,
    isFavorite: false,
    isFrozen: false,
    updatedAt: null,
    viewStyle: 'list',
    defaultOrder: 0,
    description: '',
    isCollapsed: false,
    isShared: false,
    inboxProject: false,
    url: `https://app.todoist.com/app/project/${p.id}`,
    ...p,
  } as Project;
}

function makeSection(id: string, name: string, projectId: string, sectionOrder: number): Section {
  const now = new Date();
  return {
    id,
    name,
    projectId,
    sectionOrder,
    userId: 'demo',
    addedAt: now,
    updatedAt: now,
    archivedAt: null,
    description: null,
    isArchived: false,
    isDeleted: false,
    isCollapsed: false,
    url: `https://app.todoist.com/app/section/${id}`,
  } as Section;
}

export class DemoBackend implements Backend {
  private tasks = new Map<string, Task>();
  private closed = new Set<string>();
  private readonly user: User;
  private readonly projects: Project[];
  private readonly sections: Section[];
  private readonly labels: Label[];

  constructor() {
    const tz = safeTz(null);
    const today = todayIn(tz);
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
    const due = (offset: number, extra: Partial<Due> = {}): Due => ({
      date: addDays(today, offset),
      string: addDays(today, offset),
      isRecurring: false,
      lang: 'en',
      ...extra,
    });

    this.user = {
      id: 'demo',
      fullName: 'Demo User',
      email: 'demo@example.com',
      inboxProjectId: 'inbox',
      lang: 'en',
      startDay: 1,
      nextWeek: 1,
      weekendStartDay: 6,
      tzInfo: { timezone: tz, gmtString: '', hours: 0, minutes: 0, isDst: 0 },
    } as User;
    this.projects = [
      makeProject({ id: 'inbox', name: 'Inbox', color: 'charcoal', parentId: null, childOrder: 0, inboxProject: true }),
      makeProject({ id: 'work', name: 'Work', color: 'blue', parentId: null, childOrder: 1 }),
      makeProject({ id: 'launch', name: 'Q4 Launch', color: 'grape', parentId: 'work', childOrder: 0 }),
      makeProject({ id: 'personal', name: 'Personal', color: 'green', parentId: null, childOrder: 2 }),
      makeProject({ id: 'home', name: 'Home', color: 'orange', parentId: 'personal', childOrder: 0 }),
      makeProject({ id: 'errands', name: 'Errands', color: 'teal', parentId: null, childOrder: 3 }),
      makeProject({ id: 'someday', name: 'Someday / Maybe', color: 'taupe', parentId: null, childOrder: 4 }),
    ];
    this.sections = [
      makeSection('w-meet', 'Meetings', 'work', 0),
      makeSection('w-admin', 'Admin', 'work', 1),
      makeSection('h-repairs', 'Repairs', 'home', 0),
    ];
    this.labels = ['quick', 'waiting', 'deep-work', 'phone', 'computer'].map((name, i) => ({
      id: `l${i}`,
      name,
      order: i,
      color: ['green', 'grey', 'violet', 'sky_blue', 'blue'][i],
      isFavorite: false,
    }));

    const seed: Seed[] = [
      // Overdue
      { id: 't1', content: 'Send invoice to Acme Corp', projectId: 'work', sectionId: 'w-admin', priority: 4, due: due(-3), addedAt: ago(10), labels: ['computer'] },
      { id: 't2', content: 'Water the plants', projectId: 'home', due: due(-1, { isRecurring: true, string: 'every 3 days' }), addedAt: ago(90) },
      { id: 't3', content: 'Book dentist appointment', projectId: 'personal', priority: 2, due: due(-12), addedAt: ago(30), labels: ['phone', 'quick'] },
      {
        id: 't4',
        content: 'Review Q3 metrics deck',
        projectId: 'launch',
        priority: 3,
        due: due(-2, { date: `${addDays(today, -2)}T14:00:00`, string: `${addDays(today, -2)} 14:00` }),
        addedAt: ago(8),
        description: 'Focus on retention numbers and the churn cohort slide. Leave comments directly in the doc.',
      },
      { id: 't5', content: 'Return library books', projectId: 'errands', due: due(-40), addedAt: ago(60) },
      // Today
      { id: 't6', content: 'Daily review', projectId: 'personal', due: due(0, { isRecurring: true, string: 'every weekday' }), addedAt: ago(200), labels: ['quick'] },
      { id: 't7', content: '1:1 prep with Sam', projectId: 'work', sectionId: 'w-meet', priority: 3, due: due(0, { date: `${today}T10:30:00`, string: 'today 10:30' }), addedAt: ago(3) },
      {
        id: 't8',
        content: 'Fix leaking kitchen tap',
        projectId: 'home',
        sectionId: 'h-repairs',
        priority: 2,
        due: due(0),
        addedAt: ago(14),
        description: 'Washer size is probably 1/2". Check the hardware store on the way home.',
      },
      { id: 't9', content: 'Write launch announcement draft', projectId: 'launch', priority: 4, due: due(0), addedAt: ago(5), labels: ['deep-work', 'computer'] },
      // Inbox
      { id: 't10', content: 'Look into that podcast Alex recommended', projectId: 'inbox', addedAt: ago(1) },
      { id: 't11', content: 'Buy birthday present for Mia', projectId: 'inbox', addedAt: ago(4), description: 'Ideas: board game, the book about octopuses, concert tickets' },
      { id: 't12', content: 'Renew passport', projectId: 'inbox', priority: 3, addedAt: ago(9) },
      { id: 't13', content: 'Plan team offsite', projectId: 'inbox', addedAt: ago(2) },
      { id: 't14', content: 'Pick venue options', projectId: 'inbox', parentId: 't13', addedAt: ago(2), childOrder: 1 },
      { id: 't15', content: 'Collect dietary restrictions', projectId: 'inbox', parentId: 't13', addedAt: ago(2), childOrder: 2 },
      { id: 't16', content: 'Cancel unused streaming subscription', projectId: 'inbox', due: due(-1), addedAt: ago(6), labels: ['quick'] },
      { id: 't17', content: 'Try the new ramen place on 5th', projectId: 'inbox', addedAt: ago(21) },
    ];
    for (const s of seed) this.tasks.set(s.id, makeTask(s));
  }

  async load(): Promise<Snapshot> {
    await delay();
    const today = todayIn(this.user.tzInfo.timezone);
    const day = (t: Task) => t.due?.date.slice(0, 10) ?? '';
    const active = [...this.tasks.values()].filter((t) => !this.closed.has(t.id)).map((t) => structuredClone(t));
    return {
      user: this.user,
      projects: this.projects,
      sections: this.sections,
      labels: this.labels,
      inbox: active.filter((t) => t.projectId === 'inbox'),
      overdue: active.filter((t) => t.due && day(t) < today),
      today: active.filter((t) => t.due && day(t) === today),
    };
  }

  private get(id: string) {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task ${id} not found`);
    return t;
  }

  async close(id: string) {
    await delay();
    const t = this.get(id);
    if (t.due?.isRecurring) {
      // Recurring tasks roll forward instead of closing.
      const today = todayIn(this.user.tzInfo.timezone);
      const current = t.due.date.slice(0, 10);
      t.due = { ...t.due, date: addDays(current < today ? today : current, 1) + t.due.date.slice(10) };
    } else {
      this.closed.add(id);
      for (const c of this.tasks.values()) if (c.parentId === id) this.closed.add(c.id);
    }
  }

  async reopen(id: string) {
    await delay();
    this.closed.delete(id);
  }

  async remove(id: string) {
    await delay();
    this.tasks.delete(id);
    for (const t of this.tasks.values()) if (t.parentId === id) this.tasks.delete(t.id);
  }

  async update(id: string, patch: TaskPatch) {
    await delay();
    const t = this.get(id);
    const { dueString, dueLang, ...rest } = patch;
    Object.assign(t, rest);
    if (dueString !== undefined && dueString !== null) {
      // A toy parser; the real thing is Todoist's.
      const today = todayIn(this.user.tzInfo.timezone);
      const s = dueString.trim().toLowerCase();
      if (s === 'no date' || s === '') t.due = null;
      else {
        const m = /^in (\d+) days?$/.exec(s);
        const offset = s === 'today' ? 0 : s === 'tomorrow' ? 1 : m ? Number(m[1]) : 3;
        t.due = { date: addDays(today, offset), string: dueString, isRecurring: s.startsWith('every'), lang: dueLang ?? 'en' };
      }
    }
    return structuredClone(t);
  }

  async setDue(id: string, due: SyncDueDate) {
    await delay();
    const t = this.get(id);
    if (!due) {
      t.due = null;
      return;
    }
    const isRecurring = due.isRecurring ?? false;
    t.due = {
      date: due.date ?? t.due?.date ?? '',
      string: isRecurring ? (due.string ?? t.due?.string ?? '') : (due.string ?? due.date ?? ''),
      isRecurring,
      timezone: due.timezone ?? null,
      lang: due.lang ?? 'en',
    };
  }

  async move(id: string, to: MoveTarget) {
    await delay();
    const t = this.get(id);
    if (to.parentId) {
      const parent = this.get(to.parentId);
      Object.assign(t, { parentId: parent.id, projectId: parent.projectId, sectionId: parent.sectionId });
    } else if (to.sectionId) {
      const section = this.sections.find((s) => s.id === to.sectionId)!;
      Object.assign(t, { parentId: null, projectId: section.projectId, sectionId: section.id });
    } else if (to.projectId) {
      Object.assign(t, { parentId: null, projectId: to.projectId, sectionId: null });
    }
    // Subtasks travel with their parent.
    for (const c of this.tasks.values()) if (c.parentId === id) Object.assign(c, { projectId: t.projectId, sectionId: t.sectionId });
  }
}
