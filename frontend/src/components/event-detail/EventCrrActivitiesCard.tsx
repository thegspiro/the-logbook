/**
 * CRR activities done at an outreach event: what was installed, checked or
 * taught there, and a way to record more.
 *
 * Shown when the server says the viewer may record them (``can_record_crr``:
 * crr.record or events.manage, on an outreach event that is not cancelled).
 * Members are not listed on an event's activity: the event's attendance
 * credits their time (owner decision, 2026-11-22).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { crrService } from '../../services/crrServices';
import type { CrrActivity, CrrFormOptions } from '../../types/crr';
import { useAuthStore } from '../../stores/authStore';
import { asArray } from '../../utils/asArray';
import { getErrorMessage } from '../../utils/errorHandling';
import CrrActivityDialog from '../../pages/crr/CrrActivityDialog';

interface EventCrrActivitiesCardProps {
  eventId: string;
  eventTitle: string;
  timezone: string;
}

const EventCrrActivitiesCard: React.FC<EventCrrActivitiesCardProps> = ({ eventId, eventTitle, timezone }) => {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const [activities, setActivities] = useState<CrrActivity[]>([]);
  const [options, setOptions] = useState<CrrFormOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await crrService.listActivities({ event_id: eventId, limit: 200 });
      setActivities(asArray(data?.items));
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'CRR activities could not be loaded.'));
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    void crrService
      .getFormOptions()
      .then((data) =>
        setOptions({
          ...data,
          activity_types: asArray(data?.activity_types),
          tags: asArray(data?.tags),
          members: asArray(data?.members),
        })
      )
      .catch(() => setOptions(null));
  }, [load]);

  return (
    <section className="card p-4" aria-labelledby="event-crr-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="event-crr-heading" className="text-theme-text-primary flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4 w-4 text-red-700 dark:text-red-400" aria-hidden="true" />
            CRR activities
          </h2>
          <p className="text-theme-text-muted text-sm">Alarms installed, seats checked or people trained here.</p>
        </div>
        <button
          type="button"
          className="btn-secondary touch:min-h-11 inline-flex items-center gap-1.5 text-sm"
          disabled={!options}
          onClick={() => setOpen(true)}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Record an activity
        </button>
      </div>

      {error ? (
        <p className="text-theme-text-secondary mt-3 text-sm" role="alert">
          {error}
        </p>
      ) : activities.length === 0 ? (
        <p className="text-theme-text-muted mt-3 text-sm">None recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {activities.map((activity) => (
            <li key={activity.id} className="text-sm">
              <span className="text-theme-text-primary font-medium">{activity.activity_type_name}</span>
              {activity.counts.length > 0 && (
                <span className="text-theme-text-secondary">
                  {' '}
                  — {activity.counts.map((c) => `${c.label}: ${c.quantity}`).join(', ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {options && (
        <CrrActivityDialog
          isOpen={open}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void load();
          }}
          options={options}
          timezone={timezone}
          currentUserId={currentUserId}
          eventId={eventId}
          eventTitle={eventTitle}
        />
      )}
    </section>
  );
};

export default EventCrrActivitiesCard;
