import { useEffect, useRef } from 'preact/hooks';

// The phone bar's drag buttons (Move, Labels, Schedule, Priority) work the same way: tap for the sheet, or press and
// drag up and an overlay opens under the finger, so letting go on a choice applies it in one gesture.

/** The fingertip during a press, written on every pointer move and read once a frame by the open overlay. */
export const finger = { x: 0, y: 0 };

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
