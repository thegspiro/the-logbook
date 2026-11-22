/**
 * An event and what it links to, as anyone allowed to read it sees it. The
 * server sends only the people, apparatus, photos and documents the caller may
 * open, so nothing here filters.
 */
import React from 'react';
import { Link } from 'react-router';
import type { EventMemberView, EventView } from '../types';
import { formatDateSpan } from '../utils/historyFormat';
import { ApparatusLinks } from './ApparatusDetails';
import { DocumentTile } from './DocumentDetails';
import { MediaTile } from './MediaDetails';

export const EventDetails: React.FC<{ item: EventView | EventMemberView }> = ({ item }) => {
  const rows: [string, string | null][] = [
    ['When', formatDateSpan(item)],
    ['Type', item.event_type_name],
    ['Place', item.place],
    ['Station', item.station_name],
    ['Source or donor', item.source_name],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {rows
          .filter(([, value]) => Boolean(value))
          .map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-theme-text-secondary font-medium">{label}</dt>
              <dd className="text-theme-text-primary">{value}</dd>
            </React.Fragment>
          ))}
      </dl>
      {item.description && <p className="text-theme-text-primary text-sm whitespace-pre-line">{item.description}</p>}
      {item.members.length > 0 && (
        <section aria-labelledby="event-people-heading">
          <h2 id="event-people-heading" className="text-theme-text-primary mb-1 text-base font-semibold">
            People
          </h2>
          <ul className="divide-theme-surface-border divide-y text-sm">
            {item.members.map((person) => (
              <li key={person.member_id} className="flex flex-wrap items-center gap-2 py-1.5">
                <Link
                  to={`/history/people/${person.member_id}`}
                  className="touch-target-phone link-underline text-theme-text-primary inline-flex items-center font-medium"
                >
                  {person.display_name}
                </Link>
                {person.role && <span className="text-theme-text-secondary">{person.role}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ApparatusLinks apparatus={item.apparatus} headingId="event-apparatus-heading" />
      {item.media.length > 0 && (
        <section aria-labelledby="event-media-heading">
          <h2 id="event-media-heading" className="text-theme-text-primary mb-2 text-base font-semibold">
            Photos and media
          </h2>
          <ul className="thumb-grid">
            {item.media.map((media) => (
              <li key={media.id}>
                <MediaTile item={media} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {item.documents.length > 0 && (
        <section aria-labelledby="event-documents-heading">
          <h2 id="event-documents-heading" className="text-theme-text-primary mb-2 text-base font-semibold">
            Documents
          </h2>
          <ul className="thumb-grid">
            {item.documents.map((document) => (
              <li key={document.id}>
                <DocumentTile item={document} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
