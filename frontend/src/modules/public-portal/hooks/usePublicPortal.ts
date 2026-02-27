/**
 * React hooks for Public Portal functionality
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import * as api from '../services/publicPortalApi';
import type {
  PublicPortalConfig,
  PublicPortalAPIKey,
  PublicPortalAPIKeyCreated,
  PublicPortalAccessLog,
  PublicPortalUsageStats,
  PublicPortalDataWhitelist,
  CreateAPIKeyRequest,
  UpdateConfigRequest,
  AccessLogFilters,
} from '../types';

// ============================================================================
// usePortalConfig - Manage portal configuration
// ============================================================================

export const usePortalConfig = () => {
  const [config, setConfig] = useState<PublicPortalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getConfig();
      setConfig(data);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to load configuration');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(
    async (updates: UpdateConfigRequest) => {
      try {
        const data = await api.updateConfig(updates);
        setConfig(data);
        toast.success('Configuration updated successfully');
        return data;
      } catch (err: unknown) {
        const message = getErrorMessage(err, 'Failed to update configuration');
        toast.error(message);
        throw err;
      }
    },
    []
  );

  const toggleEnabled = useCallback(
    async (enabled: boolean) => {
      return updateConfig({ enabled });
    },
    [updateConfig]
  );

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  return {
    config,
    loading,
    error,
    refetch: fetchConfig,
    updateConfig,
    toggleEnabled,
  };
};

// ============================================================================
// useAPIKeys - Manage API keys
// ============================================================================

export const useAPIKeys = (includeInactive = false) => {
  const [apiKeys, setApiKeys] = useState<PublicPortalAPIKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAPIKeys = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listAPIKeys(includeInactive);
      setApiKeys(data);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to load API keys');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  const createKey = useCallback(
    async (data: CreateAPIKeyRequest): Promise<PublicPortalAPIKeyCreated> => {
      try {
        const newKey = await api.createAPIKey(data);
        await fetchAPIKeys(); // Refresh list
        toast.success('API key created successfully');
        return newKey;
      } catch (err: unknown) {
        const message = getErrorMessage(err, 'Failed to create API key');
        toast.error(message);
        throw err;
      }
    },
    [fetchAPIKeys]
  );

  const revokeKey = useCallback(
    async (keyId: string) => {
      try {
        await api.revokeAPIKey(keyId);
        await fetchAPIKeys(); // Refresh list
        toast.success('API key revoked successfully');
      } catch (err: unknown) {
        const message = getErrorMessage(err, 'Failed to revoke API key');
        toast.error(message);
        throw err;
      }
    },
    [fetchAPIKeys]
  );

  useEffect(() => {
    void fetchAPIKeys();
  }, [fetchAPIKeys]);

  return {
    apiKeys,
    loading,
    error,
    refetch: fetchAPIKeys,
    createKey,
    revokeKey,
  };
};

// ============================================================================
// useAccessLogs - View access logs
// ============================================================================

export const useAccessLogs = (filters: AccessLogFilters = {}) => {
  const [logs, setLogs] = useState<PublicPortalAccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAccessLogs(filters);
      setLogs(data);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to load access logs');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  return {
    logs,
    loading,
    error,
    refetch: fetchLogs,
  };
};

// ============================================================================
// useUsageStats - View usage statistics
// ============================================================================

export const useUsageStats = () => {
  const [stats, setStats] = useState<PublicPortalUsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getUsageStats();
      setStats(data);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to load usage statistics');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  return {
    stats,
    loading,
    error,
    refetch: fetchStats,
  };
};

// ============================================================================
// useDataWhitelist - Manage data whitelist
// ============================================================================

export const useDataWhitelist = (category?: string) => {
  const [whitelist, setWhitelist] = useState<PublicPortalDataWhitelist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWhitelist = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getWhitelist(category);
      setWhitelist(data);
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to load whitelist');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [category]);

  const toggleField = useCallback(
    async (entryId: string, isEnabled: boolean) => {
      try {
        await api.updateWhitelistEntry(entryId, isEnabled);
        await fetchWhitelist(); // Refresh list
        toast.success(`Field ${isEnabled ? 'enabled' : 'disabled'} successfully`);
      } catch (err: unknown) {
        const message = getErrorMessage(err, 'Failed to update whitelist');
        toast.error(message);
        throw err;
      }
    },
    [fetchWhitelist]
  );

  const bulkUpdate = useCallback(
    async (
      updates: Array<{ category: string; field: string; enabled: boolean }>
    ) => {
      try {
        const result = await api.bulkUpdateWhitelist(updates);
        await fetchWhitelist(); // Refresh list
        toast.success(result.message);
      } catch (err: unknown) {
        const message = getErrorMessage(err, 'Failed to bulk update whitelist');
        toast.error(message);
        throw err;
      }
    },
    [fetchWhitelist]
  );

  useEffect(() => {
    void fetchWhitelist();
  }, [fetchWhitelist]);

  return {
    whitelist,
    loading,
    error,
    refetch: fetchWhitelist,
    toggleField,
    bulkUpdate,
  };
};
