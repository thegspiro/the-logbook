import React from 'react';
import { Bell } from 'lucide-react';
import { labelClass, selectClass } from '../eventFormConstants';
import type { EventFormModel } from '../useEventFormModel';

interface NotificationsSectionProps {
  model: Pick<EventFormModel, 'formData' | 'update' | 'handleReminderTargetChange'>;
}

/** Who is reminded, and when. */
export const NotificationsSection: React.FC<NotificationsSectionProps> = ({ model }) => {
  const { formData, update, handleReminderTargetChange } = model;
  return (
    <section className="space-y-4">
      <h2 className="text-theme-text-primary flex items-center space-x-2 text-lg font-bold">
        <Bell className="h-5 w-5 text-red-700" />
        <span>Notifications</span>
      </h2>

      <div>
        <label htmlFor="reminder-target" className={labelClass}>
          Who should receive reminders?
        </label>
        <select
          id="reminder-target"
          value={formData.send_reminders ? formData.reminder_target || 'going' : 'none'}
          onChange={(e) => handleReminderTargetChange(e.target.value as 'going' | 'all' | 'none')}
          className={selectClass}
        >
          <option value="going">Members who sign up</option>
          <option value="all">All active members</option>
          <option value="none">No reminders</option>
        </select>
        <p className="text-theme-text-muted mt-1 text-xs">
          In-app reminders go to this group; email also follows each member's notification preferences.
        </p>
      </div>

      {formData.send_reminders && (
        <div className="space-y-3 border-l-2 border-red-500/30 pl-4">
          <label className={labelClass}>Reminder Schedule</label>

          {(formData.reminder_schedule || [24]).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {[...(formData.reminder_schedule || [24])]
                .sort((a, b) => b - a)
                .map((hours) => (
                  <span
                    key={hours}
                    className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-800 dark:text-red-300"
                  >
                    {hours >= 168
                      ? `${Math.floor(hours / 168)} week${hours >= 336 ? 's' : ''}`
                      : hours >= 24
                        ? `${Math.floor(hours / 24)} day${hours >= 48 ? 's' : ''}`
                        : `${hours} hour${hours !== 1 ? 's' : ''}`}{' '}
                    before
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          reminder_schedule: (formData.reminder_schedule || [24]).filter((h) => h !== hours),
                        })
                      }
                      className="touch-target-phone ml-0.5 inline-flex items-center justify-center hover:text-red-900 dark:hover:text-red-100"
                      aria-label={`Remove ${hours}-hour reminder`}
                    >
                      &times;
                    </button>
                  </span>
                ))}
            </div>
          )}

          <select
            id="add-reminder"
            aria-label="Add a reminder"
            value=""
            onChange={(e) => {
              const val = parseInt(e.target.value);
              if (val && !(formData.reminder_schedule || []).includes(val)) {
                update({ reminder_schedule: [...(formData.reminder_schedule || []), val] });
              }
            }}
            className="form-input w-full py-2"
          >
            <option value="">+ Add a reminder...</option>
            {[
              { value: 1, label: '1 hour before' },
              { value: 2, label: '2 hours before' },
              { value: 4, label: '4 hours before' },
              { value: 12, label: '12 hours before' },
              { value: 24, label: '1 day before' },
              { value: 48, label: '2 days before' },
              { value: 72, label: '3 days before' },
              { value: 168, label: '1 week before' },
            ]
              .filter(({ value }) => !(formData.reminder_schedule || []).includes(value))
              .map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </div>
      )}
    </section>
  );
};
