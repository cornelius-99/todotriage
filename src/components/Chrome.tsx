import type { ComponentChildren } from 'preact';
import { datePresets } from '../lib/dates.ts';
import { QUEUES, reasonsFor, type QueueId } from '../lib/queue.ts';
import { todoistColor, uiPriority } from '../lib/colors.ts';
import { hint } from '../shortcuts.ts';
import {
  complete,
  counts,
  current,
  currentId,
  dateAck,
  dismissToast,
  gone,
  goTo,
  inboxId,
  isDemo,
  kept,
  list,
  load,
  projectById,
  queue,
  refreshing,
  remaining,
  remove,
  reviewKept,
  scheduleDay,
  setPriority,
  setQueue,
  sheet,
  skip,
  stats,
  tasks,
  toasts,
  today,
  tz,
  undo,
  user,
  type Sheet,
} from '../store.ts';
import { Icon, type IconName } from './icons.tsx';

const QUEUE_ICON: Record<QueueId, IconName> = { all: 'sparkles', overdue: 'clock', today: 'sun', inbox: 'inbox' };

export function Header() {
  const c = counts.value;
  return (
    <header class="topbar">
      <div class="brand" aria-hidden="true">
        <span class="logo small">
          <Icon name="check" size={16} />
        </span>
        <span class="brand-name">Triage</span>
        {isDemo.value && <span class="pill demo">demo</span>}
      </div>
      <nav class="tabs" aria-label="Queues">
        {QUEUES.map((q) => (
          <button key={q.id} class={`tab ${queue.value === q.id ? 'on' : ''}`} onClick={() => setQueue(q.id)} aria-pressed={queue.value === q.id}>
            <Icon name={QUEUE_ICON[q.id]} size={15} />
            <span class="tab-label">{q.label}</span>
            <span class={`count ${q.id === 'overdue' && c[q.id] ? 'hot' : ''}`}>{c[q.id]}</span>
          </button>
        ))}
      </nav>
      <div class="top-actions">
        <button class={`icon-btn ${refreshing.value ? 'spin' : ''}`} onClick={() => void load()} title="Refresh (⇧R)" aria-label="Refresh">
          <Icon name="refresh" />
        </button>
        <button class="icon-btn desktop-only" onClick={() => (sheet.value = 'help')} title="Shortcuts (?)" aria-label="Keyboard shortcuts">
          <Icon name="keyboard" />
        </button>
        <button class="icon-btn" onClick={() => (sheet.value = 'more')} title="Menu" aria-label="Menu">
          <Icon name="more" />
        </button>
      </div>
    </header>
  );
}

export function Progress() {
  const s = stats.value;
  const done = s.completed + s.scheduled + s.moved + s.deleted + s.kept;
  const total = done + remaining.value;
  const pct = total ? (done / total) * 100 : 100;
  return (
    <div class="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div class="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function presetFor(id: 'today' | 'tomorrow' | 'weekend' | 'nextweek') {
  const u = user.value;
  return datePresets(today.value, { weekendStart: u?.weekendStartDay, nextWeek: u?.nextWeek }).find((p) => p.id === id)!;
}

function Act({
  icon,
  label,
  k,
  onClick,
  tone,
  disabled,
}: {
  icon: IconName;
  label: string;
  k?: string;
  onClick: () => void;
  tone?: string;
  disabled?: boolean;
}) {
  return (
    <button class={`act ${tone ? `tone-${tone}` : ''}`} onClick={onClick} disabled={disabled} title={k ? `${label} (${k})` : label}>
      <Icon name={icon} size={17} />
      <span class="act-label">{label}</span>
      {k && <kbd>{k}</kbd>}
    </button>
  );
}

const openSheet = (s: Sheet) => () => (sheet.value = s);

/** Desktop action panel: every action visible with its key. */
export function ActionPanel() {
  const task = current.value;
  const off = !task;
  const date = (id: 'today' | 'tomorrow' | 'weekend' | 'nextweek', icon: IconName, label: string) => {
    const p = presetFor(id);
    return <Act icon={icon} label={label} k={hint(id === 'weekend' ? 'This weekend' : label)} disabled={off} onClick={() => scheduleDay(p.day, p.label)} />;
  };
  return (
    <div class="panel">
      <div class="panel-group">
        <Act icon="check" label="Done" k={hint('Done')} tone="done" disabled={off} onClick={() => complete()} />
        <Act icon="skip" label="Skip" k={hint('Skip (keep as is)')} disabled={off} onClick={skip} />
        <Act icon="trash" label="Delete" k={hint('Delete')} tone="danger" disabled={off} onClick={() => remove()} />
        <Act icon="undo" label="Undo" k={hint('Undo')} onClick={() => void undo()} />
        <Act icon="external" label="Open" k={hint('Open in Todoist')} disabled={off} onClick={() => task && window.open(task.url, '_blank', 'noopener')} />
      </div>
      <div class="panel-group">
        {date('today', 'sun', 'Today')}
        {date('tomorrow', 'sunrise', 'Tomorrow')}
        {date('weekend', 'sofa', 'Weekend')}
        {date('nextweek', 'nextWeek', 'Next week')}
        <Act icon="calendar" label="Date…" k={hint('Pick a date…')} disabled={off} onClick={openSheet('schedule')} />
      </div>
      <div class="panel-group">
        <Act icon="move" label="Move…" k={hint('Move to project…')} disabled={off} onClick={openSheet('move')} />
        <Act icon="tag" label="Labels…" k={hint('Labels…')} disabled={off} onClick={openSheet('labels')} />
        <Act icon="pencil" label="Edit" k={hint('Edit title & description')} disabled={off} onClick={openSheet('edit')} />
        <div class="prio-inline" role="group" aria-label="Priority">
          {[1, 2, 3, 4].map((p) => (
            <button
              key={p}
              class={`prio-mini p${p} ${task && uiPriority(task.priority) === p ? 'on' : ''}`}
              disabled={off}
              onClick={() => setPriority(p)}
              title={`Priority ${p} (${p})`}
            >
              <Icon name="flag" size={14} />
              <kbd>{p}</kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Phone action bar: quick dates on top, big thumb targets below. */
export function MobileBar() {
  const task = current.value;
  const off = !task;
  const pill = (id: 'today' | 'tomorrow' | 'weekend' | 'nextweek', label: string) => {
    const p = presetFor(id);
    return (
      <button class="date-pill" disabled={off} onClick={() => scheduleDay(p.day, p.label)}>
        {label}
      </button>
    );
  };
  const big = (icon: IconName, label: string, onClick: () => void, tone?: string) => (
    <button class={`bar-btn ${tone ?? ''}`} disabled={off && tone !== 'menu'} onClick={onClick}>
      <Icon name={icon} size={tone === 'done' ? 26 : 22} />
      <span>{label}</span>
    </button>
  );
  return (
    <div class="mobile-bar">
      <div class="date-pills">
        {pill('today', 'Today')}
        {pill('tomorrow', 'Tomorrow')}
        {pill('weekend', 'Weekend')}
        {pill('nextweek', 'Next week')}
      </div>
      <div class="bar-row">
        {big('skip', 'Skip', skip)}
        {big('move', 'Move', openSheet('move'))}
        {big('check', 'Done', () => complete(), 'done')}
        {big('calendar', 'Date…', openSheet('schedule'))}
        {big('more', 'More', openSheet('more'), 'menu')}
      </div>
    </div>
  );
}

const REASON_TITLE = { overdue: 'Overdue', today: 'Today', inbox: 'Inbox' } as const;

/** Desktop sidebar listing the whole queue. */
export function QueueList() {
  const ids = list.value;
  const map = tasks.value;
  let lastGroup = '';
  const rows: ComponentChildren[] = [];
  for (const id of ids) {
    const t = map.get(id);
    if (!t) continue;
    const group = queue.value === 'all' ? reasonGroup(id) : '';
    if (group && group !== lastGroup) {
      rows.push(
        <li class="ql-head" key={`h-${group}`}>
          {REASON_TITLE[group as keyof typeof REASON_TITLE]}
        </li>,
      );
      lastGroup = group;
    }
    const project = projectById.value.get(t.projectId);
    rows.push(
      <li key={id}>
        <button class={`ql-item ${id === currentId.value ? 'on' : ''} ${kept.value.has(id) ? 'kept' : ''}`} onClick={() => goTo(id)}>
          <span class={`ql-prio p${uiPriority(t.priority)}`} />
          <span class="ql-text">{t.content.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}</span>
          {kept.value.has(id) ? <span class="pill">kept</span> : project && <span class="dot" style={{ background: todoistColor(project.color) }} title={project.name} />}
        </button>
      </li>,
    );
  }
  return (
    <aside class="queue-list" aria-label="Queue">
      <div class="ql-title">
        <span>{QUEUES.find((q) => q.id === queue.value)?.label}</span>
        <span class="muted">{remaining.value} left</span>
      </div>
      <ul>{rows}</ul>
    </aside>
  );
}

function reasonGroup(id: string): string {
  const t = tasks.value.get(id);
  if (!t) return '';
  return reasonsFor(t, 'all', { today: today.value, tz: tz.value, inboxId: inboxId.value, tasks: tasks.value, gone: gone.value, dateAck: dateAck.value })[0] ?? '';
}

export function EmptyState() {
  const s = stats.value;
  const keptCount = list.value.filter((id) => kept.value.has(id)).length;
  const others = QUEUES.filter((q) => q.id !== queue.value && q.id !== 'all' && counts.value[q.id] > 0);
  const total = s.completed + s.scheduled + s.moved + s.deleted;
  const statItems: [IconName, number, string][] = [
    ['check', s.completed, 'completed'],
    ['calendar', s.scheduled, 'scheduled'],
    ['move', s.moved, 'moved'],
    ['trash', s.deleted, 'deleted'],
  ];
  return (
    <div class="empty">
      <div class="empty-badge">
        <Icon name={keptCount ? 'check' : 'sparkles'} size={34} />
      </div>
      <h2>{keptCount ? 'End of the queue' : 'All clear'}</h2>
      <p class="muted">
        {keptCount
          ? `You kept ${keptCount} task${keptCount > 1 ? 's' : ''} as ${keptCount > 1 ? 'they are' : 'it is'}.`
          : total
            ? 'Nothing left to triage here. Nice work.'
            : 'Nothing needs triage in this queue right now.'}
      </p>
      {total > 0 && (
        <ul class="stats">
          {statItems
            .filter(([, n]) => n > 0)
            .map(([icon, n, label]) => (
              <li key={label}>
                <Icon name={icon} size={16} />
                <strong>{n}</strong> {label}
              </li>
            ))}
        </ul>
      )}
      <div class="empty-actions">
        {keptCount > 0 && (
          <button class="btn primary" onClick={reviewKept}>
            Go through kept tasks
          </button>
        )}
        {others.map((q) => (
          <button class="btn" key={q.id} onClick={() => setQueue(q.id)}>
            <Icon name={QUEUE_ICON[q.id]} size={16} /> {q.label} ({counts.value[q.id]})
          </button>
        ))}
        <button class="btn" onClick={() => void load()}>
          <Icon name="refresh" size={16} /> Refresh
        </button>
      </div>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.undo && (
            <button
              class="toast-btn"
              onClick={() => {
                dismissToast(t.id);
                void undo();
              }}
            >
              Undo
            </button>
          )}
          <button class="toast-x" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
