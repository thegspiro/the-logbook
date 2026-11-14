import type { EventCreate, RecurringEventCreate, RecurrencePattern, EventType } from '../../types/event';

export interface ConflictEvent {
  id: string;
  title: string;
  start_datetime: string;
  end_datetime: string;
  event_type?: EventType;
}

export interface InitialRecurrence {
  is_recurring: boolean;
  recurrence_pattern?: RecurrencePattern | undefined;
  recurrence_end_date?: string | undefined;
  rolling_recurrence?: boolean | undefined;
  recurrence_custom_days?: number[] | undefined;
  recurrence_weekday?: number | undefined;
  recurrence_week_ordinal?: number | undefined;
  recurrence_month?: number | undefined;
  recurrence_exceptions?: string[] | undefined;
}

/**
 * What `useEventFormModel` needs from the form that hosts it. The flags carry
 * the same meaning as `EventForm`'s props of the same names; defaults are the
 * host's to apply, so the model never guesses whether it is creating.
 */
export interface EventFormModelOptions {
  initialData?: Partial<EventCreate> | undefined;
  onSubmit: (data: EventCreate) => Promise<void>;
  onSubmitRecurring?: ((data: RecurringEventCreate) => Promise<void>) | undefined;
  /** Pre-populate recurrence state when editing a recurring event */
  initialRecurrence?: InitialRecurrence | undefined;
  /** Events the user has RSVP'd to, used for conflict detection */
  userEvents?: ConflictEvent[] | undefined;
  /** When editing, the ID of the current event (excluded from conflict checks) */
  editingEventId?: string | undefined;
  showOrganizerPickers: boolean;
  attendanceLocked: boolean;
  eventTypeLocked: boolean;
}
