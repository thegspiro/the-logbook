/**
 * Apparatus crew for a scheduled public request.
 *
 * The crew goes on the request's own calendar event, so the visit stays one
 * entry on the calendar: a reschedule moves the crew with it and a
 * cancellation stands it down. Volunteer signups (the section above) are
 * independent — a request can have both, an engine crew and extra educators.
 * The crew itself is managed on the event page's crew card.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { ChevronRight, Truck } from 'lucide-react';
import { apparatusEventService } from '../../services/api';
import type { ApparatusConflict, ApparatusEventTemplate, CrewBoard } from '../../types/apparatusEvent';
import { getErrorMessage } from '../../utils/errorHandling';
import { useAuthStore } from '../../stores/authStore';
import ApparatusConflictNotice from './ApparatusConflictNotice';
import { conflictsFrom } from './apparatusConflicts';

interface RequestApparatusCrewSectionProps {
  requestId: string;
  /** The request's calendar event; absent when it was scheduled without one. */
  eventId: string | undefined;
  onAttached?: (() => void) | undefined;
}

export const RequestApparatusCrewSection: React.FC<RequestApparatusCrewSectionProps> = ({
  requestId,
  eventId,
  onAttached,
}) => {
  const canManage = useAuthStore((s) => s.checkPermission('apparatus_events.manage'));
  const [board, setBoard] = useState<CrewBoard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [templates, setTemplates] = useState<ApparatusEventTemplate[] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [conflicts, setConflicts] = useState<ApparatusConflict[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadBoard = useCallback(async () => {
    if (!eventId) {
      setLoaded(true);
      return;
    }
    try {
      setBoard(await apparatusEventService.getCrewBoard(eventId));
    } catch {
      // 404 is the ordinary answer for a request without a crew yet.
      setBoard(null);
    } finally {
      setLoaded(true);
    }
  }, [eventId]);

  useEffect(() => {
    if (!canManage) return;
    setLoaded(false);
    void loadBoard();
  }, [canManage, loadBoard]);

  useEffect(() => {
    if (!canManage || !eventId || board || !loaded) return;
    void apparatusEventService
      .listTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [canManage, eventId, board, loaded]);

  // The conflicts for the chosen template at this event's time, before
  // anything is attached.
  useEffect(() => {
    setAcknowledged(false);
    if (!eventId || !templateId) {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    apparatusEventService
      .checkAttachConflicts(eventId, templateId)
      .then((found) => {
        if (!cancelled) setConflicts(found);
      })
      .catch(() => {
        if (!cancelled) setConflicts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, templateId]);

  if (!canManage) return null;

  const attach = async () => {
    if (!templateId) return;
    setSaving(true);
    try {
      await apparatusEventService.attachToRequest(requestId, templateId, acknowledged);
      toast.success('Apparatus crew added to the request’s event');
      setTemplateId('');
      await loadBoard();
      onAttached?.();
    } catch (err) {
      const found = conflictsFrom(err);
      if (found) {
        setConflicts(found);
        toast.error('The apparatus is committed elsewhere at that time. Review it below.');
      } else {
        toast.error(getErrorMessage(err, 'Could not add the apparatus crew.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const filled = board ? board.units.reduce((n, u) => n + u.seats.filter((s) => s.user_id).length, 0) : 0;
  const total = board ? board.units.reduce((n, u) => n + u.seats.length, 0) : 0;

  return (
    <section className="space-y-3" aria-labelledby={`crew-${requestId}`}>
      <h3
        id={`crew-${requestId}`}
        className="text-theme-text-muted flex items-center gap-2 text-xs font-semibold tracking-wider uppercase"
      >
        <Truck className="h-4 w-4" aria-hidden="true" />
        Apparatus Crew
      </h3>

      {!eventId ? (
        <p className="text-theme-text-muted text-sm">
          This request was scheduled without a calendar event. Schedule it with one to add an apparatus crew.
        </p>
      ) : !loaded ? (
        <p className="text-theme-text-muted text-sm">Checking for a crew…</p>
      ) : board ? (
        <Link
          to={`/events/${eventId}`}
          className="card hover:bg-theme-surface-hover focus-visible:ring-theme-focus-ring flex items-center gap-3 p-3 focus-visible:ring-2 focus-visible:outline-none"
        >
          <span className="flex flex-wrap gap-1">
            {board.units.map((unit) => (
              <span key={unit.id} className="rounded-md bg-red-800 px-2 py-0.5 font-mono text-xs font-bold text-white">
                {unit.unit_number}
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="text-theme-text-primary block font-semibold">
              {filled} of {total} seats filled
            </span>
            <span className="text-theme-text-muted block text-xs">
              {board.template_name ? `From “${board.template_name}” · ` : ''}Manage the crew on the event page
            </span>
          </span>
          <ChevronRight className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
        </Link>
      ) : (
        <div className="card space-y-3 p-3">
          <p className="text-theme-text-secondary text-sm">
            Bringing an apparatus? Add a crew from a template. It goes on this request’s calendar event, so it moves
            with a reschedule. Volunteer signups above stay as they are.
          </p>
          {templates === null ? (
            <p className="text-theme-text-muted text-sm">Loading templates…</p>
          ) : templates.length === 0 ? (
            <p className="text-theme-text-muted text-sm">
              No apparatus event templates yet. Create one under Community Outreach → Apparatus Events.
            </p>
          ) : (
            <div>
              <label className="form-label" htmlFor={`crew-template-${requestId}`}>
                Template
              </label>
              <select
                id={`crew-template-${requestId}`}
                className="form-input"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">Choose a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.units.map((u) => u.unit_number).join(' + ')} · {t.total_seats} seats
                  </option>
                ))}
              </select>
            </div>
          )}
          <ApparatusConflictNotice
            conflicts={conflicts}
            acknowledged={acknowledged}
            onAcknowledge={setAcknowledged}
            confirmLabel="Add it anyway. I’ve confirmed the apparatus can cover this visit."
          />
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            disabled={!templateId || saving || (conflicts.length > 0 && !acknowledged)}
            onClick={() => void attach()}
          >
            <Truck className="h-4 w-4" aria-hidden="true" />
            {saving ? 'Adding…' : 'Add apparatus crew'}
          </button>
        </div>
      )}
    </section>
  );
};

export default RequestApparatusCrewSection;
