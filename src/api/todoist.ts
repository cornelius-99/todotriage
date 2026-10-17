import { createCommand, TodoistApi, TodoistRequestError } from '@doist/todoist-sdk';
import { AuthError, type TokenSource } from '../auth.ts';
import type { Backend, MoveTarget, Snapshot, SyncDueDate, TaskPatch } from './types.ts';

export function isAuthError(e: unknown) {
  return e instanceof AuthError || (e instanceof TodoistRequestError && e.isAuthenticationError());
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
  private readonly tokens: TokenSource;
  private client: { token: string; api: TodoistApi } | null = null;

  constructor(tokens: TokenSource) {
    this.tokens = tokens;
  }

  private async api(forceRefresh = false): Promise<TodoistApi> {
    const token = await this.tokens.token(forceRefresh);
    if (this.client?.token !== token) this.client = { token, api: new TodoistApi(token) };
    return this.client.api;
  }

  /** Run `fn` with a valid token; if Todoist rejects it anyway, refresh once and retry. */
  private async call<T>(fn: (api: TodoistApi) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.api());
    } catch (e) {
      if (!isAuthError(e) || !this.tokens.canRefresh) throw e;
      return fn(await this.api(true));
    }
  }

  load(): Promise<Snapshot> {
    return this.call(async (api) => {
      const user = await api.getUser();
      const limit = 200;
      // Pin the filter language so "overdue"/"today" parse regardless of the account language.
      const filter = (query: string) => all((cursor) => api.getTasksByFilter({ query, lang: 'en', cursor, limit }));
      const [projects, sections, labels, inbox, overdue, today] = await Promise.all([
        all((cursor) => api.getProjects({ cursor, limit })),
        all((cursor) => api.getSections({ cursor, limit })),
        all((cursor) => api.getLabels({ cursor, limit })),
        all((cursor) => api.getTasks({ projectId: user.inboxProjectId, cursor, limit })),
        filter('overdue'),
        filter('today'),
      ]);
      return { user, projects, sections, labels, inbox, overdue, today };
    });
  }

  upcoming() {
    return this.call((api) => all((cursor) => api.getTasksByFilter({ query: 'next 7 days', lang: 'en', cursor, limit: 200 })));
  }

  async close(id: string) {
    await this.call((api) => api.closeTask(id));
  }

  async reopen(id: string) {
    await this.call((api) => api.reopenTask(id));
  }

  async remove(id: string) {
    await this.call((api) => api.deleteTask(id));
  }

  update(id: string, patch: TaskPatch) {
    return this.call((api) => api.updateTask(id, patch));
  }

  async move(id: string, to: MoveTarget) {
    await this.call((api) => api.moveTask(id, to));
  }

  async setDue(id: string, due: SyncDueDate) {
    // REST's dueString replaces the whole due (and its recurrence); the Sync API lets us
    // change just the date while keeping the recurrence string.
    await this.call((api) => api.sync({ commands: [createCommand('item_update', { id, due })] }));
  }
}
