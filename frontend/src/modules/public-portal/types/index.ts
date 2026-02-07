/**
 * Public Portal TypeScript Types
 */

export interface PublicPortalConfig {
  id: string;
  organization_id: string;
  enabled: boolean;
  allowed_origins: string[];
  default_rate_limit: number;
  cache_ttl_seconds: number;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface PublicPortalAPIKey {
  id: string;
  organization_id: string;
  key_prefix: string;
  name: string;
  rate_limit_override: number | null;
  expires_at: string | null;
  last_used_at: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  is_expired: boolean;
}

export interface PublicPortalAPIKeyCreated extends PublicPortalAPIKey {
  api_key: string; // Full key shown only once
}

export interface PublicPortalAccessLog {
  id: string;
  organization_id: string;
  api_key_id: string | null;
  ip_address: string;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms: number | null;
  user_agent: string | null;
  referer: string | null;
  timestamp: string;
  flagged_suspicious: boolean;
  flag_reason: string | null;
}

export interface PublicPortalUsageStats {
  total_requests: number;
  requests_today: number;
  requests_this_week: number;
  requests_this_month: number;
  unique_ips: number;
  average_response_time_ms: number;
  top_endpoints: Array<{ endpoint: string; count: number }>;
  requests_by_status: Record<number, number>;
  flagged_requests: number;
}

export interface PublicPortalDataWhitelist {
  id: string;
  organization_id: string;
  data_category: string;
  field_name: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAPIKeyRequest {
  name: string;
  rate_limit_override?: number;
  expires_at?: string;
}

export interface UpdateAPIKeyRequest {
  name?: string;
  rate_limit_override?: number;
  expires_at?: string;
  is_active?: boolean;
}

export interface UpdateConfigRequest {
  enabled?: boolean;
  allowed_origins?: string[];
  default_rate_limit?: number;
  cache_ttl_seconds?: number;
  settings?: Record<string, any>;
}

export interface AccessLogFilters {
  api_key_id?: string;
  ip_address?: string;
  endpoint?: string;
  status_code?: number;
  flagged_suspicious?: boolean;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}
