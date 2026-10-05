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
import { formatNumber } from '../../../utils/dateFormatting';

// The bounds the update endpoint enforces (PublicPortalConfigUpdate).
const MIN_RATE_LIMIT = 1;
const MAX_RATE_LIMIT = 100000;

const ConfigurationTab: React.FC = () => {
  const { config, loading, updateConfig } = usePortalConfig();

  // Held as the text in the box, not a number. As a number the field had two
  // ways to stop being a controlled input: a cleared box parsed to NaN, and a
  // config response without the field set it to undefined — React warned on
  // both, and a save sent the bad value on to a 422.
  const [rateLimitText, setRateLimitText] = useState('1000');
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof config?.default_rate_limit === 'number') {
      setRateLimitText(String(config.default_rate_limit));
    }
  }, [config]);

  const handleSave = async () => {
    const rateLimit = Number(rateLimitText);
    if (
      !rateLimitText.trim() ||
      !Number.isInteger(rateLimit) ||
      rateLimit < MIN_RATE_LIMIT ||
      rateLimit > MAX_RATE_LIMIT
    ) {
      setRateLimitError(`Enter a whole number from ${MIN_RATE_LIMIT} to ${formatNumber(MAX_RATE_LIMIT)}.`);
      return;
    }
    setRateLimitError(null);
    setSaving(true);
    try {
      await updateConfig({ default_rate_limit: rateLimit });
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
            value={rateLimitText}
            onChange={(e) => {
              setRateLimitText(e.target.value);
              setRateLimitError(null);
            }}
            min={MIN_RATE_LIMIT}
            max={MAX_RATE_LIMIT}
            step={1}
            aria-invalid={rateLimitError ? true : undefined}
            aria-describedby={rateLimitError ? 'portal-default-rate-limit-error' : undefined}
            className="form-input"
          />
          {rateLimitError && (
            <p
              id="portal-default-rate-limit-error"
              role="alert"
              className="mt-1 text-sm text-red-700 dark:text-red-400"
            >
              {rateLimitError}
            </p>
          )}
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
            <h4 className="text-theme-text-primary text-sm font-medium">Security Best Practices</h4>
            <ul className="text-theme-text-secondary mt-2 list-inside list-disc space-y-1 text-sm">
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
