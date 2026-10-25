import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, Printer } from 'lucide-react';
import { formatNumber } from '../../../utils/dateFormatting';
import { buildLabelFilterPath } from '../utils/labelPrintQuery';

/**
 * The items list's standing way into label printing.
 *
 * Before this, the list reached `/inventory/print-labels` only from a
 * selection, from the "items need a label" banner (which "Not now" dismisses
 * and which disappears once everything is labelled), or from the setup guide —
 * so reprinting a worn label meant knowing to tick rows first.
 *
 * A disclosure of links rather than an ARIA menu: every choice is a navigation,
 * and links keep open-in-new-tab and the URL preview. It holds no input, so
 * closing on a click elsewhere loses nothing.
 */

interface LabelPrintMenuProps {
  /**
   * The print page addressed by the list's current filters, or null when they
   * cannot be expressed there (the low-stock filter has no print-page
   * equivalent, and printing without it would label more than the list shows).
   */
  listPath: string | null;
  /** Items the list's filters match. */
  listCount: number;
  /** Active items never confirmed labelled, or null until counted. */
  needsLabelCount: number | null;
}

const optionClass =
  'hover:bg-theme-surface-hover focus:bg-theme-surface-hover touch:min-h-11 flex w-full flex-col items-start rounded-md px-3 py-2 text-left focus:outline-hidden';

/**
 * One choice. Named by its title and described by its hint: as content alone
 * the two inline spans run together, so a screen reader announced "1 itemEvery
 * item matching…".
 */
const Option: React.FC<{ to: string; title: string; hint: string; onChoose: () => void }> = ({
  to,
  title,
  hint,
  onChoose,
}) => {
  const id = useId();
  return (
    <li>
      <Link
        to={to}
        onClick={onChoose}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint`}
        className={optionClass}
      >
        <span id={`${id}-title`} className="text-theme-text-primary text-sm font-semibold">
          {title}
        </span>
        <span id={`${id}-hint`} className="text-theme-text-muted text-xs">
          {hint}
        </span>
      </Link>
    </li>
  );
};

export const LabelPrintMenu: React.FC<LabelPrintMenuProps> = ({ listPath, listCount, needsLabelCount }) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="btn-secondary btn-md inline-flex items-center gap-2"
      >
        <Printer className="h-4 w-4" aria-hidden="true" /> Print Labels
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={panelId}
          className="card absolute top-full left-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] p-1 shadow-lg"
        >
          <ul>
            {listPath && (
              <Option
                to={listPath}
                title={`This list — ${formatNumber(listCount)} ${listCount === 1 ? 'item' : 'items'}`}
                hint="Every item matching the filters above"
                onChoose={close}
              />
            )}
            <Option
              to={buildLabelFilterPath({ label_printed: false })}
              title={`Items that need a label${needsLabelCount !== null ? ` — ${formatNumber(needsLabelCount)}` : ''}`}
              hint="Never labelled, or barcode changed since"
              onChoose={close}
            />
            <Option
              to="/inventory/print-labels"
              title="Choose by category or location…"
              hint="Opens the label page"
              onChoose={close}
            />
          </ul>
        </div>
      )}
    </div>
  );
};

export default LabelPrintMenu;
