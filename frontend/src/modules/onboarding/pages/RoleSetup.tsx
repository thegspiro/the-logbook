import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Shield,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Plus,
  X,
  Eye,
  Edit3,
  Crown,
  Star,
  UserCog,
  Briefcase,
  GraduationCap,
  ClipboardList,
  Wrench,
  Info,
  Truck,
  Monitor,
  UserPlus,
  BadgeCheck,
  Megaphone,
  Building2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ProgressIndicator, BackButton, AutoSaveNotification } from '../components';
import { useOnboardingStore } from '../store';
import { MODULE_REGISTRY, type ModuleDefinition } from '../config';
import { apiClient } from '../services/api-client';
import { getErrorMessage } from '@/utils/errorHandling';

/**
 * Build permission categories dynamically from the module registry.
 * This ensures new modules automatically appear in role configuration.
 */
const buildPermissionCategories = (modules: ModuleDefinition[]) => {
  const categories: Record<
    string,
    {
      name: string;
      icon: React.ElementType;
      view: string[];
      manage: string[];
    }
  > = {};

  modules.forEach((module) => {
    categories[module.id] = {
      name: module.name,
      icon: module.icon,
      view: module.permissions.view,
      manage: module.permissions.manage,
    };
  });

  return categories;
};

/**
 * Generate default permissions object with all modules set to specified values.
 */
const generateDefaultPermissions = (
  modules: ModuleDefinition[],
  defaults: { view: boolean; manage: boolean }
): Record<string, { view: boolean; manage: boolean }> => {
  return Object.fromEntries(modules.map((m) => [m.id, { ...defaults }]));
};

/**
 * Generate permissions for a specific role type.
 * This ensures new modules get sensible defaults for each role.
 */
const generateRolePermissions = (
  modules: ModuleDefinition[],
  roleType: 'full_access' | 'leadership' | 'officer' | 'specialist' | 'member' | 'probationary',
  specialties?: string[]
): Record<string, { view: boolean; manage: boolean }> => {
  const permissions: Record<string, { view: boolean; manage: boolean }> = {};

  modules.forEach((module) => {
    switch (roleType) {
      case 'full_access':
        // Full access to everything
        permissions[module.id] = { view: true, manage: true };
        break;
      case 'leadership':
        // Leaders can manage most things except sensitive system modules
        permissions[module.id] = {
          view: true,
          manage: module.id !== 'settings',
        };
        break;
      case 'officer':
        // Officers can view everything, manage their area
        permissions[module.id] = {
          view: true,
          manage: specialties?.includes(module.id) || false,
        };
        break;
      case 'specialist':
        // Specialists have narrow focus
        permissions[module.id] = {
          view: true,
          manage: specialties?.includes(module.id) || false,
        };
        break;
      case 'member':
        // Standard members can view most things
        permissions[module.id] = {
          view: module.category !== 'System',
          manage: false,
        };
        break;
      case 'probationary':
        // Limited view access
        permissions[module.id] = {
          view: ['members', 'events', 'documents', 'training', 'scheduling'].includes(module.id),
          manage: false,
        };
        break;
    }
  });

  return permissions;
};

/**
 * Build role templates dynamically using the module registry.
 * This ensures new modules are included in role permissions automatically.
 */
const buildRoleTemplates = (modules: ModuleDefinition[]) => ({
  administrative: {
    name: 'Administrative',
    description: 'System and IT administration roles',
    roles: [
      {
        id: 'admin',
        name: 'Administrator',
        description: 'Full system access - IT and system administrators',
        icon: Shield,
        priority: 100,
        permissions: generateRolePermissions(modules, 'full_access'),
      },
      {
        id: 'it_administrator',
        name: 'IT Administrator',
        description: 'Manages integrations, notifications, and system settings',
        icon: Monitor,
        priority: 100,
        permissions: generateRolePermissions(modules, 'full_access'),
      },
    ],
  },
  leadership: {
    name: 'Leadership',
    description: 'Executive and operational leadership roles',
    roles: [
      {
        id: 'chief',
        name: 'Chief',
        description: 'Top operational leader of the department',
        icon: Crown,
        priority: 95,
        permissions: generateRolePermissions(modules, 'full_access'),
      },
      {
        id: 'president',
        name: 'President',
        description: 'Top executive leader of the organization',
        icon: Crown,
        priority: 95,
        permissions: generateRolePermissions(modules, 'full_access'),
      },
      {
        id: 'assistant_chief',
        name: 'Assistant Chief',
        description: 'Second in command, supports the Chief',
        icon: Star,
        priority: 90,
        permissions: generateRolePermissions(modules, 'leadership'),
      },
      {
        id: 'vice_president',
        name: 'Vice President',
        description: 'Second in command, supports the President',
        icon: Star,
        priority: 80,
        permissions: generateRolePermissions(modules, 'leadership'),
      },
    ],
  },
  officers: {
    name: 'Officers',
    description: 'Elected or appointed officers with specific duties',
    roles: [
      {
        id: 'secretary',
        name: 'Secretary',
        description: 'Records, communications, and elections',
        icon: Briefcase,
        priority: 75,
        permissions: generateRolePermissions(modules, 'officer', [
          'members',
          'events',
          'documents',
          'elections',
          'minutes',
          'reports',
          'prospective_members',
        ]),
      },
      {
        id: 'assistant_secretary',
        name: 'Assistant Secretary',
        description: 'Assists the secretary with records and communications',
        icon: Briefcase,
        priority: 70,
        permissions: generateRolePermissions(modules, 'officer', [
          'members',
          'events',
          'documents',
          'minutes',
        ]),
      },
      {
        id: 'treasurer',
        name: 'Treasurer',
        description: 'Financial oversight and reporting',
        icon: Briefcase,
        priority: 75,
        permissions: generateRolePermissions(modules, 'officer', ['documents', 'reports']),
      },
      {
        id: 'training_officer',
        name: 'Training Officer',
        description: 'Manages training programs and certifications',
        icon: GraduationCap,
        priority: 65,
        permissions: generateRolePermissions(modules, 'specialist', [
          'training',
          'events',
          'documents',
        ]),
      },
      {
        id: 'safety_officer',
        name: 'Safety Officer',
        description: 'Safety compliance and oversight',
        icon: Shield,
        priority: 65,
        permissions: generateRolePermissions(modules, 'specialist', [
          'training',
          'events',
          'documents',
          'inventory',
          'reports',
          'forms',
        ]),
      },
      {
        id: 'officers',
        name: 'Officers',
        description: 'General officer role with broad operational access',
        icon: BadgeCheck,
        priority: 70,
        permissions: generateRolePermissions(modules, 'officer', [
          'members',
          'events',
          'documents',
          'inventory',
          'scheduling',
          'reports',
          'forms',
        ]),
      },
    ],
  },
  support: {
    name: 'Support Roles',
    description: 'Specialized support and operational roles',
    roles: [
      {
        id: 'quartermaster',
        name: 'Quartermaster',
        description: 'Equipment and inventory management',
        icon: Wrench,
        priority: 85,
        permissions: generateRolePermissions(modules, 'specialist', ['inventory']),
      },
      {
        id: 'scheduling_officer',
        name: 'Scheduling Officer',
        description: 'Manages duty rosters and shift scheduling',
        icon: ClipboardList,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', ['scheduling']),
      },
      {
        id: 'public_outreach_coordinator',
        name: 'Public Outreach Coordinator',
        description: 'Community events and public education',
        icon: Users,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', ['events', 'documents']),
      },
      {
        id: 'communications_officer',
        name: 'Communications Officer',
        description: 'Website, social media, newsletters, and notification management',
        icon: Megaphone,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', [
          'notifications',
          'mobile',
          'events',
          'documents',
        ]),
      },
      {
        id: 'apparatus_manager',
        name: 'Apparatus Manager',
        description: 'Day-to-day fleet tracking, maintenance logging, and equipment checks',
        icon: Truck,
        priority: 50,
        permissions: generateRolePermissions(modules, 'specialist', ['apparatus', 'inventory']),
      },
      {
        id: 'membership_coordinator',
        name: 'Membership Coordinator',
        description: 'Manages member records, applications, and onboarding/offboarding',
        icon: UserPlus,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', ['members', 'prospective_members']),
      },
      {
        id: 'meeting_hall_coordinator',
        name: 'Meeting Hall Coordinator',
        description: 'Manages meeting hall and location bookings',
        icon: ClipboardList,
        priority: 60,
        permissions: generateRolePermissions(modules, 'specialist', ['events', 'scheduling']),
      },
      {
        id: 'facilities_manager',
        name: 'Facilities Manager',
        description: 'Day-to-day building management, maintenance logging, and inspections',
        icon: Building2,
        priority: 50,
        permissions: generateRolePermissions(modules, 'specialist', ['inventory']),
      },
    ],
  },
  members: {
    name: 'Member Roles',
    description: 'Standard member access level',
    roles: [
      {
        id: 'member',
        name: 'Member',
        description: 'Regular department member',
        icon: Users,
        priority: 10,
        permissions: generateRolePermissions(modules, 'member'),
      },
    ],
  },
});

// Icon lookup map for serialization/deserialization
const ICON_MAP: Record<string, React.ElementType> = {
  Shield, Crown, Star, Briefcase, GraduationCap, ClipboardList, Wrench, Users, UserCog,
  Truck, Monitor, UserPlus, BadgeCheck, Megaphone, Building2,
};

const getIconName = (icon: React.ElementType): string => {
  for (const [name, component] of Object.entries(ICON_MAP)) {
    if (component === icon) return name;
  }
  return 'UserCog';
};

interface RoleConfig {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  priority: number;
  permissions: Record<string, { view: boolean; manage: boolean }>;
  isCustom?: boolean;
}

const RoleSetup: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const lastSaved = useOnboardingStore(state => state.lastSaved);
  const savedRolesConfig = useOnboardingStore(state => state.rolesConfig);
  const setRolesConfig = useOnboardingStore(state => state.setRolesConfig);

  // Build permission categories and role templates from the module registry
  // This ensures new modules automatically appear in role configuration
  const permissionCategories = useMemo(() => buildPermissionCategories(MODULE_REGISTRY), []);
  const roleTemplates = useMemo(() => buildRoleTemplates(MODULE_REGISTRY), []);

  // Selected roles - restore from Zustand store if available, otherwise use defaults
  const [selectedRoles, setSelectedRoles] = useState<Record<string, RoleConfig>>(() => {
    // Restore from persisted store if available
    if (savedRolesConfig) {
      const restored: Record<string, RoleConfig> = {};
      for (const [roleId, saved] of Object.entries(savedRolesConfig)) {
        restored[roleId] = {
          ...saved,
          icon: ICON_MAP[saved.icon || 'UserCog'] || UserCog,
        };
      }
      return restored;
    }

    // Build templates for initial state
    const templates = buildRoleTemplates(MODULE_REGISTRY);

    // Pre-select essential roles (admin, chief, secretary, training_officer, member)
    const initial: Record<string, RoleConfig> = {};
    ['admin', 'chief', 'secretary', 'training_officer', 'member'].forEach(roleId => {
      Object.values(templates).forEach(category => {
        const role = category.roles.find(r => r.id === roleId);
        if (role) {
          initial[roleId] = { ...role };
        }
      });
    });
    return initial;
  });

  // Expanded categories
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['administrative', 'leadership', 'officers']);

  // Role being edited
  const [editingRole, setEditingRole] = useState<string | null>(null);

  // Custom role modal
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customRoleName, setCustomRoleName] = useState('');
  const [customRoleDescription, setCustomRoleDescription] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  // Persist role changes to Zustand store (survives navigation)
  useEffect(() => {
    const serializable: Record<string, any> = {};
    for (const [roleId, role] of Object.entries(selectedRoles)) {
      serializable[roleId] = {
        id: role.id,
        name: role.name,
        description: role.description,
        icon: getIconName(role.icon),
        priority: role.priority,
        permissions: role.permissions,
        isCustom: role.isCustom,
      };
    }
    setRolesConfig(serializable);
  }, [selectedRoles, setRolesConfig]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(c => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  const toggleRole = (role: RoleConfig) => {
    if (role.id === 'admin') return; // Admin cannot be removed

    setSelectedRoles(prev => {
      if (prev[role.id]) {
        const { [role.id]: removed, ...rest } = prev;
        return rest;
      } else {
        return { ...prev, [role.id]: { ...role } };
      }
    });
  };

  const updateRolePermission = (roleId: string, category: string, type: 'view' | 'manage', value: boolean) => {
    if (roleId === 'admin') return; // Admin always has all permissions

    setSelectedRoles(prev => ({
      ...prev,
      [roleId]: {
        ...prev[roleId],
        permissions: {
          ...prev[roleId].permissions,
          [category]: {
            ...prev[roleId].permissions[category],
            [type]: value,
            // If manage is enabled, view must be enabled too
            ...(type === 'manage' && value ? { view: true } : {}),
            // If view is disabled, manage must be disabled too
            ...(type === 'view' && !value ? { manage: false } : {}),
          },
        },
      },
    }));
  };

  const createCustomRole = () => {
    if (!customRoleName.trim()) {
      toast.error('Please enter a role name');
      return;
    }

    const roleId = customRoleName.toLowerCase().replace(/\s+/g, '_');

    if (selectedRoles[roleId]) {
      toast.error('A role with this name already exists');
      return;
    }

    // Use registry to generate permissions for all modules
    const newRole: RoleConfig = {
      id: roleId,
      name: customRoleName,
      description: customRoleDescription || 'Custom role',
      icon: UserCog,
      priority: 50,
      isCustom: true,
      permissions: generateDefaultPermissions(MODULE_REGISTRY, { view: true, manage: false }),
    };

    setSelectedRoles(prev => ({ ...prev, [roleId]: newRole }));
    setCustomRoleName('');
    setCustomRoleDescription('');
    setShowCustomModal(false);
    setEditingRole(roleId);
    toast.success(`Created custom role: ${customRoleName}`);
  };

  const handleContinue = async () => {
    // Verify organization was created first
    if (!departmentName) {
      toast.error('Please complete organization setup first');
      navigate('/onboarding/start');
      return;
    }

    setIsSaving(true);

    try {
      // Convert selected roles to API format
      const rolesPayload = Object.values(selectedRoles).map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        priority: role.priority,
        permissions: role.permissions,
        is_custom: role.isCustom || false,
      }));

      const response = await apiClient.saveRolesConfig({ roles: rolesPayload });

      if (response.error) {
        toast.error(response.error);
        setIsSaving(false);
        return;
      }

      toast.success(
        `Roles configured successfully! Created: ${response.data?.created?.length || 0}, Updated: ${response.data?.updated?.length || 0}`
      );
      navigate('/onboarding/modules');
    } catch (error: unknown) {
      // Show specific error message from backend
      const errorMessage = getErrorMessage(error, 'Failed to save role configuration. Please try again.');
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCount = Object.keys(selectedRoles).length;
  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col">
      <header className="bg-theme-nav-bg backdrop-blur-sm border-b border-theme-nav-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center">
          {logoPreview ? (
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center overflow-hidden mr-4">
              <img src={logoPreview} alt={`${departmentName} logo`} className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center mr-4">
              <Shield className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
          )}
          <div>
            <h1 className="text-theme-text-primary text-lg font-semibold">{departmentName}</h1>
            <p className="text-theme-text-muted text-sm">Setup in Progress</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 py-8">
        <div className="max-w-6xl w-full mx-auto">
          <BackButton to="/onboarding/it-team" className="mb-6" />

          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-full mb-4">
              <Users className="w-8 h-8 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-theme-text-primary mb-3">
              Set Up Roles & Permissions
            </h1>
            <p className="text-xl text-theme-text-secondary mb-2">
              Choose which roles your organization needs
            </p>
            <p className="text-sm text-theme-text-muted max-w-2xl mx-auto">
              Select from common fire department roles or create your own. Each role determines what members can view and manage.
            </p>
          </div>

          {/* Info Banners */}
          <div className="space-y-4 mb-6">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <div className="flex items-start">
                <Info className="w-5 h-5 text-blue-400 mt-0.5 mr-3 flex-shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-blue-400 font-semibold mb-1">How Permissions Work</p>
                  <p className="text-slate-300 text-sm">
                    Each role has <strong className="text-green-400">View</strong> (see content) and{' '}
                    <strong className="text-orange-400">Manage</strong> (create/edit/delete) permissions per module.
                    Click on a selected role to customize its permissions.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <div className="flex items-start">
                <CheckCircle className="w-5 h-5 text-green-400 mt-0.5 mr-3 flex-shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-green-400 font-semibold mb-1">Don't Worry - You Can Change These Later</p>
                  <p className="text-slate-300 text-sm">
                    Roles and permissions can be updated anytime in <strong>Settings → Roles & Permissions</strong>.
                    You can add new roles, modify permissions, or remove roles as your organization's needs evolve.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center space-x-4">
              <div className="text-theme-text-primary">
                <span className="text-2xl font-bold">{selectedCount}</span>
                <span className="text-theme-text-muted ml-2">roles selected</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCustomModal(true)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Create Custom Role
              </button>
              <button
                onClick={handleContinue}
                disabled={isSaving || selectedCount < 2}
                className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                  selectedCount >= 2 && !isSaving
                    ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white'
                    : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isSaving ? 'Saving...' : 'Continue to Modules'}
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Left: Role Templates */}
            <div className="space-y-4">
              <h2 className="text-theme-text-primary font-bold text-lg mb-4">Available Role Templates</h2>

              {Object.entries(roleTemplates).map(([categoryId, category]) => (
                <div key={categoryId} className="bg-white/5 rounded-lg border border-theme-surface-border overflow-hidden">
                  <button
                    onClick={() => toggleCategory(categoryId)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
                  >
                    <div>
                      <h3 className="text-theme-text-primary font-semibold">{category.name}</h3>
                      <p className="text-theme-text-muted text-sm">{category.description}</p>
                    </div>
                    {expandedCategories.includes(categoryId) ? (
                      <ChevronDown className="w-5 h-5 text-slate-400" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-400" aria-hidden="true" />
                    )}
                  </button>

                  {expandedCategories.includes(categoryId) && (
                    <div className="px-4 pb-4 space-y-2">
                      {category.roles.map(role => {
                        const isSelected = !!selectedRoles[role.id];
                        const Icon = role.icon;

                        return (
                          <div
                            key={role.id}
                            className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${
                              isSelected
                                ? 'border-green-500 bg-green-500/10'
                                : 'border-slate-600 hover:border-slate-500'
                            }`}
                            onClick={() => toggleRole(role)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRole(role); } }}
                            tabIndex={0}
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-label={`${role.name} - ${role.description}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                  isSelected ? 'bg-green-600' : 'bg-slate-700'
                                }`}>
                                  <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                                </div>
                                <div>
                                  <p className={`font-semibold ${isSelected ? 'text-green-400' : 'text-theme-text-primary'}`}>
                                    {role.name}
                                  </p>
                                  <p className="text-theme-text-muted text-xs">{role.description}</p>
                                </div>
                              </div>
                              {isSelected && (
                                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" aria-hidden="true" />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Right: Selected Roles & Permissions */}
            <div>
              <h2 className="text-theme-text-primary font-bold text-lg mb-4">Selected Roles & Permissions</h2>

              <div className="space-y-3">
                {Object.values(selectedRoles)
                  .sort((a, b) => b.priority - a.priority)
                  .map(role => {
                    const Icon = role.icon;
                    const isEditing = editingRole === role.id;
                    const isAdmin = role.id === 'admin';

                    return (
                      <div
                        key={role.id}
                        className={`bg-theme-surface rounded-lg border transition-all ${
                          isEditing ? 'border-orange-500' : 'border-theme-surface-border'
                        }`}
                      >
                        <div
                          className="p-4 flex items-center justify-between cursor-pointer"
                          onClick={() => setEditingRole(isEditing ? null : role.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingRole(isEditing ? null : role.id); } }}
                          tabIndex={0}
                          role="button"
                          aria-expanded={isEditing}
                          aria-label={`${role.name} - click to ${isEditing ? 'collapse' : 'expand'} permissions`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              isAdmin ? 'bg-purple-600' : role.isCustom ? 'bg-blue-600' : 'bg-green-600'
                            }`}>
                              <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-theme-text-primary font-semibold">{role.name}</p>
                                {isAdmin && (
                                  <span className="text-xs bg-purple-500/30 text-purple-300 px-2 py-0.5 rounded">
                                    System
                                  </span>
                                )}
                                {role.isCustom && (
                                  <span className="text-xs bg-blue-500/30 text-blue-300 px-2 py-0.5 rounded">
                                    Custom
                                  </span>
                                )}
                              </div>
                              <p className="text-theme-text-muted text-xs">{role.description}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!isAdmin && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleRole(role);
                                }}
                                className="p-1 hover:bg-red-500/20 rounded text-slate-400 hover:text-red-400 transition-colors"
                                aria-label={`Remove ${role.name} role`}
                              >
                                <X className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}
                            {isEditing ? (
                              <ChevronDown className="w-5 h-5 text-orange-400" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-slate-400" aria-hidden="true" />
                            )}
                          </div>
                        </div>

                        {/* Expanded permissions editor */}
                        {isEditing && (
                          <div className="px-4 pb-4 border-t border-theme-nav-border pt-4">
                            <p className="text-theme-text-muted text-sm mb-3">
                              {isAdmin
                                ? 'Administrator has full access to all features.'
                                : 'Click to toggle permissions for each module:'}
                            </p>
                            <div className="grid grid-cols-1 gap-2">
                              {Object.entries(permissionCategories).map(([catId, cat]) => {
                                const perms = role.permissions[catId] || { view: false, manage: false };

                                return (
                                  <div
                                    key={catId}
                                    className="flex items-center justify-between py-2 px-3 bg-theme-surface-secondary rounded"
                                  >
                                    <span className="text-theme-text-secondary text-sm">{cat.name}</span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => updateRolePermission(role.id, catId, 'view', !perms.view)}
                                        disabled={isAdmin}
                                        aria-label={`${perms.view ? 'Disable' : 'Enable'} view permission for ${cat.name}`}
                                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                                          perms.view
                                            ? 'bg-green-500/20 text-green-400'
                                            : 'bg-slate-700 text-slate-500'
                                        } ${isAdmin ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
                                      >
                                        <Eye className="w-3 h-3" aria-hidden="true" />
                                        View
                                      </button>
                                      <button
                                        onClick={() => updateRolePermission(role.id, catId, 'manage', !perms.manage)}
                                        disabled={isAdmin}
                                        aria-label={`${perms.manage ? 'Disable' : 'Enable'} manage permission for ${cat.name}`}
                                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                                          perms.manage
                                            ? 'bg-orange-500/20 text-orange-400'
                                            : 'bg-slate-700 text-slate-500'
                                        } ${isAdmin ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
                                      >
                                        <Edit3 className="w-3 h-3" aria-hidden="true" />
                                        Manage
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Progress */}
          <div className="mt-8 bg-theme-surface backdrop-blur-sm rounded-lg p-6 border border-theme-surface-border">
            <ProgressIndicator currentStep={8} totalSteps={10} />
            <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
          </div>
        </div>
      </main>

      {/* Custom Role Modal */}
      {showCustomModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="custom-role-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowCustomModal(false); }}
        >
          <div className="bg-theme-surface-modal rounded-lg p-6 max-w-md w-full border border-theme-surface-border">
            <h3 id="custom-role-modal-title" className="text-theme-text-primary font-bold text-xl mb-4">Create Custom Role</h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="custom-role-name" className="block text-sm font-semibold text-theme-text-secondary mb-2">
                  Role Name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="custom-role-name"
                  type="text"
                  value={customRoleName}
                  onChange={(e) => setCustomRoleName(e.target.value)}
                  placeholder="e.g., Social Media Manager"
                  required
                  aria-required="true"
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div>
                <label htmlFor="custom-role-description" className="block text-sm font-semibold text-theme-text-secondary mb-2">
                  Description
                </label>
                <input
                  id="custom-role-description"
                  type="text"
                  value={customRoleDescription}
                  onChange={(e) => setCustomRoleDescription(e.target.value)}
                  placeholder="Brief description of this role"
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCustomModal(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createCustomRole}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white rounded-lg font-semibold transition-colors"
              >
                Create Role
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="bg-theme-nav-bg backdrop-blur-sm border-t border-theme-nav-border px-6 py-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-theme-text-secondary text-sm">© {currentYear} {departmentName}. All rights reserved.</p>
          <p className="text-slate-500 text-xs mt-1">Powered by The Logbook</p>
        </div>
      </footer>
    </div>
  );
};

export default RoleSetup;
