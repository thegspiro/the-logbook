/**
 * Linked Events Section
 *
 * Displays events linked to a prospective member applicant and provides
 * controls to link/unlink events via an inline event picker.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Link2, Trash2, CalendarPlus, Search, X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Applicant, ProspectEventLink } from '../types';
import { eventLinkService } from '../services/api';
import { formatDateTime } from '../../../utils/dateFormatting';
import { ApplicantStatus } from '../../../constants/enums';
import { eventService } from '../../../services/eventServices';
import type { EventListItem } from '../../../types/event';

interface LinkedEventsSectionProps {
  applicant: Applicant;
  tz: string;
}

const LinkedEventsSection: React.FC<LinkedEventsSectionProps> = ({ applicant, tz }) => {
  const [linkedEvents, setLinkedEvents] = useState<ProspectEventLink[]>([]);
  const [isLoadingLinkedEvents, setIsLoadingLinkedEvents] = useState(false);
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<EventListItem[]>([]);
  const [isLoadingUpcoming, setIsLoadingUpcoming] = useState(false);
  const [eventSearchQuery, setEventSearchQuery] = useState('');

  useEffect(() => {
    if (!applicant.id) {
      setLinkedEvents([]);
      return;
    }
    setIsLoadingLinkedEvents(true);
    eventLinkService
      .getLinkedEvents(applicant.id)
      .then(setLinkedEvents)
      .catch(() => setLinkedEvents([]))
      .finally(() => setIsLoadingLinkedEvents(false));
  }, [applicant.id]);

  const handleOpenEventPicker = useCallback(async () => {
    setShowEventPicker(true);
    setEventSearchQuery('');
    setIsLoadingUpcoming(true);
    try {
      const now = new Date().toISOString();
      const events = await eventService.getEvents({
        end_after: now,
        include_cancelled: false,
        limit: 50,
      });
      setUpcomingEvents(events);
    } catch {
      setUpcomingEvents([]);
    } finally {
      setIsLoadingUpcoming(false);
    }
  }, []);

  const handleLinkEvent = useCallback(
    async (eventId: string) => {
      try {
        const link = await eventLinkService.linkEvent(applicant.id, eventId);
        setLinkedEvents((prev) => [link, ...prev]);
        setShowEventPicker(false);
        toast.success('Event linked');
      } catch {
        toast.error('Failed to link event');
      }
    },
    [applicant.id]
  );

  const handleUnlinkEvent = useCallback(
    async (linkId: string) => {
      try {
        await eventLinkService.unlinkEvent(applicant.id, linkId);
        setLinkedEvents((prev) => prev.filter((l) => l.id !== linkId));
        toast.success('Event unlinked');
      } catch {
        toast.error('Failed to unlink event');
      }
    },
    [applicant.id]
  );

  return (
    <div className="border-theme-surface-border border-b p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-theme-text-muted flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase">
          <Link2 className="h-3.5 w-3.5" />
          Linked Events
        </h3>
        {applicant.status === ApplicantStatus.ACTIVE && (
          <button
            onClick={() => {
              void handleOpenEventPicker();
            }}
            className="flex items-center gap-1 text-xs text-red-500 transition-colors hover:text-red-800 dark:hover:text-red-400"
          >
            <CalendarPlus className="h-3 w-3" />
            Link Event
          </button>
        )}
      </div>

      {/* Event picker dropdown */}
      {showEventPicker && (
        <div className="bg-theme-surface border-theme-surface-border mb-3 overflow-hidden rounded-lg border shadow-lg">
          <div className="border-theme-surface-border border-b p-2">
            <div className="bg-theme-input-bg border-theme-surface-border flex items-center gap-2 rounded-sm border px-2 py-1.5">
              <Search className="text-theme-text-muted h-3.5 w-3.5" />
              <input
                type="text"
                value={eventSearchQuery}
                onChange={(e) => setEventSearchQuery(e.target.value)}
                aria-label="Search upcoming events..."
                placeholder="Search upcoming events..."
                className="text-theme-text-primary placeholder-theme-text-muted flex-1 bg-transparent text-sm focus:outline-hidden"
                autoFocus
              />
              <button
                onClick={() => setShowEventPicker(false)}
                className="text-theme-text-muted hover:text-theme-text-primary"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {isLoadingUpcoming ? (
              <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
                <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" />
              </div>
            ) : (
              (() => {
                const alreadyLinkedIds = new Set(linkedEvents.map((l) => l.event_id));
                const query = eventSearchQuery.toLowerCase();
                const filtered = upcomingEvents.filter(
                  (ev) =>
                    !alreadyLinkedIds.has(ev.id) &&
                    (ev.title.toLowerCase().includes(query) ||
                      ev.event_type.toLowerCase().includes(query) ||
                      (ev.custom_category ?? '').toLowerCase().includes(query))
                );
                if (filtered.length === 0) {
                  return <p className="text-theme-text-muted py-4 text-center text-xs">No matching upcoming events</p>;
                }
                return filtered.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => {
                      void handleLinkEvent(ev.id);
                    }}
                    className="hover:bg-theme-surface-hover flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
                  >
                    <Calendar className="text-theme-text-muted h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-theme-text-primary truncate text-sm">{ev.title}</p>
                      <p className="text-theme-text-muted text-xs">
                        {formatDateTime(ev.start_datetime, tz)}
                        {ev.custom_category && (
                          <span className="bg-theme-surface-secondary ml-1.5 rounded px-1.5 py-0.5 text-[10px]">
                            {ev.custom_category}
                          </span>
                        )}
                        {!ev.custom_category && (
                          <span className="bg-theme-surface-secondary ml-1.5 rounded px-1.5 py-0.5 text-[10px] capitalize">
                            {ev.event_type.replace(/_/g, ' ')}
                          </span>
                        )}
                      </p>
                    </div>
                  </button>
                ));
              })()
            )}
          </div>
        </div>
      )}

      {/* Linked events list */}
      {isLoadingLinkedEvents ? (
        <div className="flex items-center justify-center py-3" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-4 w-4 animate-spin" />
        </div>
      ) : linkedEvents.length === 0 ? (
        <p className="text-theme-text-muted text-xs">No events linked yet.</p>
      ) : (
        <div className="space-y-2">
          {linkedEvents.map((link) => (
            <div
              key={link.id}
              className={`flex items-center gap-3 rounded-lg border p-2.5 transition-colors ${
                link.is_cancelled
                  ? 'border-red-500/20 bg-red-500/5 opacity-60'
                  : 'border-theme-surface-border bg-theme-surface'
              }`}
            >
              <Calendar className="text-theme-text-muted h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-theme-text-primary truncate text-sm">
                  {link.event_title ?? 'Deleted event'}
                  {link.is_cancelled && <span className="ml-1.5 text-[10px] font-medium text-red-500">CANCELLED</span>}
                </p>
                <p className="text-theme-text-muted text-xs">
                  {link.event_start ? formatDateTime(link.event_start, tz) : 'No date'}
                  {(link.custom_category || link.event_type) && (
                    <span className="bg-theme-surface-secondary ml-1.5 rounded px-1.5 py-0.5 text-[10px] capitalize">
                      {link.custom_category ?? (link.event_type ?? '').replace(/_/g, ' ')}
                    </span>
                  )}
                </p>
              </div>
              {applicant.status === ApplicantStatus.ACTIVE && (
                <button
                  onClick={() => {
                    void handleUnlinkEvent(link.id);
                  }}
                  className="text-theme-text-muted shrink-0 transition-colors hover:text-red-500"
                  title="Unlink event"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LinkedEventsSection;
