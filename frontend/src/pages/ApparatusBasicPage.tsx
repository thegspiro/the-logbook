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
import { Truck, Plus, Search, Pencil, Trash2, Loader2, X, Save, Shield, Users, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../modules/scheduling/services/api';

import { useConfirm } from '../contexts/ConfirmContext';
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

const POSITION_OPTIONS = [
  'officer',
  'driver',
  'firefighter',
  'EMT',
  'captain',
  'lieutenant',
  'probationary',
  'volunteer',
];

const DEFAULT_POSITIONS_BY_TYPE: Record<string, string[]> = {
  engine: ['officer', 'driver', 'firefighter', 'firefighter'],
  ladder: ['officer', 'driver', 'firefighter', 'firefighter'],
  ambulance: ['driver', 'EMT'],
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

export default function ApparatusBasicPage() {
  const { confirm } = useConfirm();
  const [apparatusList, setApparatusList] = useState<BasicApparatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BasicApparatus | null>(null);
  const [form, setForm] = useState({
    unit_number: '',
    name: '',
    apparatus_type: 'engine',
    min_staffing: 4,
    positions: ['officer', 'driver', 'firefighter', 'firefighter'] as string[],
  });
  const [isSaving, setIsSaving] = useState(false);

  const loadApparatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await schedulingService.getBasicApparatus();
      // Map PositionSlot[] to flat string[] for the local form model
      setApparatusList(
        data.map((a) => ({
          ...a,
          positions: a.positions?.map((p) => (typeof p === 'string' ? p : p.position)) ?? [],
        }))
      );
    } catch {
      toast.error('Failed to load apparatus');
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      min_staffing: 4,
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
      min_staffing: apparatus.min_staffing || 1,
      positions: apparatus.positions || [],
    });
    setShowModal(true);
  };

  const handleTypeChange = (type: string) => {
    setForm((prev) => ({
      ...prev,
      apparatus_type: type,
      positions: DEFAULT_POSITIONS_BY_TYPE[type] || ['driver'],
      min_staffing: (DEFAULT_POSITIONS_BY_TYPE[type] || ['driver']).length,
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
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        unit_number: form.unit_number.trim(),
        name: form.name.trim(),
        apparatus_type: form.apparatus_type,
        min_staffing: form.min_staffing,
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
    } catch {
      toast.error('Failed to save apparatus');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (apparatus: BasicApparatus) => {
    if (
      !(await confirm({
        title: 'Delete apparatus',
        message: `Delete "${apparatus.name}" (${apparatus.unit_number})? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await schedulingService.deleteBasicApparatus(apparatus.id);
      toast.success('Apparatus deleted');
      void loadApparatus();
    } catch {
      toast.error('Failed to delete apparatus');
    }
  };

  const getTypeInfo = (type: string) =>
    APPARATUS_TYPES.find((t) => t.value === type) || APPARATUS_TYPES[APPARATUS_TYPES.length - 1];
  const inputCls =
    'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
  const labelCls = 'block text-sm font-medium text-theme-text-secondary mb-1';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-theme-text-primary text-3xl font-bold">Apparatus & Vehicles</h1>
          <p className="text-theme-text-secondary mt-1">
            Define your department's vehicles and crew positions for shift scheduling
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2 py-2.5">
          <Plus className="h-4 w-4" /> Add Apparatus
        </button>
      </div>

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
      <div className="relative max-w-md">
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
            Add your department's vehicles to start building shift assignments with crew positions.
          </p>
          <button onClick={openCreate} className="btn-primary inline-flex items-center gap-2 py-2.5">
            <Plus className="h-4 w-4" /> Add First Apparatus
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-theme-text-muted">No apparatus matching "{searchQuery}"</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((apparatus) => {
            const typeInfo = getTypeInfo(apparatus.apparatus_type);
            return (
              <div
                key={apparatus.id}
                className="bg-theme-surface border-theme-surface-border group hover:border-theme-text-muted/30 rounded-xl border p-5 transition-colors"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-lg">
                      {typeInfo?.icon}
                    </div>
                    <div>
                      <h3 className="text-theme-text-primary text-lg font-semibold">{apparatus.name}</h3>
                      <p className="text-theme-text-secondary text-sm">{apparatus.unit_number}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      onClick={() => openEdit(apparatus)}
                      title="Edit"
                      aria-label="Edit apparatus"
                      className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-2 transition-colors"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => {
                        void handleDelete(apparatus);
                      }}
                      title="Delete"
                      aria-label="Delete apparatus"
                      className="text-theme-text-muted rounded-lg p-2 transition-colors hover:bg-red-500/10 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="mb-3 flex items-center gap-2">
                  <span className="bg-theme-surface-hover text-theme-text-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium">
                    <Wrench className="h-3 w-3" /> {typeInfo?.label}
                  </span>
                  <span className="bg-theme-surface-hover text-theme-text-secondary inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium">
                    <Users className="h-3 w-3" /> {apparatus.min_staffing || 0} crew
                  </span>
                </div>

                {apparatus.positions && apparatus.positions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {apparatus.positions.map((pos, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-violet-500/10 px-2 py-0.5 text-xs text-violet-700 capitalize dark:text-violet-400"
                      >
                        {pos}
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
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowModal(false);
          }}
        >
          <div className="bg-theme-surface-modal border-theme-surface-border max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <h2 className="text-theme-text-primary text-lg font-bold">
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
                  <label className={labelCls}>Unit Number *</label>
                  <input
                    type="text"
                    value={form.unit_number}
                    onChange={(e) => setForm((p) => ({ ...p, unit_number: e.target.value }))}
                    placeholder="e.g., E-1, L-1, M-1"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., Engine 1, Ladder 1"
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Apparatus Type</label>
                <select
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
                <label className={labelCls}>Minimum Staffing</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={form.min_staffing}
                  onChange={(e) => setForm((p) => ({ ...p, min_staffing: Number(e.target.value) }))}
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
                        value={pos}
                        onChange={(e) => updatePosition(i, e.target.value)}
                        className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                      >
                        {POSITION_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o.charAt(0).toUpperCase() + o.slice(1)}
                          </option>
                        ))}
                      </select>
                      {form.positions.length > 1 && (
                        <button
                          onClick={() => removePosition(i)}
                          aria-label="Remove position"
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
