/**
 * FoldedCard
 *
 * One line standing in for a card that has nothing in it yet. The event page
 * drew every optional card in full whether or not it was used, so a manager
 * scrolled past an empty upload area, an empty headcount form and a message
 * composer on every event. Folded, each is a title, a word on its state and
 * the button that opens it.
 *
 * The caller decides whether to start folded, from data it already holds. A
 * card with something in it must never start folded: that would hide a record
 * behind a click. Once opened it stays open, so saving the first entry does
 * not snap the card shut around it.
 */

import React, { useEffect, useRef, useState } from 'react';

export interface FoldedCardProps {
  title: string;
  /** The card's state in a few words, e.g. "None yet". */
  summary: string;
  /** What opening it lets the viewer do, e.g. "Attach file". */
  actionLabel: string;
  startFolded: boolean;
  children: React.ReactNode;
}

export const FoldedCard: React.FC<FoldedCardProps> = ({ title, summary, actionLabel, startFolded, children }) => {
  const [folded, setFolded] = useState(startFolded);
  const [justOpened, setJustOpened] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // The button that was pressed is gone once the card opens, which would drop
  // a keyboard or screen-reader user's focus back to the top of the page.
  useEffect(() => {
    if (justOpened) contentRef.current?.focus();
  }, [justOpened]);

  if (!folded) {
    return (
      <div ref={contentRef} tabIndex={-1} className="focus:outline-hidden">
        {children}
      </div>
    );
  }

  return (
    <section aria-label={title} className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="text-sm">
        <span className="text-theme-text-primary font-medium">{title}</span>
        <span className="text-theme-text-muted"> · {summary}</span>
      </p>
      <button
        type="button"
        className="btn-secondary text-sm"
        onClick={() => {
          setFolded(false);
          setJustOpened(true);
        }}
      >
        {actionLabel}
      </button>
    </section>
  );
};
