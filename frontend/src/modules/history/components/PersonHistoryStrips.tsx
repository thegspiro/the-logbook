/**
 * A person's events and own timeline: the events they took part in, their
 * line-of-duty death, and the titles they held with a date entered. The
 * server filters both to what the viewer may read.
 */
import React, { useEffect, useState } from 'react';
import { historyEventService, historyTimelineService } from '../services/api';
import type { EventSummary, TimelineEntry } from '../types';
import { LinkedEventsList } from './LinkedEventsList';
import { TimelineList } from './TimelineList';

export const PersonEventsStrip: React.FC<{ personId: string }> = ({ personId }) => {
  const [events, setEvents] = useState<EventSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    historyEventService
      .relatedTo({ member_id: personId })
      .then((list) => {
        if (!cancelled) setEvents(list);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  if (events.length === 0) return null;
  return (
    <section aria-labelledby="person-events-heading">
      <h2 id="person-events-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
        Events
      </h2>
      <LinkedEventsList events={events} />
    </section>
  );
};

export const PersonTimelineStrip: React.FC<{ personId: string }> = ({ personId }) => {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    historyTimelineService
      .personTimeline(personId)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [personId]);

  if (entries.length === 0) return null;
  return (
    <section aria-labelledby="person-timeline-heading">
      <h2 id="person-timeline-heading" className="text-theme-text-primary mb-2 text-lg font-semibold">
        Timeline
      </h2>
      <TimelineList entries={entries} emptyText="" />
    </section>
  );
};
