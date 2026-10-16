import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from './icons.tsx';

/** True on devices with a real keyboard and mouse; there we autofocus inputs. */
export const hasFinePointer = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Modal panel: a bottom sheet on phones, a centered palette on larger screens. */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="sheet-grip" aria-hidden="true" />
        <header class="sheet-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <div class="sheet-sub">{subtitle}</div>}
          </div>
          <button class="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div class="sheet-body">{children}</div>
        {footer && <footer class="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export interface PickItem {
  id: string;
  label: ComponentChildren;
  /** Right-aligned secondary text. */
  aside?: ComponentChildren;
  sub?: ComponentChildren;
  icon?: IconName;
  color?: string;
  indent?: number;
  kbd?: string;
  checked?: boolean;
  current?: boolean;
  tone?: 'danger' | 'accent';
  run: () => void;
}

/** Search box + keyboard-navigable list. The parent filters `items` from `query`. */
export function PickList({
  query,
  onQuery,
  placeholder,
  items,
  extra,
  onSubmitEmpty,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  items: PickItem[];
  extra?: ComponentChildren;
  onSubmitEmpty?: () => void;
}) {
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (hasFinePointer()) input.current?.focus();
  }, []);
  useEffect(() => setActive(0), [query]);
  useLayoutEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && onSubmitEmpty) onSubmitEmpty();
      else if (items[active]) items[active].run();
      else onSubmitEmpty?.();
    }
  };

  return (
    <div class="picklist">
      <label class="search">
        <Icon name="search" size={16} />
        <input
          ref={input}
          value={query}
          placeholder={placeholder}
          onInput={(e) => onQuery((e.target as HTMLInputElement).value)}
          onKeyDown={onKey}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          enterkeyhint="go"
        />
      </label>
      {extra}
      <ul class="picks" ref={listRef} role="listbox">
        {items.map((it, i) => (
          <li key={it.id} role="option" aria-selected={i === active}>
            <button
              class={`pick ${i === active ? 'active' : ''} ${it.tone ? `tone-${it.tone}` : ''}`}
              style={it.indent ? { paddingLeft: `${12 + it.indent * 18}px` } : undefined}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={it.run}
            >
              {it.checked !== undefined && <span class={`tick ${it.checked ? 'on' : ''}`}>{it.checked && <Icon name="check" size={12} />}</span>}
              {it.icon && <Icon name={it.icon} size={17} />}
              {it.color && <span class="dot" style={{ background: it.color }} />}
              <span class="pick-label">
                {it.label}
                {it.sub && <span class="pick-sub">{it.sub}</span>}
              </span>
              {it.current && <span class="pill">current</span>}
              {it.aside && <span class="pick-aside">{it.aside}</span>}
              {it.kbd && <kbd>{it.kbd}</kbd>}
            </button>
          </li>
        ))}
        {items.length === 0 && <li class="picks-empty">No matches</li>}
      </ul>
    </div>
  );
}
