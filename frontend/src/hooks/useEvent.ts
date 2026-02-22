/**
 * useEvent Hook
 *
 * Custom hook for fetching and managing event data
 */

import { useState, useEffect, useCallback } from 'react';
import { eventService } from '../services/api';
import type { Event } from '../types/event';

export const useEvent = (eventId: string | undefined) => {
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvent = useCallback(async (signal?: AbortSignal) => {
    if (!eventId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getEvent(eventId);
      if (!signal?.aborted) {
        setEvent(data);
      }
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load event';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [eventId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchEvent(controller.signal);
    return () => controller.abort();
  }, [fetchEvent]);

  return {
    event,
    loading,
    error,
    refetch: fetchEvent,
  };
};
