import React from 'react';
import { Modal } from '../Modal';
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
    <Modal
      isOpen
      onClose={onClose}
      title={`RSVP for ${event.title}`}
      titleId="rsvp-modal-title"
      onSubmit={onSubmit}
      footer={
        <>
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
            className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Cancel
          </button>
        </>
      }
    >
      {submitError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3" role="alert" aria-live="assertive">
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
              className="form-input mt-1 shadow-xs sm:text-sm"
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
            className="form-input mt-1 shadow-xs sm:text-sm"
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
            className="form-input mt-1 shadow-xs sm:text-sm"
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
            className="form-input mt-1 shadow-xs sm:text-sm"
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
    </Modal>
  );
};

export default EventRSVPModal;
