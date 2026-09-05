import React, { useState, useMemo, useEffect } from 'react';
import { useDialog } from '../../../hooks/useDialog';
import { useNavigate } from 'react-router';
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
  HeartPulse,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { OnboardingHeader, ProgressIndicator, BackButton, AutoSaveNotification } from '../components';
import { useOnboardingStore } from '../store';
import { MODULE_REGISTRY, SEEDED_POSITION_GRANTS, isAgencyFilteredOut, type ModuleDefinition } from '../config';
import { apiClient } from '../services/api-client';
import { getErrorMessage } from '@/utils/errorHandling';
import { buildPositionTemplates } from './positionTemplates';

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
 * Positions the members category used to offer, which are really a member's
 * class and status rather than a job they hold. They are set on the member
 * record now, and migration c3d4e5f6a7b8 recovers the standing of anyone who
 * already holds one.
 *
 * Kept as a named list because an in-flight onboarding session persists its
 * position picks to localStorage: without this, resuming a session started
 * before the change re-creates exactly what the migration just retired.
 */
const RETIRED_STANDING_SLUGS = new Set([
  'probationary_member',
  'junior_member',
  'life_member',
  'administrative_member',
  'social_member',
  'exempt_member',
]);

// Icon lookup map for serialization/deserialization
const ICON_MAP: Record<string, React.ElementType> = {
  Shield,
  Crown,
  Star,
  Briefcase,
  GraduationCap,
  ClipboardList,
  Wrench,
  Users,
  UserCog,
  Truck,
  Monitor,
  UserPlus,
  BadgeCheck,
  Megaphone,
  Building2,
  Flame,
  HeartPulse,
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
  isCustom?: boolean | undefined;
}

const PositionSetup: React.FC = () => {
  const navigate = useNavigate();
  const departmentName = useOnboardingStore((state) => state.departmentName);
  const logoPreview = useOnboardingStore((state) => state.logoData);
  const lastSaved = useOnboardingStore((state) => state.lastSaved);
  const savedPositionsConfig = useOnboardingStore((state) => state.positionsConfig);
  const setPositionsConfig = useOnboardingStore((state) => state.setPositionsConfig);
  const organizationType = useOnboardingStore((state) => state.organizationType);

  // Build permission categories and position templates from the module registry
  // This ensures new modules automatically appear in position configuration
  const permissionCategories = useMemo(() => buildPermissionCategories(MODULE_REGISTRY), []);
  const positionTemplates = useMemo(
    () => buildPositionTemplates(MODULE_REGISTRY, organizationType),
    [organizationType]
  );

  // Flattened view of the agency-filtered templates, for reconciling a restored
  // config against them. A custom position an admin invented has no template
  // and is kept as-is.
  const templatesById = useMemo(
    () =>
      new Map(
        Object.values(positionTemplates).flatMap((category) =>
          category.positions.map((position) => [position.id, position] as const)
        )
      ),
    [positionTemplates]
  );

  // Selected positions - restore from Zustand store if available, otherwise use defaults
  const [selectedPositions, setSelectedPositions] = useState<Record<string, RoleConfig>>(() => {
    // Restore from persisted store if available.
    //
    // The restored map goes through the same agency filter as a fresh one, and
    // has to. It is read from localStorage, so it can predate this filter
    // existing — an EMS department that reached this step on an earlier build
    // has `firefighter` sitting in its saved config, ticked. Submitting it does
    // not merely show a position in error: `save_session_roles` finds no system
    // position with that slug and *creates* one, putting back exactly the row
    // the backend declined to seed. Names are refreshed from the template for
    // the same reason, so a config saved as "Fire Chief" reads "Chief".
    if (savedPositionsConfig) {
      const restored: Record<string, RoleConfig> = {};
      for (const [posId, saved] of Object.entries(savedPositionsConfig)) {
        // Two independent reasons a saved pick must not come back, and both
        // have to run. Dropped by slug rather than by "not in the current
        // templates", which would also discard the custom positions a
        // department built in this very session.
        //
        // 1. A membership standing, which is no longer a position at all: this
        //    restore is what would put one back, because handleContinue
        //    submits whatever is here — recreating the permission-bearing row
        //    *after* the recovery migration has already reclassified those
        //    members.
        if (RETIRED_STANDING_SLUGS.has(posId)) continue;
        // 2. A discipline position this agency does not have. Same mechanism,
        //    different cause: the config predates the agency filter, so an EMS
        //    service resuming an older session still has `firefighter` ticked.
        const template = templatesById.get(posId);
        if (!template && isAgencyFilteredOut(posId, organizationType)) continue;
        // Permissions are refreshed from the template too, and only for a
        // position the backend seeds. A config read from localStorage can
        // predate the grants this build presents: an EMT saved on an earlier
        // build carries the ticks a role-type heuristic chose — `reports`
        // among them — and handleContinue submits whatever is here, so the
        // stale set would be written after every migration had already run.
        // The templates have been through `applySeededGrants`, so taking
        // theirs is the same answer a fresh session gets.
        //
        // Confined to seeded slugs on purpose: a custom position built in this
        // session, or a template the registry does not seed, has no other
        // source for its permissions and must keep what was saved.
        const seeded = template && SEEDED_POSITION_GRANTS[posId];
        restored[posId] = {
          ...saved,
          ...(template ? { name: template.name } : {}),
          ...(seeded ? { permissions: template.permissions } : {}),
          icon: ICON_MAP[saved.icon || 'UserCog'] || UserCog,
        };
      }
      return restored;
    }

    // Build templates for initial state. The store default is the full fire
    // set, so a wizard resumed with a cleared store offers one position too
    // many rather than silently hiding one.
    const templates = buildPositionTemplates(MODULE_REGISTRY, organizationType);

    // Pre-select essential positions
    const initial: Record<string, RoleConfig> = {};
    ['it_manager', 'fire_chief', 'president', 'secretary', 'training_officer', 'member'].forEach((posId) => {
      Object.values(templates).forEach((category) => {
        const position = category.positions.find((p) => p.id === posId);
        if (position) {
          initial[posId] = { ...position };
        }
      });
    });
    return initial;
  });

  // Expanded categories
  const [expandedCategories, setExpandedCategories] = useState<string[]>([
    'system',
    'operational_ranks',
    'leadership',
    'officers',
  ]);

  // Position being edited
  const [editingPosition, setEditingPosition] = useState<string | null>(null);

  // Custom position modal
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customPositionName, setCustomPositionName] = useState('');
  const [customPositionDescription, setCustomPositionDescription] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  // Guard: redirect to start if org setup hasn't been completed
  useEffect(() => {
    if (!departmentName) {
      void navigate('/onboarding/start');
    }
  }, [departmentName, navigate]);

  // Persist position changes to Zustand store (survives navigation)
  useEffect(() => {
    const serializable: Record<
      string,
      {
        id: string;
        name: string;
        description: string;
        icon: string;
        priority: number;
        permissions: Record<string, { view: boolean; manage: boolean }>;
        isCustom?: boolean | undefined;
      }
    > = {};
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
    setExpandedCategories((prev) =>
      prev.includes(categoryId) ? prev.filter((c) => c !== categoryId) : [...prev, categoryId]
    );
  };

  const togglePosition = (position: RoleConfig) => {
    if (position.id === 'it_manager') return; // IT Manager cannot be removed

    setSelectedPositions((prev) => {
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

    setSelectedPositions((prev) => {
      if (!prev[positionId]) return prev;
      return {
        ...prev,
        [positionId]: {
          ...prev[positionId],
          permissions: {
            ...prev[positionId].permissions,
            [category]: {
              ...prev[positionId].permissions?.[category],
              [type]: value,
              // If manage is enabled, view must be enabled too
              ...(type === 'manage' && value ? { view: true } : {}),
              // If view is disabled, manage must be disabled too
              ...(type === 'view' && !value ? { manage: false } : {}),
            },
          },
        },
      } as Record<string, RoleConfig>;
    });
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

    setSelectedPositions((prev) => ({ ...prev, [posId]: newPosition }));
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
      void navigate('/onboarding/start');
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
      void navigate('/onboarding/modules');
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

  const dialogRef = useDialog<HTMLDivElement>({ isOpen: showCustomModal, onClose: () => setShowCustomModal(false) });

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to safe-top flex min-h-screen flex-col bg-linear-to-br">
      <OnboardingHeader departmentName={departmentName} logoPreview={logoPreview} />

      <main className="flex-1 p-4 py-8">
        <div className="mx-auto w-full max-w-6xl">
          <BackButton to="/onboarding/it-team" className="mb-6" />

          {/* Header */}
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-800">
              <Users className="h-8 w-8 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-theme-text-primary mb-3 text-4xl font-bold md:text-5xl">
              Set Up Positions & Permissions
            </h1>
            <p className="text-theme-text-secondary mb-2 text-xl">Choose which positions your organization needs</p>
            <p className="text-theme-text-muted mx-auto max-w-2xl text-sm">
              Select from common fire department positions or create your own. Each position determines what members can
              view and manage.
            </p>
          </div>

          {/* Info Banners */}
          <div className="mb-6 space-y-4">
            <div className="alert-info">
              <div className="flex items-start">
                <Info className="text-theme-alert-info-icon mt-0.5 mr-3 h-5 w-5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-theme-alert-info-title mb-1 font-semibold">How Permissions Work</p>
                  <p className="text-theme-text-secondary text-sm">
                    Each position has <strong className="text-theme-alert-success-text">View</strong> (see content) and{' '}
                    <strong className="text-theme-alert-warning-icon">Manage</strong> (create/edit/delete) permissions
                    per module. Click on a selected position to customize its permissions.
                  </p>
                </div>
              </div>
            </div>

            <div className="alert-success">
              <div className="flex items-start">
                <CheckCircle
                  className="text-theme-alert-success-icon mt-0.5 mr-3 h-5 w-5 shrink-0"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-theme-alert-success-title mb-1 font-semibold">
                    Don't Worry - You Can Change These Later
                  </p>
                  <p className="text-theme-text-secondary text-sm">
                    Positions and permissions can be updated anytime in{' '}
                    <strong>Settings → Positions & Permissions</strong>. You can add new positions, modify permissions,
                    or remove positions as your organization's needs evolve.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="card mb-6 flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="flex items-center space-x-4">
              <div className="text-theme-text-primary">
                <span className="text-2xl font-bold">{selectedCount}</span>
                <span className="text-theme-text-muted ml-2">positions selected</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowCustomModal(true)}
                className="bg-theme-surface hover:bg-theme-surface-hover text-theme-text-primary flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Create Custom Position
              </button>
              <button
                onClick={() => {
                  void handleContinue();
                }}
                disabled={isSaving || selectedCount < 2}
                className={`rounded-lg px-6 py-2 font-semibold transition-all ${
                  selectedCount >= 2 && !isSaving
                    ? 'bg-linear-to-r from-red-600 to-orange-600 text-white hover:from-red-700 hover:to-orange-700'
                    : 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
                }`}
              >
                {isSaving ? 'Saving...' : 'Continue to Modules'}
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left: Position Templates */}
            <div className="space-y-4">
              <h2 className="text-theme-text-primary mb-4 text-lg font-bold">Available Position Templates</h2>

              {Object.entries(positionTemplates).map(([categoryId, category]) => (
                <div key={categoryId} className="card-secondary overflow-hidden">
                  <button
                    onClick={() => toggleCategory(categoryId)}
                    className="hover:bg-theme-surface-hover flex w-full items-center justify-between px-4 py-3 text-left transition-colors"
                  >
                    <div>
                      <h3 className="text-theme-text-primary font-semibold">{category.name}</h3>
                      <p className="text-theme-text-muted text-sm">{category.description}</p>
                    </div>
                    {expandedCategories.includes(categoryId) ? (
                      <ChevronDown className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                    )}
                  </button>

                  {expandedCategories.includes(categoryId) && (
                    <div className="space-y-2 px-4 pb-4">
                      {category.positions.map((position) => {
                        const isSelected = !!selectedPositions[position.id];
                        const Icon = position.icon;

                        return (
                          <div
                            key={position.id}
                            className={`cursor-pointer rounded-lg border-2 p-3 transition-all ${
                              isSelected
                                ? 'border-theme-accent-green bg-theme-accent-green-muted'
                                : 'border-theme-surface-border hover:border-theme-surface-hover'
                            }`}
                            onClick={() => togglePosition(position)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                togglePosition(position);
                              }
                            }}
                            tabIndex={0}
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-label={`${position.name} - ${position.description}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                                    isSelected ? 'bg-green-600' : 'bg-theme-surface'
                                  }`}
                                >
                                  <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                                </div>
                                <div>
                                  <p
                                    className={`font-semibold ${isSelected ? 'text-theme-accent-green' : 'text-theme-text-primary'}`}
                                  >
                                    {position.name}
                                  </p>
                                  <p className="text-theme-text-muted text-xs">{position.description}</p>
                                </div>
                              </div>
                              {isSelected && (
                                <CheckCircle className="text-theme-accent-green h-5 w-5 shrink-0" aria-hidden="true" />
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
              <h2 className="text-theme-text-primary mb-4 text-lg font-bold">Selected Positions & Permissions</h2>

              <div className="space-y-3">
                {Object.values(selectedPositions)
                  .sort((a, b) => b.priority - a.priority)
                  .map((position) => {
                    const Icon = position.icon;
                    const isEditing = editingPosition === position.id;
                    const isITManager = position.id === 'it_manager';

                    return (
                      <div
                        key={position.id}
                        className={`card transition-all ${isEditing ? 'border-theme-accent-orange' : 'border-theme-surface-border'}`}
                      >
                        <div
                          className="flex cursor-pointer items-center justify-between p-4"
                          onClick={() => setEditingPosition(isEditing ? null : position.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setEditingPosition(isEditing ? null : position.id);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-expanded={isEditing}
                          aria-label={`${position.name} - click to ${isEditing ? 'collapse' : 'expand'} permissions`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                                isITManager ? 'bg-purple-600' : position.isCustom ? 'bg-blue-600' : 'bg-green-600'
                              }`}
                            >
                              <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-theme-text-primary font-semibold">{position.name}</p>
                                {isITManager && (
                                  <span className="bg-theme-alert-purple-bg text-theme-alert-purple-text rounded-sm px-2 py-0.5 text-xs">
                                    System
                                  </span>
                                )}
                                {position.isCustom && (
                                  <span className="bg-theme-alert-info-bg text-theme-alert-info-text rounded-sm px-2 py-0.5 text-xs">
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
                                className="hover:bg-theme-accent-orange-muted text-theme-text-muted hover:text-theme-accent-red rounded-sm p-1 transition-colors"
                                aria-label={`Remove ${position.name} position`}
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                              </button>
                            )}
                            {isEditing ? (
                              <ChevronDown className="text-theme-accent-orange h-5 w-5" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                            )}
                          </div>
                        </div>

                        {/* Expanded permissions editor */}
                        {isEditing && (
                          <div className="border-theme-nav-border border-t px-4 pt-4 pb-4">
                            <p className="text-theme-text-muted mb-3 text-sm">
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
                                    className="bg-theme-surface-secondary flex items-center justify-between rounded-sm px-3 py-2"
                                  >
                                    <span className="text-theme-text-secondary text-sm">{cat.name}</span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() =>
                                          updatePositionPermission(position.id, catId, 'view', !perms.view)
                                        }
                                        disabled={isITManager}
                                        aria-label={`${perms.view ? 'Disable' : 'Enable'} view permission for ${cat.name}`}
                                        className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                                          perms.view
                                            ? 'bg-theme-accent-green-muted text-theme-accent-green'
                                            : 'bg-theme-surface text-theme-text-muted'
                                        } ${isITManager ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
                                      >
                                        <Eye className="h-3 w-3" aria-hidden="true" />
                                        View
                                      </button>
                                      <button
                                        onClick={() =>
                                          updatePositionPermission(position.id, catId, 'manage', !perms.manage)
                                        }
                                        disabled={isITManager}
                                        aria-label={`${perms.manage ? 'Disable' : 'Enable'} manage permission for ${cat.name}`}
                                        className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                                          perms.manage
                                            ? 'bg-theme-accent-orange-muted text-theme-accent-orange'
                                            : 'bg-theme-surface text-theme-text-muted'
                                        } ${isITManager ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
                                      >
                                        <Edit3 className="h-3 w-3" aria-hidden="true" />
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
          <div className="card mt-8 p-6">
            <ProgressIndicator step="positions" />
            <AutoSaveNotification showTimestamp lastSaved={lastSaved} className="mt-4" />
          </div>
        </div>
      </main>

      {/* Custom Position Modal */}
      {showCustomModal && (
        <div
          className="modal-overlay z-50 flex items-center justify-center p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="custom-position-modal-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowCustomModal(false);
          }}
        >
          <div ref={dialogRef} className="modal-panel modal-panel-scroll w-full max-w-md p-6">
            <h3 id="custom-position-modal-title" className="text-theme-text-primary mb-4 text-xl font-bold">
              Create Custom Position
            </h3>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="custom-position-name"
                  className="text-theme-text-secondary mb-2 block text-sm font-semibold"
                >
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
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>

              <div>
                <label
                  htmlFor="custom-position-description"
                  className="text-theme-text-secondary mb-2 block text-sm font-semibold"
                >
                  Description
                </label>
                <input
                  id="custom-position-description"
                  type="text"
                  value={customPositionDescription}
                  onChange={(e) => setCustomPositionDescription(e.target.value)}
                  placeholder="Brief description of this position"
                  className="form-input placeholder-theme-text-muted py-3"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowCustomModal(false)}
                className="bg-theme-surface-secondary hover:bg-theme-surface-hover text-theme-text-primary flex-1 rounded-lg px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={createCustomPosition}
                className="flex-1 rounded-lg bg-linear-to-r from-red-600 to-orange-600 px-4 py-2 font-semibold text-white transition-colors hover:from-red-700 hover:to-orange-700"
              >
                Create Position
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="bg-theme-nav-bg border-theme-nav-border border-t px-6 py-4 backdrop-blur-xs">
        <div className="mx-auto max-w-7xl text-center">
          <p className="text-theme-text-secondary text-sm">
            © {currentYear} {departmentName}. All rights reserved.
          </p>
          <p className="text-theme-text-muted mt-1 text-xs">Powered by The Logbook</p>
        </div>
      </footer>
    </div>
  );
};

// Backward-compatible alias
export const RoleSetup = PositionSetup;

export default PositionSetup;
