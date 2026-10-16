import { useEffect, useRef, useState } from 'preact/hooks';
import type { Task } from '../api/types.ts';
import { todoistColor, uiPriority } from '../lib/colors.ts';
import { ago, dayLabel, describeDue, dueStatus, overdueBy } from '../lib/dates.ts';
import { reasonsFor } from '../lib/queue.ts';
import {
  childrenOf,
  complete,
  dateAck,
  exiting,
  gone,
  inboxId,
  list,
  projectById,
  queue,
  remove,
  sectionById,
  sheet,
  skip,
  tasks,
  today,
  tz,
} from '../store.ts';
import { Icon, type IconName } from './icons.tsx';
import { RichText } from './RichText.tsx';

type SwipeAction = 'done' | 'delete' | 'schedule' | 'move' | 'skip';

const SWIPE: Record<SwipeAction, { label: string; icon: IconName }> = {
  done: { label: 'Done', icon: 'check' },
  delete: { label: 'Delete', icon: 'trash' },
  schedule: { label: 'Schedule', icon: 'calendar' },
  move: { label: 'Move', icon: 'move' },
  skip: { label: 'Skip', icon: 'skip' },
};

// Fractions of the card width.
const SHORT = 0.22;
const LONG = 0.58;

function actionFor(dx: number, dy: number, width: number, axis: 'x' | 'y' | null): SwipeAction | null {
  if (axis === 'y') return dy < -70 ? 'skip' : null;
  if (axis !== 'x') return null;
  const r = dx / width;
  if (r >= LONG) return 'delete';
  if (r >= SHORT) return 'done';
  if (r <= -LONG) return 'move';
  if (r <= -SHORT) return 'schedule';
  return null;
}

export function TaskMeta({ task }: { task: Task }) {
  const project = projectById.value.get(task.projectId);
  const section = task.sectionId ? sectionById.value.get(task.sectionId) : null;
  const kids = childrenOf(task.id).length;
  const status = dueStatus(task.due, today.value, tz.value);
  // The inbox bucket tag already says where it is.
  const showProject = project && project.id !== inboxId.value;
  return (
    <div class="chips">
      {task.due && (
        <span class={`chip due-${status}`}>
          <Icon name={task.due.isRecurring ? 'repeat' : 'calendar'} size={14} />
          {describeDue(task.due, today.value, tz.value)}
          {task.due.isRecurring && <span class="chip-sub">{task.due.string}</span>}
        </span>
      )}
      {task.deadline && (
        <span class="chip deadline">
          <Icon name="target" size={14} />
          {dayLabel(task.deadline.date, today.value)}
        </span>
      )}
      {showProject && (
        <span class="chip">
          <span class="dot" style={{ background: todoistColor(project.color) }} />
          {project.name}
          {section && <span class="chip-sub">/ {section.name}</span>}
        </span>
      )}
      {task.labels.map((l) => (
        <span class="chip label" key={l}>
          <Icon name="tag" size={13} />
          {l}
        </span>
      ))}
      {kids > 0 && (
        <span class="chip">
          <Icon name="subtasks" size={14} />
          {kids} subtask{kids > 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

function Subtasks({ task }: { task: Task }) {
  const kids = childrenOf(task.id)
    .filter((k) => k.parentId === task.id)
    .sort((a, b) => a.childOrder - b.childOrder);
  if (!kids.length) return null;
  const shown = kids.slice(0, 4);
  return (
    <ul class="subtasks">
      {shown.map((k) => (
        <li key={k.id}>
          <span class="sub-dot" />
          <RichText text={k.content} />
        </li>
      ))}
      {kids.length > shown.length && <li class="muted">+{kids.length - shown.length} more</li>}
    </ul>
  );
}

function CardBody({ task, expanded, onExpand }: { task: Task; expanded?: boolean; onExpand?: () => void }) {
  const p = uiPriority(task.priority);
  const reasons = reasonsFor(task, queue.value, {
    today: today.value,
    tz: tz.value,
    inboxId: inboxId.value,
    tasks: tasks.value,
    gone: gone.value,
    dateAck: dateAck.value,
  });
  const pos = list.value.indexOf(task.id);
  const long = task.description.length > 220 || task.description.split('\n').length > 5;
  return (
    <>
      <div class="card-top">
        <span class="buckets">
          {reasons.map((r) => (
            <span class={`bucket bucket-${r}`} key={r}>
              <Icon name={r === 'inbox' ? 'inbox' : r === 'today' ? 'sun' : 'clock'} size={13} />
              {r === 'overdue' && task.due ? overdueBy(task.due, today.value, tz.value) : r === 'today' ? 'Today' : 'Inbox'}
            </span>
          ))}
        </span>
        {pos >= 0 && (
          <span class="pos">
            {pos + 1} / {list.value.length}
          </span>
        )}
      </div>
      <div class="card-title-row">
        <button
          class={`checkbox p${p}`}
          aria-label="Complete task"
          title="Complete (E)"
          onClick={(e) => {
            e.stopPropagation();
            complete(task.id);
          }}
        >
          <Icon name="check" size={14} />
        </button>
        <h2 class="card-title">
          <RichText text={task.content} />
        </h2>
      </div>
      {task.description && (
        <div class={`card-desc ${expanded || !long ? 'open' : ''}`}>
          <RichText text={task.description} multiline />
          {long && onExpand && (
            <button class="linkish" onClick={onExpand}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
      <Subtasks task={task} />
      <TaskMeta task={task} />
      {task.addedAt && <div class="added">Added {ago(task.addedAt.toISOString())}</div>}
    </>
  );
}

export function TaskCard({ task }: { task: Task }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const [drag, setDragState] = useState({ dx: 0, dy: 0, axis: null as 'x' | 'y' | null });
  // Pointer events can arrive faster than re-renders, so the gesture reads from a ref.
  const live = useRef(drag);
  const setDrag = (d: typeof drag) => {
    live.current = d;
    setDragState(d);
  };
  const [flying, setFlying] = useState<SwipeAction | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setDrag({ dx: 0, dy: 0, axis: null });
    setFlying(null);
    setExpanded(false);
  }, [task.id]);

  const width = () => ref.current?.offsetWidth ?? 360;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || sheet.value) return;
    if ((e.target as HTMLElement).closest('button, a, input, textarea')) return;
    start.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };

  const onPointerMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    let axis = live.current.axis;
    if (!axis) {
      if (Math.hypot(dx, dy) < 8) return;
      axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (axis === 'y' && (expanded || dy > 0)) {
        // Let the page scroll instead.
        start.current = null;
        return;
      }
      ref.current?.setPointerCapture(e.pointerId);
    }
    setDrag({ dx: axis === 'x' ? dx : 0, dy: axis === 'y' ? Math.min(0, dy) : 0, axis });
  };

  const finish = (e: PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    start.current = null;
    const dt = Math.max(1, performance.now() - s.t);
    const drag = live.current;
    let action = actionFor(drag.dx, drag.dy, width(), drag.axis);
    // A quick flick counts as a short swipe.
    if (!action && drag.axis === 'x' && Math.abs(drag.dx) > 40 && Math.abs(drag.dx) / dt > 0.6) action = drag.dx > 0 ? 'done' : 'schedule';
    if (!action && drag.axis === 'y' && drag.dy < -30 && -drag.dy / dt > 0.5) action = 'skip';
    if (!action || e.type === 'pointercancel') {
      setDrag({ dx: 0, dy: 0, axis: null });
      return;
    }
    run(action);
  };

  const run = (action: SwipeAction) => {
    if (action === 'schedule' || action === 'move') {
      setDrag({ dx: 0, dy: 0, axis: null });
      sheet.value = action;
      return;
    }
    setFlying(action);
    setTimeout(() => {
      if (action === 'done') complete(task.id);
      else if (action === 'delete') remove(task.id);
      else skip();
      // The card already flew out; no need for the exit ghost.
      exiting.value = null;
    }, 170);
  };

  const preview = flying ?? actionFor(drag.dx, drag.dy, width(), drag.axis);
  const side = drag.dx > 0 ? 'left' : 'right';
  const progress = Math.min(1, Math.abs(drag.axis === 'y' ? drag.dy / 70 : drag.dx / (width() * SHORT)));
  const transform = flying
    ? flying === 'skip'
      ? 'translateY(-120%) scale(.9)'
      : `translateX(${flying === 'done' || flying === 'delete' ? 130 : -130}%) rotate(${flying === 'done' || flying === 'delete' ? 8 : -8}deg)`
    : `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 40}deg)`;

  return (
    <div class="card-wrap">
      {drag.axis === 'x' && drag.dx !== 0 && (
        <div class={`underlay underlay-${preview ?? 'none'} from-${side}`} style={{ opacity: Math.max(0.35, progress) }}>
          <span class="underlay-label">
            <Icon name={SWIPE[preview ?? (drag.dx > 0 ? 'done' : 'schedule')].icon} size={22} />
            {preview ? SWIPE[preview].label : drag.dx > 0 ? 'Done' : 'Schedule'}
          </span>
          {preview && (preview === 'done' || preview === 'schedule') && <span class="underlay-more">keep going: {preview === 'done' ? 'Delete' : 'Move'}</span>}
        </div>
      )}
      {drag.axis === 'y' && drag.dy < 0 && (
        <div class="skip-hint" style={{ opacity: progress }}>
          <Icon name="skip" size={20} /> Skip
        </div>
      )}
      <div
        ref={ref}
        class={`card ${drag.axis ? 'dragging' : ''} ${flying ? 'flying' : ''} ${expanded ? 'expanded' : ''}`}
        style={{ transform }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <CardBody task={task} expanded={expanded} onExpand={() => setExpanded(!expanded)} />
      </div>
    </div>
  );
}

/** A copy of a card that just left the queue, animating out in the direction of the action. */
export function ExitGhost() {
  const ex = exiting.value;
  useEffect(() => {
    if (!ex) return;
    const t = setTimeout(() => {
      if (exiting.value?.key === ex.key) exiting.value = null;
    }, 320);
    return () => clearTimeout(t);
  }, [ex?.key]);
  if (!ex) return null;
  return (
    <div class={`card ghost ghost-${ex.dir}`} key={ex.key} aria-hidden="true">
      <CardBody task={ex.task} />
    </div>
  );
}
