/**
 * Item Detail Page
 *
 * Full-page view for a single inventory item with all related details
 * organized into clear sections. Replaces the previous crowded modal
 * with a spacious, navigable layout.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Package,
  Shield,
  ClipboardList,
  Flame,
  Info,
  Calendar,
  AlertTriangle,
  Barcode,
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
  Pencil,
  Printer,
  Archive,
  MapPin,
  Hash,
  Tag,
  DollarSign,
  Copy,
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
import { useAuthStore } from '../../stores/authStore';
import { getErrorMessage } from '../../utils/errorHandling';
import { Breadcrumbs } from '../../components/ux/Breadcrumbs';
import toast from 'react-hot-toast';
import JsBarcode from 'jsbarcode';

// ── Helpers ─────────────────────────────────────────────────────

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString();
}

function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const inputClass =
  'w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-emerald-500';

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
  assigned: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  checked_out: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  in_maintenance: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30',
  lost: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
  stolen: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
  retired: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border',
};

const getStatusStyle = (status: string) =>
  STATUS_COLORS[status] ?? 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';

const CONDITION_COLORS: Record<string, string> = {
  excellent: 'text-green-700 dark:text-green-400',
  good: 'text-emerald-700 dark:text-emerald-400',
  fair: 'text-yellow-700 dark:text-yellow-400',
  poor: 'text-orange-700 dark:text-orange-400',
  damaged: 'text-red-700 dark:text-red-400',
  out_of_service: 'text-red-700 dark:text-red-500',
};

// ── Inline Barcode ──────────────────────────────────────────────

const InlineBarcode: React.FC<{ value: string }> = ({ value }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current) {
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width: 2,
          height: 50,
          displayValue: true,
          fontSize: 12,
          margin: 4,
          textMargin: 2,
          font: 'monospace',
          background: 'transparent',
        });
      } catch {
        // Invalid barcode value
      }
    }
  }, [value]);

  return (
    <div className="flex justify-center bg-white rounded-lg p-3 border border-theme-surface-border">
      <svg ref={svgRef} />
    </div>
  );
};

// ── Section Components ──────────────────────────────────────────

type DetailSection = 'overview' | 'history' | 'nfpa' | 'inspections' | 'exposures';

// ── NFPA Compliance Section ─────────────────────────────────────

function NFPAComplianceSection({
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
        getErrorMessage(err, 'Failed to save compliance')
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
          Lifecycle Dates (NFPA 1851 &sect;10.1.2)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Manufacture Date', key: 'manufacture_date' as const },
            { label: 'First In-Service Date', key: 'first_in_service_date' as const },
            { label: 'Expected Retirement Date', key: 'expected_retirement_date' as const },
          ].map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-theme-text-muted mb-1">{f.label}</label>
              <input
                type="date"
                className={inputClass}
                value={form[f.key] ?? ''}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value || undefined })}
              />
            </div>
          ))}
        </div>

        <h4 className="text-sm font-semibold text-theme-text-primary pt-2">Ensemble Assignment</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">Ensemble ID</label>
            <input type="text" className={inputClass} placeholder="e.g. ENS-001"
              value={form.ensemble_id ?? ''}
              onChange={(e) => setForm({ ...form, ensemble_id: e.target.value || undefined })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">Role in Ensemble</label>
            <select className={inputClass} value={form.ensemble_role ?? ''}
              onChange={(e) => setForm({ ...form, ensemble_role: e.target.value || undefined })}>
              <option value="">— Select —</option>
              {NFPA_ENSEMBLE_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <h4 className="text-sm font-semibold text-theme-text-primary pt-2">SCBA Fields (NFPA 1852)</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { label: 'Cylinder Manufacture Date', key: 'cylinder_manufacture_date' as const },
            { label: 'Cylinder Expiration Date', key: 'cylinder_expiration_date' as const },
            { label: 'Hydrostatic Test Date', key: 'hydrostatic_test_date' as const },
            { label: 'Hydrostatic Test Due', key: 'hydrostatic_test_due' as const },
            { label: 'Flow Test Date', key: 'flow_test_date' as const },
            { label: 'Flow Test Due', key: 'flow_test_due' as const },
          ].map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-theme-text-muted mb-1">{f.label}</label>
              <input type="date" className={inputClass}
                value={form[f.key] ?? ''}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value || undefined })} />
            </div>
          ))}
        </div>

        <h4 className="text-sm font-semibold text-theme-text-primary pt-2">Contamination</h4>
        <select className={inputClass} value={form.contamination_level ?? 'none'}
          onChange={(e) => setForm({ ...form, contamination_level: e.target.value })}>
          {NFPA_CONTAMINATION_LEVEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <div className="flex justify-end gap-3 pt-4">
          <button onClick={() => { setEditing(false); if (compliance) setForm(compliance); }}
            className="px-4 py-2 text-sm border border-theme-input-border rounded-lg text-theme-text-primary hover:bg-theme-surface-secondary">
            Cancel
          </button>
          <button onClick={() => void handleSave()}
            className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {retirementDays !== null && retirementDays <= 180 && (
        <div className={`flex items-center gap-3 p-3 rounded-lg border ${
          retirementDays <= 0
            ? 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'
            : retirementDays <= 90
              ? 'bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-400'
              : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400'
        }`}>
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">
            {retirementDays <= 0
              ? 'This item has exceeded its 10-year service life and must be retired per NFPA 1851.'
              : `This item reaches its 10-year service life in ${retirementDays} days.`}
          </span>
        </div>
      )}

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">
          Lifecycle (NFPA 1851 &sect;10.1.2)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Manufacture Date', value: formatDate(compliance?.manufacture_date) },
            { label: 'First In-Service', value: formatDate(compliance?.first_in_service_date) },
            {
              label: 'Expected Retirement',
              value: formatDate(compliance?.expected_retirement_date),
              extra: retirementDays !== null && retirementDays > 0
                ? ` (${retirementDays}d)` : null,
            },
          ].map((f) => (
            <div key={f.label}>
              <dt className="text-xs text-theme-text-muted">{f.label}</dt>
              <dd className="mt-1 text-sm text-theme-text-primary font-medium">
                {f.value}
                {'extra' in f && f.extra && (
                  <span className="ml-2 text-xs text-theme-text-muted">{f.extra}</span>
                )}
              </dd>
            </div>
          ))}
        </div>
      </section>

      {compliance?.ensemble_id && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">Ensemble</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-theme-text-muted">Ensemble ID</dt>
              <dd className="mt-1 text-sm text-theme-text-primary font-medium">{compliance.ensemble_id}</dd>
            </div>
            <div>
              <dt className="text-xs text-theme-text-muted">Role</dt>
              <dd className="mt-1 text-sm text-theme-text-primary font-medium capitalize">{compliance.ensemble_role ?? '—'}</dd>
            </div>
          </div>
        </section>
      )}

      {(compliance?.hydrostatic_test_date || compliance?.cylinder_manufacture_date) && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">SCBA (NFPA 1852)</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Cylinder Manufactured', value: formatDate(compliance.cylinder_manufacture_date) },
              { label: 'Cylinder Expiration', value: formatDate(compliance.cylinder_expiration_date) },
              {
                label: 'Hydrostatic Test',
                value: formatDate(compliance.hydrostatic_test_date),
                due: compliance.hydrostatic_test_due ? `(due ${formatDate(compliance.hydrostatic_test_due)})` : null,
              },
              {
                label: 'Flow Test',
                value: formatDate(compliance.flow_test_date),
                due: compliance.flow_test_due ? `(due ${formatDate(compliance.flow_test_due)})` : null,
              },
            ].map((f) => (
              <div key={f.label}>
                <dt className="text-xs text-theme-text-muted">{f.label}</dt>
                <dd className="mt-1 text-sm text-theme-text-primary">
                  {f.value}
                  {'due' in f && f.due && (
                    <span className="ml-2 text-xs text-theme-text-muted">{f.due}</span>
                  )}
                </dd>
              </div>
            ))}
          </div>
        </section>
      )}

      {compliance?.contamination_level && compliance.contamination_level !== 'none' && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">Contamination</h4>
          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full border ${
            compliance.contamination_level === 'heavy' || compliance.contamination_level === 'gross'
              ? 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30'
              : compliance.contamination_level === 'moderate'
                ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30'
                : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30'
          }`}>
            {compliance.contamination_level.charAt(0).toUpperCase() + compliance.contamination_level.slice(1)}
          </span>
        </section>
      )}

      {canManage && (
        <div className="pt-2">
          <button onClick={() => { setForm(compliance ?? {}); setEditing(true); }}
            className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">
            Edit Compliance Record
          </button>
        </div>
      )}
    </div>
  );
}

// ── Inspections Section ─────────────────────────────────────────

function InspectionsSection({ item }: { item: InventoryItem }) {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await inventoryService.getItemMaintenanceHistory(item.id);
        setRecords(data);
      } catch {
        // empty state is fine
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
        <p className="text-theme-text-muted">No inspection or maintenance records yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {records.map((r) => (
        <div key={r.id} className="flex items-start gap-3 p-3 border border-theme-surface-border rounded-lg">
          <div className={`mt-0.5 shrink-0 ${
            r.passed === true ? 'text-green-600'
              : r.passed === false ? 'text-red-600'
                : 'text-theme-text-muted'
          }`}>
            {r.passed === true ? <CheckCircle2 className="h-5 w-5" />
              : r.passed === false ? <XCircle className="h-5 w-5" />
                : <ClipboardList className="h-5 w-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-theme-text-primary capitalize">
                {r.maintenance_type.replace(/_/g, ' ')}
              </span>
              {r.passed !== null && r.passed !== undefined && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  r.passed ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'bg-red-500/10 text-red-700 dark:text-red-400'
                }`}>
                  {r.passed ? 'Passed' : 'Failed'}
                </span>
              )}
            </div>
            <div className="text-xs text-theme-text-muted mt-1 flex gap-3">
              {r.completed_date && (
                <span><Calendar className="inline h-3 w-3 mr-1" />{formatDate(r.completed_date)}</span>
              )}
              {r.next_due_date && <span>Next due: {formatDate(r.next_due_date)}</span>}
            </div>
            {r.description && <p className="text-xs text-theme-text-muted mt-1">{r.description}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Exposures Section ───────────────────────────────────────────

function ExposuresSection({ item, canManage }: { item: InventoryItem; canManage: boolean }) {
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
      toast.error(getErrorMessage(err, 'Failed to record exposure'));
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
        <button onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">
          <Plus className="h-4 w-4" /> Log Exposure
        </button>
      )}

      {showForm && (
        <div className="p-4 border border-theme-surface-border rounded-lg space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-theme-text-muted mb-1">Exposure Type</label>
              <select className={inputClass} value={form.exposure_type}
                onChange={(e) => setForm({ ...form, exposure_type: e.target.value })}>
                {NFPA_EXPOSURE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-text-muted mb-1">Date</label>
              <input type="date" className={inputClass} value={form.exposure_date}
                onChange={(e) => setForm({ ...form, exposure_date: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-theme-text-muted mb-1">Incident #</label>
              <input type="text" className={inputClass} placeholder="Optional" value={form.incident_number}
                onChange={(e) => setForm({ ...form, incident_number: e.target.value })} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-theme-text-primary">
                <input type="checkbox" checked={form.decon_required}
                  onChange={(e) => setForm({ ...form, decon_required: e.target.checked })}
                  className="rounded-sm border-theme-input-border" />
                Decontamination required
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-theme-text-muted mb-1">Description</label>
            <textarea className={inputClass} rows={2} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-sm border border-theme-input-border rounded-lg text-theme-text-primary hover:bg-theme-surface-secondary">
              Cancel
            </button>
            <button onClick={() => void handleCreate()}
              className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">
              Save
            </button>
          </div>
        </div>
      )}

      {records.length === 0 && !showForm ? (
        <div className="text-center py-12">
          <Flame className="mx-auto h-10 w-10 text-theme-text-muted mb-3" />
          <p className="text-theme-text-muted">No exposure events recorded for this item.</p>
        </div>
      ) : (
        records.map((r) => (
          <div key={r.id} className="flex items-start gap-3 p-3 border border-theme-surface-border rounded-lg">
            <Flame className="h-5 w-5 mt-0.5 shrink-0 text-orange-500" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-theme-text-primary capitalize">
                  {r.exposure_type.replace(/_/g, ' ')}
                </span>
                {r.incident_number && (
                  <span className="text-xs text-theme-text-muted">#{r.incident_number}</span>
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
                <Calendar className="inline h-3 w-3 mr-1" />{formatDate(r.exposure_date)}
              </div>
              {r.description && <p className="text-xs text-theme-text-muted mt-1">{r.description}</p>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── History / Activity Timeline ─────────────────────────────────

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

function HistorySection({ item }: { item: InventoryItem }) {
  const [events, setEvents] = useState<ItemHistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    inventoryService
      .getItemHistory(item.id)
      .then((data) => { if (!cancelled) setEvents(data.events); })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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
      <div className="absolute left-[17px] top-2 bottom-2 w-px bg-theme-surface-border" />
      <ul className="space-y-4">
        {events.map((event) => (
          <li key={event.id} className="relative flex gap-3">
            <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-theme-surface-secondary border border-theme-surface-border">
              {EVENT_ICON[event.type] ?? <Clock className="h-4 w-4 text-theme-text-muted" />}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted">
                  {EVENT_LABEL[event.type] ?? event.type}
                </span>
                <time className="text-xs text-theme-text-muted">
                  {new Date(event.date).toLocaleString()}
                </time>
              </div>
              <p className="text-sm text-theme-text-primary mt-0.5">{event.summary}</p>
              {typeof event.details.reason === 'string' && event.details.reason && (
                <p className="text-xs text-theme-text-muted mt-0.5">Reason: {event.details.reason}</p>
              )}
              {typeof event.details.notes === 'string' && event.details.notes && (
                <p className="text-xs text-theme-text-muted mt-0.5">Notes: {event.details.notes}</p>
              )}
              {typeof event.details.return_notes === 'string' && event.details.return_notes && (
                <p className="text-xs text-theme-text-muted mt-0.5">Notes: {event.details.return_notes}</p>
              )}
              {typeof event.details.damage_notes === 'string' && event.details.damage_notes && (
                <p className="text-xs text-theme-text-muted mt-0.5">Damage: {event.details.damage_notes}</p>
              )}
              {event.type === 'maintenance' && event.details.passed !== undefined && event.details.passed !== null && (
                <span className={`inline-flex items-center gap-1 text-xs mt-1 ${
                  event.details.passed ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
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

// ── Main Page Component ─────────────────────────────────────────

const ItemDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('inventory.manage');

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [category, setCategory] = useState<InventoryCategory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<DetailSection>('overview');

  const loadItem = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await inventoryService.getItem(id);
      setItem(data);
      if (data.category_id) {
        try {
          const cats = await inventoryService.getCategories();
          const cat = cats.find((c) => c.id === data.category_id) ?? null;
          setCategory(cat);
        } catch {
          // non-critical
        }
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load item details'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadItem();
  }, [loadItem]);

  if (loading) {
    return (
      <div className="min-h-screen">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
          </div>
        </main>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="min-h-screen">
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <Link to="/inventory/admin" className="inline-flex items-center gap-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary mb-6">
            <ArrowLeft className="h-4 w-4" /> Back to Inventory
          </Link>
          <div className="card p-12 text-center">
            <Package className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-theme-text-primary mb-2">Item Not Found</h2>
            <p className="text-theme-text-muted text-sm">{error ?? 'The requested inventory item could not be found.'}</p>
          </div>
        </main>
      </div>
    );
  }

  const isNFPA = category?.nfpa_tracking_enabled ?? false;
  const barcodeValue = item.barcode || item.asset_tag || item.serial_number || item.id.slice(0, 12);

  const sections: Array<{ key: DetailSection; label: string; icon: React.ReactNode }> = [
    { key: 'overview', label: 'Overview', icon: <Info className="h-4 w-4" /> },
    { key: 'history', label: 'History', icon: <Clock className="h-4 w-4" /> },
    ...(isNFPA
      ? [
          { key: 'nfpa' as DetailSection, label: 'NFPA Compliance', icon: <Shield className="h-4 w-4" /> },
          { key: 'inspections' as DetailSection, label: 'Inspections', icon: <ClipboardList className="h-4 w-4" /> },
          { key: 'exposures' as DetailSection, label: 'Exposures', icon: <Flame className="h-4 w-4" /> },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumbs */}
        <Breadcrumbs
          items={[
            { label: 'Inventory', path: '/inventory/admin' },
            { label: item.name },
          ]}
          className="mb-4"
        />

        {/* Header Card */}
        <div className="card p-5 sm:p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-xl sm:text-2xl font-bold text-theme-text-primary truncate">
                  {item.name}
                </h1>
                <span className={`shrink-0 px-2.5 py-1 text-xs font-semibold rounded-md border ${getStatusStyle(item.status)}`}>
                  {item.status.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>
              {item.description && (
                <p className="text-sm text-theme-text-muted mb-3">{item.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-text-muted">
                {category && (
                  <span className="inline-flex items-center gap-1">
                    <Tag className="h-3 w-3" /> {category.name}
                  </span>
                )}
                {item.serial_number && (
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Hash className="h-3 w-3" /> S/N: {item.serial_number}
                  </span>
                )}
                {item.asset_tag && (
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Barcode className="h-3 w-3" /> {item.asset_tag}
                  </span>
                )}
                {item.condition && (
                  <span className={`capitalize ${CONDITION_COLORS[item.condition] ?? 'text-theme-text-muted'}`}>
                    {item.condition.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <Link
                to={`/inventory/print-labels?ids=${item.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-theme-surface-border rounded-lg text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
                title="Print barcode label"
              >
                <Printer className="h-4 w-4" />
                <span className="hidden sm:inline">Print Label</span>
              </Link>
              {canManage && (
                <>
                  <button
                    onClick={() => { void navigate(`/inventory/admin`); }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-theme-surface-border rounded-lg text-theme-text-primary hover:bg-theme-surface-secondary transition-colors"
                  >
                    <Pencil className="h-4 w-4" />
                    <span className="hidden sm:inline">Edit</span>
                  </button>
                  {item.status !== 'retired' && (
                    <button
                      onClick={() => {
                        if (window.confirm('Are you sure you want to retire this item?')) {
                          void inventoryService.retireItem(item.id).then(() => {
                            toast.success('Item retired');
                            void loadItem();
                          }).catch(() => toast.error('Failed to retire item'));
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-red-500/30 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Archive className="h-4 w-4" />
                      <span className="hidden sm:inline">Retire</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Two-column layout: sidebar + main content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Barcode Card */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">Barcode</h3>
              <InlineBarcode value={barcodeValue} />
            </div>

            {/* Quick Info Card */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">Details</h3>
              <dl className="space-y-3">
                {[
                  { icon: <Tag className="h-3.5 w-3.5" />, label: 'Category', value: category?.name },
                  { icon: <Package className="h-3.5 w-3.5" />, label: 'Tracking', value: item.tracking_type === 'pool' ? 'Pool (bulk)' : 'Individual' },
                  { icon: <Hash className="h-3.5 w-3.5" />, label: 'Quantity', value: item.tracking_type === 'pool' ? `${item.quantity - item.quantity_issued} available / ${item.quantity} total` : String(item.quantity) },
                  { icon: <Barcode className="h-3.5 w-3.5" />, label: 'Serial #', value: item.serial_number },
                  { icon: <Barcode className="h-3.5 w-3.5" />, label: 'Asset Tag', value: item.asset_tag },
                  { icon: <Copy className="h-3.5 w-3.5" />, label: 'Manufacturer', value: item.manufacturer ? `${item.manufacturer}${item.model_number ? ` ${item.model_number}` : ''}` : undefined },
                  { icon: <MapPin className="h-3.5 w-3.5" />, label: 'Location', value: item.storage_location || item.station },
                  { icon: <Calendar className="h-3.5 w-3.5" />, label: 'Purchase Date', value: item.purchase_date ? formatDate(item.purchase_date) : undefined },
                  { icon: <DollarSign className="h-3.5 w-3.5" />, label: 'Purchase Price', value: item.purchase_price != null ? `$${item.purchase_price.toFixed(2)}` : undefined },
                  { icon: <DollarSign className="h-3.5 w-3.5" />, label: 'Replacement Cost', value: item.replacement_cost != null ? `$${item.replacement_cost.toFixed(2)}` : undefined },
                  { icon: <Calendar className="h-3.5 w-3.5" />, label: 'Warranty Exp.', value: item.warranty_expiration ? formatDate(item.warranty_expiration) : undefined },
                ].filter((f) => f.value).map((f) => (
                  <div key={f.label} className="flex items-start gap-2">
                    <span className="text-theme-text-muted mt-0.5 shrink-0">{f.icon}</span>
                    <div className="min-w-0">
                      <dt className="text-xs text-theme-text-muted">{f.label}</dt>
                      <dd className="text-sm text-theme-text-primary">{f.value}</dd>
                    </div>
                  </div>
                ))}
              </dl>
              {(item.size || item.color) && (
                <div className="flex flex-wrap gap-1.5 mt-4 pt-3 border-t border-theme-surface-border">
                  {item.size && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                      {item.size}
                    </span>
                  )}
                  {item.color && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                      {item.color}
                    </span>
                  )}
                </div>
              )}
              {item.notes && (
                <div className="mt-4 pt-3 border-t border-theme-surface-border">
                  <dt className="text-xs text-theme-text-muted mb-1">Notes</dt>
                  <dd className="text-sm text-theme-text-primary whitespace-pre-wrap">{item.notes}</dd>
                </div>
              )}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-2">
            {/* Section Tabs */}
            <div className="flex border-b border-theme-surface-border mb-6 overflow-x-auto">
              {sections.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setActiveSection(s.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeSection === s.key
                      ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                      : 'border-transparent text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  {s.icon}
                  {s.label}
                </button>
              ))}
            </div>

            {/* Section Content */}
            <div className="card p-5">
              {activeSection === 'overview' && (
                <OverviewSection item={item} category={category} />
              )}
              {activeSection === 'history' && <HistorySection item={item} />}
              {activeSection === 'nfpa' && (
                <NFPAComplianceSection item={item} canManage={canManage} />
              )}
              {activeSection === 'inspections' && <InspectionsSection item={item} />}
              {activeSection === 'exposures' && (
                <ExposuresSection item={item} canManage={canManage} />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

// ── Overview Section (replaces GeneralTab) ──────────────────────

function OverviewSection({
  item,
}: {
  item: InventoryItem;
  category: InventoryCategory | null;
}) {
  // Show key details in a structured layout
  const identificationFields = [
    { label: 'Serial Number', value: item.serial_number },
    { label: 'Asset Tag', value: item.asset_tag },
    { label: 'Barcode', value: item.barcode },
  ].filter((f) => f.value);

  const productFields = [
    { label: 'Manufacturer', value: item.manufacturer },
    { label: 'Model Number', value: item.model_number },
    { label: 'Size', value: item.size },
    { label: 'Color', value: item.color },
  ].filter((f) => f.value);

  const trackingFields = [
    { label: 'Condition', value: item.condition ? item.condition.replace(/_/g, ' ') : undefined },
    { label: 'Status', value: item.status ? item.status.replace(/_/g, ' ') : undefined },
    { label: 'Tracking Type', value: item.tracking_type === 'pool' ? 'Pool (bulk stock)' : 'Individual' },
    { label: 'Quantity', value: item.tracking_type === 'pool' ? `${item.quantity} total, ${item.quantity_issued} issued` : String(item.quantity) },
    { label: 'Unit of Measure', value: item.unit_of_measure },
  ].filter((f) => f.value);

  const financialFields = [
    { label: 'Purchase Date', value: item.purchase_date ? formatDate(item.purchase_date) : undefined },
    { label: 'Purchase Price', value: item.purchase_price != null ? `$${item.purchase_price.toFixed(2)}` : undefined },
    { label: 'Replacement Cost', value: item.replacement_cost != null ? `$${item.replacement_cost.toFixed(2)}` : undefined },
    { label: 'Vendor', value: item.vendor },
    { label: 'Warranty Expiration', value: item.warranty_expiration ? formatDate(item.warranty_expiration) : undefined },
  ].filter((f) => f.value);

  const maintenanceFields = [
    { label: 'Last Inspection', value: item.last_inspection_date ? formatDate(item.last_inspection_date) : undefined },
    { label: 'Next Inspection Due', value: item.next_inspection_due ? formatDate(item.next_inspection_due) : undefined },
    {
      label: 'Inspection Interval',
      value: item.inspection_interval_days != null ? `Every ${item.inspection_interval_days} days` : undefined,
    },
  ].filter((f) => f.value);

  const renderFieldGroup = (
    title: string,
    fields: Array<{ label: string; value: string | undefined }>,
    icon: React.ReactNode
  ) => {
    if (fields.length === 0) return null;
    return (
      <section className="mb-6 last:mb-0">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">
          {icon} {title}
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="text-xs text-theme-text-muted">{f.label}</dt>
              <dd className="mt-0.5 text-sm text-theme-text-primary capitalize">{f.value}</dd>
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div>
      {item.description && (
        <div className="mb-6 pb-6 border-b border-theme-surface-border">
          <p className="text-sm text-theme-text-primary">{item.description}</p>
        </div>
      )}

      {renderFieldGroup('Identification', identificationFields, <Hash className="h-3.5 w-3.5" />)}
      {renderFieldGroup('Product Details', productFields, <Package className="h-3.5 w-3.5" />)}
      {renderFieldGroup('Tracking & Status', trackingFields, <Info className="h-3.5 w-3.5" />)}
      {renderFieldGroup('Financial', financialFields, <DollarSign className="h-3.5 w-3.5" />)}
      {renderFieldGroup('Maintenance Schedule', maintenanceFields, <Wrench className="h-3.5 w-3.5" />)}

      {item.notes && (
        <section className="mt-6 pt-6 border-t border-theme-surface-border">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">Notes</h4>
          <p className="text-sm text-theme-text-primary whitespace-pre-wrap">{item.notes}</p>
        </section>
      )}
    </div>
  );
}

export default ItemDetailPage;
