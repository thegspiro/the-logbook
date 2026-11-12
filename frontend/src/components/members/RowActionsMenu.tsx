/**
 * A "⋯" menu for a table row's less frequent actions.
 *
 * The panel is portalled to `document.body` and positioned against the
 * viewport. Inside the row it was wrong twice over: the roster's
 * `overflow-x-auto` region clips vertically too, cutting off the last rows'
 * menus, and its `backdrop-blur` makes it the containing block for `fixed`
 * descendants, so a "fixed" panel was laid out against the table and focusing
 * its first item scrolled the page. It closes on Escape, on a click outside
 * it, on scroll or resize (the anchor would move out from under it), and after
 * an item is chosen.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export interface RowAction {
  label: string;
  /** Spoken name when the visible label needs the row's context. */
  ariaLabel?: string;
  onSelect: () => void;
  /** Destructive actions are drawn in red. */
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

interface RowActionsMenuProps {
  /** Accessible name of the trigger, e.g. "More actions for Jordan Avery". */
  label: string;
  actions: RowAction[];
}

const PANEL_WIDTH_PX = 192;
const GAP_PX = 4;

export const RowActionsMenu: React.FC<RowActionsMenuProps> = ({ label, actions }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; openUp: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 0;
    // The phone's bottom tab bar paints over the last 56px of the window
    // (CLAUDE.md pitfall #21), so it does not count as room below.
    const bottomNav =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-nav-height')) || 0;
    const roomBelow = window.innerHeight - bottomNav;
    const openUp = rect.bottom + GAP_PX + panelHeight > roomBelow && rect.top - GAP_PX - panelHeight > 0;
    setPosition({
      top: openUp ? rect.top - GAP_PX - panelHeight : rect.bottom + GAP_PX,
      left: Math.max(GAP_PX, rect.right - PANEL_WIDTH_PX),
      openUp,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
      ?.focus({ preventScroll: true });

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    const onMove = () => close(false);

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onMove);
    // Capture so a scroll inside the table region closes it too.
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close]);

  if (actions.length === 0) return null;

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        className="btn-icon text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-md"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            style={{
              position: 'fixed',
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              width: PANEL_WIDTH_PX,
              visibility: position ? 'visible' : 'hidden',
            }}
            className="popover-panel z-50 py-1 text-left"
          >
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                aria-label={action.ariaLabel}
                disabled={action.disabled}
                onClick={() => {
                  close(true);
                  action.onSelect();
                }}
                className={`touch:min-h-11 hover:bg-theme-surface-secondary w-full px-4 py-2 text-left text-sm font-medium disabled:opacity-50 ${
                  action.tone === 'danger' ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'
                }`}
              >
                {action.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
};
