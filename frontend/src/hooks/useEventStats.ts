/**
 * useEventStats Hook
 *
 * Custom hook for fetching and managing event statistics
 */

import { useState, useEffect } from 'react';
import { eventService } from '../services/api';
import type { EventStats } from '../types/event';

export const useEventStats = (eventId: string | undefined, shouldFetch: boolean = true) => {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    if (!eventId || !shouldFetch) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getEventStats(eventId);
      setStats(data);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to load stats';
      console.error('Error fetching stats:', err);
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [eventId, shouldFetch]);

  return {
    stats,
    loading,
    error,
    refetch: fetchStats,
  };
};
