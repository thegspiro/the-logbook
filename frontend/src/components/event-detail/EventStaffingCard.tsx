/**
 * Volunteer staffing for an outreach event, on the event page.
 *
 * Owner decision, 2026-11-20: an outreach event an officer created directly
 * can open the same role-based signup sheet a public request opens, starting
 * from a request type's role preset. An event scheduled from a request is
 * staffed from the request; this card shows that sheet and links there to
 * change it. Rendered only when the detail endpoint says the caller may staff
 * the event (`can_staff_event`).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { eventRequestService, eventService } from '../../services/api';
import type {
  EventStaffing,
  EventVolunteerSignup,
  OutreachEventTypeConfig,
  OutreachRole,
  StaffingRoleNeed,
} from '../../types/event';
import OutreachRoleSignup from '../../modules/scheduling/components/OutreachRoleSignup';
import { VolunteerRoleList } from './EventVolunteerSignupCard';
import { asArray } from '../../utils/asArray';
import { getErrorMessage } from '../../utils/errorHandling';
import { initialRoleNeeds } from '../../utils/outreachRoles';
import { requestPagePath } from '../../pages/event-requests/requestInbox';

interface EventStaffingCardProps {
  eventId: string;
  /** The sheet as the organizer sees it as a member, so they can sign themselves up too. */
  volunteerSignup?: EventVolunteerSignup | null | undefined;
  isPast?: boolean;
  /** After the organizer signs themselves up, so the page re-reads the event. */
  onSignedUp?: () => void | Promise<void>;
}

const EventStaffingCard: React.FC<EventStaffingCardProps> = ({
  eventId,
  volunteerSignup,
  isPast = false,
  onSignedUp,
}) => {
  const [staffing, setStaffing] = useState<EventStaffing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [roles, setRoles] = useState<OutreachRole[]>([]);
  const [types, setTypes] = useState<OutreachEventTypeConfig[]>([]);
  const [presetType, setPresetType] = useState('');
  const [needs, setNeeds] = useState<StaffingRoleNeed[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStaffing(await eventService.getStaffing(eventId));
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load volunteer staffing.'));
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    const loadConfig = async () => {
      try {
        const [roleList, settings] = await Promise.all([
          eventRequestService.getOutreachRoles(),
          eventService.getModuleSettings(),
        ]);
        const configured = asArray<OutreachRole>(roleList);
        setRoles(configured);
        setTypes(asArray<OutreachEventTypeConfig>(settings?.outreach_event_types ?? []));
        setNeeds(initialRoleNeeds([], null, configured));
      } catch {
        // Without the vocabulary the form offers nothing to pick; the sheet
        // itself still loads above.
      }
    };
    void loadConfig();
  }, [load]);

  const choosePreset = (value: string) => {
    setPresetType(value);
    setNeeds(initialRoleNeeds(types, value, roles));
  };

  const update = (index: number, patch: Partial<StaffingRoleNeed>) =>
    setNeeds((prev) => prev.map((need, i) => (i === index ? { ...need, ...patch } : need)));

  const addRow = () => {
    const unused = roles.find((r) => !needs.some((need) => need.role === r.value));
    if (unused) setNeeds((prev) => [...prev, { role: unused.value, count: 1 }]);
  };

  const open = async () => {
    setBusy(true);
    try {
      setStaffing(await eventService.openStaffing(eventId, { roles: needs }));
      toast.success('Volunteer signups are open on the schedule.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not open volunteer signups.'));
    } finally {
      setBusy(false);
    }
  };

  const presets = types.filter((t) => (t.default_roles?.length ?? 0) > 0);
  const total = needs.reduce((sum, need) => sum + need.count, 0);

  return (
    <section className="card p-6" aria-labelledby="event-staffing-heading">
      <h2
        id="event-staffing-heading"
        className="text-theme-text-primary mb-1 flex items-center gap-2 text-lg font-semibold"
      >
        <UserPlus className="h-5 w-5" aria-hidden="true" />
        Volunteer staffing
      </h2>
      {loadError && (
        <p className="text-sm text-red-800 dark:text-red-300" role="alert">
          {loadError}
        </p>
      )}
      {staffing?.request_id && (
        <p className="text-theme-text-secondary mb-3 text-sm">
          This event came from a public request, so its volunteers are arranged there.{' '}
          <Link
            to={requestPagePath(staffing.request_id)}
            className="font-medium text-blue-700 underline dark:text-blue-400"
          >
            Open the request
          </Link>
        </p>
      )}
      {staffing?.shift_id ? (
        <div className="space-y-3">
          <p className="text-theme-text-secondary text-sm">
            {staffing.slots_filled} of {staffing.slots_total} signed up. Members sign up here or from Scheduling → Open
            Shifts.
          </p>
          <VolunteerRoleList roles={staffing.roles} />
          {staffing.shift_id && volunteerSignup && !volunteerSignup.signed_up && !isPast && (
            <OutreachRoleSignup
              shiftId={staffing.shift_id}
              roles={staffing.roles}
              onSignedUp={async () => {
                await load();
                await onSignedUp?.();
              }}
            />
          )}
          {staffing.volunteers.length > 0 && (
            <ul className="border-theme-surface-border space-y-1 border-t pt-3 text-sm">
              {staffing.volunteers.map((v) => (
                <li key={v.user_id} className="flex justify-between gap-3">
                  <span className="text-theme-text-primary">{v.member_name}</span>
                  <span className="text-theme-text-muted">{v.outreach_role_label ?? ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        staffing &&
        !staffing.request_id && (
          <div className="space-y-3">
            <p className="text-theme-text-secondary text-sm">
              Say what help you need and members can claim a role from Scheduling → Open Shifts.
            </p>
            {presets.length > 0 && (
              <div>
                <label htmlFor="event-staffing-preset" className="form-label">
                  Start from
                </label>
                <select
                  id="event-staffing-preset"
                  value={presetType}
                  onChange={(e) => choosePreset(e.target.value)}
                  className="form-input"
                >
                  <option value="">No preset</option>
                  {presets.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {needs.map((need, index) => (
              <div key={need.role} className="flex items-center gap-2">
                <select
                  value={need.role}
                  onChange={(e) => update(index, { role: e.target.value })}
                  aria-label={`Role ${index + 1}`}
                  className="form-input min-w-0 flex-1"
                >
                  {roles
                    .filter((r) => r.value === need.role || !needs.some((other) => other.role === r.value))
                    .map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                </select>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={need.count || ''}
                  onChange={(e) =>
                    update(index, {
                      count: e.target.value === '' ? 0 : Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                    })
                  }
                  aria-label={`How many for role ${index + 1}`}
                  className="form-input w-20"
                />
                <button
                  type="button"
                  onClick={() => setNeeds((prev) => prev.filter((_, i) => i !== index))}
                  className="btn-icon text-theme-text-muted hover:text-red-700"
                  aria-label={`Remove role ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
            {roles.length === 0 && (
              <p className="text-theme-text-muted text-sm">
                No outreach roles are configured. Add them in Event settings → Public Requests → Types &amp; roles.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {needs.length < roles.length && (
                <button
                  type="button"
                  onClick={addRow}
                  className="touch-target-phone inline-flex items-center gap-1 text-sm font-medium text-red-700 dark:text-red-400"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add a role
                </button>
              )}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => void open()}
                disabled={busy || needs.length === 0 || total > 50 || needs.some((n) => n.count < 1)}
                className="btn-primary"
              >
                {busy ? 'Opening…' : 'Open signups'}
              </button>
            </div>
            {total > 50 && (
              <p className="text-sm text-red-800 dark:text-red-300">A signup sheet holds at most 50 people.</p>
            )}
          </div>
        )
      )}
    </section>
  );
};

export default EventStaffingCard;
