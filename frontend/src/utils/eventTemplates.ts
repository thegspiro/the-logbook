import type { EventCreate, EventTemplate } from '../types/event';
import {
  fromTemplateTrainingDetails,
  type TrainingDetailsForm,
} from '../components/training-event/trainingDetailsModel';
import { formatForDateTimeInput, localToUTC } from './dateFormatting';

/**
 * Convert an EventTemplate into a partial EventCreate suitable for pre-populating the form.
 * start_datetime is the next full hour on the department's clock; end_datetime is offset
 * by the template's default_duration_minutes (or 60 min if unset). Both are UTC instants,
 * as the event form expects of initialData; it converts them to `tz` itself. The naive
 * browser-clock strings this used to build were read as browser time, which put the
 * default an hour or a day out for anyone away from the department (workflow review W21).
 *
 * A Training template's training details are read separately, by
 * `templateToInitialTraining`, since the training form holds them apart from
 * the event's own fields.
 */
export function templateToInitialData(template: EventTemplate, tz: string): Partial<EventCreate> {
  const nowLocal = formatForDateTimeInput(new Date(), tz);
  const hourStart = new Date(localToUTC(`${nowLocal.slice(0, 13)}:00`, tz));
  const start = new Date(hourStart.getTime() + 60 * 60 * 1000);
  const durationMs = (template.default_duration_minutes || 60) * 60 * 1000;
  const end = new Date(start.getTime() + durationMs);

  return {
    title: template.default_title || '',
    description: template.default_description || undefined,
    event_type: template.event_type,
    location_id: template.default_location_id || undefined,
    location: template.default_location || undefined,
    location_details: template.default_location_details || undefined,
    start_datetime: start.toISOString(),
    end_datetime: end.toISOString(),
    requires_rsvp: template.requires_rsvp,
    max_attendees: template.max_attendees || undefined,
    is_mandatory: template.is_mandatory,
    allow_guests: template.allow_guests,
    // ?? rather than ||: null here means "inherit the org default" and is a
    // real choice, so it must survive rather than being coerced away.
    attendee_visibility: template.attendee_visibility ?? null,
    check_in_window_type: template.check_in_window_type || undefined,
    check_in_minutes_before: template.check_in_minutes_before ?? undefined,
    check_in_minutes_after: template.check_in_minutes_after ?? undefined,
    require_checkout: template.require_checkout,
    send_reminders: template.send_reminders,
    reminder_target: template.reminder_target,
    reminder_schedule: template.reminder_schedule,
    custom_fields:
      (template.custom_fields_template as Record<string, string | number | boolean | null> | undefined) || undefined,
  };
}

/**
 * Training Info for a picked template: its saved training details laid onto
 * the form's defaults, or undefined when it has none to fill — any type but
 * Training, or a Training template saved before templates carried training
 * details (owner decision 2026-11-20), which opens Training Info on its
 * defaults as before.
 */
export function templateToInitialTraining(template: EventTemplate): TrainingDetailsForm | undefined {
  if (template.event_type !== 'training' || !template.training_details) return undefined;
  return fromTemplateTrainingDetails(template.training_details);
}
