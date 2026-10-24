/**
 * Apparatus Basic Page (Lightweight)
 *
 * Used when the full Apparatus module is NOT enabled.
 * Provides basic vehicle/unit definitions for use by shift scheduling,
 * training sessions, and other cross-module features.
 *
 * When the Apparatus module IS enabled, the full ApparatusPage handles
 * all vehicle management instead.
 */

import { useState, useEffect, useCallback } from 'react';
import { useDialog } from '../hooks/useDialog';
import {
  Truck,
  Plus,
  Search,
  Pencil,
  Trash2,
  Loader2,
  X,
  Save,
  Shield,
  Users,
  Wrench,
  ArchiveRestore,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import { schedulingService } from '../modules/scheduling/services/api';

import { useConfirm } from '../contexts/ConfirmContext';
import { useAuthStore } from '../stores/authStore';
import { positionLabel } from '../modules/scheduling/utils/positionLabels';
import { OperationsPageHeader } from '../components/operations/OperationsPageHeader';
interface BasicApparatus {
  id: string;
  organization_id?: string;
  unit_number: string;
  name: string;
  apparatus_type: string;
  station_id?: string;
  station_name?: string;
  min_staffing?: number;
  positions?: string[];
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

const APPARATUS_TYPES = [
  { value: 'engine', label: 'Engine', icon: '🚒' },
  { value: 'ladder', label: 'Ladder/Truck', icon: '🪜' },
  { value: 'ambulance', label: 'Ambulance/Medic', icon: '🚑' },
  { value: 'rescue', label: 'Rescue', icon: '🛟' },
  { value: 'tanker', label: 'Tanker', icon: '💧' },
  { value: 'brush', label: 'Brush/Wildland', icon: '🌲' },
  { value: 'quint', label: 'Quint', icon: '🚒' },
  { value: 'squad', label: 'Squad', icon: '🚐' },
  { value: 'hazmat', label: 'HazMat', icon: '☢️' },
  { value: 'command', label: 'Command', icon: '📡' },
  { value: 'utility', label: 'Utility', icon: '🔧' },
  { value: 'boat', label: 'Boat', icon: '🚤' },
  { value: 'other', label: 'Other', icon: '🚗' },
];

// Seat *values*, not labels. These must stay in the vocabulary the signup API
// speaks (ShiftPosition) and that ranks grant (operational_ranks.
// eligible_positions) — an apparatus seat outside it cannot be signed up for by
// anyone, because the API has no way to name it. This list previously carried
// 'EMT' where the rest of the system says 'ems', which made every EMT seat on
// every ambulance unfillable. Labels come from positionLabel().
const POSITION_OPTIONS = [
  'officer',
  'driver',
  'firefighter',
  'ems',
  // A medic seat is a different seat from an EMT one -- an ALS unit that
  // must be staffed by a paramedic cannot say so with 'ems' alone. Values
  // here must stay within CANONICAL_POSITIONS; test_position_slots.py parses
  // this list to enforce it.
  'paramedic',
  'captain',
  'lieutenant',
  'probationary',
  'volunteer',
];

const DEFAULT_POSITIONS_BY_TYPE: Record<string, string[]> = {
  engine: ['officer', 'driver', 'firefighter', 'firefighter'],
  ladder: ['officer', 'driver', 'firefighter', 'firefighter'],
  ambulance: ['driver', 'ems'],
  rescue: ['officer', 'driver', 'firefighter', 'firefighter'],
  tanker: ['driver', 'firefighter'],
  brush: ['driver', 'firefighter'],
  quint: ['officer', 'driver', 'firefighter', 'firefighter', 'firefighter'],
  squad: ['officer', 'driver', 'firefighter'],
  hazmat: ['officer', 'driver', 'firefighter', 'firefighter'],
  command: ['officer'],
  utility: ['driver'],
  boat: ['driver', 'firefighter'],
  other: ['driver'],
};

// BasicApparatusCreate's bounds in backend/app/schemas/scheduling.py.
const UNIT_NUMBER_MAX_LENGTH = 20;
const NAME_MAX_LENGTH = 100;
const MIN_STAFFING_MAX = 50;

export default function ApparatusBasicPage() {
  const { confirm } = useConfirm();
  const [apparatusList, setApparatusList] = useState<BasicApparatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // A vehicle in use is deactivated rather than deleted, which drops it from
  // the list; this is the way back to it.
  const [showInactive, setShowInactive] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BasicApparatus | null>(null);
  const [form, setForm] = useState({
    unit_number: '',
    name: '',
    apparatus_type: 'engine',
    // Held as the box's text so a cleared field reads as blank, not as 0.
    min_staffing: '4',
    positions: ['officer', 'driver', 'firefighter', 'firefighter'] as string[],
  });
  const [isSaving, setIsSaving] = useState(false);

  const loadApparatus = useCallback(async () => {
    setIsLoading(true);
    try {
      // The list endpoint answers one state at a time, so inactive vehicles
      // are a second request, listed after the active ones.
      const data = showInactive
        ? (
            await Promise.all([
              schedulingService.getBasicApparatus(),
              schedulingService.getBasicApparatus({ is_active: false }),
            ])
          ).flat()
        : await schedulingService.getBasicApparatus();
      // Map PositionSlot[] to flat string[] for the local form model
      setApparatusList(
        data.map((a) => ({
          ...a,
          positions: a.positions?.map((p) => p.position) ?? [],
        }))
      );
    } catch {
      toast.error('Failed to load apparatus');
    } finally {
      setIsLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    void loadApparatus();
  }, [loadApparatus]);

  const filtered = apparatusList.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.unit_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.apparatus_type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openCreate = () => {
    setEditing(null);
    setForm({
      unit_number: '',
      name: '',
      apparatus_type: 'engine',
      min_staffing: '4',
      positions: [...(DEFAULT_POSITIONS_BY_TYPE.engine ?? [])],
    });
    setShowModal(true);
  };

  const openEdit = (apparatus: BasicApparatus) => {
    setEditing(apparatus);
    setForm({
      unit_number: apparatus.unit_number,
      name: apparatus.name,
      apparatus_type: apparatus.apparatus_type,
      min_staffing: String(apparatus.min_staffing || 1),
      positions: apparatus.positions || [],
    });
    setShowModal(true);
  };

  const handleTypeChange = (type: string) => {
    setForm((prev) => ({
      ...prev,
      apparatus_type: type,
      positions: DEFAULT_POSITIONS_BY_TYPE[type] || ['driver'],
      min_staffing: String((DEFAULT_POSITIONS_BY_TYPE[type] || ['driver']).length),
    }));
  };

  const addPosition = () => {
    setForm((prev) => ({
      ...prev,
      positions: [...prev.positions, 'firefighter'],
    }));
  };

  const removePosition = (index: number) => {
    setForm((prev) => ({
      ...prev,
      positions: prev.positions.filter((_, i) => i !== index),
    }));
  };

  const updatePosition = (index: number, value: string) => {
    setForm((prev) => ({
      ...prev,
      positions: prev.positions.map((p, i) => (i === index ? value : p)),
    }));
  };

  const handleSave = async () => {
    if (!form.unit_number.trim()) {
      toast.error('Unit number is required');
      return;
    }
    // These mirror BasicApparatusCreate (unit_number max_length=20, name
    // max_length=100, min_staffing ge=1 le=50), so the form names the problem
    // instead of the save failing with a bare error.
    if (form.unit_number.trim().length > UNIT_NUMBER_MAX_LENGTH) {
      toast.error(`Unit number must be ${UNIT_NUMBER_MAX_LENGTH} characters or fewer`);
      return;
    }
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (form.name.trim().length > NAME_MAX_LENGTH) {
      toast.error(`Name must be ${NAME_MAX_LENGTH} characters or fewer`);
      return;
    }
    const minStaffing = form.min_staffing.trim() === '' ? Number.NaN : Number(form.min_staffing);
    if (!Number.isInteger(minStaffing) || minStaffing < 1 || minStaffing > MIN_STAFFING_MAX) {
      toast.error(`Minimum staffing must be a whole number from 1 to ${MIN_STAFFING_MAX}`);
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        unit_number: form.unit_number.trim(),
        name: form.name.trim(),
        apparatus_type: form.apparatus_type,
        min_staffing: minStaffing,
        positions: form.positions,
      };
      if (editing) {
        await schedulingService.updateBasicApparatus(editing.id, payload);
        toast.success('Apparatus updated');
      } else {
        await schedulingService.createBasicApparatus(payload);
        toast.success('Apparatus added');
      }
      setShowModal(false);
      void loadApparatus();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save apparatus'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (apparatus: BasicApparatus) => {
    if (
      !(await confirm({
        title: 'Delete apparatus',
        message: `Delete "${apparatus.name}" (${apparatus.unit_number})? If shift templates, shifts, equipment checks or call records name it, it is deactivated instead of deleted: those records keep it, and it is no longer offered for new templates. Otherwise it is deleted, which cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      const outcome = await schedulingService.deleteBasicApparatus(apparatus.id);
      toast.success(
        outcome === 'deactivated'
          ? `${apparatus.name} is still named by templates, shifts or call records, so it was deactivated instead of deleted.`
          : 'Apparatus deleted'
      );
      void loadApparatus();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete apparatus'));
    }
  };

  const handleReactivate = async (apparatus: BasicApparatus) => {
    if (
      !(await confirm({
        title: 'Reactivate apparatus',
        message: `Reactivate "${apparatus.name}" (${apparatus.unit_number})? It is offered again for new shift templates and shifts. Nothing is added back to any shift or template.`,
        confirmLabel: 'Reactivate',
        cancelLabel: 'Leave inactive',
        variant: 'info',
      }))
    )
      return;
    setReactivatingId(apparatus.id);
    try {
      await schedulingService.reactivateBasicApparatus(apparatus.id);
      toast.success(`${apparatus.name} reactivated`);
      void loadApparatus();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reactivate apparatus'));
    } finally {
      setReactivatingId(null);
    }
  };

  const getTypeInfo = (type: string) =>
    APPARATUS_TYPES.find((t) => t.value === type) || APPARATUS_TYPES[APPARATUS_TYPES.length - 1];
  const inputCls = 'form-input py-2.5';
  const labelCls = 'form-label';

  const dialogRef = useDialog<HTMLDivElement>({ isOpen: showModal, onClose: () => setShowModal(false) });

  // Reading the fleet is auth-only on purpose — a department without the
  // Apparatus module still needs these unit definitions for shift staffing,
  // which is why the route carries no permission gate. Writing is not: the
  // create/update/delete endpoints all require `scheduling.manage`, so the
  // controls for them are gated on it rather than left to 403.
  const canManage = useAuthStore((state) => state.checkPermission('scheduling.manage'));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <OperationsPageHeader
        icon={Truck}
        title="Apparatus & Vehicles"
        subtitle="Define your department's vehicles and crew positions for shift scheduling"
        actions={
          canManage && (
            <button onClick={openCreate} className="btn-primary flex shrink-0 items-center gap-2 py-2.5">
              <Plus className="h-4 w-4" /> Add Apparatus
            </button>
          )
        }
      />

      {/* Info Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
        <Shield className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="text-theme-text-secondary text-sm">
          <p>
            Apparatus defined here are available for shift scheduling. Each apparatus includes crew positions that
            determine how many members are needed to staff it per shift. Enable the full Apparatus module for
            maintenance tracking, equipment inventory, and more.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="relative max-w-md flex-1">
          <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search apparatus..."
            placeholder="Search apparatus..."
            className="form-input placeholder-theme-text-muted py-2.5 pr-4 pl-10"
          />
        </div>
        {/* Only an officer can bring an inactive vehicle back, so only an
            officer is offered the list of them. */}
        {canManage && (
          <label className="text-theme-text-secondary mobile-touch-target flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
        )}
      </div>

      {/* Apparatus List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : filtered.length === 0 && !searchQuery ? (
        <div className="py-20 text-center">
          <Truck className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <h3 className="text-theme-text-primary mb-1 text-lg font-medium">No apparatus defined</h3>
          <p className="text-theme-text-muted mb-4">
            {canManage
              ? "Add your department's vehicles to start building shift assignments with crew positions."
              : 'A scheduling officer defines the vehicles and crew positions used for shift assignments.'}
          </p>
          {canManage && (
            <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2 py-2.5">
              <Plus className="h-4 w-4" /> Add First Apparatus
            </button>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-theme-text-muted">No apparatus matching "{searchQuery}"</p>
        </div>
      ) : (
        <div className="card-grid gap-4">
          {filtered.map((apparatus) => {
            const typeInfo = getTypeInfo(apparatus.apparatus_type);
            return (
              <div key={apparatus.id} className="card group hover:border-theme-text-muted/30 p-5">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-lg">
                      {typeInfo?.icon}
                    </div>
                    <div>
                      <h3 className="text-theme-text-primary text-lg font-semibold">{apparatus.name}</h3>
                      <p className="text-theme-text-secondary text-sm">{apparatus.unit_number}</p>
                    </div>
                  </div>
                  {!apparatus.is_active && (
                    <span className="badge bg-theme-surface-secondary text-theme-text-secondary shrink-0">
                      Inactive
                    </span>
                  )}
                </div>

                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="bg-theme-surface-hover text-theme-text-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium">
                    <Wrench className="h-3 w-3" /> {typeInfo?.label}
                  </span>
                  <span className="bg-theme-surface-hover text-theme-text-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium">
                    <Users className="h-3 w-3" /> {apparatus.min_staffing || 0} crew
                  </span>
                  {/* The actions share this short badge row rather than the title's:
                      hidden until hover with a mouse, they would still hold their
                      width beside a long name and wrap it a line early. */}
                  {canManage && !apparatus.is_active && (
                    <button
                      type="button"
                      onClick={() => {
                        void handleReactivate(apparatus);
                      }}
                      disabled={reactivatingId === apparatus.id}
                      aria-label={`Reactivate ${apparatus.name}`}
                      className="btn-secondary btn-sm ml-auto"
                    >
                      {reactivatingId === apparatus.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Reactivate
                    </button>
                  )}
                  {canManage && apparatus.is_active && (
                    <div className="ml-auto flex items-center gap-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
                      <button
                        onClick={() => openEdit(apparatus)}
                        title="Edit"
                        aria-label={`Edit ${apparatus.name}`}
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded-lg p-2 transition-colors"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => {
                          void handleDelete(apparatus);
                        }}
                        title="Delete"
                        aria-label={`Delete ${apparatus.name}`}
                        className="text-theme-text-muted touch-target-phone rounded-lg p-2 transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>

                {apparatus.positions && apparatus.positions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {apparatus.positions.map((pos, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-violet-500/10 px-2 py-0.5 text-xs text-violet-700 capitalize dark:text-violet-400"
                      >
                        {positionLabel(pos)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {canManage && showModal && (
        <div
          className="modal-overlay z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="apparatus-basic-dialog-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowModal(false);
          }}
        >
          <div ref={dialogRef} className="modal-panel max-h-[90dvh] w-full max-w-lg overflow-y-auto">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <h2 id="apparatus-basic-dialog-title" className="text-theme-text-primary text-lg font-bold">
                {editing ? 'Edit Apparatus' : 'Add Apparatus'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                aria-label="Close dialog"
                className="text-theme-text-muted hover:text-theme-text-primary"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="apparatus-basic-unit" className={labelCls}>
                    Unit Number *
                  </label>
                  <input
                    id="apparatus-basic-unit"
                    type="text"
                    value={form.unit_number}
                    onChange={(e) => setForm((p) => ({ ...p, unit_number: e.target.value }))}
                    placeholder="e.g., E-1, L-1, M-1"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="apparatus-basic-name" className={labelCls}>
                    Name *
                  </label>
                  <input
                    id="apparatus-basic-name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., Engine 1, Ladder 1"
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="apparatus-basic-type" className={labelCls}>
                  Apparatus Type
                </label>
                <select
                  id="apparatus-basic-type"
                  value={form.apparatus_type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className={inputCls}
                >
                  {APPARATUS_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.icon} {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="apparatus-basic-min-staffing" className={labelCls}>
                  Minimum Staffing *
                </label>
                <input
                  id="apparatus-basic-min-staffing"
                  type="number"
                  min={1}
                  max={MIN_STAFFING_MAX}
                  step={1}
                  required
                  aria-required="true"
                  value={form.min_staffing}
                  onChange={(e) => setForm((p) => ({ ...p, min_staffing: e.target.value }))}
                  className={inputCls}
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className={labelCls}>Crew Positions</label>
                  <button
                    type="button"
                    onClick={addPosition}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                  >
                    <Plus className="h-3 w-3" /> Add Position
                  </button>
                </div>
                <div className="space-y-2">
                  {form.positions.map((pos, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-theme-text-muted w-6 text-right text-xs">{i + 1}.</span>
                      <select
                        aria-label={`Crew position ${i + 1}`}
                        value={pos}
                        onChange={(e) => updatePosition(i, e.target.value)}
                        className="form-input flex-1"
                      >
                        {POSITION_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {positionLabel(o)}
                          </option>
                        ))}
                      </select>
                      {form.positions.length > 1 && (
                        <button
                          onClick={() => removePosition(i)}
                          aria-label={`Remove crew position ${i + 1}`}
                          className="text-theme-text-muted rounded-sm p-1.5 transition-colors hover:text-red-500"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
              <button
                onClick={() => setShowModal(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleSave();
                }}
                disabled={isSaving || !form.unit_number.trim() || !form.name.trim()}
                className="btn-primary flex items-center gap-2 px-5"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {editing ? 'Update' : 'Add Apparatus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
