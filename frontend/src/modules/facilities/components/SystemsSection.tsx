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

interface Props {
  facilityId: string;
}

export default function SystemsSection({ facilityId }: Props) {
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
      name: '', system_type: 'other', description: '', manufacturer: '',
      model_number: '', serial_number: '', install_date: '', warranty_expiration: '',
      condition: 'good', notes: '', test_frequency_days: '',
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
    if (!window.confirm(`Delete system "${sys.name}"?`)) return;
    try {
      await facilitiesService.deleteSystem(sys.id);
      toast.success('System deleted');
      void loadSystems();
    } catch {
      toast.error('Failed to delete system');
    }
  };

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl">
      <div className="flex items-center justify-between p-5 border-b border-theme-surface-border">
        <h2 className="text-sm font-semibold text-theme-text-primary">
          Building Systems {!isLoading && `(${systems.length})`}
        </h2>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add System
        </button>
      </div>

      <div className="p-5">
        {showForm && (
          <div className="mb-5 p-4 bg-theme-surface-hover/50 rounded-lg space-y-3">
            <h3 className="text-sm font-medium text-theme-text-primary">
              {editingSystem ? 'Edit System' : 'Add System'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Name *</label>
                <input type="text" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Main HVAC Unit" className={inputCls} autoFocus />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select value={formData.system_type} onChange={e => setFormData(p => ({ ...p, system_type: e.target.value }))} className={inputCls}>
                  {SYSTEM_TYPES.map(st => <option key={st} value={st}>{enumLabel(st)}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Condition</label>
                <select value={formData.condition} onChange={e => setFormData(p => ({ ...p, condition: e.target.value }))} className={inputCls}>
                  {CONDITION_OPTIONS.map(c => <option key={c} value={c}>{enumLabel(c)}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Manufacturer</label>
                <input type="text" value={formData.manufacturer} onChange={e => setFormData(p => ({ ...p, manufacturer: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Model Number</label>
                <input type="text" value={formData.model_number} onChange={e => setFormData(p => ({ ...p, model_number: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Serial Number</label>
                <input type="text" value={formData.serial_number} onChange={e => setFormData(p => ({ ...p, serial_number: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Install Date</label>
                <input type="date" value={formData.install_date} onChange={e => setFormData(p => ({ ...p, install_date: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Warranty Expiration</label>
                <input type="date" value={formData.warranty_expiration} onChange={e => setFormData(p => ({ ...p, warranty_expiration: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Test Frequency (days)</label>
                <input type="number" value={formData.test_frequency_days} onChange={e => setFormData(p => ({ ...p, test_frequency_days: e.target.value }))} className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={2} className={inputCls + ' resize-none'} />
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { void handleSave(); }} disabled={isSaving} className="btn-primary flex gap-1.5 items-center px-3 py-1.5 text-xs">
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {editingSystem ? 'Update' : 'Add'}
              </button>
              <button onClick={resetForm} className="px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8" role="status" aria-live="polite"><Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" /></div>
        ) : systems.length === 0 ? (
          <div className="text-center py-8">
            <Settings className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
            <p className="text-sm text-theme-text-muted">No building systems recorded.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {systems.map(sys => (
              <div key={sys.id} className="flex items-center justify-between p-3 bg-theme-surface-hover/30 rounded-lg group">
                <div className="flex items-center gap-3">
                  <Settings className="w-4 h-4 text-theme-text-muted" />
                  <div>
                    <p className="text-sm font-medium text-theme-text-primary">{sys.name}</p>
                    <div className="flex items-center gap-2 text-xs text-theme-text-muted">
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
                      {sys.testFrequencyDays != null && (
                        <span>Test every {sys.testFrequencyDays}d</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(sys)} className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors" aria-label={`Edit ${sys.name}`}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { void handleDelete(sys); }} className="p-1.5 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors" aria-label={`Delete ${sys.name}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
