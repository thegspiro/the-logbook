/**
 * SystemsSection — Manage building systems for a facility.
 */

import { useState, useEffect, useCallback } from 'react';
import { Settings, Plus, Trash2, Loader2, Pencil, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { FacilitySystemCreate } from '../../../services/facilitiesServices';
import type { FacilitySystem } from '../types';
import { enumLabel, SYSTEM_TYPES } from '../types';
import { inputCls, labelCls, CONDITION_OPTIONS, CONDITION_COLORS } from '../constants';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, isPastDate } from '../../../utils/dateFormatting';

import { useConfirm } from '../../../contexts/ConfirmContext';
interface Props {
  facilityId: string;
  canManage: boolean;
}

export default function SystemsSection({ facilityId, canManage }: Props) {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [systems, setSystems] = useState<FacilitySystem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSystem, setEditingSystem] = useState<FacilitySystem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    system_type: 'other',
    description: '',
    manufacturer: '',
    model_number: '',
    serial_number: '',
    install_date: '',
    warranty_expiration: '',
    condition: 'good',
    notes: '',
    test_frequency_days: '',
  });

  const loadSystems = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await facilitiesService.getSystems({ facility_id: facilityId });
      setSystems(data);
    } catch {
      toast.error('Failed to load systems');
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    void loadSystems();
  }, [loadSystems]);

  const resetForm = () => {
    setFormData({
      name: '',
      system_type: 'other',
      description: '',
      manufacturer: '',
      model_number: '',
      serial_number: '',
      install_date: '',
      warranty_expiration: '',
      condition: 'good',
      notes: '',
      test_frequency_days: '',
    });
    setEditingSystem(null);
    setShowForm(false);
  };

  const openEdit = (sys: FacilitySystem) => {
    setEditingSystem(sys);
    setFormData({
      name: sys.name || '',
      system_type: sys.systemType || 'other',
      description: sys.description || '',
      manufacturer: sys.manufacturer || '',
      model_number: sys.modelNumber || '',
      serial_number: sys.serialNumber || '',
      install_date: sys.installDate || '',
      warranty_expiration: sys.warrantyExpiration || '',
      condition: sys.condition || 'good',
      notes: sys.notes || '',
      test_frequency_days: sys.testFrequencyDays != null ? String(sys.testFrequencyDays) : '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('System name is required');
      return;
    }
    setIsSaving(true);
    try {
      const payload: FacilitySystemCreate = {
        facility_id: facilityId,
        name: formData.name.trim(),
        system_type: formData.system_type,
        condition: formData.condition,
      };
      if (formData.description.trim()) payload.description = formData.description.trim();
      if (formData.manufacturer.trim()) payload.manufacturer = formData.manufacturer.trim();
      if (formData.model_number.trim()) payload.model_number = formData.model_number.trim();
      if (formData.serial_number.trim()) payload.serial_number = formData.serial_number.trim();
      if (formData.install_date) payload.install_date = formData.install_date;
      if (formData.warranty_expiration) payload.warranty_expiration = formData.warranty_expiration;
      if (formData.notes.trim()) payload.notes = formData.notes.trim();
      if (formData.test_frequency_days) payload.test_frequency_days = Number(formData.test_frequency_days);

      if (editingSystem) {
        await facilitiesService.updateSystem(editingSystem.id, payload);
        toast.success('System updated');
      } else {
        await facilitiesService.createSystem(payload);
        toast.success('System added');
      }
      resetForm();
      void loadSystems();
    } catch {
      toast.error('Failed to save system');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (sys: FacilitySystem) => {
    if (
      !(await confirm({
        title: 'Delete system',
        message: `Delete "${sys.name}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await facilitiesService.deleteSystem(sys.id);
      toast.success('System deleted');
      void loadSystems();
    } catch {
      toast.error('Failed to delete system');
    }
  };

  return (
    <div className="bg-theme-surface border-theme-surface-border rounded-xl border">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-5">
        <h2 className="text-theme-text-primary text-sm font-semibold">
          Building Systems {!isLoading && `(${systems.length})`}
        </h2>
        {canManage && (
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <Plus className="h-3.5 w-3.5" /> Add System
          </button>
        )}
      </div>

      <div className="p-5">
        {canManage && showForm && (
          <div className="bg-theme-surface-hover/50 mb-5 space-y-3 rounded-lg p-4">
            <h3 className="text-theme-text-primary text-sm font-medium">
              {editingSystem ? 'Edit System' : 'Add System'}
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className={labelCls}>Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g., Main HVAC Unit"
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select
                  value={formData.system_type}
                  onChange={(e) => setFormData((p) => ({ ...p, system_type: e.target.value }))}
                  className={inputCls}
                >
                  {SYSTEM_TYPES.map((st) => (
                    <option key={st} value={st}>
                      {enumLabel(st)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Condition</label>
                <select
                  value={formData.condition}
                  onChange={(e) => setFormData((p) => ({ ...p, condition: e.target.value }))}
                  className={inputCls}
                >
                  {CONDITION_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {enumLabel(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Manufacturer</label>
                <input
                  type="text"
                  value={formData.manufacturer}
                  onChange={(e) => setFormData((p) => ({ ...p, manufacturer: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Model Number</label>
                <input
                  type="text"
                  value={formData.model_number}
                  onChange={(e) => setFormData((p) => ({ ...p, model_number: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Serial Number</label>
                <input
                  type="text"
                  value={formData.serial_number}
                  onChange={(e) => setFormData((p) => ({ ...p, serial_number: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Install Date</label>
                <input
                  type="date"
                  value={formData.install_date}
                  onChange={(e) => setFormData((p) => ({ ...p, install_date: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Warranty Expiration</label>
                <input
                  type="date"
                  value={formData.warranty_expiration}
                  onChange={(e) => setFormData((p) => ({ ...p, warranty_expiration: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Test Frequency (days)</label>
                <input
                  type="number"
                  value={formData.test_frequency_days}
                  onChange={(e) => setFormData((p) => ({ ...p, test_frequency_days: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                rows={2}
                className={inputCls + ' resize-none'}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  void handleSave();
                }}
                disabled={isSaving}
                className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {editingSystem ? 'Update' : 'Add'}
              </button>
              <button
                onClick={resetForm}
                className="text-theme-text-muted hover:text-theme-text-primary px-3 py-1.5 text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
          </div>
        ) : systems.length === 0 ? (
          <div className="py-8 text-center">
            <Settings className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
            <p className="text-theme-text-muted text-sm">No building systems recorded.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {systems.map((sys) => (
              <div
                key={sys.id}
                className="bg-theme-surface-hover/30 group flex items-center justify-between rounded-lg p-3"
              >
                <div className="flex items-center gap-3">
                  <Settings className="text-theme-text-muted h-4 w-4" />
                  <div>
                    <p className="text-theme-text-primary text-sm font-medium">{sys.name}</p>
                    <div className="text-theme-text-muted flex items-center gap-2 text-xs">
                      <span>{enumLabel(sys.systemType)}</span>
                      {sys.condition && (
                        <span className={`font-medium ${CONDITION_COLORS[sys.condition.toLowerCase()] || ''}`}>
                          {enumLabel(sys.condition)}
                        </span>
                      )}
                      {sys.manufacturer && <span>{sys.manufacturer}</span>}
                      {sys.warrantyExpiration && (
                        <span className={isPastDate(sys.warrantyExpiration) ? 'text-red-500' : ''}>
                          Warranty: {formatDate(sys.warrantyExpiration, tz)}
                        </span>
                      )}
                      {sys.testFrequencyDays != null && <span>Test every {sys.testFrequencyDays}d</span>}
                    </div>
                  </div>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      onClick={() => openEdit(sys)}
                      className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-1.5 transition-colors"
                      aria-label={`Edit ${sys.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        void handleDelete(sys);
                      }}
                      className="text-theme-text-muted rounded-lg p-1.5 transition-colors hover:bg-red-500/10 hover:text-red-500"
                      aria-label={`Delete ${sys.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
