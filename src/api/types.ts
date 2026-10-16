import type {
  CurrentUser,
  DueDate,
  Label,
  MoveTaskArgs,
  PersonalProject,
  Section,
  SyncDueDate,
  Task,
  UpdateTaskArgs,
  WorkspaceProject,
} from '@doist/todoist-sdk';

export type { CurrentUser as User, DueDate as Due, Label, Section, SyncDueDate, Task };
export type Project = PersonalProject | WorkspaceProject;
export type MoveTarget = MoveTaskArgs;
export type TaskPatch = Pick<UpdateTaskArgs, 'content' | 'description' | 'priority' | 'labels' | 'dueString' | 'dueLang'>;

/** Everything the triage screen needs, loaded in one go. */
export interface Snapshot {
  user: CurrentUser;
  projects: Project[];
  sections: Section[];
  labels: Label[];
  inbox: Task[];
  overdue: Task[];
  today: Task[];
}

/** The operations the app performs. Implemented by the Todoist SDK wrapper and the demo backend. */
export interface Backend {
  load(): Promise<Snapshot>;
  close(id: string): Promise<void>;
  reopen(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  update(id: string, patch: TaskPatch): Promise<Task>;
  /** Set the due date via the Sync API, which keeps recurrence when `string`/`isRecurring` are passed. `null` clears it. */
  setDue(id: string, due: SyncDueDate): Promise<void>;
  move(id: string, to: MoveTarget): Promise<void>;
}
