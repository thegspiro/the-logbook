/**
 * What has happened to a submission, as its author sees it: receipt, then each
 * status change and each response reviewers chose to share.
 *
 * Reviewers appear as "Reviewers", never by name; the backend does not send a
 * name for a step, so there is nothing here to leak.
 */

import React from 'react';
import { SUGGESTION_DISPOSITION_LABELS, SuggestionDisposition } from '../../../constants/enums';
import { useTimezone } from '../../../hooks/useTimezone';
import type { TimelineEntry } from '../types/suggestions';
import { formatSuggestionTime } from '../utils/suggestionTime';

interface SuggestionTimelineProps {
  entries: TimelineEntry[];
}

/** A closed outcome that went nowhere: drawn muted rather than as progress. */
const CLOSED_WITHOUT_ACTION: ReadonlySet<string> = new Set([
  SuggestionDisposition.DECLINED,
  SuggestionDisposition.DUPLICATE,
]);

const DOT_CLASSES: Record<string, string> = {
  new: 'bg-blue-700',
  under_review: 'bg-amber-700',
  accepted: 'bg-green-700',
  implemented: 'bg-green-700',
  declined: 'bg-slate-500',
  duplicate: 'bg-slate-500',
};

function stepLabel(entry: TimelineEntry, index: number, previous: TimelineEntry | undefined): string {
  if (index === 0) return 'Received';
  // A response given without a status change keeps the status it was given
  // under; saying the status again would read as a second change.
  if (previous && previous.disposition === entry.disposition) return 'Reviewers responded';
  return SUGGESTION_DISPOSITION_LABELS[entry.disposition] ?? entry.disposition;
}

const SuggestionTimeline: React.FC<SuggestionTimelineProps> = ({ entries }) => {
  const tz = useTimezone();
  if (entries.length === 0) return null;

  return (
    <section aria-label="Status history" className="space-y-2">
      <h3 className="text-theme-text-secondary text-sm font-medium">Status history</h3>
      <ol className="border-theme-surface-border ml-1.5 space-y-4 border-l-2 pl-5">
        {entries.map((entry, index) => {
          const previous = index > 0 ? entries[index - 1] : undefined;
          const isLatest = index === entries.length - 1;
          const muted = CLOSED_WITHOUT_ACTION.has(entry.disposition);
          return (
            <li key={`${entry.createdAt}-${index}`} className="relative" aria-current={isLatest ? 'step' : undefined}>
              <span
                aria-hidden="true"
                className={`ring-theme-surface absolute top-1 -left-[1.6rem] h-3 w-3 rounded-full ring-2 ${
                  DOT_CLASSES[entry.disposition] ?? 'bg-slate-500'
                }`}
              />
              <p
                className={`text-sm ${isLatest ? 'font-semibold' : 'font-medium'} ${
                  muted ? 'text-theme-text-secondary' : 'text-theme-text-primary'
                }`}
              >
                {stepLabel(entry, index, previous)}
              </p>
              <p className="text-theme-text-muted text-xs">
                {formatSuggestionTime(entry.createdAt, entry.timestampPrecision, tz)}
              </p>
              {entry.publicResponse && (
                <blockquote className="bg-theme-surface-secondary text-theme-text-primary mt-2 rounded-md p-3 text-sm whitespace-pre-wrap">
                  <span className="text-theme-text-muted mb-1 block text-xs font-medium">Reviewers</span>
                  {entry.publicResponse}
                </blockquote>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default SuggestionTimeline;
