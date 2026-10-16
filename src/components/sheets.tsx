import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Project } from '../api/types.ts';
import { todoistColor, uiPriority } from '../lib/colors.ts';
import { datePresets, dayLabel, describeDue, shortDate } from '../lib/dates.ts';
import { fuzzyFilter } from '../lib/fuzzy.ts';
import { QUEUE_CHORDS, SHORTCUTS } from '../shortcuts.ts';
import {
  current,
  editTask,
  isDemo,
  labels,
  load,
  moveTo,
  openInTodoist,
  projects,
  remove,
  scheduleDay,
  scheduleText,
  sections,
  setLabels,
  setPriority,
  sheet,
  signOut,
  today,
  tz,
  undo,
  user,
} from '../store.ts';
import { Icon, type IconName } from './icons.tsx';
import { hasFinePointer, PickList, Sheet, type PickItem } from './Sheet.tsx';

const close = () => (sheet.value = null);

const PRESET_ICON: Record<string, IconName> = {
  today: 'sun',
  tomorrow: 'sunrise',
  weekend: 'sofa',
  nextweek: 'nextWeek',
  nextmonth: 'nextMonth',
  none: 'calendarX',
};

function ScheduleSheet() {
  const task = current.value;
  const [query, setQuery] = useState('');
  const dateInput = useRef<HTMLInputElement>(null);
  if (!task) return null;
  const u = user.value;
  const presets = datePresets(today.value, { weekendStart: u?.weekendStartDay, nextWeek: u?.nextWeek });
  const pick = (day: string | null, label: string) => {
    close();
    scheduleDay(day, label, task.id);
  };
  const items: PickItem[] = [];
  if (query.trim()) {
    items.push({ id: 'typed', icon: 'calendar', label: <>Schedule “{query.trim()}”</>, aside: 'via Todoist', tone: 'accent', run: () => (close(), scheduleText(query, task.id)) });
  }
  for (const p of fuzzyFilter(presets, query, (p) => p.label)) {
    items.push({
      id: p.id,
      icon: PRESET_ICON[p.id],
      label: p.label,
      aside: p.day ? shortDate(p.day, today.value) : '',
      run: () => pick(p.day, p.label),
    });
  }
  return (
    <Sheet
      title="Schedule"
      subtitle={
        task.due ? (
          <>
            {task.due.isRecurring && <Icon name="repeat" size={13} />} Due {describeDue(task.due, today.value, tz.value).replace(/^(Today|Tomorrow|Yesterday)/, (m) => m.toLowerCase())}
            {task.due.isRecurring && <> · repeats “{task.due.string}”, kept when you pick a day</>}
          </>
        ) : (
          'No date yet'
        )
      }
      onClose={close}
    >
      <PickList
        query={query}
        onQuery={setQuery}
        placeholder="Type a date: fri 3pm, in 2 weeks, every monday…"
        items={items}
        extra={
          <label class="date-row">
            <Icon name="calendar" size={17} />
            <span>Pick on calendar…</span>
            <input
              ref={dateInput}
              type="date"
              min={today.value}
              onClick={() => dateInput.current?.showPicker?.()}
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v) pick(v, dayLabel(v, today.value));
              }}
            />
          </label>
        }
      />
    </Sheet>
  );
}

const parentOf = (p: Project) => ('parentId' in p ? p.parentId : null);

function MoveSheet() {
  const task = current.value;
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const byParent = new Map<string | null, Project[]>();
    for (const p of projects.value) {
      const key = parentOf(p);
      byParent.set(key, [...(byParent.get(key) ?? []), p]);
    }
    const out: { projectId: string; sectionId: string | null; name: string; path: string; color: string; depth: number }[] = [];
    const walk = (parent: string | null, depth: number, trail: string) => {
      const kids = (byParent.get(parent) ?? []).sort((a, b) => {
        // Inbox first, then Todoist's own order.
        const ia = 'inboxProject' in a && a.inboxProject ? -1 : 0;
        const ib = 'inboxProject' in b && b.inboxProject ? -1 : 0;
        return ia - ib || a.childOrder - b.childOrder;
      });
      for (const p of kids) {
        const path = trail ? `${trail} / ${p.name}` : p.name;
        out.push({ projectId: p.id, sectionId: null, name: p.name, path, color: todoistColor(p.color), depth });
        for (const s of sections.value.filter((s) => s.projectId === p.id)) {
          out.push({ projectId: p.id, sectionId: s.id, name: s.name, path: `${path} / ${s.name}`, color: todoistColor(p.color), depth: depth + 1 });
        }
        walk(p.id, depth + 1, path);
      }
    };
    walk(null, 0, '');
    // Projects whose parent we don't know (e.g. archived parent) still need to be reachable.
    const seen = new Set(out.map((r) => r.projectId));
    for (const p of projects.value) if (!seen.has(p.id)) out.push({ projectId: p.id, sectionId: null, name: p.name, path: p.name, color: todoistColor(p.color), depth: 0 });
    return out;
  }, [projects.value, sections.value]);

  if (!task) return null;
  const filtered = fuzzyFilter(rows, query, (r) => r.path);
  const items: PickItem[] = filtered.map((r) => ({
    id: `${r.projectId}:${r.sectionId ?? ''}`,
    label: query ? r.path : r.name,
    color: r.sectionId ? undefined : r.color,
    icon: r.sectionId ? 'subtasks' : undefined,
    indent: query ? 0 : r.depth,
    current: task.projectId === r.projectId && (task.sectionId ?? null) === r.sectionId,
    run: () => {
      close();
      moveTo({ projectId: r.projectId, sectionId: r.sectionId }, task.id);
    },
  }));
  return (
    <Sheet title="Move to…" subtitle={task.content} onClose={close}>
      <PickList query={query} onQuery={setQuery} placeholder="Search projects and sections" items={items} />
    </Sheet>
  );
}

function LabelsSheet() {
  const task = current.value;
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>(task?.labels ?? []);
  if (!task) return null;
  const apply = () => {
    close();
    setLabels(draft, task.id);
  };
  const toggle = (name: string) => {
    setDraft((d) => (d.includes(name) ? d.filter((x) => x !== name) : [...d, name]));
    setQuery('');
  };
  const names = [...new Set([...labels.value.map((l) => l.name), ...draft])];
  const colorOf = (n: string) => todoistColor(labels.value.find((l) => l.name === n)?.color);
  const items: PickItem[] = fuzzyFilter(names, query, (n) => n).map((n) => ({
    id: n,
    label: n,
    checked: draft.includes(n),
    color: colorOf(n),
    run: () => toggle(n),
  }));
  const q = query.trim().replace(/^@/, '').replace(/\s+/g, '_');
  if (q && !names.some((n) => n.toLowerCase() === q.toLowerCase())) {
    items.push({ id: '+new', icon: 'plus', label: <>Create label “{q}”</>, tone: 'accent', run: () => toggle(q) });
  }
  return (
    <Sheet
      title="Labels"
      subtitle={task.content}
      onClose={apply}
      footer={
        <button class="btn primary" onClick={apply}>
          Done{hasFinePointer() && <kbd>⌘↵</kbd>}
        </button>
      }
    >
      <PickList query={query} onQuery={setQuery} placeholder="Filter or create labels" items={items} onSubmitEmpty={apply} />
    </Sheet>
  );
}

function EditSheet() {
  const task = current.value;
  const [content, setContent] = useState(task?.content ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (el && hasFinePointer()) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  if (!task) return null;
  const save = () => {
    close();
    editTask(content.trim(), description, task.id);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (e.target === titleRef.current && !e.shiftKey))) {
      e.preventDefault();
      save();
    }
  };
  return (
    <Sheet
      title="Edit task"
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>
            Cancel
          </button>
          <button class="btn primary" onClick={save} disabled={!content.trim()}>
            Save{hasFinePointer() && <kbd>⌘↵</kbd>}
          </button>
        </>
      }
    >
      <div class="edit-form">
        <textarea
          ref={titleRef}
          class="edit-title"
          rows={2}
          value={content}
          onInput={(e) => setContent((e.target as HTMLTextAreaElement).value)}
          onKeyDown={onKey}
          placeholder="Task name"
          enterkeyhint="done"
        />
        <textarea
          class="edit-desc"
          rows={6}
          value={description}
          onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
          onKeyDown={onKey}
          placeholder="Description"
        />
      </div>
    </Sheet>
  );
}

const PRIORITY_COLORS = ['', 'var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--muted)'];

function PriorityButtons({ onPick }: { onPick?: () => void }) {
  const task = current.value;
  if (!task) return null;
  const now = uiPriority(task.priority);
  return (
    <div class="prio-row">
      {[1, 2, 3, 4].map((p) => (
        <button
          key={p}
          class={`prio-btn ${now === p ? 'on' : ''}`}
          style={{ color: PRIORITY_COLORS[p] }}
          onClick={() => {
            setPriority(p, task.id);
            onPick?.();
          }}
        >
          <Icon name="flag" size={18} />
          <span>P{p}</span>
        </button>
      ))}
    </div>
  );
}

function PrioritySheet() {
  return (
    <Sheet title="Priority" subtitle={current.value?.content} onClose={close}>
      <PriorityButtons onPick={close} />
    </Sheet>
  );
}

function MoreSheet() {
  const task = current.value;
  const row = (icon: IconName, label: string, run: () => void, tone?: 'danger') => (
    <button class={`more-row ${tone ? `tone-${tone}` : ''}`} onClick={run}>
      <Icon name={icon} size={19} />
      <span>{label}</span>
    </button>
  );
  return (
    <Sheet title={task ? 'More actions' : 'Menu'} subtitle={task?.content} onClose={close}>
      {task && (
        <>
          <div class="more-section">Priority</div>
          <PriorityButtons />
          <div class="more-grid">
            {row('tag', 'Labels', () => (sheet.value = 'labels'))}
            {row('pencil', 'Edit', () => (sheet.value = 'edit'))}
            {row('external', 'Open in Todoist', () => (close(), openInTodoist(task.id)))}
            {row('trash', 'Delete', () => (close(), remove(task.id)), 'danger')}
          </div>
        </>
      )}
      <div class="more-grid">
        {row('undo', 'Undo last', () => (close(), void undo()))}
        {row('refresh', 'Refresh', () => (close(), void load()))}
        {row('keyboard', 'Shortcuts & gestures', () => (sheet.value = 'help'))}
        {row('logout', isDemo.value ? 'Leave demo' : 'Sign out', () => signOut())}
      </div>
    </Sheet>
  );
}

function HelpSheet() {
  const groups = ['Triage', 'Dates', 'Organize', 'Navigate'] as const;
  return (
    <Sheet title="Shortcuts & gestures" onClose={close}>
      <div class="help">
        <section class="help-group">
          <h4>Swipe the card (phone)</h4>
          <dl>
            <div><dt><span class="swatch done" />Swipe right</dt><dd>Done</dd></div>
            <div><dt><span class="swatch delete" />Long swipe right</dt><dd>Delete</dd></div>
            <div><dt><span class="swatch schedule" />Swipe left</dt><dd>Schedule…</dd></div>
            <div><dt><span class="swatch move" />Long swipe left</dt><dd>Move to project…</dd></div>
            <div><dt><span class="swatch skip" />Swipe up</dt><dd>Skip</dd></div>
          </dl>
        </section>
        {groups.map((g) => (
          <section class="help-group" key={g}>
            <h4>{g}</h4>
            <dl>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.label}>
                  <dt>{s.label}</dt>
                  <dd>
                    {s.show.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
              {g === 'Navigate' &&
                Object.entries(QUEUE_CHORDS).map(([k, q]) => (
                  <div key={k}>
                    <dt>Go to {q === 'all' ? 'all queues' : q}</dt>
                    <dd>
                      <kbd>G</kbd>
                      <kbd>{k.toUpperCase()}</kbd>
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

export function Sheets() {
  // Key by the task so drafts reset when the focused task changes.
  const key = `${sheet.value}:${current.value?.id ?? ''}`;
  switch (sheet.value) {
    case 'schedule':
      return <ScheduleSheet key={key} />;
    case 'move':
      return <MoveSheet key={key} />;
    case 'labels':
      return <LabelsSheet key={key} />;
    case 'edit':
      return <EditSheet key={key} />;
    case 'priority':
      return <PrioritySheet key={key} />;
    case 'more':
      return <MoreSheet key={key} />;
    case 'help':
      return <HelpSheet key={key} />;
    default:
      return null;
  }
}
