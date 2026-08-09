import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Eye, Edit3, Shield, Users, CheckCircle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { getModuleById } from '../config';
import { ThemeToggle } from '../components';
import { useOnboardingStore } from '../store';

/**
 * Module Configuration Template with Two-Tier Permissions
 *
 * View Access: Who can see/use the module (typically all members)
 * Manage Access: Who can create/edit/delete content (specific roles)
 */
const ModuleConfigTemplate: React.FC = () => {
  const navigate = useNavigate();
  const { moduleId } = useParams<{ moduleId: string }>();
  const [saving, setSaving] = useState(false);

  // Get module config from the central registry
  // Normalize hyphens to underscores so URL slugs like "prospective-members" match registry IDs like "prospective_members"
  const normalizedModuleId = moduleId?.replace(/-/g, '_');
  const config = useMemo(
    () => (normalizedModuleId ? getModuleById(normalizedModuleId) : undefined),
    [normalizedModuleId]
  );
  const moduleName = config?.name || 'Module';
  const departmentName = useOnboardingStore((state) => state.departmentName);

  // Guard: redirect if org setup hasn't been completed or module ID is invalid
  useEffect(() => {
    if (!departmentName) {
      void navigate('/onboarding/start');
    } else if (!config) {
      void navigate('/onboarding/modules');
    }
  }, [departmentName, config, navigate]);

  // Read positions from the onboarding store (set during PositionSetup step)
  const positionsConfig = useOnboardingStore((state) => state.positionsConfig);
  const modulePermissionConfigs = useOnboardingStore((state) => state.modulePermissionConfigs);
  const setModulePermissionConfig = useOnboardingStore((state) => state.setModulePermissionConfig);

  // Build available positions dynamically from what was configured in the Positions step
  const availablePositions = useMemo(() => {
    if (!positionsConfig || Object.keys(positionsConfig).length === 0) {
      // Fallback if positions haven't been configured yet
      return [
        { id: 'it_manager', name: 'IT Manager', description: 'System Owner - full access' },
        { id: 'member', name: 'Member', description: 'Standard member access' },
      ];
    }

    return Object.values(positionsConfig)
      .sort((a, b) => b.priority - a.priority)
      .map((pos) => ({
        id: pos.id,
        name: pos.name,
        description: pos.description,
      }));
  }, [positionsConfig]);

  // Restore previously saved manage positions for this module, or use defaults.
  // Filter out any positions that were removed since the config was saved.
  const availablePositionIds = useMemo(() => new Set(availablePositions.map((p) => p.id)), [availablePositions]);
  const [managePositions, setManagePositions] = useState<string[]>(() => {
    if (normalizedModuleId && modulePermissionConfigs[normalizedModuleId]) {
      return modulePermissionConfigs[normalizedModuleId].filter((id) => availablePositionIds.has(id));
    }
    return config?.permissions.defaultManagePositions || ['it_manager'];
  });

  const togglePosition = (positionId: string) => {
    if (positionId === 'it_manager') return; // System Owner always has manage access
    setManagePositions((prev) =>
      prev.includes(positionId) ? prev.filter((p) => p !== positionId) : [...prev, positionId]
    );
  };

  const handleSave = () => {
    if (!normalizedModuleId) return;
    setSaving(true);
    setModulePermissionConfig(normalizedModuleId, managePositions);
    toast.success(`${moduleName} permissions configured!`);
    setSaving(false);
    void navigate('/onboarding/modules');
  };

  const handleSkip = () => {
    void navigate('/onboarding/modules');
  };

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-pt-8 relative min-h-screen bg-linear-to-br p-4 pb-8">
      <ThemeToggle className="absolute top-4 right-4" />
      <div className="mx-auto w-full max-w-4xl">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={handleSkip}
            className="text-theme-text-muted hover:text-theme-text-primary mb-4 flex items-center transition-colors"
          >
            <ArrowLeft aria-hidden="true" className="mr-2 h-5 w-5" />
            Back to Modules
          </button>
          <h1 className="text-theme-text-primary mb-2 text-4xl font-bold">Configure {moduleName}</h1>
          <p className="text-theme-text-secondary">Set up who can view and who can manage this module</p>
        </div>

        {/* Two-Tier Permission Model Explanation */}
        <div className="alert-info mb-6">
          <div className="flex items-start">
            <Info aria-hidden="true" className="text-theme-alert-info-icon mt-0.5 mr-3 h-5 w-5 shrink-0" />
            <div>
              <p className="text-theme-alert-info-title mb-1 font-semibold">How Permissions Work</p>
              <p className="text-theme-text-secondary text-sm">
                <strong>View Access</strong> allows members to see and use basic features.{' '}
                <strong>Manage Access</strong> allows creating, editing, and administrative actions. All members can
                view by default; you choose who can manage.
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6 grid gap-6 md:grid-cols-2">
          {/* View Access Card */}
          <div className="bg-theme-surface border-theme-alert-success-border rounded-lg border p-6 backdrop-blur-xs">
            <div className="mb-4 flex items-center">
              <div className="mr-4 flex h-12 w-12 items-center justify-center rounded-lg bg-green-600">
                <Eye aria-hidden="true" className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-theme-text-primary text-lg font-bold">View Access</h2>
                <p className="text-theme-alert-success-icon text-sm">All Members</p>
              </div>
            </div>
            <p className="text-theme-text-secondary mb-4 text-sm">{config?.permissions.viewDescription}</p>
            <div className="bg-theme-surface-secondary rounded-lg p-4">
              <p className="text-theme-text-muted mb-2 text-xs font-semibold uppercase">What members can do:</p>
              <ul className="space-y-2">
                {config?.permissions.view.map((perm, idx) => (
                  <li key={idx} className="text-theme-text-secondary flex items-center text-sm">
                    <CheckCircle aria-hidden="true" className="text-theme-accent-green mr-2 h-4 w-4 shrink-0" />
                    {perm}
                  </li>
                ))}
              </ul>
            </div>
            <div className="text-theme-text-muted mt-4 flex items-center text-xs">
              <Users aria-hidden="true" className="mr-2 h-4 w-4" />
              Applies to all active members automatically
            </div>
          </div>

          {/* Manage Access Card */}
          <div className="bg-theme-surface border-theme-alert-warning-border rounded-lg border p-6 backdrop-blur-xs">
            <div className="mb-4 flex items-center">
              <div className="mr-4 flex h-12 w-12 items-center justify-center rounded-lg bg-orange-600">
                <Edit3 aria-hidden="true" className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-theme-text-primary text-lg font-bold">Manage Access</h2>
                <p className="text-theme-accent-orange text-sm">Selected Positions Only</p>
              </div>
            </div>
            <p className="text-theme-text-secondary mb-4 text-sm">{config?.permissions.manageDescription}</p>
            <div className="bg-theme-surface-secondary rounded-lg p-4">
              <p className="text-theme-text-muted mb-2 text-xs font-semibold uppercase">What managers can do:</p>
              <ul className="space-y-2">
                {config?.permissions.manage.map((perm, idx) => (
                  <li key={idx} className="text-theme-text-secondary flex items-center text-sm">
                    <Shield aria-hidden="true" className="text-theme-accent-orange mr-2 h-4 w-4 shrink-0" />
                    {perm}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Position Selection */}
        <div className="card mb-6 p-6">
          <h3 className="text-theme-text-primary mb-2 text-lg font-bold">Who Can Manage {moduleName}?</h3>
          <p className="text-theme-text-muted mb-4 text-sm">
            Select which positions should have management permissions. The System Owner (IT Manager) always has full
            access.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {availablePositions.map((pos) => {
              const isSelected = managePositions.includes(pos.id);
              const isSystemOwner = pos.id === 'it_manager';

              return (
                <button
                  key={pos.id}
                  onClick={() => togglePosition(pos.id)}
                  disabled={isSystemOwner}
                  className={`rounded-lg border-2 p-4 text-left transition-all ${
                    isSelected
                      ? 'border-theme-accent-orange bg-theme-accent-orange-muted'
                      : 'border-theme-surface-border bg-theme-surface-secondary hover:border-theme-surface-hover'
                  } ${isSystemOwner ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={`font-semibold ${isSelected ? 'text-theme-accent-orange' : 'text-theme-text-primary'}`}
                    >
                      {pos.name}
                    </span>
                    {isSelected && <CheckCircle aria-hidden="true" className="text-theme-accent-orange h-5 w-5" />}
                  </div>
                  <p className="text-theme-text-muted text-xs">{pos.description}</p>
                  {isSystemOwner && <p className="text-theme-accent-orange mt-1 text-xs italic">Always has access</p>}
                </button>
              );
            })}
          </div>

          <div className="bg-theme-surface-secondary mt-4 rounded-lg p-3">
            <p className="text-theme-text-muted text-sm">
              <strong className="text-theme-text-primary">Selected positions:</strong>{' '}
              {managePositions
                .map((p) => availablePositions.find((ap) => ap.id === p)?.name)
                .filter(Boolean)
                .join(', ')}
            </p>
          </div>
        </div>

        {/* Quick Tips */}
        <div className="bg-theme-surface-secondary border-theme-input-border mb-6 rounded-lg border p-4">
          <h3 className="text-theme-text-primary mb-2 font-semibold">Quick Tips</h3>
          <ul className="text-theme-text-secondary space-y-2 text-sm">
            <li className="flex items-start">
              <span className="text-theme-accent-green mr-2">•</span>
              <span>You can change these permissions anytime in Settings → Permissions</span>
            </li>
            <li className="flex items-start">
              <span className="text-theme-accent-green mr-2">•</span>
              <span>Individual users can be granted additional permissions beyond their position</span>
            </li>
            <li className="flex items-start">
              <span className="text-theme-accent-green mr-2">•</span>
              <span>Some modules have sub-permissions you can configure in detail later</span>
            </li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-linear-to-r from-red-600 to-orange-600 px-6 py-3 font-semibold text-white transition-all hover:from-red-700 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Permissions'}
          </button>
          <button
            onClick={handleSkip}
            className="border-theme-surface-border hover:border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary rounded-lg border bg-transparent px-6 py-3 font-semibold transition-all sm:w-auto"
          >
            Use Defaults
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModuleConfigTemplate;
