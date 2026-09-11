import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
  Lock,
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
import {
  OnboardingHeader,
  ProgressIndicator,
  BackButton,
  AutoSaveNotification,
  RankLadderSection,
  MembershipLadderSection,
} from '../components';
import { useOnboardingStore } from '../store';
import {
  MODULE_CHECKBOX_CONFERRED_BY,
  MODULE_CHECKBOX_TIERS,
  MODULE_REGISTRY,
  isAgencyFilteredOut,
  type ModuleCheckboxConferredBy,
  type ModuleCheckboxTiers,
  type ModuleDefinition,
} from '../config';
import { apiClient } from '../services/api-client';
import { getErrorMessage } from '@/utils/errorHandling';
import { buildPositionTemplates } from './positionTemplates';
import { nextStepName, nextStepPath, previousStepPath } from '../config/steps';

/**
 * Build permission categories dynamically from the module registry.
 * This ensures new modules automatically appear in position configuration.
 */
/**
 * The rows of the permission matrix, and which of each row's two checkboxes
 * the app can actually grant.
 *
 * A module whose View and Manage tiers are both unbacked is not a row at all.
 * Mobile App Access is that module: it is a PWA with no permission gate, so
 * both boxes wrote `mobile.view` / `mobile.manage` / `mobile.*` into every
 * position that ticked them and no endpoint has ever read one. Integrations
 * keeps its row but loses View, because there is no read-only console —
 * every route behind it requires `integrations.manage`.
 *
 * `MODULE_CHECKBOX_TIERS` is generated from the backend's own map, so a new
 * module whose settings key is not its permission prefix is answered there
 * once rather than here as well.
 */
const buildPermissionCategories = (modules: ModuleDefinition[]) => {
  const categories: Record<
    string,
    {
      name: string;
      icon: React.ElementType;
      view: string[];
      manage: string[];
      tiers: ModuleCheckboxTiers;
      conferredBy: ModuleCheckboxConferredBy;
    }
  > = {};

  modules.forEach((module) => {
    const tiers = MODULE_CHECKBOX_TIERS[module.id] ?? { view: true, manage: true };
    if (!tiers.view && !tiers.manage) return;
    categories[module.id] = {
      name: module.name,
      icon: module.icon,
      view: module.permissions.view,
      manage: module.permissions.manage,
      tiers,
      conferredBy: MODULE_CHECKBOX_CONFERRED_BY[module.id] ?? {},
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
/**
 * Positions whose seeded grants changed after a session could already have
 * persisted them, so a restored config must take the template's answer rather
 * than its own.
 *
 * `emt` had no DEFAULT_POSITIONS entry until 2026-09-05: the wizard offered it
 * to every agency type with nothing seeded behind the slug, so the role-type
 * heuristic supplied its boxes — Reports among them — and `save_session_roles`
 * stored that as a permission-bearing `is_system` row.
 *
 * `member`, `firefighter` and `emt` lost `apparatus` on 2026-09-05: the fleet
 * record is a maintenance and compliance workspace, not a member amenity. A
 * config persisted before that deploy still has the box ticked, and
 * `handleContinue` submits whatever is here — so without this the wizard would
 * re-grant `apparatus.view` on the first Continue, after the migration that
 * revoked it had already run. `engineer` is absent on purpose: it is the
 * driver/operator rank and keeps the grant.
 *
 * **Keyed by marker, not by slug.** `reconciledSeededSlugs` records what a
 * draft has already been through, and a draft that visited Role Setup under
 * the EMT repair above recorded the bare `emt`. Listing `emt` again for a
 * *different* grant change would be filtered out as already done, so that
 * draft would keep the apparatus box ticked and write `apparatus.view` back.
 * One marker per (slug, change) fixes that. The bare `emt` marker is kept
 * verbatim for the change that introduced it, so a draft that already
 * reconciled it is not reset a second time and lose an administrator's edits.
 *
 * Deliberately narrow. This reconciliation overwrites what was saved, and an
 * administrator's own edits to a built-in position are saved the same way, so
 * a slug belongs here only while its seeded grants have genuinely moved.
 */
const STALE_SEEDED_MARKERS: Readonly<Record<string, string>> = {
  // EMT's heuristic-written grants. Recorded as the bare slug before markers
  // carried the change they stand for; left as-is so it stays satisfied.
  emt: 'emt',
  // apparatus.view left the rank-and-file set.
  'emt@apparatus-view': 'emt',
  'member@apparatus-view': 'member',
  'firefighter@apparatus-view': 'firefighter',
};

/**
 * What a draft has already been through, including work an earlier build
 * recorded under a name this one no longer uses.
 *
 * The build that first revoked apparatus (#2248) reconciled `emt`, `member`
 * and `firefighter` but recorded them as bare slugs, because markers did not
 * carry the change they stood for yet. Read literally, none of those satisfies
 * a `@apparatus-view` marker, so a draft from that build would be reconciled a
 * second time — overwriting permissions and priority an administrator had
 * edited since, which is the exact harm the once-only design exists to
 * prevent.
 *
 * A bare `member` or `firefighter` can only have come from that build: no
 * earlier one listed either. So each already carries its apparatus
 * reconciliation. A bare `emt` is ambiguous — the build before it recorded
 * `emt` alone, for the heuristic-grants change — and carries the apparatus work
 * only if this draft also went through the build that wrote the other two. The
 * effect below records the whole set on every visit, so their presence is a
 * reliable signal of which build a draft last saw.
 */
const satisfiedMarkers = (recorded: readonly string[]): Set<string> => {
  const satisfied = new Set(recorded);
  for (const slug of ['member', 'firefighter'] as const) {
    if (satisfied.has(slug)) satisfied.add(`${slug}@apparatus-view`);
  }
  if (satisfied.has('emt') && (satisfied.has('member') || satisfied.has('firefighter'))) {
    satisfied.add('emt@apparatus-view');
  }
  return satisfied;
};

/**
 * Recorded once a restored draft has been raised to the all-positions baseline.
 *
 * Unticking a position deletes it, so the set left ticked *is* the department's
 * structure — and a draft persisted by the build before that change carries the
 * six positions that build preselected. Restoring one verbatim and submitting it
 * deletes the other twenty-three seeded rows, which is precisely the defect the
 * all-position initialisation exists to prevent, reached through localStorage
 * instead of through a fresh mount.
 *
 * It has to be a marker rather than an inference from the draft's contents: a
 * six-position draft written by the old build and one an administrator narrowed
 * to six on purpose are the same object. The marker says which.
 *
 * Not in `STALE_SEEDED_MARKERS` because that map is keyed by slug — "this slug's
 * seeded grants moved" — and this is a property of the whole draft.
 */
const ALL_POSITIONS_BASELINE_MARKER = '@all-positions-baseline';

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
  const reconciledSeededSlugs = useOnboardingStore((state) => state.reconciledSeededSlugs);
  const markSeededSlugsReconciled = useOnboardingStore((state) => state.markSeededSlugsReconciled);

  // Which stale slugs this mount reconciles: present in the saved config and
  // not recorded as done. Latched on first render rather than recomputed,
  // because the effect below adds to `reconciledSeededSlugs` — recomputing
  // would decide a slug was already handled while this mount is still using
  // the answer it started with.
  const slugsToReconcileRef = useRef<string[] | null>(null);
  if (slugsToReconcileRef.current === null) {
    const saved = savedPositionsConfig ?? {};
    const done = satisfiedMarkers(reconciledSeededSlugs);
    slugsToReconcileRef.current = [
      ...new Set(
        Object.entries(STALE_SEEDED_MARKERS)
          .filter(([marker, slug]) => slug in saved && !done.has(marker))
          .map(([, slug]) => slug)
      ),
    ];
  }
  const slugsToReconcile = slugsToReconcileRef.current;

  // Whether this mount raises a restored draft to the all-positions baseline.
  // Latched on first render for the same reason as the slug list above: the
  // effect that records the marker runs after, and recomputing would decide the
  // work was already done while this mount is still using the answer it began
  // with.
  const needsBaselineTopUpRef = useRef<boolean | null>(null);
  if (needsBaselineTopUpRef.current === null) {
    needsBaselineTopUpRef.current =
      !!savedPositionsConfig && !satisfiedMarkers(reconciledSeededSlugs).has(ALL_POSITIONS_BASELINE_MARKER);
  }
  const needsBaselineTopUp = needsBaselineTopUpRef.current;

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
        // 3. A slug whose seeded grants changed under a saved config. Same
        //    mechanism again — handleContinue submits whatever is here — but
        //    the entry is reconciled rather than dropped, because the position
        //    is still offered. A config read from localStorage can predate the
        //    grants this build presents, and an EMT saved on an earlier build
        //    carries the ticks a role-type heuristic chose, `reports` among
        //    them, which would be written after every migration had run.
        //    Priority comes along for the same reason: save_session_roles
        //    writes the submitted value over the seeded one, so a stale 10
        //    would put EMT back on the baseline Member position's rung.
        //
        //    Named slugs, not every seeded position, and **once** rather than
        //    on every mount. Either alone is not enough: replacing the saved
        //    map wholesale would discard edits to any built-in position, and
        //    doing it repeatedly would discard them for this slug — an
        //    administrator customizes EMT, walks to the modules step, comes
        //    back, and finds the boxes reset, with the persistence effect then
        //    writing the defaults back over their work. `reconciledSeededSlugs`
        //    records that the upgrade has happened, so a session created by
        //    this build reconciles a no-op on first mount and is then left
        //    alone. Only a slug whose seeded grants actually moved needs this,
        //    and a later change adds its own.
        const stale = template && slugsToReconcile.includes(posId);
        restored[posId] = {
          ...saved,
          ...(template ? { name: template.name } : {}),
          ...(stale ? { permissions: template.permissions, priority: template.priority } : {}),
          icon: ICON_MAP[saved.icon || 'UserCog'] || UserCog,
        };
      }

      // 4. A draft written before unticking meant deletion. It holds the six
      //    positions that build preselected, and submitting it now would delete
      //    the twenty-three it does not name. Every agency template missing from
      //    it is added back, once, so the resumed session starts from the same
      //    baseline a fresh one does.
      //
      //    Additive on purpose: an administrator's edits to the six that *are*
      //    in the draft are kept, and their custom positions with them. The
      //    cost of being wrong in this direction is a department seeing a
      //    position it has to untick again; in the other, it is a silent
      //    deletion nobody asked for.
      if (needsBaselineTopUp) {
        for (const [posId, template] of templatesById) {
          if (!(posId in restored) && !RETIRED_STANDING_SLUGS.has(posId)) {
            restored[posId] = { ...template };
          }
        }
      }

      return restored;
    }

    // Build templates for initial state. The store default is the full fire
    // set, so a wizard resumed with a cleared store offers one position too
    // many rather than silently hiding one.
    const templates = buildPositionTemplates(MODULE_REGISTRY, organizationType);

    // Everything this agency has is selected, and that is load-bearing rather
    // than a convenience.
    //
    // Unticking a position now removes it, so the set left ticked *is* the
    // department's structure — and the overwhelmingly common path through this
    // step is an administrator pressing Continue having edited nothing. That
    // click has to be a no-op, which is the same invariant
    // `test_continuing_without_editing_changes_nothing` holds for the grants
    // inside each position.
    //
    // Six positions used to be preselected, from when leaving one unticked
    // meant "do not submit it" and the row survived regardless. Carrying that
    // list forward past the deletion change would have made the default
    // Continue delete the twenty-three it does not name — Captain, Lieutenant,
    // Firefighter, Engineer, EMT, Treasurer, Quartermaster and the rest — for
    // every department that did not think to look.
    //
    // The templates are already narrowed to this agency type, and are built
    // from what the backend seeded, so submitting all of them writes back
    // exactly what is there.
    const initial: Record<string, RoleConfig> = {};
    Object.values(templates).forEach((category) => {
      category.positions.forEach((position) => {
        initial[position.id] = { ...position };
      });
    });
    return initial;
  });

  // Record **every** stale slug once this screen has been reached, not only the
  // ones the saved config happened to contain.
  //
  // Recording just the reconciled ones leaves a hole for a session started on
  // this build: EMT is not among the preselected positions, so the first mount
  // finds nothing to reconcile and records nothing. The administrator then
  // selects EMT, customizes it, walks to the modules step and comes back — and
  // the next mount, seeing EMT in the config but not in the record, treats
  // those current-build edits as legacy state and replaces them.
  //
  // A slug selected after this point was built from the current template by
  // definition, so there is nothing to reconcile in it, and recording the whole
  // set here says exactly that.
  useEffect(() => {
    markSeededSlugsReconciled([...Object.keys(STALE_SEEDED_MARKERS), ALL_POSITIONS_BASELINE_MARKER]);
  }, [markSeededSlugsReconciled]);

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

  // The membership ladder batches its edits behind its own Save, so this step
  // has to refuse to leave with them pending rather than navigate away and
  // report success for the half of the step that did save.
  const [ladderDirty, setLadderDirty] = useState(false);
  // Why it is dirty, which decides what the refusal can honestly tell them to
  // do. A ladder the backend synthesized is dirty from the moment it loads and
  // reloading re-proposes it, so "or discard" is a way out that does not exist.
  const [ladderNeverSaved, setLadderNeverSaved] = useState(false);
  // Stable, because the section reports through an effect keyed on this
  // identity — a fresh arrow each render would re-run it on every render of
  // this step.
  const handleLadderDirtyChange = useCallback((dirty: boolean, neverSaved: boolean) => {
    setLadderDirty(dirty);
    setLadderNeverSaved(neverSaved);
  }, []);
  // `ladderDirty` is false for the whole of the tier config read, including for
  // an organization with no stored `membership_tiers` — the editor opens dirty
  // only once the response says `is_saved: false`. Leaving during that window
  // is the same loss as leaving with edits pending, so the step waits for the
  // read to settle before it will believe the ladder is clean.
  const [ladderLoading, setLadderLoading] = useState(true);
  // The rank editor's Add/Edit form is the same hazard in the other section:
  // typed, not yet written, and discarded when Continue unmounts it.
  const [rankFormPending, setRankFormPending] = useState(false);
  // And the tier editor's Add a tier field is the third: its value lives inside
  // `MembershipTiersSection`, so a half-typed tier is in neither `dirty` nor
  // the config a Save would write.
  const [tierNamePending, setTierNamePending] = useState(false);
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
    if (ladderLoading) {
      toast.error('Your membership tiers are still loading — give it a moment before continuing');
      return;
    }

    if (ladderDirty) {
      toast.error(
        ladderNeverSaved
          ? 'Save your membership tiers before continuing — they have not been stored yet'
          : 'Save or discard your membership tier changes before continuing'
      );
      return;
    }

    if (rankFormPending) {
      toast.error('Save or cancel the rank you are editing before continuing');
      return;
    }

    if (tierNamePending) {
      toast.error('Add or clear the tier you are typing before continuing');
      return;
    }

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

      // Name the removals rather than counting them. Unticking a position now
      // deletes it, and "Removed: 2" gives an administrator no way to notice
      // they unticked the wrong row.
      const removed = response.data?.removed ?? [];
      toast.success(
        `Positions configured successfully! Created: ${response.data?.created?.length || 0}, Updated: ${response.data?.updated?.length || 0}` +
          (removed.length > 0 ? `. Removed: ${removed.join(', ')}` : '')
      );
      // Separately, and as an error rather than folded into the success line:
      // the save succeeded, but one of the removals the administrator asked for
      // did not happen. Left unsaid they would finish setup believing the
      // position was gone and meet it again in every picker.
      const retained = response.data?.retained ?? [];
      if (retained.length > 0) {
        toast.error(
          `Still in use, so not removed: ${retained.join(', ')}. Move the members holding ` +
            'these to another position first, then remove them under Members → Settings.',
          { duration: 8000 }
        );
      }
      void navigate(nextStepPath('positions'));
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

      <main id="main-content" tabIndex={-1} className="flex-1 p-4 py-8">
        <div className="mx-auto w-full max-w-6xl">
          <BackButton to={previousStepPath('positions')} className="mb-6" />

          {/* Header */}
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-800">
              <Users className="h-8 w-8 text-white" aria-hidden="true" />
            </div>
            <h1 className="text-theme-text-primary mb-3 text-4xl font-bold md:text-5xl">Set Up Ranks & Positions</h1>
            <p className="text-theme-text-secondary mb-2 text-xl">
              Describe the structure your department already uses
            </p>
            <p className="text-theme-text-muted mx-auto max-w-2xl text-sm">
              Your membership ladder first, then the ranks your members hold, then the positions that decide what they
              can view and manage. Start from what we have suggested and change it to match your department — nothing
              here is fixed.
            </p>
          </div>

          <MembershipLadderSection
            onDirtyChange={handleLadderDirtyChange}
            onLoadingChange={setLadderLoading}
            onPendingTierChange={setTierNamePending}
          />

          <RankLadderSection onPendingChange={setRankFormPending} />

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
                  <p className="text-theme-text-secondary mt-2 text-sm">
                    Every position your department could have starts selected. Untick the ones you do not use and they
                    will be removed — your own System Owner position and the baseline Member position are always kept.
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
                    ? 'bg-linear-to-r from-red-700 to-orange-700 text-white hover:from-red-800 hover:to-orange-800'
                    : 'bg-theme-surface text-theme-text-muted cursor-not-allowed'
                }`}
              >
                {isSaving ? 'Saving...' : `Continue to ${nextStepName('positions')}`}
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
                                // A tier another module's checkbox also opens
                                // is read off the grid being edited, not off a
                                // stored answer: unticking Inventory releases
                                // Medical Supplies in the same breath. See
                                // MODULE_CHECKBOX_CONFERRED_BY.
                                const conferrer = (tier: 'view' | 'manage') => {
                                  const pair = cat.conferredBy[tier];
                                  if (!pair) return null;
                                  const [moduleId, action] = pair;
                                  if (!position.permissions[moduleId]?.[action]) return null;
                                  return permissionCategories[moduleId]?.name ?? moduleId;
                                };
                                const viaView = conferrer('view');
                                const viaManage = conferrer('manage');
                                // Shown on, and not editable: unticking cannot
                                // revoke what the other grant confers, and a
                                // control that silently does nothing is worse
                                // than one that says why it is fixed.
                                const viewNote = viaView
                                  ? `${cat.name} view comes with ${viaView} view and cannot be turned off separately`
                                  : undefined;
                                const manageNote = viaManage
                                  ? `${cat.name} management comes with ${viaManage} manage and cannot be turned off separately`
                                  : undefined;

                                return (
                                  <div
                                    key={catId}
                                    className="bg-theme-surface-secondary flex items-center justify-between rounded-sm px-3 py-2"
                                  >
                                    <span className="text-theme-text-secondary text-sm">{cat.name}</span>
                                    <div className="flex items-center gap-2">
                                      {cat.tiers.view && (
                                        <button
                                          onClick={() =>
                                            updatePositionPermission(position.id, catId, 'view', !perms.view)
                                          }
                                          disabled={isITManager || !!viaView}
                                          title={viewNote}
                                          aria-label={
                                            viewNote ??
                                            `${perms.view ? 'Disable' : 'Enable'} view permission for ${cat.name}`
                                          }
                                          className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                                            perms.view || viaView
                                              ? 'bg-theme-accent-green-muted text-theme-accent-green'
                                              : 'bg-theme-surface text-theme-text-muted'
                                          } ${isITManager || viaView ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
                                        >
                                          {viaView ? (
                                            <Lock className="h-3 w-3" aria-hidden="true" />
                                          ) : (
                                            <Eye className="h-3 w-3" aria-hidden="true" />
                                          )}
                                          View
                                        </button>
                                      )}
                                      {cat.tiers.manage && (
                                        <button
                                          onClick={() =>
                                            updatePositionPermission(position.id, catId, 'manage', !perms.manage)
                                          }
                                          disabled={isITManager || !!viaManage}
                                          title={manageNote}
                                          aria-label={
                                            manageNote ??
                                            `${perms.manage ? 'Disable' : 'Enable'} manage permission for ${cat.name}`
                                          }
                                          className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                                            perms.manage || viaManage
                                              ? 'bg-theme-accent-orange-muted text-theme-accent-orange'
                                              : 'bg-theme-surface text-theme-text-muted'
                                          } ${isITManager || viaManage ? 'cursor-not-allowed' : 'hover:opacity-80'}`}
                                        >
                                          {viaManage ? (
                                            <Lock className="h-3 w-3" aria-hidden="true" />
                                          ) : (
                                            <Edit3 className="h-3 w-3" aria-hidden="true" />
                                          )}
                                          Manage
                                        </button>
                                      )}
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
                className="flex-1 rounded-lg bg-linear-to-r from-red-700 to-orange-700 px-4 py-2 font-semibold text-white transition-colors hover:from-red-800 hover:to-orange-800"
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
