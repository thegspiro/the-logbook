/**
 * Configuration Tab Component
 *
 * Allows admins to configure portal settings including CORS origins,
 * rate limits, and cache TTL.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Save, Plus, X, AlertCircle } from 'lucide-react';
import { usePortalConfig } from '../hooks/usePublicPortal';

const ConfigurationTab: React.FC = () => {
  const { config, loading, updateConfig } = usePortalConfig();

  const [allowedOrigins, setAllowedOrigins] = useState<string[]>([]);
  const [newOrigin, setNewOrigin] = useState('');
  const [defaultRateLimit, setDefaultRateLimit] = useState(1000);
  const [cacheTTL, setCacheTTL] = useState(300);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setAllowedOrigins(config.allowed_origins || []);
      setDefaultRateLimit(config.default_rate_limit);
      setCacheTTL(config.cache_ttl_seconds);
    }
  }, [config]);

  const handleAddOrigin = () => {
    if (!newOrigin.trim()) return;

    // Validate URL format
    try {
      new URL(newOrigin);
      if (!allowedOrigins.includes(newOrigin)) {
        setAllowedOrigins([...allowedOrigins, newOrigin]);
        setNewOrigin('');
      }
    } catch {
      toast.error('Please enter a valid URL (e.g., https://example.com)');
    }
  };

  const handleRemoveOrigin = (origin: string) => {
    setAllowedOrigins(allowedOrigins.filter((o) => o !== origin));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateConfig({
        allowed_origins: allowedOrigins,
        default_rate_limit: defaultRateLimit,
        cache_ttl_seconds: cacheTTL,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* CORS Origins */}
      <div className="bg-theme-surface rounded-lg p-6 shadow-sm">
        <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Allowed Origins (CORS)</h3>
        <p className="text-theme-text-secondary mb-4 text-sm">
          Specify which domains can make requests to your public API. Leave empty to allow all origins (not recommended
          for production).
        </p>

        <div className="space-y-3">
          {/* Origin List */}
          {allowedOrigins.length > 0 && (
            <div className="space-y-2">
              {allowedOrigins.map((origin) => (
                <div
                  key={origin}
                  className="bg-theme-surface-secondary flex items-center justify-between rounded-lg px-4 py-2"
                >
                  <span className="text-theme-text-secondary font-mono text-sm">{origin}</span>
                  <button
                    onClick={() => handleRemoveOrigin(origin)}
                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Origin */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              value={newOrigin}
              onChange={(e) => setNewOrigin(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddOrigin()}
              placeholder="https://example.com"
              className="border-theme-surface-border focus:ring-theme-focus-ring flex-1 rounded-lg border px-4 py-2 focus:border-transparent focus:ring-2"
            />
            <button onClick={handleAddOrigin} className="btn-info flex shrink-0 items-center justify-center gap-2">
              <Plus className="h-4 w-4" />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>

      {/* Rate Limiting */}
      <div className="bg-theme-surface rounded-lg p-6 shadow-sm">
        <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Rate Limiting</h3>
        <p className="text-theme-text-secondary mb-4 text-sm">
          Set the default rate limit for API keys. Individual keys can override this value.
        </p>

        <div>
          <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
            Default Rate Limit (requests per hour)
          </label>
          <input
            type="number"
            value={defaultRateLimit}
            onChange={(e) => setDefaultRateLimit(parseInt(e.target.value, 10))}
            min={1}
            max={100000}
            className="border-theme-surface-border focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2 focus:border-transparent focus:ring-2"
          />
          <p className="text-theme-text-muted mt-1 text-xs">
            Recommended: 1000 for public websites, 10000 for high-traffic sites
          </p>
        </div>
      </div>

      {/* Caching */}
      <div className="bg-theme-surface rounded-lg p-6 shadow-sm">
        <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Caching</h3>
        <p className="text-theme-text-secondary mb-4 text-sm">
          Configure how long responses are cached to reduce database load.
        </p>

        <div>
          <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Cache TTL (seconds)</label>
          <input
            type="number"
            value={cacheTTL}
            onChange={(e) => setCacheTTL(parseInt(e.target.value, 10))}
            min={0}
            max={3600}
            className="border-theme-surface-border focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2 focus:border-transparent focus:ring-2"
          />
          <p className="text-theme-text-muted mt-1 text-xs">
            Recommended: 300 seconds (5 minutes). Set to 0 to disable caching.
          </p>
        </div>
      </div>

      {/* Security Notice */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex">
          <AlertCircle className="h-5 w-5 shrink-0 text-blue-600" />
          <div className="ml-3">
            <h4 className="text-sm font-medium text-blue-900">Security Best Practices</h4>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-blue-800">
              <li>Always specify allowed origins in production</li>
              <li>Use conservative rate limits to prevent abuse</li>
              <li>Monitor access logs regularly for suspicious activity</li>
              <li>Only whitelist fields that are safe for public access</li>
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
