import React from 'react';
import { FileText, Bold, Italic, List, Link } from 'lucide-react';
import type { EventType } from '../../../types/event';
import { EventType as EventTypeEnum } from '../../../constants/enums';
import { getEventTypeLabel } from '../../../utils/eventHelpers';
import { EventOrganizerPickers } from '../../EventOrganizerPickers';
import { FormField } from '../../ux/FormField';
import { EVENT_FIELDS, EVENT_TYPES, inputClass, labelClass, selectClass } from '../eventFormConstants';
import type { EventFormModel } from '../useEventFormModel';

interface DetailsSectionProps {
  model: Pick<
    EventFormModel,
    | 'formData'
    | 'update'
    | 'fieldErrors'
    | 'descriptionRef'
    | 'insertMarkdown'
    | 'handleEventTypeChange'
    | 'attendanceLocked'
    | 'eventTypeLocked'
    | 'lockNoticeId'
    | 'typeLockHintId'
    | 'visibleTypes'
    | 'updateGuestSwitches'
    | 'customCategories'
    | 'visibleCustomCategories'
    | 'unlistedCategories'
    | 'showOrganizerPickers'
    | 'organizerOptions'
    | 'organizerId'
    | 'alternateId'
    | 'setOrganizerId'
    | 'setAlternateId'
    | 'currentUserId'
  >;
  /**
   * Leave the Event Type block out, for a form whose type is fixed before it
   * opens. The recruitment prompt lives in that block and goes with it.
   */
  hideTypePicker?: boolean | undefined;
  /** Rendered under the type picker, before the recruitment prompt. */
  typeHint?: React.ReactNode;
  /** Rendered between the Event Type block and the category picker. */
  afterType?: React.ReactNode;
}

/** Title, description, type, category and (on create) who organizes the event. */
export const DetailsSection: React.FC<DetailsSectionProps> = ({
  model,
  hideTypePicker = false,
  typeHint,
  afterType,
}) => {
  const {
    formData,
    update,
    fieldErrors,
    descriptionRef,
    insertMarkdown,
    handleEventTypeChange,
    attendanceLocked,
    eventTypeLocked,
    lockNoticeId,
    typeLockHintId,
    visibleTypes,
    updateGuestSwitches,
    customCategories,
    visibleCustomCategories,
    unlistedCategories,
    showOrganizerPickers,
    organizerOptions,
    organizerId,
    alternateId,
    setOrganizerId,
    setAlternateId,
    currentUserId,
  } = model;
  return (
    <section className="space-y-6">
      <h2 className="text-theme-text-primary flex items-center space-x-2 text-xl font-bold">
        <FileText className="h-5 w-5 text-red-700" />
        <span>Event Details</span>
      </h2>

      {/* Title */}
      <FormField
        id="event-title"
        label="Title"
        required
        error={fieldErrors.title}
        maxLength={EVENT_FIELDS.title.maxLength}
        count={formData.title.length}
      >
        {(field) => (
          <input
            {...field}
            type="text"
            autoComplete="off"
            value={formData.title}
            onChange={(e) => update({ title: e.target.value })}
            className={inputClass}
            placeholder="e.g., Monthly Business Meeting"
          />
        )}
      </FormField>

      {/* Description */}
      <div>
        <label htmlFor="event-description" className={labelClass}>
          Description
        </label>
        {/* Formatting toolbar */}
        <div className="mb-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => insertMarkdown('bold')}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded p-1.5 transition-colors"
            title="Bold (**text**)"
            aria-label="Insert bold text"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertMarkdown('italic')}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded p-1.5 transition-colors"
            title="Italic (*text*)"
            aria-label="Insert italic text"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertMarkdown('list')}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded p-1.5 transition-colors"
            title="Bullet list (- item)"
            aria-label="Insert bullet list"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => insertMarkdown('link')}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded p-1.5 transition-colors"
            title="Link ([text](url))"
            aria-label="Insert link"
          >
            <Link className="h-4 w-4" />
          </button>
          <span className="text-theme-text-muted ml-2 text-xs">Supports **bold**, *italic*, - lists, [links](url)</span>
        </div>
        <textarea
          ref={descriptionRef}
          id="event-description"
          aria-invalid={fieldErrors.description ? true : undefined}
          aria-describedby={fieldErrors.description ? 'event-description-error' : undefined}
          rows={4}
          value={formData.description || ''}
          onChange={(e) => update({ description: e.target.value })}
          className={inputClass}
          placeholder="What is this event about? Use **bold**, *italic*, - lists, or [links](url)"
        />
        {fieldErrors.description && (
          <p id="event-description-error" className="mt-1 text-sm text-red-700 dark:text-red-400">
            {fieldErrors.description}
          </p>
        )}
      </div>

      {/* Event Type */}
      {!hideTypePicker && (
        <div>
          <label htmlFor="event-type" className={labelClass}>
            Event Type <span className="text-red-700 dark:text-red-500">*</span>
          </label>
          <select
            id="event-type"
            required
            value={formData.event_type}
            onChange={(e) => handleEventTypeChange(e.target.value as EventType)}
            disabled={attendanceLocked || eventTypeLocked}
            aria-describedby={attendanceLocked ? lockNoticeId : eventTypeLocked ? typeLockHintId : undefined}
            className={`${selectClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {EVENT_TYPES.filter((t) => visibleTypes.includes(t)).map((type) => (
              <option key={type} value={type}>
                {getEventTypeLabel(type)}
              </option>
            ))}
            {EVENT_TYPES.some((t) => !visibleTypes.includes(t)) && (
              <optgroup label="Other">
                {EVENT_TYPES.filter((t) => !visibleTypes.includes(t)).map((type) => (
                  <option key={type} value={type}>
                    {getEventTypeLabel(type)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {eventTypeLocked && !attendanceLocked && (
            <p id={typeLockHintId} className="text-theme-text-muted mt-2 text-sm">
              Only an event manager can change a training event&apos;s type.
            </p>
          )}
          {typeHint}
          {/* A recruitment event only reaches the prospective-members pipeline
              through guest sign-in, and those two switches live in Check-In,
              several sections below the type picker. Without this prompt the
              usual outcome is an outreach night whose applicants' attendance
              is recorded as external attendees and never reaches their
              applications. */}
          {formData.event_type === EventTypeEnum.RECRUITMENT && (
            <div className="mt-2 rounded-lg border border-teal-500/30 bg-teal-500/10 p-3">
              {formData.allow_guest_check_in && formData.guest_check_in_creates_prospect ? (
                <p className="text-sm text-teal-700 dark:text-teal-300">
                  Applicants who sign in at this event will have it recorded on their application. Visitors not yet in
                  the pipeline are asked to see a member of staff.
                </p>
              ) : (
                <>
                  <p className="text-sm text-teal-700 dark:text-teal-300">
                    Applicants record their attendance at this event by signing in as guests. Turn on guest sign-in to
                    link this event to the prospective members pipeline.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      updateGuestSwitches({
                        allow_guest_check_in: true,
                        guest_check_in_creates_prospect: true,
                      })
                    }
                    className="mt-2 rounded-md border border-teal-500/40 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-500/10 dark:text-teal-300"
                  >
                    Enable guest sign-in and pipeline follow-up
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {afterType}

      {/* Custom Category (optional) */}
      {(customCategories.length > 0 || unlistedCategories.length > 0) && (
        <div>
          <label htmlFor="custom-category" className={labelClass}>
            Category
          </label>
          <select
            id="custom-category"
            value={formData.custom_category || ''}
            onChange={(e) =>
              update(e.target.value ? { custom_category: e.target.value } : { custom_category: undefined })
            }
            disabled={attendanceLocked}
            aria-describedby={attendanceLocked ? lockNoticeId : undefined}
            className={`${selectClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <option value="">None</option>
            {unlistedCategories.map((saved) => (
              <option key={saved} value={saved}>
                {saved}
              </option>
            ))}
            {customCategories
              .filter((c) => visibleCustomCategories.includes(c.value))
              .map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            {customCategories.some((c) => !visibleCustomCategories.includes(c.value)) && (
              <optgroup label="Other">
                {customCategories
                  .filter((c) => !visibleCustomCategories.includes(c.value))
                  .map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </div>
      )}
      {showOrganizerPickers && (
        <div>
          {organizerOptions.error ? (
            <p className="text-sm text-red-700 dark:text-red-400" role="alert">
              {organizerOptions.error} You will be the organizer; you can transfer the event once it is created.
            </p>
          ) : (
            <EventOrganizerPickers
              idPrefix="event"
              options={organizerOptions.options}
              organizerId={organizerId}
              alternateId={alternateId}
              onOrganizerChange={setOrganizerId}
              onAlternateChange={setAlternateId}
              organizerPlaceholder="Me (default)"
              defaultOrganizerId={currentUserId}
              disabled={organizerOptions.loading}
              selectClassName={selectClass}
              labelClassName={labelClass}
            />
          )}
        </div>
      )}
    </section>
  );
};
