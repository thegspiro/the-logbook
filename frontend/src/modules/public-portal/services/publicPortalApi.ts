/**
 * Public Portal API Service
 *
 * Client-side API for managing the public portal configuration,
 * API keys, access logs, and data whitelist.
 */

import axios from 'axios';
import type {
  PublicPortalConfig,
  PublicPortalAPIKey,
  PublicPortalAPIKeyCreated,
  PublicPortalAccessLog,
  PublicPortalUsageStats,
  PublicPortalDataWhitelist,
  CreateAPIKeyRequest,
  UpdateAPIKeyRequest,
  UpdateConfigRequest,
  AccessLogFilters,
} from '../types';

const API_BASE = '/api/v1/public-portal';

// ============================================================================
// Configuration API
// ============================================================================

export const getConfig = async (): Promise<PublicPortalConfig> => {
  const response = await axios.get(`${API_BASE}/config`);
  return response.data;
};

export const createConfig = async (
  config: UpdateConfigRequest
): Promise<PublicPortalConfig> => {
  const response = await axios.post(`${API_BASE}/config`, config);
  return response.data;
};

export const updateConfig = async (
  config: UpdateConfigRequest
): Promise<PublicPortalConfig> => {
  const response = await axios.patch(`${API_BASE}/config`, config);
  return response.data;
};

// ============================================================================
// API Key Management
// ============================================================================

export const listAPIKeys = async (
  includeInactive = false
): Promise<PublicPortalAPIKey[]> => {
  const response = await axios.get(`${API_BASE}/api-keys`, {
    params: { include_inactive: includeInactive },
  });
  return response.data;
};

export const createAPIKey = async (
  data: CreateAPIKeyRequest
): Promise<PublicPortalAPIKeyCreated> => {
  const response = await axios.post(`${API_BASE}/api-keys`, data);
  return response.data;
};

export const updateAPIKey = async (
  keyId: string,
  data: UpdateAPIKeyRequest
): Promise<PublicPortalAPIKey> => {
  const response = await axios.patch(`${API_BASE}/api-keys/${keyId}`, data);
  return response.data;
};

export const revokeAPIKey = async (
  keyId: string
): Promise<{ message: string; key_prefix: string }> => {
  const response = await axios.delete(`${API_BASE}/api-keys/${keyId}`);
  return response.data;
};

// ============================================================================
// Access Logs
// ============================================================================

export const getAccessLogs = async (
  filters: AccessLogFilters = {}
): Promise<PublicPortalAccessLog[]> => {
  const response = await axios.get(`${API_BASE}/access-logs`, {
    params: filters,
  });
  return response.data;
};

export const getUsageStats = async (): Promise<PublicPortalUsageStats> => {
  const response = await axios.get(`${API_BASE}/usage-stats`);
  return response.data;
};

// ============================================================================
// Data Whitelist
// ============================================================================

export const getWhitelist = async (
  category?: string
): Promise<PublicPortalDataWhitelist[]> => {
  const response = await axios.get(`${API_BASE}/whitelist`, {
    params: category ? { category } : {},
  });
  return response.data;
};

export const createWhitelistEntry = async (data: {
  data_category: string;
  field_name: string;
  is_enabled: boolean;
}): Promise<PublicPortalDataWhitelist> => {
  const response = await axios.post(`${API_BASE}/whitelist`, data);
  return response.data;
};

export const updateWhitelistEntry = async (
  entryId: string,
  isEnabled: boolean
): Promise<PublicPortalDataWhitelist> => {
  const response = await axios.patch(`${API_BASE}/whitelist/${entryId}`, {
    is_enabled: isEnabled,
  });
  return response.data;
};

export const bulkUpdateWhitelist = async (
  updates: Array<{ category: string; field: string; enabled: boolean }>
): Promise<{ message: string; updated_count: number }> => {
  const response = await axios.post(`${API_BASE}/whitelist/bulk-update`, {
    updates,
  });
  return response.data;
};
