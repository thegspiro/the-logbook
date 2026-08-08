import React from 'react';
import type { Event } from '../../types/event';
import type { RSVPStatus } from '../../constants/enums';
import { RSVPStatus as RSVPStatusEnum } from '../../constants/enums';
import { getRSVPStatusLabel } from '../../utils/eventHelpers';

interface EventRSVPModalProps {
  event: Event;
  rsvpStatus: RSVPStatus;
  onRsvpStatusChange: (status: RSVPStatus) => void;
  guestCount: number;
  onGuestCountChange: (count: number) => void;
  rsvpNotes: string;
  onRsvpNotesChange: (notes: string) => void;
  rsvpDietaryRestrictions: string;
  onRsvpDietaryRestrictionsChange: (value: string) => void;
  rsvpAccessibilityNeeds: string;
  onRsvpAccessibilityNeedsChange: (value: string) => void;
  rsvpApplyToSeries: boolean;
  onRsvpApplyToSeriesChange: (value: boolean) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

const EventRSVPModal: React.FC<EventRSVPModalProps> = ({
  event,
  rsvpStatus,
  onRsvpStatusChange,
  guestCount,
  onGuestCountChange,
  rsvpNotes,
  onRsvpNotesChange,
  rsvpDietaryRestrictions,
  onRsvpDietaryRestrictionsChange,
  rsvpAccessibilityNeeds,
  onRsvpAccessibilityNeedsChange,
  rsvpApplyToSeries,
  onRsvpApplyToSeriesChange,
  submitting,
  submitError,
  onSubmit,
  onClose,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rsvp-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
    >
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="bg-theme-surface-modal relative z-10 inline-block transform overflow-hidden rounded-lg text-left align-bottom shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:align-middle">
          <form onSubmit={onSubmit}>
            <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <h3 id="rsvp-modal-title" className="text-theme-text-primary mb-4 text-lg font-medium">
                RSVP for {event.title}
              </h3>

              {submitError && (
                <div
                  className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3"
                  role="alert"
                  aria-live="assertive"
                >
                  <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
                </div>
              )}

              <div className="space-y-4">
                <fieldset>
                  <legend className="text-theme-text-secondary mb-2 block text-sm font-medium">Your Response</legend>
                  <div className="space-y-2">
                    {(event.allowed_rsvp_statuses || [RSVPStatusEnum.GOING, RSVPStatusEnum.NOT_GOING]).map((status) => (
                      <label key={status} className="flex items-center">
                        <input
                          type="radio"
                          name="rsvp-response"
                          value={status}
                          checked={rsvpStatus === status}
                          onChange={(e) => onRsvpStatusChange(e.target.value as RSVPStatus)}
                          className="focus:ring-theme-focus-ring border-theme-surface-border h-4 w-4 text-blue-600"
                        />
                        <span className="text-theme-text-secondary ml-2 text-sm">{getRSVPStatusLabel(status)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {event.allow_guests && rsvpStatus === RSVPStatusEnum.GOING && (
                  <div>
                    <label htmlFor="guest_count" className="text-theme-text-secondary block text-sm font-medium">
                      Number of Guests
                    </label>
                    <input
                      type="number"
                      id="guest_count"
                      min="0"
                      max="10"
                      value={guestCount}
                      onChange={(e) => onGuestCountChange(parseInt(e.target.value))}
                      className="bg-theme-input-bg text-theme-text-primary border-theme-input-border focus:ring-theme-focus-ring focus:border-theme-focus-ring mt-1 block w-full rounded-md shadow-xs sm:text-sm"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="notes" className="text-theme-text-secondary block text-sm font-medium">
                    Notes (optional)
                  </label>
                  <textarea
                    id="notes"
                    rows={3}
                    value={rsvpNotes}
                    onChange={(e) => onRsvpNotesChange(e.target.value)}
                    className="bg-theme-input-bg text-theme-text-primary border-theme-input-border focus:ring-theme-focus-ring focus:border-theme-focus-ring mt-1 block w-full rounded-md shadow-xs sm:text-sm"
                    placeholder="Any special requests or comments"
                  />
                </div>

                <div>
                  <label htmlFor="dietary_restrictions" className="text-theme-text-secondary block text-sm font-medium">
                    Dietary Restrictions (optional)
                  </label>
                  <input
                    type="text"
                    id="dietary_restrictions"
                    value={rsvpDietaryRestrictions}
                    onChange={(e) => onRsvpDietaryRestrictionsChange(e.target.value)}
                    className="bg-theme-input-bg text-theme-text-primary border-theme-input-border focus:ring-theme-focus-ring focus:border-theme-focus-ring mt-1 block w-full rounded-md shadow-xs sm:text-sm"
                    placeholder="e.g., Vegetarian, Nut allergy"
                    maxLength={500}
                  />
                </div>

                <div>
                  <label htmlFor="accessibility_needs" className="text-theme-text-secondary block text-sm font-medium">
                    Accessibility Needs (optional)
                  </label>
                  <input
                    type="text"
                    id="accessibility_needs"
                    value={rsvpAccessibilityNeeds}
                    onChange={(e) => onRsvpAccessibilityNeedsChange(e.target.value)}
                    className="bg-theme-input-bg text-theme-text-primary border-theme-input-border focus:ring-theme-focus-ring focus:border-theme-focus-ring mt-1 block w-full rounded-md shadow-xs sm:text-sm"
                    placeholder="e.g., Wheelchair access"
                    maxLength={500}
                  />
                </div>

                {event && (event.is_recurring || event.recurrence_parent_id) && (
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rsvpApplyToSeries}
                      onChange={(e) => onRsvpApplyToSeriesChange(e.target.checked)}
                      className="focus:ring-theme-focus-ring border-theme-surface-border h-4 w-4 rounded text-blue-600"
                    />
                    <span className="text-theme-text-secondary text-sm">Apply to all future events in this series</span>
                  </label>
                )}
              </div>
            </div>

            <div className="bg-theme-surface-secondary px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium sm:ml-3 sm:w-auto sm:text-sm"
              >
                {submitting ? 'Submitting...' : 'Submit RSVP'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring mt-3 inline-flex w-full justify-center rounded-md border px-4 py-2 text-base font-medium shadow-xs focus:ring-2 focus:ring-offset-2 focus:outline-hidden sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EventRSVPModal;
