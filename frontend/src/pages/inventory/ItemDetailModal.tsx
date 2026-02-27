import React, { useEffect, useState, useCallback } from 'react';
import {
  X,
  Shield,
  ClipboardList,
  Flame,
  Info,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Plus,
  Loader2,
  Clock,
  UserCheck,
  LogOut,
  LogIn,
  Send,
  Undo2,
  Wrench,
} from 'lucide-react';
import {
  inventoryService,
  type InventoryItem,
  type InventoryCategory,
  type NFPACompliance,
  type NFPAExposureRecord,
  type MaintenanceRecord,
  type ItemHistoryEvent,
} from '../../services/api';
import {
  NFPA_CONTAMINATION_LEVEL_OPTIONS,
  NFPA_EXPOSURE_TYPE_OPTIONS,
  NFPA_ENSEMBLE_ROLE_OPTIONS,
} from '../../constants/enums';
import toast from 'react-hot-toast';

type DetailTab = 'general' | 'history' | 'nfpa' | 'inspections' | 'exposures';

interface ItemDetailModalProps {
  item: InventoryItem;
  category?: InventoryCategory;
  onClose: () => void;
  onEdit: (item: InventoryItem) => void;
  canManage: boolean;
}

const inputClass =
  'w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500';

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString();
}

function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ============================================
// General Info Tab
// ============================================

function GeneralTab({ item }: { item: InventoryItem }) {
  const fields: Array<{ label: string; value: string | undefined | null }> = [
    { label: 'Name', value: item.name },
    { label: 'Description', value: item.description },
    { label: 'Serial Number', value: item.serial_number },
    { label: 'Asset Tag', value: item.asset_tag },
    { label: 'Barcode', value: item.barcode },
    { label: 'Manufacturer', value: item.manufacturer },
    { label: 'Model Number', value: item.model_number },
    { label: 'Size', value: item.size },
    { label: 'Color', value: item.color },
    { label: 'Condition', value: item.condition },
    { label: 'Status', value: item.status },
    { label: 'Purchase Date', value: formatDate(item.purchase_date) },
    { label: 'Warranty Expiration', value: formatDate(item.warranty_expiration) },
    { label: 'Notes', value: item.notes },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {fields.map(
        (f) =>
          f.value &&
          f.value !== '—' && (
            <div key={f.label}>
              <dt className="text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                {f.label}
              </dt>
              <dd className="mt-1 text-sm text-theme-text-primary">{f.value}</dd>
            </div>
          )
      )}
    </div>
  );
}

// ============================================
// NFPA Compliance Tab
// ============================================

function NFPAComplianceTab({
  item,
  canManage,
}: {
  item: InventoryItem;
  canManage: boolean;
}) {
  const [compliance, setCompliance] = useState<NFPACompliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<NFPACompliance>>({});

  const load = useCallback(async () => {
    try {
      const data = await inventoryService.getNFPACompliance(item.id);
      setCompliance(data);
      setForm(data);
    } catch {
      setCompliance(null);
    } finally {
      setLoading(false);
    }
  }, [item.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    try {
      if (compliance) {
        const updated = await inventoryService.updateNFPACompliance(item.id, form);
        setCompliance(updated);
        toast.success('NFPA compliance updated');
      } else {
        const created = await inventoryService.createNFPACompliance(item.id, form);
        setCompliance(created);
        toast.success('NFPA compliance record created');
      }
      setEditing(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save compliance'
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  const retirementDays = daysUntil(compliance?.expected_retirement_date);

  if (!compliance && !editing) {
    return (
      <div className="text-center py-12">
        <Shield className="mx-auto h-10 w-10 text-theme-text-muted mb-3" />
        <p className="text-theme-text-muted mb-4">No NFPA compliance record yet.</p>
        {canManage && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm"
          >
            <Plus className="h-4 w-4" />
            Create Compliance Record
          </button>
        )}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-theme-text-primary">
          Lifecycle Dates (NFPA 1851 §10.1.2)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Manufacture Date
            </label>
            <input
              type="date"
              className={inputClass}
              value={form.manufacture_date ?? ''}
              onChange={(e) =>
                setForm({ ...form, manufacture_date: e.target.value || undefined })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              First In-Service Date
            </label>
            <input
              type="date"
              className={inputClass}
              value={form.first_in_service_date ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  first_in_service_date: e.target.value || undefined,
                })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Expected Retirement Date
            </label>
            <input
              type="date"
              className={inputClass}
              value={form.expected_retirement_date ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  expected_retirement_date: e.target.value || undefined,
                })
              }
            />
          </div>
        </div>

        <h4 className="text-sm font-semibold text-theme-text-primary pt-2">
          Ensemble Assignment
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Ensemble ID
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="e.g. ENS-001"
              value={form.ensemble_id ?? ''}
              onChange={(e) =>
                setForm({ ...form, ensemble_id: e.target.value || undefined })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Role in Ensemble
            </label>
            <select
              className={inputClass}
              value={form.ensemble_role ?? ''}
              onChange={(e) =>
                setForm({ ...form, ensemble_role: e.target.value || undefined })
              }
            >
              <option value="">— Select —</option>
              {NFPA_ENSEMBLE_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <h4 className="text-sm font-semibold text-theme-text-primary pt-2">
          SCBA Fields (NFPA 1852)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Cylinder Manufacture Date
            </label>
            <input
              type="date"
              className={inputClass}
              value={form.cylinder_manufacture_date ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  cylinder_manufacture_date: e.target.value || undefined,
                })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Cylinder Expiration Date
            </label>
            <input
              type="date"
              className={inputClass}
              value={form.cylinder_expiration_date ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  cylinder_expiration_date: e.target.value || undefined,
                })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Hydrostatic Test Date
            </label>
            <input
              type="date"
              className={inputClass}
              value={form.hydrostatic_test_date ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  hydrostatic_test_date: e.target.value || undefined,
                })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Hydrostatic Test Due
            </label>
            <input
              type="date"
              className={inputClass}
              value={form.hydrostatic_test_due ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  hydrostatic_test_due: e.target.value || undefined,
                })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Flow Test Date
            </label>
            <input
              type="date"
              className={inputClass}
              value={form.flow_test_date ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  flow_test_date: e.target.value || undefined,
                })
              }
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Flow Test Due
            </label>
            <input
              type="date"
              className={inputClass}
              value={form.flow_test_due ?? ''}
              onChange={(e) =>
                setForm({
                  ...form,
                  flow_test_due: e.target.value || undefined,
                })
              }
            />
          </div>
        </div>

        <h4 className="text-sm font-semibold text-theme-text-primary pt-2">
          Contamination
        </h4>
        <select
          className={inputClass}
          value={form.contamination_level ?? 'none'}
          onChange={(e) =>
            setForm({ ...form, contamination_level: e.target.value })
          }
        >
          {NFPA_CONTAMINATION_LEVEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <div className="flex justify-end gap-3 pt-4">
          <button
            onClick={() => {
              setEditing(false);
              if (compliance) setForm(compliance);
            }}
            className="px-4 py-2 text-sm border border-theme-input-border rounded-lg text-theme-text-primary hover:bg-theme-surface-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  // Read-only view
  return (
    <div className="space-y-6">
      {/* Retirement warning banner */}
      {retirementDays !== null && retirementDays <= 180 && (
        <div
          className={`flex items-center gap-3 p-3 rounded-lg border ${
            retirementDays <= 0
              ? 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'
              : retirementDays <= 90
                ? 'bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400'
                : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400'
          }`}
        >
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">
            {retirementDays <= 0
              ? 'This item has exceeded its 10-year service life and must be retired per NFPA 1851.'
              : `This item reaches its 10-year service life in ${retirementDays} days.`}
          </span>
        </div>
      )}

      {/* Lifecycle section */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">
          Lifecycle (NFPA 1851 §10.1.2)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <dt className="text-xs text-theme-text-muted">Manufacture Date</dt>
            <dd className="mt-1 text-sm text-theme-text-primary font-medium">
              {formatDate(compliance?.manufacture_date)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-theme-text-muted">First In-Service</dt>
            <dd className="mt-1 text-sm text-theme-text-primary font-medium">
              {formatDate(compliance?.first_in_service_date)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-theme-text-muted">
              Expected Retirement
            </dt>
            <dd className="mt-1 text-sm text-theme-text-primary font-medium">
              {formatDate(compliance?.expected_retirement_date)}
              {retirementDays !== null && retirementDays > 0 && (
                <span className="ml-2 text-xs text-theme-text-muted">
                  ({retirementDays}d)
                </span>
              )}
            </dd>
          </div>
        </div>
      </section>

      {/* Ensemble section */}
      {compliance?.ensemble_id && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">
            Ensemble
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-theme-text-muted">Ensemble ID</dt>
              <dd className="mt-1 text-sm text-theme-text-primary font-medium">
                {compliance.ensemble_id}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-theme-text-muted">Role</dt>
              <dd className="mt-1 text-sm text-theme-text-primary font-medium capitalize">
                {compliance.ensemble_role ?? '—'}
              </dd>
            </div>
          </div>
        </section>
      )}

      {/* SCBA section */}
      {(compliance?.hydrostatic_test_date ||
        compliance?.cylinder_manufacture_date) && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">
            SCBA (NFPA 1852)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-theme-text-muted">
                Cylinder Manufactured
              </dt>
              <dd className="mt-1 text-sm text-theme-text-primary">
                {formatDate(compliance.cylinder_manufacture_date)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-theme-text-muted">
                Cylinder Expiration
              </dt>
              <dd className="mt-1 text-sm text-theme-text-primary">
                {formatDate(compliance.cylinder_expiration_date)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-theme-text-muted">
                Hydrostatic Test
              </dt>
              <dd className="mt-1 text-sm text-theme-text-primary">
                {formatDate(compliance.hydrostatic_test_date)}
                {compliance.hydrostatic_test_due && (
                  <span className="ml-2 text-xs text-theme-text-muted">
                    (due {formatDate(compliance.hydrostatic_test_due)})
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-theme-text-muted">Flow Test</dt>
              <dd className="mt-1 text-sm text-theme-text-primary">
                {formatDate(compliance.flow_test_date)}
                {compliance.flow_test_due && (
                  <span className="ml-2 text-xs text-theme-text-muted">
                    (due {formatDate(compliance.flow_test_due)})
                  </span>
                )}
              </dd>
            </div>
          </div>
        </section>
      )}

      {/* Contamination */}
      {compliance?.contamination_level &&
        compliance.contamination_level !== 'none' && (
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">
              Contamination
            </h4>
            <span
              className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${
                compliance.contamination_level === 'heavy' ||
                compliance.contamination_level === 'gross'
                  ? 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30'
                  : compliance.contamination_level === 'moderate'
                    ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30'
                    : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30'
              }`}
            >
              {compliance.contamination_level.charAt(0).toUpperCase() +
                compliance.contamination_level.slice(1)}
            </span>
          </section>
        )}

      {canManage && (
        <div className="pt-2">
          <button
            onClick={() => {
              setForm(compliance ?? {});
              setEditing(true);
            }}
            className="text-sm text-emerald-600 hover:text-emerald-700 font-medium"
          >
            Edit Compliance Record
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================
// Inspections Tab
// ============================================

function InspectionsTab({ item }: { item: InventoryItem }) {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await inventoryService.getItemMaintenanceHistory(item.id);
        setRecords(data);
      } catch {
        // Silently handle — empty state is fine
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [item.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-12">
        <ClipboardList className="mx-auto h-10 w-10 text-theme-text-muted mb-3" />
        <p className="text-theme-text-muted">
          No inspection or maintenance records yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {records.map((r) => (
        <div
          key={r.id}
          className="flex items-start gap-3 p-3 border border-theme-surface-border rounded-lg"
        >
          <div
            className={`mt-0.5 shrink-0 ${
              r.passed === true
                ? 'text-green-600'
                : r.passed === false
                  ? 'text-red-600'
                  : 'text-theme-text-muted'
            }`}
          >
            {r.passed === true ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : r.passed === false ? (
              <XCircle className="h-5 w-5" />
            ) : (
              <ClipboardList className="h-5 w-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-theme-text-primary capitalize">
                {r.maintenance_type.replace(/_/g, ' ')}
              </span>
              {r.passed !== null && r.passed !== undefined && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full ${
                    r.passed
                      ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                      : 'bg-red-500/10 text-red-700 dark:text-red-400'
                  }`}
                >
                  {r.passed ? 'Passed' : 'Failed'}
                </span>
              )}
            </div>
            <div className="text-xs text-theme-text-muted mt-1 flex gap-3">
              {r.completed_date && (
                <span>
                  <Calendar className="inline h-3 w-3 mr-1" />
                  {formatDate(r.completed_date)}
                </span>
              )}
              {r.next_due_date && (
                <span>Next due: {formatDate(r.next_due_date)}</span>
              )}
            </div>
            {r.description && (
              <p className="text-xs text-theme-text-muted mt-1">
                {r.description}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// Exposures Tab
// ============================================

function ExposuresTab({
  item,
  canManage,
}: {
  item: InventoryItem;
  canManage: boolean;
}) {
  const [records, setRecords] = useState<NFPAExposureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    exposure_type: 'structure_fire',
    exposure_date: new Date().toISOString().split('T')[0] ?? '',
    incident_number: '',
    description: '',
    decon_required: false,
  });

  const load = useCallback(async () => {
    try {
      const data = await inventoryService.getExposureRecords(item.id);
      setRecords(data);
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, [item.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    try {
      await inventoryService.createExposureRecord(item.id, {
        exposure_type: form.exposure_type,
        exposure_date: form.exposure_date,
        incident_number: form.incident_number || undefined,
        description: form.description || undefined,
        decon_required: form.decon_required,
        decon_completed: false,
      });
      toast.success('Exposure recorded');
      setShowForm(false);
      setForm({
        exposure_type: 'structure_fire',
        exposure_date: new Date().toISOString().split('T')[0] ?? '',
        incident_number: '',
        description: '',
        decon_required: false,
      });
      void load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to record exposure'
      );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canManage && !showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
        >
          <Plus className="h-4 w-4" />
          Log Exposure
        </button>
      )}

      {showForm && (
        <div className="p-4 border border-theme-surface-border rounded-lg space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-theme-text-muted mb-1">
                Exposure Type
              </label>
              <select
                className={inputClass}
                value={form.exposure_type}
                onChange={(e) =>
                  setForm({ ...form, exposure_type: e.target.value })
                }
              >
                {NFPA_EXPOSURE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-text-muted mb-1">
                Date
              </label>
              <input
                type="date"
                className={inputClass}
                value={form.exposure_date}
                onChange={(e) =>
                  setForm({ ...form, exposure_date: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-text-muted mb-1">
                Incident #
              </label>
              <input
                type="text"
                className={inputClass}
                placeholder="Optional"
                value={form.incident_number}
                onChange={(e) =>
                  setForm({ ...form, incident_number: e.target.value })
                }
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-theme-text-primary">
                <input
                  type="checkbox"
                  checked={form.decon_required}
                  onChange={(e) =>
                    setForm({ ...form, decon_required: e.target.checked })
                  }
                  className="rounded border-theme-input-border"
                />
                Decontamination required
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">
              Description
            </label>
            <textarea
              className={inputClass}
              rows={2}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-sm border border-theme-input-border rounded-lg text-theme-text-primary hover:bg-theme-surface-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleCreate()}
              className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {records.length === 0 && !showForm ? (
        <div className="text-center py-12">
          <Flame className="mx-auto h-10 w-10 text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">
            No exposure events recorded for this item.
          </p>
        </div>
      ) : (
        records.map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-3 p-3 border border-theme-surface-border rounded-lg"
          >
            <Flame className="h-5 w-5 mt-0.5 shrink-0 text-orange-500" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-theme-text-primary capitalize">
                  {r.exposure_type.replace(/_/g, ' ')}
                </span>
                {r.incident_number && (
                  <span className="text-xs text-theme-text-muted">
                    #{r.incident_number}
                  </span>
                )}
                {r.decon_required && !r.decon_completed && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30">
                    Decon needed
                  </span>
                )}
                {r.decon_completed && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30">
                    Decon done
                  </span>
                )}
              </div>
              <div className="text-xs text-theme-text-muted mt-1">
                <Calendar className="inline h-3 w-3 mr-1" />
                {formatDate(r.exposure_date)}
              </div>
              {r.description && (
                <p className="text-xs text-theme-text-muted mt-1">
                  {r.description}
                </p>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ============================================
// History / Activity Timeline Tab
// ============================================

const EVENT_ICON: Record<string, React.ReactNode> = {
  assignment: <UserCheck className="h-4 w-4 text-blue-500" />,
  return: <Undo2 className="h-4 w-4 text-green-500" />,
  checkout: <LogOut className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />,
  checkin: <LogIn className="h-4 w-4 text-green-500" />,
  issuance: <Send className="h-4 w-4 text-purple-500" />,
  issuance_return: <Undo2 className="h-4 w-4 text-purple-400" />,
  maintenance: <Wrench className="h-4 w-4 text-orange-500" />,
};

const EVENT_LABEL: Record<string, string> = {
  assignment: 'Assignment',
  return: 'Return',
  checkout: 'Checkout',
  checkin: 'Check-in',
  issuance: 'Issuance',
  issuance_return: 'Return',
  maintenance: 'Maintenance',
};

function HistoryTab({ item }: { item: InventoryItem }) {
  const [events, setEvents] = useState<ItemHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    inventoryService
      .getItemHistory(item.id)
      .then((data) => {
        if (!cancelled) setEvents(data.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <p className="text-sm text-theme-text-muted py-8 text-center">
        No activity recorded for this item yet.
      </p>
    );
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-[17px] top-2 bottom-2 w-px bg-theme-surface-border" />

      <ul className="space-y-4">
        {events.map((event) => (
          <li key={event.id} className="relative flex gap-3">
            {/* Icon circle */}
            <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-theme-surface-secondary border border-theme-surface-border">
              {EVENT_ICON[event.type] ?? <Clock className="h-4 w-4 text-theme-text-muted" />}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted">
                  {EVENT_LABEL[event.type] ?? event.type}
                </span>
                <time className="text-xs text-theme-text-muted">
                  {new Date(event.date).toLocaleString()}
                </time>
              </div>
              <p className="text-sm text-theme-text-primary mt-0.5">
                {event.summary}
              </p>
              {/* Extra details */}
              {typeof event.details.reason === 'string' && event.details.reason && (
                <p className="text-xs text-theme-text-muted mt-0.5">
                  Reason: {event.details.reason}
                </p>
              )}
              {typeof event.details.notes === 'string' && event.details.notes && (
                <p className="text-xs text-theme-text-muted mt-0.5">
                  Notes: {event.details.notes}
                </p>
              )}
              {typeof event.details.return_notes === 'string' && event.details.return_notes && (
                <p className="text-xs text-theme-text-muted mt-0.5">
                  Notes: {event.details.return_notes}
                </p>
              )}
              {typeof event.details.damage_notes === 'string' && event.details.damage_notes && (
                <p className="text-xs text-theme-text-muted mt-0.5">
                  Damage: {event.details.damage_notes}
                </p>
              )}
              {event.type === 'maintenance' && event.details.passed !== undefined && event.details.passed !== null && (
                <span className={`inline-flex items-center gap-1 text-xs mt-1 ${event.details.passed ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {event.details.passed ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {event.details.passed ? 'Passed' : 'Failed'}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================
// Main ItemDetailModal
// ============================================

const ItemDetailModal: React.FC<ItemDetailModalProps> = ({
  item,
  category,
  onClose,
  onEdit,
  canManage,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('general');
  const isNFPA = category?.nfpa_tracking_enabled ?? false;

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const tabs: Array<{ key: DetailTab; label: string; icon: React.ReactNode }> =
    [
      { key: 'general', label: 'General', icon: <Info className="h-4 w-4" /> },
      { key: 'history', label: 'History', icon: <Clock className="h-4 w-4" /> },
      ...(isNFPA
        ? [
            {
              key: 'nfpa' as DetailTab,
              label: 'NFPA Compliance',
              icon: <Shield className="h-4 w-4" />,
            },
            {
              key: 'inspections' as DetailTab,
              label: 'Inspections',
              icon: <ClipboardList className="h-4 w-4" />,
            },
            {
              key: 'exposures' as DetailTab,
              label: 'Exposures',
              icon: <Flame className="h-4 w-4" />,
            },
          ]
        : []),
    ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-theme-surface-modal rounded-xl shadow-xl border border-theme-surface-border flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-theme-surface-border shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-theme-text-primary truncate">
              {item.name}
            </h3>
            {item.serial_number && (
              <p className="text-xs text-theme-text-muted">
                S/N: {item.serial_number}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {canManage && (
              <button
                onClick={() => onEdit(item)}
                className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
              >
                Edit
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-theme-surface-secondary text-theme-text-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-theme-surface-border shrink-0 px-4 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === t.key
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'general' && <GeneralTab item={item} />}
          {activeTab === 'history' && <HistoryTab item={item} />}
          {activeTab === 'nfpa' && (
            <NFPAComplianceTab item={item} canManage={canManage} />
          )}
          {activeTab === 'inspections' && <InspectionsTab item={item} />}
          {activeTab === 'exposures' && (
            <ExposuresTab item={item} canManage={canManage} />
          )}
        </div>
      </div>
    </div>
  );
};

export default ItemDetailModal;
