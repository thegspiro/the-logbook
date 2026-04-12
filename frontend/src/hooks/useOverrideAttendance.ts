/**
 * useOverrideAttendance Hook
 *
 * Manages override attendance modal state and submission for EventDetailPage.
 */

import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { AxiosError } from 'axios';
import { eventService } from '../services/api';
import { formatForDateTimeInput, localToUTC } from '../utils/dateFormatting';
import type { RSVP, RSVPOverride } from '../types/event';

interface UseOverrideAttendanceOptions {
  eventId: string | undefined;
  timezone: string;
  onSuccess: () => Promise<void>;
}

export const useOverrideAttendance = ({ eventId, timezone, onSuccess }: UseOverrideAttendanceOptions) => {
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [editingRsvp, setEditingRsvp] = useState<RSVP | null>(null);
  const [overrideCheckIn, setOverrideCheckIn] = useState('');
  const [overrideCheckOut, setOverrideCheckOut] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const openModal = useCallback((rsvp: RSVP) => {
    setEditingRsvp(rsvp);
    setOverrideCheckIn(
      rsvp.override_check_in_at
        ? formatForDateTimeInput(rsvp.override_check_in_at, timezone)
        : rsvp.checked_in_at
          ? formatForDateTimeInput(rsvp.checked_in_at, timezone)
          : ''
    );
    setOverrideCheckOut(
      rsvp.override_check_out_at
        ? formatForDateTimeInput(rsvp.override_check_out_at, timezone)
        : rsvp.checked_out_at
          ? formatForDateTimeInput(rsvp.checked_out_at, timezone)
          : ''
    );
    setShowOverrideModal(true);
    setSubmitError(null);
  }, [timezone]);

  const closeModal = useCallback(() => {
    setShowOverrideModal(false);
    setEditingRsvp(null);
    setSubmitError(null);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !editingRsvp) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      const data: RSVPOverride = {};
      if (overrideCheckIn) data.override_check_in_at = localToUTC(overrideCheckIn, timezone);
      if (overrideCheckOut) data.override_check_out_at = localToUTC(overrideCheckOut, timezone);

      await eventService.overrideAttendance(eventId, editingRsvp.user_id, data);
      setShowOverrideModal(false);
      setEditingRsvp(null);
      await onSuccess();
      toast.success('Attendance times updated');
    } catch (err) {
      setSubmitError((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to update attendance');
    } finally {
      setSubmitting(false);
    }
  }, [eventId, editingRsvp, overrideCheckIn, overrideCheckOut, timezone, onSuccess]);

  return {
    showOverrideModal,
    editingRsvp,
    overrideCheckIn,
    setOverrideCheckIn,
    overrideCheckOut,
    setOverrideCheckOut,
    submitting,
    submitError,
    openModal,
    closeModal,
    handleSubmit,
  };
};
