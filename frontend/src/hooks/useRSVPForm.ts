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

interface UseRSVPFormOptions {
  eventId: string | undefined;
  event: Event | null;
  onSuccess: () => Promise<void>;
}

export const useRSVPForm = ({ eventId, event, onSuccess }: UseRSVPFormOptions) => {
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

  const openModal = useCallback(() => {
    resetForm();
    setShowRSVPModal(true);
  }, [resetForm]);

  const closeModal = useCallback(() => {
    setShowRSVPModal(false);
    resetForm();
  }, [resetForm]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
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
        await eventService.createOrUpdateRSVP(eventId, rsvpPayload);
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
  }, [eventId, event, rsvpStatus, guestCount, rsvpNotes, rsvpDietaryRestrictions, rsvpAccessibilityNeeds, rsvpApplyToSeries, onSuccess, resetForm]);

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
