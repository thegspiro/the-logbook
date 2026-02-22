/**
 * useRSVPs Hook
 *
 * Custom hook for fetching and managing event RSVPs
 */

import { useState, useEffect, useCallback } from 'react';
import { eventService } from '../services/api';
import type { RSVP } from '../types/event';

export const useRSVPs = (eventId: string | undefined, shouldFetch: boolean = true) => {
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRSVPs = useCallback(async (signal?: AbortSignal) => {
    if (!eventId || !shouldFetch) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getEventRSVPs(eventId);
      if (!signal?.aborted) {
        setRsvps(data);
      }
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load RSVPs';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [eventId, shouldFetch]);

  useEffect(() => {
    const controller = new AbortController();
    fetchRSVPs(controller.signal);
    return () => controller.abort();
  }, [fetchRSVPs]);

  return {
    rsvps,
    loading,
    error,
    refetch: fetchRSVPs,
  };
};
