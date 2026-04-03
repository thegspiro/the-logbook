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
      onKeyDown={(e) => { if (e.key === 'Escape') { onClose(); } }}
    >
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={onClose}>
          <div className="absolute inset-0 bg-black/75"></div>
        </div>

        <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
          <form onSubmit={onSubmit}>
            <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
              <h3 id="rsvp-modal-title" className="text-lg font-medium text-theme-text-primary mb-4">RSVP for {event.title}</h3>

              {submitError && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert" aria-live="assertive">
                  <p className="text-sm text-red-700 dark:text-red-300">{submitError}</p>
                </div>
              )}

              <div className="space-y-4">
                <fieldset>
                  <legend className="block text-sm font-medium text-theme-text-secondary mb-2">
                    Your Response
                  </legend>
                  <div className="space-y-2">
                    {(event.allowed_rsvp_statuses || [RSVPStatusEnum.GOING, RSVPStatusEnum.NOT_GOING]).map((status) => (
                      <label key={status} className="flex items-center">
                        <input
                          type="radio"
                          name="rsvp-response"
                          value={status}
                          checked={rsvpStatus === status}
                          onChange={(e) => onRsvpStatusChange(e.target.value as RSVPStatus)}
                          className="h-4 w-4 text-blue-600 focus:ring-theme-focus-ring border-theme-surface-border"
                        />
                        <span className="ml-2 text-sm text-theme-text-secondary">
                          {getRSVPStatusLabel(status)}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {event.allow_guests && rsvpStatus === RSVPStatusEnum.GOING && (
                  <div>
                    <label htmlFor="guest_count" className="block text-sm font-medium text-theme-text-secondary">
                      Number of Guests
                    </label>
                    <input
                      type="number"
                      id="guest_count"
                      min="0"
                      max="10"
                      value={guestCount}
                      onChange={(e) => onGuestCountChange(parseInt(e.target.value))}
                      className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="notes" className="block text-sm font-medium text-theme-text-secondary">
                    Notes (optional)
                  </label>
                  <textarea
                    id="notes"
                    rows={3}
                    value={rsvpNotes}
                    onChange={(e) => onRsvpNotesChange(e.target.value)}
                    className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                    placeholder="Any special requests or comments"
                  />
                </div>

                <div>
                  <label htmlFor="dietary_restrictions" className="block text-sm font-medium text-theme-text-secondary">
                    Dietary Restrictions (optional)
                  </label>
                  <input
                    type="text"
                    id="dietary_restrictions"
                    value={rsvpDietaryRestrictions}
                    onChange={(e) => onRsvpDietaryRestrictionsChange(e.target.value)}
                    className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                    placeholder="e.g., Vegetarian, Nut allergy"
                    maxLength={500}
                  />
                </div>

                <div>
                  <label htmlFor="accessibility_needs" className="block text-sm font-medium text-theme-text-secondary">
                    Accessibility Needs (optional)
                  </label>
                  <input
                    type="text"
                    id="accessibility_needs"
                    value={rsvpAccessibilityNeeds}
                    onChange={(e) => onRsvpAccessibilityNeedsChange(e.target.value)}
                    className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                    placeholder="e.g., Wheelchair access"
                    maxLength={500}
                  />
                </div>

                {event && (event.is_recurring || event.recurrence_parent_id) && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rsvpApplyToSeries}
                      onChange={(e) => onRsvpApplyToSeriesChange(e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-theme-focus-ring border-theme-surface-border rounded"
                    />
                    <span className="text-sm text-theme-text-secondary">
                      Apply to all future events in this series
                    </span>
                  </label>
                )}
              </div>
            </div>

            <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full"
              >
                {submitting ? 'Submitting...' : 'Submit RSVP'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
