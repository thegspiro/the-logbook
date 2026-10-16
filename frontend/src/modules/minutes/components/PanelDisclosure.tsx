/**
 * A card on the minutes page whose body folds away.
 *
 * Minutes carry a lot beside the sections themselves (motions, closed
 * sessions, election results, action items, attachments, approved versions),
 * and on a phone they pushed the sections far down the page. Each of those
 * panels renders through this, collapsed by default with its count in the
 * heading, so the page opens on the minutes and a panel is one tap away.
 *
 * The body stays mounted while folded (it is hidden, not removed), so a form a
 * user had open or a list that was loaded is not thrown away by a tap on the
 * heading. Header actions show only while the panel is open: they act on the
 * body, which is hidden otherwise.
 */

import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface PanelDisclosureProps {
  /** Becomes the heading's id; the section is named from it. */
  id: string;
  icon?: React.ReactNode;
  title: string;
  /** Shown in brackets after the title when given. */
  count?: number | undefined;
  /** Buttons for the open panel, shown at the right of the heading. */
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  /**
   * Something in the body needs reading now (an integrity check failed). The
   * panel unfolds when this turns true and says so in its heading, so a folded
   * panel cannot hide a warning.
   */
  attention?: boolean;
  children: React.ReactNode;
}

export const PanelDisclosure: React.FC<PanelDisclosureProps> = ({
  id,
  icon,
  title,
  count,
  actions,
  defaultOpen = true,
  attention = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen || attention);
  const [wasAttention, setWasAttention] = useState(attention);
  const bodyId = useId();

  // Unfold in the same render the warning appears in, not a frame later from an
  // effect, so the warning is never painted behind a folded panel.
  if (attention !== wasAttention) {
    setWasAttention(attention);
    if (attention) setOpen(true);
  }

  return (
    <section className="bg-theme-surface mb-6 rounded-lg shadow-sm backdrop-blur-xs" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-2 p-4">
        <h2 id={id} className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="focus-ring-inset text-theme-text-primary touch:min-h-11 flex w-full items-center gap-2 text-left text-lg font-semibold"
          >
            {icon}
            <span>{count === undefined ? title : `${title} (${count})`}</span>
            {attention && (
              <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-400">
                Needs attention
              </span>
            )}
            <ChevronDown
              className={`text-theme-text-muted ml-auto h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        </h2>
        {open && actions}
      </div>
      <div id={bodyId} hidden={!open} className="px-4 pb-4">
        {children}
      </div>
    </section>
  );
};

export default PanelDisclosure;
