/**
 * useEventStats Hook
 *
 * Custom hook for fetching and managing event statistics
 */

import { useState, useEffect, useCallback } from 'react';
import { eventService } from '../services/api';
import type { EventStats } from '../types/event';

export const useEventStats = (eventId: string | undefined, shouldFetch: boolean = true) => {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async (signal?: AbortSignal) => {
    if (!eventId || !shouldFetch) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getEventStats(eventId);
      if (!signal?.aborted) {
        setStats(data);
      }
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load stats';
      setError(errorMessage);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [eventId, shouldFetch]);

  useEffect(() => {
    const controller = new AbortController();
    fetchStats(controller.signal);
    return () => controller.abort();
  }, [fetchStats]);

  return {
    stats,
    loading,
    error,
    refetch: fetchStats,
  };
};
