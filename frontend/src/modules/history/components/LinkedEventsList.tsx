/** The events a photo, document, person or apparatus belongs to. */
import React from 'react';
import { Link } from 'react-router';
import type { EventSummary } from '../types';
import { formatPartialDate } from '../utils/historyFormat';
import { PublicationBadge } from './PublicationBadge';

export const LinkedEventsList: React.FC<{ events: EventSummary[] }> = ({ events }) => (
  <ul className="divide-theme-surface-border divide-y">
    {events.map((event) => (
      <li key={event.id} className="flex flex-wrap items-center gap-2 py-2">
        <Link
          to={`/history/events/${event.id}`}
          className="touch-target-phone link-underline text-theme-text-primary inline-flex items-center font-medium"
        >
          {event.title}
        </Link>
        <span className="text-theme-text-secondary text-sm">
          {formatPartialDate(event.start_date, event.start_precision, event.start_circa)}
        </span>
        {event.publication_level === 'draft' && <PublicationBadge level="draft" />}
      </li>
    ))}
  </ul>
);
