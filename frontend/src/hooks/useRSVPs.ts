/**
 * useRSVPs Hook
 *
 * Custom hook for fetching and managing event RSVPs
 */

import { useState, useEffect } from 'react';
import { eventService } from '../services/api';
import type { RSVP } from '../types/event';

export const useRSVPs = (eventId: string | undefined, shouldFetch: boolean = true) => {
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRSVPs = async () => {
    if (!eventId || !shouldFetch) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getEventRSVPs(eventId);
      setRsvps(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load RSVPs';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRSVPs();
  }, [eventId, shouldFetch]);

  return {
    rsvps,
    loading,
    error,
    refetch: fetchRSVPs,
  };
};
