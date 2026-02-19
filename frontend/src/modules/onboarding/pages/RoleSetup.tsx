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
  Flame,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { OnboardingHeader, ProgressIndicator, BackButton, AutoSaveNotification } from '../components';
import { useOnboardingStore } from '../store';
import { MODULE_REGISTRY, type ModuleDefinition } from '../config';
import { apiClient } from '../services/api-client';
import { getErrorMessage } from '@/utils/errorHandling';

/**
 * Build permission categories dynamically from the module registry.
 * This ensures new modules automatically appear in position configuration.
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
 * Build position templates dynamically using the module registry.
 * This ensures new modules are included in position permissions automatically.
 */
const buildPositionTemplates = (modules: ModuleDefinition[]) => ({
  system: {
    name: 'System / Special',
    description: 'System administration and IT management positions',
    positions: [
      {
        id: 'it_manager',
        name: 'IT Manager',
        description: 'Full system access - manages integrations, settings, and technical administration',
        icon: Monitor,
        priority: 100,
        permissions: generateRolePermissions(modules, 'full_access'),
      },
    ],
  },
  operational_ranks: {
    name: 'Operational Ranks',
    description: 'Fire/EMS command and line positions',
    positions: [
      {
        id: 'fire_chief',
        name: 'Fire Chief',
        description: 'Highest-ranking officer with full operational and administrative authority',
        icon: Flame,
        priority: 95,
        permissions: generateRolePermissions(modules, 'full_access'),
      },
      {
        id: 'deputy_chief',
        name: 'Deputy Chief',
        description: 'Second in command, oversees operations in the Chief\'s absence',
        icon: Flame,
        priority: 90,
        permissions: generateRolePermissions(modules, 'leadership'),
      },
      {
        id: 'assistant_chief',
        name: 'Assistant Chief',
        description: 'Assists the Chief and Deputy Chief with operational oversight',
        icon: Flame,
        priority: 85,
        permissions: generateRolePermissions(modules, 'leadership'),
      },
      {
        id: 'captain',
        name: 'Captain',
        description: 'Company officer responsible for crew management and operations',
        icon: Star,
        priority: 70,
        permissions: generateRolePermissions(modules, 'officer', [
          'members',
          'training',
          'scheduling',
          'events',
          'apparatus',
        ]),
      },
      {
        id: 'lieutenant',
        name: 'Lieutenant',
        description: 'Company officer assisting the Captain with crew supervision',
        icon: Star,
        priority: 60,
        permissions: generateRolePermissions(modules, 'officer', [
          'training',
          'scheduling',
          'events',
          'apparatus',
        ]),
      },
      {
        id: 'engineer',
        name: 'Engineer / Driver Operator',
        description: 'Apparatus operator responsible for vehicle operations and maintenance',
        icon: Wrench,
        priority: 40,
        permissions: generateRolePermissions(modules, 'specialist', ['apparatus']),
      },
      {
        id: 'firefighter',
        name: 'Firefighter',
        description: 'Line firefighter with standard operational access',
        icon: Shield,
        priority: 15,
        permissions: generateRolePermissions(modules, 'member'),
      },
    ],
  },
  leadership: {
    name: 'Leadership',
    description: 'Executive leadership positions',
    positions: [
      {
        id: 'president',
        name: 'President',
        description: 'Top executive leader of the organization',
        icon: Crown,
        priority: 95,
        permissions: generateRolePermissions(modules, 'full_access'),
      },
      {
        id: 'vice_president',
        name: 'Vice President',
        description: 'Second in command, supports the President',
        icon: Star,
        priority: 80,
        permissions: generateRolePermissions(modules, 'leadership'),
      },
      {
        id: 'board_of_directors',
        name: 'Board of Directors',
        description: 'Governing board with oversight of organizational operations',
        icon: Building2,
        priority: 85,
        permissions: generateRolePermissions(modules, 'leadership'),
      },
    ],
  },
  officers: {
    name: 'Officers',
    description: 'Elected or appointed officers with specific duties',
    positions: [
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
        id: 'communications_officer',
        name: 'Communications Officer / PIO',
        description: 'Public information, website, social media, newsletters, and notification management',
        icon: Megaphone,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', [
          'notifications',
          'mobile',
          'events',
          'documents',
        ]),
      },
    ],
  },
  support: {
    name: 'Support Positions',
    description: 'Specialized support and operational positions',
    positions: [
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
        id: 'public_outreach',
        name: 'Public Outreach',
        description: 'Community events and public education',
        icon: Users,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', ['events', 'documents']),
      },
      {
        id: 'historian',
        name: 'Historian',
        description: 'Maintains organizational history, archives, and records',
        icon: ClipboardList,
        priority: 45,
        permissions: generateRolePermissions(modules, 'specialist', ['documents', 'events']),
      },
      {
        id: 'apparatus_officer',
        name: 'Apparatus Officer',
        description: 'Day-to-day fleet tracking, maintenance logging, and equipment checks',
        icon: Truck,
        priority: 50,
        permissions: generateRolePermissions(modules, 'specialist', ['apparatus', 'inventory']),
      },
      {
        id: 'membership_committee_chair',
        name: 'Membership Committee Chair',
        description: 'Manages member records, applications, and onboarding/offboarding',
        icon: UserPlus,
        priority: 55,
        permissions: generateRolePermissions(modules, 'specialist', ['members', 'prospective_members']),
      },
      {
        id: 'fundraising_chair',
        name: 'Fundraising Chair',
        description: 'Coordinates fundraising activities and campaigns',
        icon: BadgeCheck,
        priority: 50,
        permissions: generateRolePermissions(modules, 'specialist', ['events', 'documents', 'reports']),
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
    name: 'Member Positions',
    description: 'Standard and special member access levels',
    positions: [
      {
        id: 'member',
        name: 'Regular Member',
        description: 'Regular department member',
        icon: Users,
        priority: 10,
        permissions: generateRolePermissions(modules, 'member'),
      },
      {
        id: 'probationary_member',
        name: 'Probationary Member',
        description: 'New members with limited access during their trial period',
        icon: UserPlus,
        priority: 5,
        permissions: generateRolePermissions(modules, 'probationary'),
      },
      {
        id: 'junior_member',
        name: 'Junior Member',
        description: 'Youth or junior participants with restricted access',
        icon: Users,
        priority: 5,
        permissions: generateRolePermissions(modules, 'probationary'),
      },
      {
        id: 'life_member',
        name: 'Life Member',
        description: 'Long-serving members with honorary status',
        icon: BadgeCheck,
        priority: 10,
        permissions: generateRolePermissions(modules, 'member'),
      },
      {
        id: 'administrative_member',
        name: 'Administrative Member',
        description: 'Members focused on administrative and support duties',
        icon: Briefcase,
        priority: 8,
        permissions: generateRolePermissions(modules, 'member'),
      },
      {
        id: 'social_member',
        name: 'Social / Associate Member',
        description: 'Non-operational members involved socially',
        icon: Users,
        priority: 5,
        permissions: generateRolePermissions(modules, 'probationary'),
      },
      {
        id: 'exempt_member',
        name: 'Exempt / Retired Member',
        description: 'Former active members with limited access',
        icon: BadgeCheck,
        priority: 5,
        permissions: generateRolePermissions(modules, 'probationary'),
      },
    ],
  },
});

// Icon lookup map for serialization/deserialization
const ICON_MAP: Record<string, React.ElementType> = {
  Shield, Crown, Star, Briefcase, GraduationCap, ClipboardList, Wrench, Users, UserCog,
  Truck, Monitor, UserPlus, BadgeCheck, Megaphone, Building2, Flame,
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

const PositionSetup: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore(state => state.departmentName);
  const logoPreview = useOnboardingStore(state => state.logoData);
  const lastSaved = useOnboardingStore(state => state.lastSaved);
  const savedPositionsConfig = useOnboardingStore(state => state.positionsConfig);
  const setPositionsConfig = useOnboardingStore(state => state.setPositionsConfig);

  // Build permission categories and position templates from the module registry
  // This ensures new modules automatically appear in position configuration
  const permissionCategories = useMemo(() => buildPermissionCategories(MODULE_REGISTRY), []);
  const positionTemplates = useMemo(() => buildPositionTemplates(MODULE_REGISTRY), []);

  // Selected positions - restore from Zustand store if available, otherwise use defaults
  const [selectedPositions, setSelectedPositions] = useState<Record<string, RoleConfig>>(() => {
    // Restore from persisted store if available
    if (savedPositionsConfig) {
      const restored: Record<string, RoleConfig> = {};
      for (const [posId, saved] of Object.entries(savedPositionsConfig)) {
        restored[posId] = {
          ...saved,
          icon: ICON_MAP[saved.icon || 'UserCog'] || UserCog,
        };
      }
      return restored;
    }

    // Build templates for initial state
    const templates = buildPositionTemplates(MODULE_REGISTRY);

    // Pre-select essential positions
    const initial: Record<string, RoleConfig> = {};
    ['it_manager', 'fire_chief', 'president', 'secretary', 'training_officer', 'member'].forEach(posId => {
      Object.values(templates).forEach(category => {
        const position = category.positions.find(p => p.id === posId);
        if (position) {
          initial[posId] = { ...position };
        }
      });
    });
    return initial;
  });

  // Expanded categories
  const [expandedCategories, setExpandedCategories] = useState<string[]>(['system', 'operational_ranks', 'leadership', 'officers']);

  // Position being edited
  const [editingPosition, setEditingPosition] = useState<string | null>(null);

  // Custom position modal
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customPositionName, setCustomPositionName] = useState('');
  const [customPositionDescription, setCustomPositionDescription] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  // Persist position changes to Zustand store (survives navigation)
  useEffect(() => {
    const serializable: Record<string, any> = {};
    for (const [posId, position] of Object.entries(selectedPositions)) {
      serializable[posId] = {
        id: position.id,
        name: position.name,
        description: position.description,
        icon: getIconName(position.icon),
        priority: position.priority,
        permissions: position.permissions,
        isCustom: position.isCustom,
      };
    }
    setPositionsConfig(serializable);
  }, [selectedPositions, setPositionsConfig]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(c => c !== categoryId)
        : [...prev, categoryId]
    );
  };

  const togglePosition = (position: RoleConfig) => {
    if (position.id === 'it_manager') return; // IT Manager cannot be removed

    setSelectedPositions(prev => {
      if (prev[position.id]) {
        const { [position.id]: removed, ...rest } = prev;
        return rest;
      } else {
        return { ...prev, [position.id]: { ...position } };
      }
    });
  };

  const updatePositionPermission = (positionId: string, category: string, type: 'view' | 'manage', value: boolean) => {
    if (positionId === 'it_manager') return; // IT Manager always has all permissions

    setSelectedPositions(prev => ({
      ...prev,
      [positionId]: {
        ...prev[positionId],
        permissions: {
          ...prev[positionId].permissions,
          [category]: {
            ...prev[positionId].permissions[category],
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

  const createCustomPosition = () => {
    if (!customPositionName.trim()) {
      toast.error('Please enter a position name');
      return;
    }

    const posId = customPositionName.toLowerCase().replace(/\s+/g, '_');

    if (selectedPositions[posId]) {
      toast.error('A position with this name already exists');
      return;
    }

    // Use registry to generate permissions for all modules
    const newPosition: RoleConfig = {
      id: posId,
      name: customPositionName,
      description: customPositionDescription || 'Custom position',
      icon: UserCog,
      priority: 50,
      isCustom: true,
      permissions: generateDefaultPermissions(MODULE_REGISTRY, { view: true, manage: false }),
    };

    setSelectedPositions(prev => ({ ...prev, [posId]: newPosition }));
    setCustomPositionName('');
    setCustomPositionDescription('');
    setShowCustomModal(false);
    setEditingPosition(posId);
    toast.success(`Created custom position: ${customPositionName}`);
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
      // Convert selected positions to API format
      const positionsPayload = Object.values(selectedPositions).map((position) => ({
        id: position.id,
        name: position.name,
        description: position.description,
        priority: position.priority,
        permissions: position.permissions,
        is_custom: position.isCustom || false,
      }));

      const response = await apiClient.savePositionsConfig({ positions: positionsPayload });

      if (response.error) {
        toast.error(response.error);
        setIsSaving(false);
        return;
      }

      toast.success(
        `Positions configured successfully! Created: ${response.data?.created?.length || 0}, Updated: ${response.data?.updated?.length || 0}`
      );
      navigate('/onboarding/modules');
    } catch (error: unknown) {
      // Show specific error message from backend
      const errorMessage = getErrorMessage(error, 'Failed to save position configuration. Please try again.');
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const selectedCount = Object.keys(selectedPositions).length;
  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-gradient-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex flex-col">
      <OnboardingHeader departmentName={departmentName} logoPreview={logoPreview} />

      <main className="flex-1 p-4 py-8">
        <div className="max-w-6xl w-full mx-auto">
          <BackButton to="/onboarding/it-team" className="mb-6" />

          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-full mb-4">
              <Users className="w-8 h-8 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-theme-text-primary mb-3">
              Set Up Positions & Permissions
            </h1>
            <p className="text-xl text-theme-text-secondary mb-2">
              Choose which positions your organization needs
            </p>
            <p className="text-sm text-theme-text-muted max-w-2xl mx-auto">
              Select from common fire department positions or create your own. Each position determines what members can view and manage.
            </p>
          </div>

          {/* Info Banners */}
          <div className="space-y-4 mb-6">
            <div className="alert-info">
              <div className="flex items-start">
                <Info className="w-5 h-5 text-theme-alert-info-icon mt-0.5 mr-3 flex-shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-theme-alert-info-title font-semibold mb-1">How Permissions Work</p>
                  <p className="text-theme-text-secondary text-sm">
                    Each position has <strong className="text-theme-alert-success-text">View</strong> (see content) and{' '}
                    <strong className="text-theme-alert-warning-icon">Manage</strong> (create/edit/delete) permissions per module.
                    Click on a selected position to customize its permissions.
                  </p>
                </div>
              </div>
            </div>

            <div className="alert-success">
              <div className="flex items-start">
                <CheckCircle className="w-5 h-5 text-theme-alert-success-icon mt-0.5 mr-3 flex-shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-theme-alert-success-title font-semibold mb-1">Don't Worry - You Can Change These Later</p>
                  <p className="text-theme-text-secondary text-sm">
                    Positions and permissions can be updated anytime in <strong>Settings → Positions & Permissions</strong>.
                    You can add new positions, modify permissions, or remove positions as your organization's needs evolve.
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
                <span className="text-theme-text-muted ml-2">positions selected</span>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCustomModal(true)}
                className="px-4 py-2 bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Create Custom Position
              </button>
              <button
                onClick={handleContinue}
                disabled={isSaving || selectedCount < 2}
                className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                  selectedCount >= 2 && !isSaving
                    ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white'
                    : 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
                }`}
              >
                {isSaving ? 'Saving...' : 'Continue to Modules'}
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Left: Position Templates */}
            <div className="space-y-4">
              <h2 className="text-theme-text-primary font-bold text-lg mb-4">Available Position Templates</h2>

              {Object.entries(positionTemplates).map(([categoryId, category]) => (
                <div key={categoryId} className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border overflow-hidden">
                  <button
                    onClick={() => toggleCategory(categoryId)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-theme-surface-hover transition-colors"
                  >
                    <div>
                      <h3 className="text-theme-text-primary font-semibold">{category.name}</h3>
                      <p className="text-theme-text-muted text-sm">{category.description}</p>
                    </div>
                    {expandedCategories.includes(categoryId) ? (
                      <ChevronDown className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />
                    )}
                  </button>

                  {expandedCategories.includes(categoryId) && (
                    <div className="px-4 pb-4 space-y-2">
                      {category.positions.map(position => {
                        const isSelected = !!selectedPositions[position.id];
                        const Icon = position.icon;

                        return (
                          <div
                            key={position.id}
                            className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${
                              isSelected
                                ? 'border-theme-accent-green bg-theme-accent-green-muted'
                                : 'border-theme-surface-border hover:border-theme-surface-hover'
                            }`}
                            onClick={() => togglePosition(position)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePosition(position); } }}
                            tabIndex={0}
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-label={`${position.name} - ${position.description}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                                  isSelected ? 'bg-green-600' : 'bg-theme-surface'
                                }`}>
                                  <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                                </div>
                                <div>
                                  <p className={`font-semibold ${isSelected ? 'text-theme-accent-green' : 'text-theme-text-primary'}`}>
                                    {position.name}
                                  </p>
                                  <p className="text-theme-text-muted text-xs">{position.description}</p>
                                </div>
                              </div>
                              {isSelected && (
                                <CheckCircle className="w-5 h-5 text-theme-accent-green flex-shrink-0" aria-hidden="true" />
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

            {/* Right: Selected Positions & Permissions */}
            <div>
              <h2 className="text-theme-text-primary font-bold text-lg mb-4">Selected Positions & Permissions</h2>

              <div className="space-y-3">
                {Object.values(selectedPositions)
                  .sort((a, b) => b.priority - a.priority)
                  .map(position => {
                    const Icon = position.icon;
                    const isEditing = editingPosition === position.id;
                    const isITManager = position.id === 'it_manager';

                    return (
                      <div
                        key={position.id}
                        className={`bg-theme-surface rounded-lg border transition-all ${
                          isEditing ? 'border-theme-accent-orange' : 'border-theme-surface-border'
                        }`}
                      >
                        <div
                          className="p-4 flex items-center justify-between cursor-pointer"
                          onClick={() => setEditingPosition(isEditing ? null : position.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingPosition(isEditing ? null : position.id); } }}
                          tabIndex={0}
                          role="button"
                          aria-expanded={isEditing}
                          aria-label={`${position.name} - click to ${isEditing ? 'collapse' : 'expand'} permissions`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              isITManager ? 'bg-purple-600' : position.isCustom ? 'bg-blue-600' : 'bg-green-600'
                            }`}>
                              <Icon className="w-5 h-5 text-white" aria-hidden="true" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-theme-text-primary font-semibold">{position.name}</p>
                                {isITManager && (
                                  <span className="text-xs bg-theme-alert-purple-bg text-theme-alert-purple-text px-2 py-0.5 rounded">
                                    System
                                  </span>
                                )}
                                {position.isCustom && (
                                  <span className="text-xs bg-theme-alert-info-bg text-theme-alert-info-text px-2 py-0.5 rounded">
                                    Custom
                                  </span>
                                )}
                              </div>
                              <p className="text-theme-text-muted text-xs">{position.description}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!isITManager && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePosition(position);
                                }}
                                className="p-1 hover:bg-theme-accent-orange-muted rounded text-theme-text-muted hover:text-theme-accent-red transition-colors"
                                aria-label={`Remove ${position.name} position`}
                              >
                                <X className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}
                            {isEditing ? (
                              <ChevronDown className="w-5 h-5 text-theme-accent-orange" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-theme-text-muted" aria-hidden="true" />
                            )}
                          </div>
                        </div>

                        {/* Expanded permissions editor */}
                        {isEditing && (
                          <div className="px-4 pb-4 border-t border-theme-nav-border pt-4">
                            <p className="text-theme-text-muted text-sm mb-3">
                              {isITManager
                                ? 'IT Manager has full access to all features.'
                                : 'Click to toggle permissions for each module:'}
                            </p>
                            <div className="grid grid-cols-1 gap-2">
                              {Object.entries(permissionCategories).map(([catId, cat]) => {
                                const perms = position.permissions[catId] || { view: false, manage: false };

                                return (
                                  <div
                                    key={catId}
                                    className="flex items-center justify-between py-2 px-3 bg-theme-surface-secondary rounded"
                                  >
                                    <span className="text-theme-text-secondary text-sm">{cat.name}</span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => updatePositionPermission(position.id, catId, 'view', !perms.view)}
                                        disabled={isITManager}
                                        aria-label={`${perms.view ? 'Disable' : 'Enable'} view permission for ${cat.name}`}
                                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                                          perms.view
                                            ? 'bg-theme-accent-green-muted text-theme-accent-green'
                                            : 'bg-theme-surface text-theme-text-muted'
                                        } ${isITManager ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
                                      >
                                        <Eye className="w-3 h-3" aria-hidden="true" />
                                        View
                                      </button>
                                      <button
                                        onClick={() => updatePositionPermission(position.id, catId, 'manage', !perms.manage)}
                                        disabled={isITManager}
                                        aria-label={`${perms.manage ? 'Disable' : 'Enable'} manage permission for ${cat.name}`}
                                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                                          perms.manage
                                            ? 'bg-theme-accent-orange-muted text-theme-accent-orange'
                                            : 'bg-theme-surface text-theme-text-muted'
                                        } ${isITManager ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
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

      {/* Custom Position Modal */}
      {showCustomModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="custom-position-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowCustomModal(false); }}
        >
          <div className="bg-theme-surface-modal rounded-lg p-6 max-w-md w-full border border-theme-surface-border">
            <h3 id="custom-position-modal-title" className="text-theme-text-primary font-bold text-xl mb-4">Create Custom Position</h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="custom-position-name" className="block text-sm font-semibold text-theme-text-secondary mb-2">
                  Position Name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="custom-position-name"
                  type="text"
                  value={customPositionName}
                  onChange={(e) => setCustomPositionName(e.target.value)}
                  placeholder="e.g., Social Media Manager"
                  required
                  aria-required="true"
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                />
              </div>

              <div>
                <label htmlFor="custom-position-description" className="block text-sm font-semibold text-theme-text-secondary mb-2">
                  Description
                </label>
                <input
                  id="custom-position-description"
                  type="text"
                  value={customPositionDescription}
                  onChange={(e) => setCustomPositionDescription(e.target.value)}
                  placeholder="Brief description of this position"
                  className="w-full px-4 py-3 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCustomModal(false)}
                className="flex-1 px-4 py-2 bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-primary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createCustomPosition}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white rounded-lg font-semibold transition-colors"
              >
                Create Position
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="bg-theme-nav-bg backdrop-blur-sm border-t border-theme-nav-border px-6 py-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-theme-text-secondary text-sm">© {currentYear} {departmentName}. All rights reserved.</p>
          <p className="text-theme-text-muted text-xs mt-1">Powered by The Logbook</p>
        </div>
      </footer>
    </div>
  );
};

// Backward-compatible alias
export const RoleSetup = PositionSetup;

export default PositionSetup;
