/**
 * Timeline entries, oldest first, each linking to the record it was read
 * from. A draft is badged: only the archive's keepers are sent one.
 */
import React from 'react';
import { Link } from 'react-router';
import { Calendar, Landmark, Medal, Truck, UserRound } from 'lucide-react';
import { TIMELINE_KIND_LABELS, type TimelineEntry, type TimelineKind } from '../types';
import { timelineEntryPath, timelineEntryWhen } from '../utils/timeline';
import { PublicationBadge } from './PublicationBadge';

const KIND_ICON: Record<TimelineKind, React.ComponentType<{ className?: string }>> = {
  event: Calendar,
  apparatus_in: Truck,
  apparatus_out: Truck,
  designation: Truck,
  line_of_duty: Medal,
  title: UserRound,
};

interface TimelineListProps {
  entries: TimelineEntry[];
  /** Shown when there are no entries. */
  emptyText: string;
}

export const TimelineList: React.FC<TimelineListProps> = ({ entries, emptyText }) => {
  if (entries.length === 0) return <p className="text-theme-text-secondary text-sm">{emptyText}</p>;
  return (
    <ol className="border-theme-surface-border space-y-3 border-l-2 pl-4">
      {entries.map((entry) => {
        const Icon = KIND_ICON[entry.kind] ?? Landmark;
        return (
          <li key={entry.key} className="relative">
            <span
              className="surface-opaque border-theme-surface-border absolute top-1 -left-[1.6rem] flex h-5 w-5 items-center justify-center rounded-full border"
              aria-hidden="true"
            >
              <Icon className="text-theme-text-secondary h-3 w-3" />
            </span>
            <p className="text-theme-text-secondary text-xs">
              {timelineEntryWhen(entry)}
              <span className="sr-only"> · {TIMELINE_KIND_LABELS[entry.kind]}</span>
              {entry.event_type_name && <> · {entry.event_type_name}</>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={timelineEntryPath(entry)}
                className="touch-target-phone link-underline text-theme-text-primary inline-flex items-center font-medium"
              >
                {entry.label}
              </Link>
              {entry.publication_level === 'draft' && <PublicationBadge level="draft" />}
            </div>
            {entry.detail && <p className="text-theme-text-secondary text-sm">{entry.detail}</p>}
          </li>
        );
      })}
    </ol>
  );
};
