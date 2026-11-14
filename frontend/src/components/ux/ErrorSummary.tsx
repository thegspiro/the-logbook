/**
 * The list of open errors at the top of a long form, each a link to its field.
 *
 * On a long form the first flagged field can be a screen above the button
 * that was pressed (forms review F-4: Add Member's errors sat out of view and
 * focus stayed on the button). A refused submit moves focus here: a screen
 * reader announces the count and the list, and each link moves to its field.
 */
import React, { useEffect, useId, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import type { SummaryItem } from '../../hooks/useFieldErrors';
import { FIELD_ERROR_CLASS } from './FormField';

interface ErrorSummaryProps {
  items: readonly SummaryItem[];
  /** A message that belongs to no single field, e.g. an unmatched 422 entry. */
  formError?: string | null | undefined;
  /**
   * Bump this to move focus to the summary, typically once per refused
   * submit. Focus is not moved on first render or while it is unchanged.
   */
  focusKey?: number;
  title?: string;
}

export const ErrorSummary: React.FC<ErrorSummaryProps> = ({
  items,
  formError,
  focusKey = 0,
  title = 'Fix these before submitting',
}) => {
  const ref = useRef<HTMLDivElement>(null);
  // Generated, so two summaries on one page never share a heading id.
  const titleId = useId();

  useEffect(() => {
    if (focusKey > 0) ref.current?.focus();
  }, [focusKey]);

  if (items.length === 0 && !formError) return null;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby={titleId}
      className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 focus:outline-2 focus:outline-offset-2 focus:outline-red-700"
    >
      <h2 id={titleId} className={`flex items-center gap-2 text-sm font-semibold ${FIELD_ERROR_CLASS}`}>
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {items.length > 0 ? title : 'Something went wrong'}
      </h2>
      {formError && <p className={`mt-2 text-sm ${FIELD_ERROR_CLASS}`}>{formError}</p>}
      {items.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={`underline ${FIELD_ERROR_CLASS}`}
                onClick={(e) => {
                  // The default jump scrolls but leaves focus on the link.
                  e.preventDefault();
                  const target = document.getElementById(item.id);
                  target?.focus();
                  target?.scrollIntoView?.({ block: 'center' });
                }}
              >
                {item.label}: {item.message}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ErrorSummary;
