import { useEffect, useRef } from 'preact/hooks';

// The phone bar's drag buttons (Move, Labels, Schedule, Priority) work the same way: tap for the sheet, or press and
// drag up and an overlay opens under the finger, so letting go on a choice applies it in one gesture.

/** The fingertip during a press, written on every pointer move and read once a frame by the open overlay. */
export const finger = { x: 0, y: 0 };

/** Height of the zones at the top and bottom of an overlay's list that scroll it while the finger is held there. */
const EDGE = 88;

/** An overlay's scroll zone height, kept to a share of a short list so the middle stays pickable. */
export const edgeZone = (height: number) => Math.min(EDGE, height * 0.25);

/** Scroll speed in px per 60 Hz frame, `depth` from 0 at a zone's inner edge to 1 at the outer one. Slow where the
 * finger enters, so rows can still be aimed at, and fast out at the edge. */
export const edgeSpeed = (depth: number) => 1 + 13 * Math.min(1, Math.max(0, depth)) ** 2;

/** Holding a button this long opens its overlay without dragging. */
const HOLD = 320;
/** Moving up this far opens it straight away. */
const LIFT = 10;

// One press at a time across the bar, so two thumbs can't open two overlays.
let holder: number | null = null;

/**
 * Pointer handlers for a drag button. `open` shows the overlay; `release` is called when the finger lets go
 * (`cancelled` if the browser took the pointer away) and should do nothing if the overlay isn't open.
 */
export function usePressDrag({
  disabled,
  idle,
  open,
  release,
  tap,
}: {
  disabled: boolean;
  /** Nothing is showing, so a new press can start. */
  idle: () => boolean;
  open: () => void;
  release: (cancelled: boolean) => void;
  tap: () => void;
}) {
  const press = useRef<{ id: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  // A press that opened the overlay isn't also a tap.
  const dragged = useRef(false);

  useEffect(
    () => () => {
      const p = press.current;
      if (p && holder === p.id) holder = null;
    },
    [],
  );

  const onPointerDown = (e: PointerEvent) => {
    if (disabled || e.button !== 0 || !idle() || holder !== null) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    finger.x = e.clientX;
    finger.y = e.clientY;
    dragged.current = false;
    holder = e.pointerId;
    press.current = { id: e.pointerId, y: e.clientY, timer: setTimeout(open, HOLD) };
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    finger.x = e.clientX;
    finger.y = e.clientY;
    if (p.y - e.clientY > LIFT) open();
  };
  const onPointerUp = (e: PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    clearTimeout(p.timer);
    press.current = null;
    holder = null;
    dragged.current = !idle();
    release(e.type !== 'pointerup');
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onLostPointerCapture: onPointerUp,
    onClick: () => (dragged.current ? (dragged.current = false) : tap()),
    onContextMenu: (e: Event) => e.preventDefault(),
  };
}

/** Momentum after a second-finger flick: how fast it has to be going to coast (px per ms), and how quickly it slows. */
const FLING = 0.3;
const FRICTION = 0.95;

/**
 * Pointer handlers for an open overlay. While the first finger holds the drag, a second finger anywhere on the overlay
 * moves the content directly, like scrolling a normal list, and a flick coasts. `scroll` gets each move in px.
 */
export function useSecondFinger(scroll: (dx: number, dy: number) => void) {
  const other = useRef<{ id: number; x: number; y: number; t: number; v: number } | null>(null);
  const coast = useRef(0);
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;

  useEffect(() => () => cancelAnimationFrame(coast.current), []);

  const end = (e: PointerEvent) => {
    const o = other.current;
    if (!o || o.id !== e.pointerId) return;
    other.current = null;
    let v = performance.now() - o.t < 80 ? o.v : 0;
    if (Math.abs(v) < FLING) return;
    let last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(50, t - last);
      last = t;
      scrollRef.current(0, v * dt);
      v *= FRICTION ** (dt / 16.7);
      if (Math.abs(v) > 0.02) coast.current = requestAnimationFrame(step);
    };
    coast.current = requestAnimationFrame(step);
  };

  return {
    onPointerDown: (e: PointerEvent) => {
      if (other.current) return;
      cancelAnimationFrame(coast.current);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      other.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), v: 0 };
    },
    onPointerMove: (e: PointerEvent) => {
      const o = other.current;
      if (!o || o.id !== e.pointerId) return;
      const now = performance.now();
      const dx = e.clientX - o.x;
      const dy = e.clientY - o.y;
      // Smoothed, so one jittery last move doesn't decide the flick.
      if (now > o.t) o.v = 0.6 * (dy / (now - o.t)) + 0.4 * o.v;
      Object.assign(o, { x: e.clientX, y: e.clientY, t: now });
      scrollRef.current(dx, dy);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  };
}
