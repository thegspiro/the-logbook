/**
 * Linked Events Section
 *
 * Displays events linked to a prospective member applicant and provides
 * controls to link/unlink events via an inline event picker.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Link2,
  Trash2,
  CalendarPlus,
  Search,
  X,
  Loader2,
} from 'lucide-react';
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

  const handleLinkEvent = useCallback(async (eventId: string) => {
    try {
      const link = await eventLinkService.linkEvent(applicant.id, eventId);
      setLinkedEvents((prev) => [link, ...prev]);
      setShowEventPicker(false);
      toast.success('Event linked');
    } catch {
      toast.error('Failed to link event');
    }
  }, [applicant.id]);

  const handleUnlinkEvent = useCallback(async (linkId: string) => {
    try {
      await eventLinkService.unlinkEvent(applicant.id, linkId);
      setLinkedEvents((prev) => prev.filter((l) => l.id !== linkId));
      toast.success('Event unlinked');
    } catch {
      toast.error('Failed to unlink event');
    }
  }, [applicant.id]);

  return (
    <div className="p-4 border-b border-theme-surface-border">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-theme-text-muted uppercase tracking-wider flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5" />
          Linked Events
        </h3>
        {applicant.status === ApplicantStatus.ACTIVE && (
          <button
            onClick={() => { void handleOpenEventPicker(); }}
            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-800 dark:hover:text-red-400 transition-colors"
          >
            <CalendarPlus className="w-3 h-3" />
            Link Event
          </button>
        )}
      </div>

      {/* Event picker dropdown */}
      {showEventPicker && (
        <div className="mb-3 bg-theme-surface border border-theme-surface-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-theme-surface-border">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-theme-input-bg border border-theme-surface-border rounded-sm">
              <Search className="w-3.5 h-3.5 text-theme-text-muted" />
              <input
                type="text"
                value={eventSearchQuery}
                onChange={(e) => setEventSearchQuery(e.target.value)}
                aria-label="Search upcoming events..." placeholder="Search upcoming events..."
                className="flex-1 bg-transparent text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden"
                autoFocus
              />
              <button
                onClick={() => setShowEventPicker(false)}
                className="text-theme-text-muted hover:text-theme-text-primary"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {isLoadingUpcoming ? (
              <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
                <Loader2 className="w-4 h-4 animate-spin text-theme-text-muted" />
              </div>
            ) : (() => {
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
                return (
                  <p className="text-xs text-theme-text-muted text-center py-4">
                    No matching upcoming events
                  </p>
                );
              }
              return filtered.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => { void handleLinkEvent(ev.id); }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-theme-surface-hover text-left transition-colors"
                >
                  <Calendar className="w-4 h-4 text-theme-text-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-theme-text-primary truncate">{ev.title}</p>
                    <p className="text-xs text-theme-text-muted">
                      {formatDateTime(ev.start_datetime, tz)}
                      {ev.custom_category && (
                        <span className="ml-1.5 px-1.5 py-0.5 bg-theme-surface-secondary rounded text-[10px]">
                          {ev.custom_category}
                        </span>
                      )}
                      {!ev.custom_category && (
                        <span className="ml-1.5 px-1.5 py-0.5 bg-theme-surface-secondary rounded text-[10px] capitalize">
                          {ev.event_type.replace(/_/g, ' ')}
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Linked events list */}
      {isLoadingLinkedEvents ? (
        <div className="flex items-center justify-center py-3" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin text-theme-text-muted" />
        </div>
      ) : linkedEvents.length === 0 ? (
        <p className="text-xs text-theme-text-muted">No events linked yet.</p>
      ) : (
        <div className="space-y-2">
          {linkedEvents.map((link) => (
            <div
              key={link.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                link.is_cancelled
                  ? 'border-red-500/20 bg-red-500/5 opacity-60'
                  : 'border-theme-surface-border bg-theme-surface'
              }`}
            >
              <Calendar className="w-4 h-4 text-theme-text-muted shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-theme-text-primary truncate">
                  {link.event_title ?? 'Deleted event'}
                  {link.is_cancelled && (
                    <span className="ml-1.5 text-[10px] text-red-500 font-medium">CANCELLED</span>
                  )}
                </p>
                <p className="text-xs text-theme-text-muted">
                  {link.event_start ? formatDateTime(link.event_start, tz) : 'No date'}
                  {(link.custom_category || link.event_type) && (
                    <span className="ml-1.5 px-1.5 py-0.5 bg-theme-surface-secondary rounded text-[10px] capitalize">
                      {link.custom_category ?? (link.event_type ?? '').replace(/_/g, ' ')}
                    </span>
                  )}
                </p>
              </div>
              {applicant.status === ApplicantStatus.ACTIVE && (
                <button
                  onClick={() => { void handleUnlinkEvent(link.id); }}
                  className="text-theme-text-muted hover:text-red-500 transition-colors shrink-0"
                  title="Unlink event"
                >
                  <Trash2 className="w-3.5 h-3.5" />
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
