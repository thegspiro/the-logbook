import React from 'react';
import { Mail } from 'lucide-react';
import type { RSVPStatus } from '../../../types/event';
import { RSVPStatus as RSVPStatusEnum } from '../../../constants/enums';
import DateTimeQuarterHour from '../../ux/DateTimeQuarterHour';
import { FormField } from '../../ux/FormField';
import { checkboxClass, inputClass, labelClass, selectClass } from '../eventFormConstants';
import type { EventFormModel } from '../useEventFormModel';

interface RsvpSectionProps {
  model: Pick<EventFormModel, 'formData' | 'update' | 'fieldErrors' | 'rsvpDeadlineRequired' | 'toggleRsvpStatus'>;
}

/** Whether a response is required, capacity, guests and roster visibility. */
export const RsvpSection: React.FC<RsvpSectionProps> = ({ model }) => {
  const { formData, update, fieldErrors, rsvpDeadlineRequired, toggleRsvpStatus } = model;
  return (
    <section className="space-y-4">
      <h2 className="text-theme-text-primary flex items-center space-x-2 text-lg font-bold">
        <Mail className="h-5 w-5 text-red-700" />
        <span>RSVP Settings</span>
      </h2>

      <label className="mobile-touch-target flex items-center justify-start space-x-3">
        <input
          type="checkbox"
          id="requires-rsvp"
          checked={formData.requires_rsvp}
          onChange={(e) => update({ requires_rsvp: e.target.checked })}
          className={checkboxClass}
        />
        <span className="text-theme-text-secondary text-sm">Require RSVP</span>
      </label>

      {/* Only the deadline lives behind "Require RSVP". Capacity, guests,
          the allowed statuses and roster visibility all apply to an event
          that merely *accepts* responses, so hiding them here would leave
          an organizer unable to cap a voluntary event. */}
      {formData.requires_rsvp && (
        <div className="space-y-4 border-l-2 border-red-500/30 pl-4">
          <FormField
            id="rsvp-deadline"
            label="RSVP Deadline"
            required={rsvpDeadlineRequired}
            error={fieldErrors.rsvp_deadline}
          >
            {(field) => (
              <DateTimeQuarterHour
                {...field}
                value={formData.rsvp_deadline || ''}
                onChange={(val) => update({ rsvp_deadline: val })}
                className={inputClass}
              />
            )}
          </FormField>
        </div>
      )}

      <div className="space-y-4 border-l-2 border-red-500/30 pl-4">
        <FormField id="max-attendees" label="Max Attendees" error={fieldErrors.max_attendees}>
          {(field) => (
            <input
              {...field}
              type="number"
              inputMode="numeric"
              min="1"
              value={formData.max_attendees || ''}
              onChange={(e) => update({ max_attendees: e.target.value ? parseInt(e.target.value) : undefined })}
              className={inputClass}
              placeholder="Unlimited"
            />
          )}
        </FormField>

        <label className="mobile-touch-target flex items-center justify-start space-x-3">
          <input
            type="checkbox"
            id="allow-guests"
            checked={formData.allow_guests}
            onChange={(e) => update({ allow_guests: e.target.checked })}
            className={checkboxClass}
          />
          <span className="text-theme-text-secondary text-sm">Allow guests</span>
        </label>

        <fieldset>
          <legend className={labelClass}>RSVP Status Options</legend>
          <div className="flex flex-wrap gap-3">
            {([RSVPStatusEnum.GOING, RSVPStatusEnum.NOT_GOING, RSVPStatusEnum.MAYBE] as RSVPStatus[]).map((status) => (
              <label
                key={status}
                className="mobile-touch-target flex cursor-pointer items-center justify-start gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={formData.allowed_rsvp_statuses?.includes(status) || false}
                  onChange={(e) => toggleRsvpStatus(status, e.target.checked)}
                  className={checkboxClass}
                />
                <span className="text-theme-text-secondary">
                  {status === RSVPStatusEnum.GOING
                    ? 'Going'
                    : status === RSVPStatusEnum.NOT_GOING
                      ? 'Not Going'
                      : 'Maybe'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="attendee-visibility" className={labelClass}>
            Who can see who&apos;s going
          </label>
          <select
            id="attendee-visibility"
            /* '' is the inherit state. It must go back out as an explicit
               null, never an omitted key: the API dumps updates with
               exclude_unset, so omitting it would leave a previous
               override in place behind a success toast. */
            value={formData.attendee_visibility ?? ''}
            onChange={(e) =>
              update({
                attendee_visibility: (e.target.value || null) as 'members' | 'managers' | null,
              })
            }
            className={selectClass}
          >
            <option value="">Use organization default</option>
            <option value="members">Everyone in the department</option>
            <option value="managers">Only event managers</option>
          </select>
          <p className="text-theme-text-muted mt-1 text-xs">
            Members only ever see names of people going — never contact details, notes or accessibility information.
          </p>
        </div>
      </div>
    </section>
  );
};
