/**
 * Public Portal Admin Page
 *
 * Main admin interface for managing the public portal, including
 * configuration, API keys, access logs, and data whitelist.
 */

import React, { useState } from 'react';
import { Globe, Key, FileText, BarChart3, Shield, Settings, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { usePortalConfig } from '../hooks/usePublicPortal';
import { ConfigurationTab } from '../components/ConfigurationTab';
import { APIKeysTab } from '../components/APIKeysTab';
import { AccessLogsTab } from '../components/AccessLogsTab';
import { UsageStatsTab } from '../components/UsageStatsTab';
import { DataWhitelistTab } from '../components/DataWhitelistTab';

type TabType = 'config' | 'keys' | 'logs' | 'stats' | 'whitelist';

const PublicPortalAdmin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('config');
  const { config, loading, toggleEnabled } = usePortalConfig();

  const tabs = [
    {
      id: 'config' as TabType,
      label: 'Configuration',
      icon: Settings,
      description: 'Portal settings and CORS',
    },
    {
      id: 'keys' as TabType,
      label: 'API Keys',
      icon: Key,
      description: 'Manage API keys',
    },
    {
      id: 'logs' as TabType,
      label: 'Access Logs',
      icon: FileText,
      description: 'View access logs',
    },
    {
      id: 'stats' as TabType,
      label: 'Statistics',
      icon: BarChart3,
      description: 'Usage analytics',
    },
    {
      id: 'whitelist' as TabType,
      label: 'Data Control',
      icon: Shield,
      description: 'Whitelist fields',
    },
  ];

  const handleToggleEnabled = async () => {
    if (!config) return;
    try {
      await toggleEnabled(!config.enabled);
    } catch (_error) {
      // Error already handled by hook
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="text-theme-text-secondary mt-4">Loading public portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-theme-surface-secondary min-h-screen">
      {/* Header */}
      <div className="bg-theme-surface border-theme-surface-border border-b">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-500/20">
                  <Globe className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-theme-text-primary text-2xl font-bold">Public Portal</h1>
                  <p className="text-theme-text-muted text-sm">Manage public API access for external websites</p>
                </div>
              </div>

              {/* Status Toggle */}
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  {config?.enabled ? (
                    <>
                      <CheckCircle className="h-5 w-5 text-green-700 dark:text-green-500" />
                      <span className="text-sm font-medium text-green-700 dark:text-green-400">Portal Enabled</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="text-theme-text-muted h-5 w-5" />
                      <span className="text-theme-text-muted text-sm font-medium">Portal Disabled</span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => {
                    void handleToggleEnabled();
                  }}
                  className={`rounded-lg px-4 py-2 font-medium transition-colors ${
                    config?.enabled
                      ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-400 dark:hover:bg-red-500/30'
                      : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500/30'
                  }`}
                >
                  {config?.enabled ? 'Disable Portal' : 'Enable Portal'}
                </button>
              </div>
            </div>

            {/* Warning Banner */}
            {!config?.enabled && (
              <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-500/30 dark:bg-yellow-500/10">
                <div className="flex">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600" />
                  <div className="ml-3">
                    <p className="text-sm text-yellow-800 dark:text-yellow-400">
                      The public portal is currently disabled. External websites will not be able to access your data
                      until you enable it and configure API keys.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="border-theme-surface-border flex space-x-1 border-b">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'text-theme-text-muted hover:text-theme-text-secondary hover:border-theme-surface-border border-transparent'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {activeTab === 'config' && <ConfigurationTab />}
        {activeTab === 'keys' && <APIKeysTab />}
        {activeTab === 'logs' && <AccessLogsTab />}
        {activeTab === 'stats' && <UsageStatsTab />}
        {activeTab === 'whitelist' && <DataWhitelistTab />}
      </div>
    </div>
  );
};

export default PublicPortalAdmin;
