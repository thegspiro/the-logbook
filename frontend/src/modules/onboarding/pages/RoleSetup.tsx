import React, { useState } from 'react';
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ProgressIndicator, BackButton, AutoSaveNotification } from '../components';
import { useOnboardingStore } from '../store';

// Permission categories with View/Manage distinction
const permissionCategories = {
  members: {
    name: 'Member Management',
    icon: Users,
    view: ['View member directory', 'See contact info', 'View profiles'],
    manage: ['Add/edit members', 'Manage status', 'Import/export'],
  },
  roles: {
    name: 'Role Management',
    icon: Shield,
    view: ['View roles', 'See role assignments'],
    manage: ['Create/edit roles', 'Assign roles', 'Set permissions'],
  },
  events: {
    name: 'Events & Attendance',
    icon: ClipboardList,
    view: ['View events', 'RSVP', 'Check-in'],
    manage: ['Create events', 'Manage RSVPs', 'Override attendance'],
  },
  documents: {
    name: 'Documents & Files',
    icon: ClipboardList,
    view: ['Browse documents', 'Download files'],
    manage: ['Upload files', 'Create folders', 'Set visibility'],
  },
  training: {
    name: 'Training & Certifications',
    icon: GraduationCap,
    view: ['View training records', 'See courses'],
    manage: ['Create courses', 'Record completions', 'Set requirements'],
  },
  inventory: {
    name: 'Equipment & Inventory',
    icon: Wrench,
    view: ['View equipment', 'Request items'],
    manage: ['Add equipment', 'Track maintenance', 'Manage assignments'],
  },
  elections: {
    name: 'Elections & Voting',
    icon: CheckCircle,
    view: ['View elections', 'Cast votes'],
    manage: ['Create elections', 'Manage candidates', 'Certify results'],
  },
  scheduling: {
    name: 'Scheduling & Shifts',
    icon: ClipboardList,
    view: ['View schedules', 'Request swaps'],
    manage: ['Create schedules', 'Approve swaps', 'Assign shifts'],
  },
  reports: {
    name: 'Reports & Analytics',
    icon: ClipboardList,
    view: ['View dashboards', 'Personal reports'],
    manage: ['Create reports', 'Export data', 'Configure analytics'],
  },
  settings: {
    name: 'Organization Settings',
    icon: UserCog,
    view: ['View settings'],
    manage: ['Edit settings', 'Manage integrations', 'Configure modules'],
  },
};

// Predefined role templates
const roleTemplates = {
  leadership: {
    name: 'Leadership',
    description: 'Executive and administrative leadership roles',
    roles: [
      {
        id: 'chief',
        name: 'Chief / President',
        description: 'Top leadership with full organizational oversight',
        icon: Crown,
        priority: 95,
        permissions: {
          members: { view: true, manage: true },
          roles: { view: true, manage: true },
          events: { view: true, manage: true },
          documents: { view: true, manage: true },
          training: { view: true, manage: true },
          inventory: { view: true, manage: true },
          elections: { view: true, manage: true },
          scheduling: { view: true, manage: true },
          reports: { view: true, manage: true },
          settings: { view: true, manage: true },
        },
      },
      {
        id: 'assistant_chief',
        name: 'Assistant Chief / Vice President',
        description: 'Second in command, supports chief duties',
        icon: Star,
        priority: 90,
        permissions: {
          members: { view: true, manage: true },
          roles: { view: true, manage: false },
          events: { view: true, manage: true },
          documents: { view: true, manage: true },
          training: { view: true, manage: true },
          inventory: { view: true, manage: true },
          elections: { view: true, manage: false },
          scheduling: { view: true, manage: true },
          reports: { view: true, manage: true },
          settings: { view: true, manage: false },
        },
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
        permissions: {
          members: { view: true, manage: true },
          roles: { view: true, manage: false },
          events: { view: true, manage: true },
          documents: { view: true, manage: true },
          training: { view: true, manage: false },
          inventory: { view: true, manage: false },
          elections: { view: true, manage: true },
          scheduling: { view: true, manage: false },
          reports: { view: true, manage: true },
          settings: { view: true, manage: false },
        },
      },
      {
        id: 'treasurer',
        name: 'Treasurer',
        description: 'Financial oversight and reporting',
        icon: Briefcase,
        priority: 75,
        permissions: {
          members: { view: true, manage: false },
          roles: { view: true, manage: false },
          events: { view: true, manage: false },
          documents: { view: true, manage: true },
          training: { view: true, manage: false },
          inventory: { view: true, manage: false },
          elections: { view: true, manage: false },
          scheduling: { view: true, manage: false },
          reports: { view: true, manage: true },
          settings: { view: true, manage: false },
        },
      },
      {
        id: 'training_officer',
        name: 'Training Officer',
        description: 'Manages training programs and certifications',
        icon: GraduationCap,
        priority: 65,
        permissions: {
          members: { view: true, manage: false },
          roles: { view: true, manage: false },
          events: { view: true, manage: true },
          documents: { view: true, manage: true },
          training: { view: true, manage: true },
          inventory: { view: true, manage: false },
          elections: { view: true, manage: false },
          scheduling: { view: true, manage: false },
          reports: { view: true, manage: false },
          settings: { view: false, manage: false },
        },
      },
      {
        id: 'safety_officer',
        name: 'Safety Officer',
        description: 'Safety compliance and oversight',
        icon: Shield,
        priority: 65,
        permissions: {
          members: { view: true, manage: false },
          roles: { view: true, manage: false },
          events: { view: true, manage: true },
          documents: { view: true, manage: true },
          training: { view: true, manage: true },
          inventory: { view: true, manage: true },
          elections: { view: true, manage: false },
          scheduling: { view: true, manage: false },
          reports: { view: true, manage: true },
          settings: { view: false, manage: false },
        },
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
        priority: 60,
        permissions: {
          members: { view: true, manage: false },
          roles: { view: true, manage: false },
          events: { view: true, manage: false },
          documents: { view: true, manage: false },
          training: { view: true, manage: false },
          inventory: { view: true, manage: true },
          elections: { view: true, manage: false },
          scheduling: { view: true, manage: false },
          reports: { view: true, manage: false },
          settings: { view: false, manage: false },
        },
      },
      {
        id: 'scheduling_officer',
        name: 'Scheduling Officer',
        description: 'Manages duty rosters and shift scheduling',
        icon: ClipboardList,
        priority: 60,
        permissions: {
          members: { view: true, manage: false },
          roles: { view: true, manage: false },
          events: { view: true, manage: false },
          documents: { view: true, manage: false },
          training: { view: true, manage: false },
          inventory: { view: true, manage: false },
          elections: { view: true, manage: false },
          scheduling: { view: true, manage: true },
          reports: { view: true, manage: false },
          settings: { view: false, manage: false },
        },
      },
      {
        id: 'public_outreach',
        name: 'Public Outreach Coordinator',
        description: 'Community events and public education',
        icon: Users,
        priority: 55,
        permissions: {
          members: { view: true, manage: false },
          roles: { view: true, manage: false },
          events: { view: true, manage: true },
          documents: { view: true, manage: true },
          training: { view: true, manage: false },
          inventory: { view: true, manage: false },
          elections: { view: true, manage: false },
          scheduling: { view: true, manage: false },
          reports: { view: true, manage: false },
          settings: { view: false, manage: false },
        },
      },
    ],
  },
  members: {
    name: 'Member Roles',
    description: 'Standard member and probationary roles',
    roles: [
      {
        id: 'member',
        name: 'Member',
        description: 'Active member with standard access',
        icon: Users,
        priority: 20,
        permissions: {
          members: { view: true, manage: false },
          roles: { view: true, manage: false },
          events: { view: true, manage: false },
          documents: { view: true, manage: false },
          training: { view: true, manage: false },
          inventory: { view: true, manage: false },
          elections: { view: true, manage: false },
          scheduling: { view: true, manage: false },
          reports: { view: true, manage: false },
          settings: { view: false, manage: false },
        },
      },
      {
        id: 'probationary',
        name: 'Probationary Member',
        description: 'New member with limited access during probation',
        icon: Users,
        priority: 10,
        permissions: {
          members: { view: true, manage: false },
          roles: { view: false, manage: false },
          events: { view: true, manage: false },
          documents: { view: true, manage: false },
          training: { view: true, manage: false },
          inventory: { view: true, manage: false },
          elections: { view: false, manage: false },
          scheduling: { view: true, manage: false },
          reports: { view: false, manage: false },
          settings: { view: false, manage: false },
        },
      },
    ],
  },
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

  // Selected roles
  const [selectedRoles, setSelectedRoles] = useState<Record<string, RoleConfig>>(() => {
    // Pre-select essential roles
    const initial: Record<string, RoleConfig> = {};
    // Always include admin
    initial['admin'] = {
      id: 'admin',
      name: 'Administrator',
      description: 'Full system access - IT and system administrators',
      icon: Shield,
      priority: 100,
      permissions: Object.fromEntries(
        Object.keys(permissionCategories).map(k => [k, { view: true, manage: true }])
      ),
    };
    // Pre-select some common roles
    ['chief', 'secretary', 'training_officer', 'member'].forEach(roleId => {
      Object.values(roleTemplates).forEach(category => {
        const role = category.roles.find(r => r.id === roleId);
        if (role) {
          initial[roleId] = { ...role };
        }
      });
    });
    return initial;
  });

  // Expanded categories
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['leadership', 'officers']);

  // Role being edited
  const [editingRole, setEditingRole] = useState<string | null>(null);

  // Custom role modal
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customRoleName, setCustomRoleName] = useState('');
  const [customRoleDescription, setCustomRoleDescription] = useState('');

  const [isSaving, setIsSaving] = useState(false);

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

    const newRole: RoleConfig = {
      id: roleId,
      name: customRoleName,
      description: customRoleDescription || 'Custom role',
      icon: UserCog,
      priority: 50,
      isCustom: true,
      permissions: Object.fromEntries(
        Object.keys(permissionCategories).map(k => [k, { view: true, manage: false }])
      ),
    };

    setSelectedRoles(prev => ({ ...prev, [roleId]: newRole }));
    setCustomRoleName('');
    setCustomRoleDescription('');
    setShowCustomModal(false);
    setEditingRole(roleId);
    toast.success(`Created custom role: ${customRoleName}`);
  };

  const handleContinue = async () => {
    setIsSaving(true);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));

    toast.success('Roles configured successfully!');
    setIsSaving(false);
    navigate('/onboarding/modules');
  };

  const selectedCount = Object.keys(selectedRoles).length;
  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex flex-col">
      <header className="bg-slate-900/50 backdrop-blur-sm border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center">
          {logoPreview ? (
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center overflow-hidden mr-4">
              <img src={logoPreview} alt={`${departmentName} logo`} className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center mr-4">
              <Shield className="w-6 h-6 text-white" />
            </div>
          )}
          <div>
            <h1 className="text-white text-lg font-semibold">{departmentName}</h1>
            <p className="text-slate-400 text-sm">Setup in Progress</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 py-8">
        <div className="max-w-6xl w-full mx-auto">
          <BackButton to="/onboarding/it-team" className="mb-6" />

          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-full mb-4">
              <Users className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-3">
              Set Up Roles & Permissions
            </h1>
            <p className="text-xl text-slate-300 mb-2">
              Choose which roles your organization needs
            </p>
            <p className="text-sm text-slate-400 max-w-2xl mx-auto">
              Select from common fire department roles or create your own. Each role determines what members can view and manage.
            </p>
          </div>

          {/* Info Banner */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
            <div className="flex items-start">
              <Info className="w-5 h-5 text-blue-400 mt-0.5 mr-3 flex-shrink-0" />
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

          {/* Stats Bar */}
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center space-x-4">
              <div className="text-white">
                <span className="text-2xl font-bold">{selectedCount}</span>
                <span className="text-slate-400 ml-2">roles selected</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCustomModal(true)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
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
              <h2 className="text-white font-bold text-lg mb-4">Available Role Templates</h2>

              {Object.entries(roleTemplates).map(([categoryId, category]) => (
                <div key={categoryId} className="bg-white/5 rounded-lg border border-white/10 overflow-hidden">
                  <button
                    onClick={() => toggleCategory(categoryId)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
                  >
                    <div>
                      <h3 className="text-white font-semibold">{category.name}</h3>
                      <p className="text-slate-400 text-sm">{category.description}</p>
                    </div>
                    {expandedCategories.includes(categoryId) ? (
                      <ChevronDown className="w-5 h-5 text-slate-400" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-slate-400" />
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
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                  isSelected ? 'bg-green-600' : 'bg-slate-700'
                                }`}>
                                  <Icon className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                  <p className={`font-semibold ${isSelected ? 'text-green-400' : 'text-white'}`}>
                                    {role.name}
                                  </p>
                                  <p className="text-slate-400 text-xs">{role.description}</p>
                                </div>
                              </div>
                              {isSelected && (
                                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
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
              <h2 className="text-white font-bold text-lg mb-4">Selected Roles & Permissions</h2>

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
                        className={`bg-white/10 rounded-lg border transition-all ${
                          isEditing ? 'border-orange-500' : 'border-white/20'
                        }`}
                      >
                        <div
                          className="p-4 flex items-center justify-between cursor-pointer"
                          onClick={() => setEditingRole(isEditing ? null : role.id)}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              isAdmin ? 'bg-purple-600' : role.isCustom ? 'bg-blue-600' : 'bg-green-600'
                            }`}>
                              <Icon className="w-5 h-5 text-white" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-white font-semibold">{role.name}</p>
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
                              <p className="text-slate-400 text-xs">{role.description}</p>
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
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                            {isEditing ? (
                              <ChevronDown className="w-5 h-5 text-orange-400" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-slate-400" />
                            )}
                          </div>
                        </div>

                        {/* Expanded permissions editor */}
                        {isEditing && (
                          <div className="px-4 pb-4 border-t border-white/10 pt-4">
                            <p className="text-slate-400 text-sm mb-3">
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
                                    className="flex items-center justify-between py-2 px-3 bg-slate-800/50 rounded"
                                  >
                                    <span className="text-slate-300 text-sm">{cat.name}</span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => updateRolePermission(role.id, catId, 'view', !perms.view)}
                                        disabled={isAdmin}
                                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                                          perms.view
                                            ? 'bg-green-500/20 text-green-400'
                                            : 'bg-slate-700 text-slate-500'
                                        } ${isAdmin ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
                                      >
                                        <Eye className="w-3 h-3" />
                                        View
                                      </button>
                                      <button
                                        onClick={() => updateRolePermission(role.id, catId, 'manage', !perms.manage)}
                                        disabled={isAdmin}
                                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                                          perms.manage
                                            ? 'bg-orange-500/20 text-orange-400'
                                            : 'bg-slate-700 text-slate-500'
                                        } ${isAdmin ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
                                      >
                                        <Edit3 className="w-3 h-3" />
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
          <div className="mt-8 bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
            <ProgressIndicator currentStep={7} totalSteps={9} />
            <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
          </div>
        </div>
      </main>

      {/* Custom Role Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full border border-white/20">
            <h3 className="text-white font-bold text-xl mb-4">Create Custom Role</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">
                  Role Name *
                </label>
                <input
                  type="text"
                  value={customRoleName}
                  onChange={(e) => setCustomRoleName(e.target.value)}
                  placeholder="e.g., Social Media Manager"
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-200 mb-2">
                  Description
                </label>
                <input
                  type="text"
                  value={customRoleDescription}
                  onChange={(e) => setCustomRoleDescription(e.target.value)}
                  placeholder="Brief description of this role"
                  className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500"
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

      <footer className="bg-slate-900/50 backdrop-blur-sm border-t border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-slate-300 text-sm">© {currentYear} {departmentName}. All rights reserved.</p>
          <p className="text-slate-500 text-xs mt-1">Powered by The Logbook</p>
        </div>
      </footer>
    </div>
  );
};

export default RoleSetup;
