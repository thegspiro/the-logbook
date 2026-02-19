import React, { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  const config = useMemo(() => (moduleId ? getModuleById(moduleId) : undefined), [moduleId]);
  const moduleName = config?.name || 'Module';

  // Read roles from the onboarding store (set during RoleSetup step)
  const rolesConfig = useOnboardingStore(state => state.rolesConfig);
  const modulePermissionConfigs = useOnboardingStore(state => state.modulePermissionConfigs);
  const setModulePermissionConfig = useOnboardingStore(state => state.setModulePermissionConfig);

  // Build available roles dynamically from what was configured in the Roles step
  const availableRoles = useMemo(() => {
    if (!rolesConfig || Object.keys(rolesConfig).length === 0) {
      // Fallback if roles haven't been configured yet
      return [
        { id: 'admin', name: 'Administrator', description: 'Full system access' },
        { id: 'member', name: 'Member', description: 'Standard member access' },
      ];
    }

    return Object.values(rolesConfig)
      .sort((a, b) => b.priority - a.priority)
      .map(role => ({
        id: role.id,
        name: role.name,
        description: role.description,
      }));
  }, [rolesConfig]);

  // Restore previously saved manage roles for this module, or use defaults.
  // Filter out any roles that were removed since the config was saved.
  const availableRoleIds = useMemo(() => new Set(availableRoles.map(r => r.id)), [availableRoles]);
  const [manageRoles, setManageRoles] = useState<string[]>(() => {
    if (moduleId && modulePermissionConfigs[moduleId]) {
      return modulePermissionConfigs[moduleId].filter(id => availableRoleIds.has(id));
    }
    return config?.permissions.defaultManageRoles || ['admin'];
  });

  const toggleRole = (roleId: string) => {
    if (roleId === 'admin') return; // Admin always has manage access
    setManageRoles(prev =>
      prev.includes(roleId)
        ? prev.filter(r => r !== roleId)
        : [...prev, roleId]
    );
  };

  const handleSave = () => {
    if (!moduleId) return;
    setSaving(true);
    setModulePermissionConfig(moduleId, manageRoles);
    toast.success(`${moduleName} permissions configured!`);
    setSaving(false);
    navigate('/onboarding/modules');
  };

  const handleSkip = () => {
    navigate('/onboarding/modules');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to p-4 py-8 relative">
      <ThemeToggle className="absolute top-4 right-4" />
      <div className="max-w-4xl w-full mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={handleSkip}
            className="flex items-center text-theme-text-muted hover:text-theme-text-primary transition-colors mb-4"
          >
            <ArrowLeft aria-hidden="true" className="w-5 h-5 mr-2" />
            Back to Modules
          </button>
          <h1 className="text-4xl font-bold text-theme-text-primary mb-2">
            Configure {moduleName}
          </h1>
          <p className="text-theme-text-secondary">
            Set up who can view and who can manage this module
          </p>
        </div>

        {/* Two-Tier Permission Model Explanation */}
        <div className="alert-info mb-6">
          <div className="flex items-start">
            <Info aria-hidden="true" className="w-5 h-5 text-theme-alert-info-icon mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <p className="text-theme-alert-info-title font-semibold mb-1">How Permissions Work</p>
              <p className="text-theme-text-secondary text-sm">
                <strong>View Access</strong> allows members to see and use basic features.{' '}
                <strong>Manage Access</strong> allows creating, editing, and administrative actions.
                All members can view by default; you choose who can manage.
              </p>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* View Access Card */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-alert-success-border">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center mr-4">
                <Eye aria-hidden="true" className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-theme-text-primary font-bold text-lg">View Access</h2>
                <p className="text-theme-alert-success-icon text-sm">All Members</p>
              </div>
            </div>
            <p className="text-theme-text-secondary text-sm mb-4">{config?.permissions.viewDescription}</p>
            <div className="bg-theme-surface-secondary rounded-lg p-4">
              <p className="text-theme-text-muted text-xs font-semibold mb-2 uppercase">What members can do:</p>
              <ul className="space-y-2">
                {config?.permissions.view.map((perm, idx) => (
                  <li key={idx} className="flex items-center text-theme-text-secondary text-sm">
                    <CheckCircle aria-hidden="true" className="w-4 h-4 text-theme-accent-green mr-2 flex-shrink-0" />
                    {perm}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 flex items-center text-theme-text-muted text-xs">
              <Users aria-hidden="true" className="w-4 h-4 mr-2" />
              Applies to all active members automatically
            </div>
          </div>

          {/* Manage Access Card */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-alert-warning-border">
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-orange-600 rounded-lg flex items-center justify-center mr-4">
                <Edit3 aria-hidden="true" className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-theme-text-primary font-bold text-lg">Manage Access</h2>
                <p className="text-theme-accent-orange text-sm">Selected Roles Only</p>
              </div>
            </div>
            <p className="text-theme-text-secondary text-sm mb-4">{config?.permissions.manageDescription}</p>
            <div className="bg-theme-surface-secondary rounded-lg p-4">
              <p className="text-theme-text-muted text-xs font-semibold mb-2 uppercase">What managers can do:</p>
              <ul className="space-y-2">
                {config?.permissions.manage.map((perm, idx) => (
                  <li key={idx} className="flex items-center text-theme-text-secondary text-sm">
                    <Shield aria-hidden="true" className="w-4 h-4 text-theme-accent-orange mr-2 flex-shrink-0" />
                    {perm}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Role Selection */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border mb-6">
          <h3 className="text-theme-text-primary font-bold text-lg mb-2">Who Can Manage {moduleName}?</h3>
          <p className="text-theme-text-muted text-sm mb-4">
            Select which roles should have management permissions. Administrators always have full access.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {availableRoles.map(role => {
              const isSelected = manageRoles.includes(role.id);
              const isAdmin = role.id === 'admin';

              return (
                <button
                  key={role.id}
                  onClick={() => toggleRole(role.id)}
                  disabled={isAdmin}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    isSelected
                      ? 'border-theme-accent-orange bg-theme-accent-orange-muted'
                      : 'border-theme-surface-border bg-theme-surface-secondary hover:border-theme-surface-hover'
                  } ${isAdmin ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold ${isSelected ? 'text-theme-accent-orange' : 'text-theme-text-primary'}`}>
                      {role.name}
                    </span>
                    {isSelected && (
                      <CheckCircle aria-hidden="true" className="w-5 h-5 text-theme-accent-orange" />
                    )}
                  </div>
                  <p className="text-theme-text-muted text-xs">{role.description}</p>
                  {isAdmin && (
                    <p className="text-theme-accent-orange text-xs mt-1 italic">Always has access</p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 p-3 bg-theme-surface-secondary rounded-lg">
            <p className="text-theme-text-muted text-sm">
              <strong className="text-theme-text-primary">Selected roles:</strong>{' '}
              {manageRoles.map(r => availableRoles.find(ar => ar.id === r)?.name).filter(Boolean).join(', ')}
            </p>
          </div>
        </div>

        {/* Quick Tips */}
        <div className="bg-theme-surface-secondary rounded-lg p-4 border border-theme-input-border mb-6">
          <h3 className="text-theme-text-primary font-semibold mb-2">Quick Tips</h3>
          <ul className="text-theme-text-secondary text-sm space-y-2">
            <li className="flex items-start">
              <span className="text-theme-accent-green mr-2">•</span>
              <span>You can change these permissions anytime in Settings → Permissions</span>
            </li>
            <li className="flex items-start">
              <span className="text-theme-accent-green mr-2">•</span>
              <span>Individual users can be granted additional permissions beyond their role</span>
            </li>
            <li className="flex items-start">
              <span className="text-theme-accent-green mr-2">•</span>
              <span>Some modules have sub-permissions you can configure in detail later</span>
            </li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Permissions'}
          </button>
          <button
            onClick={handleSkip}
            className="sm:w-auto px-6 py-3 bg-transparent border border-theme-surface-border hover:border-slate-400 text-theme-text-secondary hover:text-theme-text-primary rounded-lg font-semibold transition-all"
          >
            Use Defaults
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModuleConfigTemplate;
