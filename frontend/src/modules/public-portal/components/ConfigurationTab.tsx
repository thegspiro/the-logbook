/**
 * Configuration Tab Component
 *
 * Allows admins to configure portal settings including CORS origins,
 * rate limits, and cache TTL.
 */

import React, { useState, useEffect } from 'react';
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
      alert('Please enter a valid URL (e.g., https://example.com)');
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
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Allowed Origins (CORS)
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Specify which domains can make requests to your public API. Leave empty
          to allow all origins (not recommended for production).
        </p>

        <div className="space-y-3">
          {/* Origin List */}
          {allowedOrigins.length > 0 && (
            <div className="space-y-2">
              {allowedOrigins.map((origin) => (
                <div
                  key={origin}
                  className="flex items-center justify-between bg-gray-50 px-4 py-2 rounded-lg"
                >
                  <span className="text-sm font-mono text-gray-700">{origin}</span>
                  <button
                    onClick={() => handleRemoveOrigin(origin)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Origin */}
          <div className="flex space-x-2">
            <input
              type="url"
              value={newOrigin}
              onChange={(e) => setNewOrigin(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddOrigin()}
              placeholder="https://example.com"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleAddOrigin}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          </div>
        </div>
      </div>

      {/* Rate Limiting */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Rate Limiting
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Set the default rate limit for API keys. Individual keys can override
          this value.
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Default Rate Limit (requests per hour)
          </label>
          <input
            type="number"
            value={defaultRateLimit}
            onChange={(e) => setDefaultRateLimit(parseInt(e.target.value, 10))}
            min={1}
            max={100000}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-gray-500">
            Recommended: 1000 for public websites, 10000 for high-traffic sites
          </p>
        </div>
      </div>

      {/* Caching */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Caching</h3>
        <p className="text-sm text-gray-600 mb-4">
          Configure how long responses are cached to reduce database load.
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Cache TTL (seconds)
          </label>
          <input
            type="number"
            value={cacheTTL}
            onChange={(e) => setCacheTTL(parseInt(e.target.value, 10))}
            min={0}
            max={3600}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-gray-500">
            Recommended: 300 seconds (5 minutes). Set to 0 to disable caching.
          </p>
        </div>
      </div>

      {/* Security Notice */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div className="ml-3">
            <h4 className="text-sm font-medium text-blue-900">
              Security Best Practices
            </h4>
            <ul className="mt-2 text-sm text-blue-800 list-disc list-inside space-y-1">
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
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center space-x-2"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
        </button>
      </div>
    </div>
  );
};

export { ConfigurationTab };
