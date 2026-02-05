/**
 * External Training Integrations Page
 *
 * Allows administrators to manage connections to external training platforms
 * like Vector Solutions, Target Solutions, Lexipol, etc.
 */

import React, { useState, useEffect } from 'react';
import {
  Link2,
  Plus,
  Settings,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
  Users,
  FolderTree,
  Download,
  Trash2,
  Edit2,
  PlayCircle,
  ExternalLink,
} from 'lucide-react';
import { AppLayout } from '../components/layout';
import { externalTrainingService } from '../services/api';
import type {
  ExternalTrainingProvider,
  ExternalTrainingProviderCreate,
  ExternalProviderType,
  ExternalCategoryMapping,
  ExternalUserMapping,
  ExternalTrainingSyncLog,
  ExternalTrainingImport,
} from '../types/training';

type TabView = 'providers' | 'imports' | 'mappings';

const PROVIDER_TYPES: { value: ExternalProviderType; label: string; description: string }[] = [
  { value: 'vector_solutions', label: 'Vector Solutions', description: 'Connect to Vector Solutions LMS for fire and EMS training records' },
  { value: 'target_solutions', label: 'Target Solutions', description: 'Sync training completions from Target Solutions platform' },
  { value: 'lexipol', label: 'Lexipol', description: 'Import policy acknowledgments and training from Lexipol' },
  { value: 'i_am_responding', label: 'I Am Responding', description: 'Track training logged through I Am Responding' },
  { value: 'custom_api', label: 'Custom API', description: 'Connect to any training platform with a compatible API' },
];

interface CreateProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CreateProviderModal: React.FC<CreateProviderModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [formData, setFormData] = useState<ExternalTrainingProviderCreate>({
    name: '',
    provider_type: 'vector_solutions',
    api_base_url: '',
    api_key: '',
    auth_type: 'api_key',
    auto_sync_enabled: false,
    sync_interval_hours: 24,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleTypeSelect = (type: ExternalProviderType) => {
    setFormData(prev => ({
      ...prev,
      provider_type: type,
      name: PROVIDER_TYPES.find(p => p.value === type)?.label || '',
    }));
    setStep('details');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      await externalTrainingService.createProvider(formData);
      onSuccess();
      onClose();
      setStep('type');
      setFormData({
        name: '',
        provider_type: 'vector_solutions',
        api_base_url: '',
        api_key: '',
        auth_type: 'api_key',
        auto_sync_enabled: false,
        sync_interval_hours: 24,
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create provider');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-2xl font-bold text-white">
            {step === 'type' ? 'Select Provider Type' : 'Configure Provider'}
          </h2>
        </div>

        {step === 'type' ? (
          <div className="p-6 space-y-4">
            {PROVIDER_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => handleTypeSelect(type.value)}
                className="w-full p-4 bg-gray-700 hover:bg-gray-600 rounded-lg text-left transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{type.label}</h3>
                    <p className="text-sm text-gray-400 mt-1">{type.description}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
              </button>
            ))}

            <div className="flex justify-end pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-300 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500 text-red-500 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Display Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-red-500"
                placeholder="e.g., Vector Solutions - Main Account"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                API Base URL *
              </label>
              <input
                type="url"
                value={formData.api_base_url}
                onChange={(e) => setFormData(prev => ({ ...prev, api_base_url: e.target.value }))}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-red-500"
                placeholder="https://api.vectorsolutions.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Authentication Type
              </label>
              <select
                value={formData.auth_type}
                onChange={(e) => setFormData(prev => ({ ...prev, auth_type: e.target.value }))}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-red-500"
              >
                <option value="api_key">API Key</option>
                <option value="basic">Basic Auth</option>
                <option value="oauth2">OAuth 2.0</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                API Key *
              </label>
              <input
                type="password"
                value={formData.api_key}
                onChange={(e) => setFormData(prev => ({ ...prev, api_key: e.target.value }))}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-red-500"
                placeholder="Enter your API key"
                required
              />
            </div>

            {formData.auth_type === 'basic' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  API Secret
                </label>
                <input
                  type="password"
                  value={formData.api_secret || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, api_secret: e.target.value }))}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-red-500"
                  placeholder="Enter your API secret"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Description
              </label>
              <textarea
                value={formData.description || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-red-500"
                placeholder="Optional description for this integration"
                rows={3}
              />
            </div>

            <div className="border-t border-gray-700 pt-4">
              <h3 className="text-lg font-semibold text-white mb-4">Sync Settings</h3>

              <div className="flex items-center justify-between mb-4">
                <div>
                  <label className="text-sm font-medium text-gray-300">
                    Enable Auto-Sync
                  </label>
                  <p className="text-xs text-gray-500">
                    Automatically sync training records on a schedule
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, auto_sync_enabled: !prev.auto_sync_enabled }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.auto_sync_enabled ? 'bg-red-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      formData.auto_sync_enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {formData.auto_sync_enabled && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Sync Interval (hours)
                  </label>
                  <select
                    value={formData.sync_interval_hours}
                    onChange={(e) => setFormData(prev => ({ ...prev, sync_interval_hours: parseInt(e.target.value) }))}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-red-500"
                  >
                    <option value={6}>Every 6 hours</option>
                    <option value={12}>Every 12 hours</option>
                    <option value={24}>Daily</option>
                    <option value={48}>Every 2 days</option>
                    <option value={168}>Weekly</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-4 border-t border-gray-700">
              <button
                type="button"
                onClick={() => setStep('type')}
                className="px-4 py-2 text-gray-300 hover:text-white"
              >
                Back
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-gray-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create Provider'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

interface ProviderCardProps {
  provider: ExternalTrainingProvider;
  onTestConnection: (id: string) => void;
  onSync: (id: string) => void;
  onEdit: (provider: ExternalTrainingProvider) => void;
  onDelete: (id: string) => void;
  onViewMappings: (id: string) => void;
  isTestingConnection: boolean;
  isSyncing: boolean;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  onTestConnection,
  onSync,
  onEdit,
  onDelete,
  onViewMappings,
  isTestingConnection,
  isSyncing,
}) => {
  const getStatusIcon = () => {
    if (provider.connection_verified) {
      return <CheckCircle className="w-5 h-5 text-green-500" />;
    }
    if (provider.connection_error) {
      return <XCircle className="w-5 h-5 text-red-500" />;
    }
    return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
  };

  const getProviderTypeLabel = () => {
    return PROVIDER_TYPES.find(p => p.value === provider.provider_type)?.label || provider.provider_type;
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gray-700 rounded-lg">
            <Link2 className="w-6 h-6 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">{provider.name}</h3>
            <p className="text-sm text-gray-400">{getProviderTypeLabel()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <span className={`text-sm ${provider.active ? 'text-green-400' : 'text-gray-500'}`}>
            {provider.active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {provider.description && (
        <p className="text-sm text-gray-400 mb-4">{provider.description}</p>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-xs text-gray-400">Last Sync</p>
          <p className="text-sm text-white">
            {provider.last_sync_at
              ? new Date(provider.last_sync_at).toLocaleString()
              : 'Never'}
          </p>
        </div>
        <div className="bg-gray-700/50 rounded-lg p-3">
          <p className="text-xs text-gray-400">Auto-Sync</p>
          <p className="text-sm text-white">
            {provider.auto_sync_enabled
              ? `Every ${provider.sync_interval_hours}h`
              : 'Disabled'}
          </p>
        </div>
      </div>

      {provider.connection_error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4">
          <p className="text-xs text-red-400">Connection Error:</p>
          <p className="text-sm text-red-300">{provider.connection_error}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onTestConnection(provider.id)}
          disabled={isTestingConnection}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg disabled:opacity-50"
        >
          {isTestingConnection ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle className="w-4 h-4" />
          )}
          Test
        </button>
        <button
          onClick={() => onSync(provider.id)}
          disabled={isSyncing}
          className="flex items-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg disabled:opacity-50"
        >
          {isSyncing ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <PlayCircle className="w-4 h-4" />
          )}
          Sync Now
        </button>
        <button
          onClick={() => onViewMappings(provider.id)}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
        >
          <FolderTree className="w-4 h-4" />
          Mappings
        </button>
        <button
          onClick={() => onEdit(provider)}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg"
        >
          <Edit2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(provider.id)}
          className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-red-600 text-white text-sm rounded-lg"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

interface MappingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  providerName: string;
}

const MappingsModal: React.FC<MappingsModalProps> = ({ isOpen, onClose, providerId, providerName }) => {
  const [activeTab, setActiveTab] = useState<'categories' | 'users'>('categories');
  const [categoryMappings, setCategoryMappings] = useState<ExternalCategoryMapping[]>([]);
  const [userMappings, setUserMappings] = useState<ExternalUserMapping[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && providerId) {
      loadMappings();
    }
  }, [isOpen, providerId]);

  const loadMappings = async () => {
    setLoading(true);
    try {
      const [categories, users] = await Promise.all([
        externalTrainingService.getCategoryMappings(providerId),
        externalTrainingService.getUserMappings(providerId),
      ]);
      setCategoryMappings(categories);
      setUserMappings(users);
    } catch (err) {
      console.error('Failed to load mappings:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-700">
          <h2 className="text-2xl font-bold text-white">Mappings - {providerName}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Map external categories and users to your internal records
          </p>
        </div>

        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('categories')}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'categories'
                ? 'text-red-500 border-b-2 border-red-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <FolderTree className="w-4 h-4 inline-block mr-2" />
            Categories ({categoryMappings.filter(m => !m.is_mapped).length} unmapped)
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'users'
                ? 'text-red-500 border-b-2 border-red-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4 inline-block mr-2" />
            Users ({userMappings.filter(m => !m.is_mapped).length} unmapped)
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading mappings...</div>
          ) : activeTab === 'categories' ? (
            <div className="space-y-3">
              {categoryMappings.length === 0 ? (
                <p className="text-gray-400 text-center py-8">
                  No category mappings yet. Run a sync to discover categories.
                </p>
              ) : (
                categoryMappings.map(mapping => (
                  <div
                    key={mapping.id}
                    className={`p-4 rounded-lg border ${
                      mapping.is_mapped
                        ? 'bg-gray-700/50 border-gray-600'
                        : 'bg-yellow-500/10 border-yellow-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-medium">{mapping.external_category_name}</p>
                        <p className="text-xs text-gray-400">
                          External ID: {mapping.external_category_id}
                          {mapping.external_category_code && ` | Code: ${mapping.external_category_code}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {mapping.is_mapped ? (
                          <span className="text-sm text-green-400 flex items-center gap-1">
                            <CheckCircle className="w-4 h-4" />
                            Mapped
                            {mapping.auto_mapped && <span className="text-xs">(auto)</span>}
                          </span>
                        ) : (
                          <button className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded">
                            Map Category
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {userMappings.length === 0 ? (
                <p className="text-gray-400 text-center py-8">
                  No user mappings yet. Run a sync to discover users.
                </p>
              ) : (
                userMappings.map(mapping => (
                  <div
                    key={mapping.id}
                    className={`p-4 rounded-lg border ${
                      mapping.is_mapped
                        ? 'bg-gray-700/50 border-gray-600'
                        : 'bg-yellow-500/10 border-yellow-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-medium">
                          {mapping.external_name || mapping.external_username || 'Unknown User'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {mapping.external_email && `Email: ${mapping.external_email} | `}
                          External ID: {mapping.external_user_id}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {mapping.is_mapped ? (
                          <span className="text-sm text-green-400 flex items-center gap-1">
                            <CheckCircle className="w-4 h-4" />
                            Mapped
                            {mapping.auto_mapped && <span className="text-xs">(auto)</span>}
                          </span>
                        ) : (
                          <button className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded">
                            Map User
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-300 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const ExternalTrainingPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabView>('providers');
  const [providers, setProviders] = useState<ExternalTrainingProvider[]>([]);
  const [imports, setImports] = useState<ExternalTrainingImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [mappingsModal, setMappingsModal] = useState<{ isOpen: boolean; providerId: string; providerName: string }>({
    isOpen: false,
    providerId: '',
    providerName: '',
  });

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    setLoading(true);
    try {
      const data = await externalTrainingService.getProviders(false);
      setProviders(data);
    } catch (err) {
      console.error('Failed to load providers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async (providerId: string) => {
    setTestingProvider(providerId);
    try {
      const result = await externalTrainingService.testConnection(providerId);
      // Reload providers to get updated connection status
      await loadProviders();
      if (result.success) {
        alert('Connection successful!');
      } else {
        alert(`Connection failed: ${result.message}`);
      }
    } catch (err: any) {
      alert(`Connection test failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSync = async (providerId: string) => {
    setSyncingProvider(providerId);
    try {
      const result = await externalTrainingService.triggerSync(providerId, { sync_type: 'incremental' });
      alert(result.message || 'Sync initiated. Check sync logs for progress.');
      // Reload providers after a short delay to show updated last_sync_at
      setTimeout(() => loadProviders(), 2000);
    } catch (err: any) {
      alert(`Sync failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSyncingProvider(null);
    }
  };

  const handleEdit = (provider: ExternalTrainingProvider) => {
    // TODO: Implement edit modal
    console.log('Edit provider:', provider);
  };

  const handleDelete = async (providerId: string) => {
    if (!confirm('Are you sure you want to delete this provider? This will also remove all imported records.')) {
      return;
    }
    try {
      await externalTrainingService.deleteProvider(providerId);
      await loadProviders();
    } catch (err: any) {
      alert(`Failed to delete: ${err.response?.data?.detail || err.message}`);
    }
  };

  const handleViewMappings = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId);
    setMappingsModal({
      isOpen: true,
      providerId,
      providerName: provider?.name || 'Provider',
    });
  };

  return (
    <AppLayout>
      <div className="p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">External Training Integrations</h1>
            <p className="text-gray-400 mt-1">
              Connect external training platforms to automatically sync completed training records
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
          >
            <Plus className="w-5 h-5" />
            Add Provider
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 mb-6">
          <button
            onClick={() => setActiveTab('providers')}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'providers'
                ? 'text-red-500 border-b-2 border-red-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Link2 className="w-4 h-4 inline-block mr-2" />
            Providers
          </button>
          <button
            onClick={() => setActiveTab('imports')}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'imports'
                ? 'text-red-500 border-b-2 border-red-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Download className="w-4 h-4 inline-block mr-2" />
            Import Queue
          </button>
          <button
            onClick={() => setActiveTab('mappings')}
            className={`px-4 py-3 text-sm font-medium ${
              activeTab === 'mappings'
                ? 'text-red-500 border-b-2 border-red-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <FolderTree className="w-4 h-4 inline-block mr-2" />
            All Mappings
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <RefreshCw className="w-8 h-8 text-gray-400 animate-spin" />
          </div>
        ) : activeTab === 'providers' ? (
          <div className="grid gap-6 md:grid-cols-2">
            {providers.length === 0 ? (
              <div className="col-span-2 text-center py-12 bg-gray-800 rounded-lg border border-gray-700">
                <Link2 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">No Integrations Yet</h3>
                <p className="text-gray-400 mb-4">
                  Connect an external training platform to start syncing records
                </p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                >
                  <Plus className="w-5 h-5" />
                  Add Provider
                </button>
              </div>
            ) : (
              providers.map(provider => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onTestConnection={handleTestConnection}
                  onSync={handleSync}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onViewMappings={handleViewMappings}
                  isTestingConnection={testingProvider === provider.id}
                  isSyncing={syncingProvider === provider.id}
                />
              ))
            )}
          </div>
        ) : activeTab === 'imports' ? (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
            <Download className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Import Queue</h3>
            <p className="text-gray-400">
              After syncing, pending imports will appear here for review and processing
            </p>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
            <FolderTree className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">All Mappings</h3>
            <p className="text-gray-400">
              View and manage all category and user mappings across providers
            </p>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateProviderModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={loadProviders}
      />
      <MappingsModal
        isOpen={mappingsModal.isOpen}
        onClose={() => setMappingsModal(prev => ({ ...prev, isOpen: false }))}
        providerId={mappingsModal.providerId}
        providerName={mappingsModal.providerName}
      />
    </AppLayout>
  );
};

export default ExternalTrainingPage;
