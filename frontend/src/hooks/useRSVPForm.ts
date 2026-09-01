/**
 * useRSVPForm Hook
 *
 * Manages RSVP modal form state and submission logic for EventDetailPage.
 */

import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { AxiosError } from 'axios';
import { eventService } from '../services/api';
import type { RSVPStatus, Event } from '../types/event';
import { RSVPStatus as RSVPStatusEnum } from '../constants/enums';
import { getPhaseGateWarning } from '../utils/errorHandling';

import { useConfirm } from '../contexts/ConfirmContext';
interface UseRSVPFormOptions {
  eventId: string | undefined;
  event: Event | null;
  onSuccess: () => Promise<void>;
}

export const useRSVPForm = ({ eventId, event, onSuccess }: UseRSVPFormOptions) => {
  const { confirm } = useConfirm();
  const [showRSVPModal, setShowRSVPModal] = useState(false);
  const [rsvpStatus, setRsvpStatus] = useState<RSVPStatus>(RSVPStatusEnum.GOING);
  const [guestCount, setGuestCount] = useState(0);
  const [rsvpNotes, setRsvpNotes] = useState('');
  const [rsvpDietaryRestrictions, setRsvpDietaryRestrictions] = useState('');
  const [rsvpAccessibilityNeeds, setRsvpAccessibilityNeeds] = useState('');
  const [rsvpApplyToSeries, setRsvpApplyToSeries] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setRsvpStatus(RSVPStatusEnum.GOING);
    setGuestCount(0);
    setRsvpNotes('');
    setRsvpDietaryRestrictions('');
    setRsvpAccessibilityNeeds('');
    setRsvpApplyToSeries(false);
    setSubmitError(null);
  }, []);

  /**
   * Seed the form from the member's existing RSVP, falling back to defaults
   * when they have not responded yet.
   *
   * This is not a convenience. The form previously reset on every open, so
   * "Update RSVP" came up blank and submitting it discarded whatever the
   * member had entered. That was quiet data loss for notes; once guests began
   * consuming event capacity it became a capacity bug, because a member with
   * two guests who opened the modal to fix a typo would submit guest_count: 0
   * and silently release two seats to somebody else.
   */
  const openModal = useCallback(() => {
    const existing = event?.user_rsvp;
    if (existing) {
      // `waitlisted` is server-generated and is normally absent from
      // allowed_rsvp_statuses, so seeding it would leave no radio selected and
      // submitting would be rejected as a disallowed status. A waitlisted
      // member is queued *for* going, so that is what their form opens on.
      setRsvpStatus(existing.status === RSVPStatusEnum.WAITLISTED ? RSVPStatusEnum.GOING : existing.status);
      setGuestCount(existing.guest_count ?? 0);
      setRsvpNotes(existing.notes ?? '');
      // Accommodation fields are not echoed back by the API — they are PHI and
      // event detail is cacheable — so they start empty, as they always did.
      setRsvpDietaryRestrictions('');
      setRsvpAccessibilityNeeds('');
      setRsvpApplyToSeries(false);
      setSubmitError(null);
    } else {
      resetForm();
    }
    setShowRSVPModal(true);
  }, [event, resetForm]);

  const closeModal = useCallback(() => {
    setShowRSVPModal(false);
    resetForm();
  }, [resetForm]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!eventId) return;

      try {
        setSubmitting(true);
        setSubmitError(null);

        const rsvpPayload = {
          status: rsvpStatus,
          guest_count: guestCount,
          notes: rsvpNotes || undefined,
          dietary_restrictions: rsvpDietaryRestrictions || undefined,
          accessibility_needs: rsvpAccessibilityNeeds || undefined,
        };

        if (rsvpApplyToSeries && event && (event.is_recurring || event.recurrence_parent_id)) {
          const result = await eventService.rsvpToSeries(eventId, rsvpPayload);
          toast.success(`RSVP applied to ${result.rsvp_count} events in the series`);
        } else {
          try {
            await eventService.createOrUpdateRSVP(eventId, rsvpPayload);
          } catch (err) {
            // Soft pipeline phase gate — confirm, then retry with override.
            const warning = getPhaseGateWarning(err);
            if (!warning) throw err;
            if (
              !(await confirm({
                title: 'RSVP anyway?',
                message: warning,
                confirmLabel: 'RSVP',
                cancelLabel: 'Not now',
                variant: 'warning',
              }))
            ) {
              setSubmitting(false);
              return;
            }
            await eventService.createOrUpdateRSVP(eventId, rsvpPayload, true);
          }
          toast.success('RSVP submitted successfully');
        }

        setShowRSVPModal(false);
        resetForm();
        await onSuccess();
      } catch (err) {
        setSubmitError((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to submit RSVP');
      } finally {
        setSubmitting(false);
      }
    },
    [
      confirm,
      eventId,
      event,
      rsvpStatus,
      guestCount,
      rsvpNotes,
      rsvpDietaryRestrictions,
      rsvpAccessibilityNeeds,
      rsvpApplyToSeries,
      onSuccess,
      resetForm,
    ]
  );

  return {
    showRSVPModal,
    setShowRSVPModal,
    rsvpStatus,
    setRsvpStatus,
    guestCount,
    setGuestCount,
    rsvpNotes,
    setRsvpNotes,
    rsvpDietaryRestrictions,
    setRsvpDietaryRestrictions,
    rsvpAccessibilityNeeds,
    setRsvpAccessibilityNeeds,
    rsvpApplyToSeries,
    setRsvpApplyToSeries,
    submitting,
    submitError,
    setSubmitError,
    openModal,
    closeModal,
    handleSubmit,
  };
};
