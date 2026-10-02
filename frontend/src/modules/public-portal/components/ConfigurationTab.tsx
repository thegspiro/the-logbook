/**
 * Configuration Tab Component
 *
 * Allows admins to configure the portal's default rate limit.
 *
 * `allowed_origins` and `cache_ttl_seconds` are stored on the config but
 * nothing reads them — browser access is governed by the server-wide
 * ALLOWED_ORIGINS and the public API does not cache — so there are no
 * controls for them (CLAUDE.md pitfall #19). The save sends only the rate
 * limit; the update endpoint writes only the fields it is sent, which keeps
 * the stored values intact.
 */

import React, { useState, useEffect } from 'react';
import { Save, AlertCircle } from 'lucide-react';
import { usePortalConfig } from '../hooks/usePublicPortal';

const ConfigurationTab: React.FC = () => {
  const { config, loading, updateConfig } = usePortalConfig();

  const [defaultRateLimit, setDefaultRateLimit] = useState(1000);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setDefaultRateLimit(config.default_rate_limit);
    }
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateConfig({ default_rate_limit: defaultRateLimit });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Rate Limiting */}
      <div className="bg-theme-surface rounded-lg p-6 shadow-sm">
        <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Rate Limiting</h3>
        <p className="text-theme-text-secondary mb-4 text-sm">
          Applies to every API key that doesn't set its own limit.
        </p>

        <div>
          <label
            htmlFor="portal-default-rate-limit"
            className="text-theme-text-secondary mb-2 block text-sm font-medium"
          >
            Default Rate Limit (requests per hour)
          </label>
          <input
            id="portal-default-rate-limit"
            type="number"
            value={defaultRateLimit}
            onChange={(e) => setDefaultRateLimit(parseInt(e.target.value, 10))}
            min={1}
            max={100000}
            className="form-input"
          />
          <p className="text-theme-text-muted mt-1 text-xs">
            Recommended: 1000 for public websites, 10000 for high-traffic sites
          </p>
        </div>
      </div>

      {/* Security Notice */}
      <div className="alert-info">
        <div className="flex">
          <AlertCircle className="text-theme-alert-info-icon h-5 w-5 shrink-0" />
          <div className="ml-3">
            <h4 className="text-theme-alert-info-title text-sm font-medium">Security Best Practices</h4>
            <ul className="text-theme-alert-info-text mt-2 list-inside list-disc space-y-1 text-sm">
              <li>Use conservative rate limits to prevent abuse</li>
              <li>Monitor access logs regularly for suspicious activity</li>
              <li>Only enable fields under Data Control that are safe to publish</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          onClick={() => {
            void handleSave();
          }}
          disabled={saving}
          className="btn-info flex items-center space-x-2 px-6 disabled:cursor-not-allowed"
        >
          <Save className="h-4 w-4" />
          <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
        </button>
      </div>
    </div>
  );
};

export { ConfigurationTab };
