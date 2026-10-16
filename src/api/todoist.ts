import { createCommand, TodoistApi, TodoistRequestError } from '@doist/todoist-sdk';
import type { Backend, MoveTarget, Snapshot, SyncDueDate, TaskPatch } from './types.ts';

export function isAuthError(e: unknown) {
  return e instanceof TodoistRequestError && e.isAuthenticationError();
}

type Page<T> = { results: T[]; nextCursor: string | null };

async function all<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<T> = await fetchPage(cursor);
    out.push(...page.results);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

/** Talks to Todoist through the official SDK, straight from the browser (the API allows CORS). */
export class TodoistBackend implements Backend {
  private readonly api: TodoistApi;

  constructor(token: string) {
    this.api = new TodoistApi(token);
  }

  async load(): Promise<Snapshot> {
    const user = await this.api.getUser();
    const limit = 200;
    // Pin the filter language so "overdue"/"today" parse regardless of the account language.
    const filter = (query: string) => all((cursor) => this.api.getTasksByFilter({ query, lang: 'en', cursor, limit }));
    const [projects, sections, labels, inbox, overdue, today] = await Promise.all([
      all((cursor) => this.api.getProjects({ cursor, limit })),
      all((cursor) => this.api.getSections({ cursor, limit })),
      all((cursor) => this.api.getLabels({ cursor, limit })),
      all((cursor) => this.api.getTasks({ projectId: user.inboxProjectId, cursor, limit })),
      filter('overdue'),
      filter('today'),
    ]);
    return { user, projects, sections, labels, inbox, overdue, today };
  }

  async close(id: string) {
    await this.api.closeTask(id);
  }

  async reopen(id: string) {
    await this.api.reopenTask(id);
  }

  async remove(id: string) {
    await this.api.deleteTask(id);
  }

  update(id: string, patch: TaskPatch) {
    return this.api.updateTask(id, patch);
  }

  async move(id: string, to: MoveTarget) {
    await this.api.moveTask(id, to);
  }

  async setDue(id: string, due: SyncDueDate) {
    // REST's dueString replaces the whole due (and its recurrence); the Sync API lets us
    // change just the date while keeping the recurrence string.
    await this.api.sync({ commands: [createCommand('item_update', { id, due })] });
  }
}
