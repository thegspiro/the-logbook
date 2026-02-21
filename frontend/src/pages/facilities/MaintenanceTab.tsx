/**
 * Maintenance Tab - Full CRUD for maintenance records across all facilities.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Wrench, Plus, Search, Loader2, X, CheckCircle2, Clock,
  AlertTriangle, Calendar, DollarSign, Filter,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../services/api';
import type { MaintenanceRecord, MaintenanceType, Facility, MAINTENANCE_CATEGORIES } from './types';

const CATEGORY_OPTIONS: Array<typeof MAINTENANCE_CATEGORIES[number]> = [
  'PREVENTIVE', 'REPAIR', 'INSPECTION', 'RENOVATION', 'CLEANING', 'SAFETY', 'OTHER',
];

interface Props {
  facilities: Facility[];
  filterFacilityId?: string | null;
  onClearFilter: () => void;
}

export default function MaintenanceTab({ facilities, filterFacilityId, onClearFilter }: Props) {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [maintenanceTypes, setMaintenanceTypes] = useState<MaintenanceType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'overdue'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MaintenanceRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    facility_id: '', maintenance_type_id: '', description: '', scheduled_date: '',
    due_date: '', performed_by: '', cost: '', vendor: '', work_order_number: '', notes: '',
  });

  const loadRecords = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (filterFacilityId) params.facility_id = filterFacilityId;
      const [data, types] = await Promise.all([
        facilitiesService.getMaintenanceRecords(params as { facility_id?: string }),
        facilitiesService.getMaintenanceTypes(),
      ]);
      setRecords(data as unknown as MaintenanceRecord[]);
      setMaintenanceTypes(types as unknown as MaintenanceType[]);
    } catch {
      toast.error('Failed to load maintenance records');
    } finally {
      setIsLoading(false);
    }
  }, [filterFacilityId]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  const filtered = records.filter(r => {
    if (statusFilter === 'completed' && !r.is_completed) return false;
    if (statusFilter === 'pending' && r.is_completed) return false;
    if (statusFilter === 'overdue' && !r.is_overdue) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (r.description?.toLowerCase().includes(q) || r.vendor?.toLowerCase().includes(q) || r.work_order_number?.toLowerCase().includes(q) || r.performed_by?.toLowerCase().includes(q));
    }
    return true;
  });

  const openCreate = () => {
    setEditingRecord(null);
    setFormData({
      facility_id: filterFacilityId || '', maintenance_type_id: '', description: '',
      scheduled_date: '', due_date: '', performed_by: '', cost: '', vendor: '',
      work_order_number: '', notes: '',
    });
    setShowModal(true);
  };

  const openEdit = (record: MaintenanceRecord) => {
    setEditingRecord(record);
    setFormData({
      facility_id: record.facility_id,
      maintenance_type_id: record.maintenance_type_id || '',
      description: record.description || '',
      scheduled_date: record.scheduled_date || '',
      due_date: record.due_date || '',
      performed_by: record.performed_by || '',
      cost: record.cost?.toString() || '',
      vendor: record.vendor || '',
      work_order_number: record.work_order_number || '',
      notes: record.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.facility_id) { toast.error('Please select a facility'); return; }
    if (!formData.description.trim()) { toast.error('Description is required'); return; }
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        facility_id: formData.facility_id,
        description: formData.description.trim(),
        maintenance_type_id: formData.maintenance_type_id || undefined,
        scheduled_date: formData.scheduled_date || undefined,
        due_date: formData.due_date || undefined,
        performed_by: formData.performed_by.trim() || undefined,
        cost: formData.cost ? Number(formData.cost) : undefined,
        vendor: formData.vendor.trim() || undefined,
        work_order_number: formData.work_order_number.trim() || undefined,
        notes: formData.notes.trim() || undefined,
      };
      if (editingRecord) {
        await facilitiesService.updateMaintenanceRecord(editingRecord.id, payload);
        toast.success('Record updated');
      } else {
        await facilitiesService.createMaintenanceRecord(payload);
        toast.success('Record created');
      }
      setShowModal(false);
      loadRecords();
    } catch {
      toast.error('Failed to save record');
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async (record: MaintenanceRecord) => {
    try {
      await facilitiesService.updateMaintenanceRecord(record.id, {
        is_completed: true,
        completed_date: new Date().toISOString().split('T')[0],
      });
      toast.success('Marked as completed');
      loadRecords();
    } catch {
      toast.error('Failed to update record');
    }
  };

  const handleDelete = async (record: MaintenanceRecord) => {
    if (!window.confirm('Delete this maintenance record?')) return;
    try {
      await facilitiesService.deleteMaintenanceRecord(record.id);
      toast.success('Record deleted');
      loadRecords();
    } catch {
      toast.error('Failed to delete record');
    }
  };

  const getFacilityName = (facilityId: string) => {
    return facilities.find(f => f.id === facilityId)?.name || 'Unknown';
  };

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500';
  const labelCls = 'block text-xs font-medium text-theme-text-muted mb-1';

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search records..." aria-label="Search maintenance records" className="w-full pl-10 pr-4 py-2.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        {filterFacilityId && (
          <button onClick={onClearFilter}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400 text-sm"
          >
            <Filter className="w-3.5 h-3.5" />
            {getFacilityName(filterFacilityId)}
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <div className="flex items-center border border-theme-surface-border rounded-lg overflow-hidden">
          {(['all', 'pending', 'completed', 'overdue'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${statusFilter === s ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors ml-auto"
        >
          <Plus className="w-4 h-4" /> New Record
        </button>
      </div>

      {/* Records List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Wrench className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted">{searchQuery || statusFilter !== 'all' ? 'No records match your filters.' : 'No maintenance records yet.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(record => (
            <div key={record.id} className="flex items-center gap-4 p-4 bg-theme-surface border border-theme-surface-border rounded-lg hover:border-theme-surface-border transition-all group">
              {/* Status Icon */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                record.is_completed ? 'bg-emerald-500/10 text-emerald-500' :
                record.is_overdue ? 'bg-red-500/10 text-red-500' :
                'bg-amber-500/10 text-amber-500'
              }`}>
                {record.is_completed ? <CheckCircle2 className="w-4 h-4" /> :
                 record.is_overdue ? <AlertTriangle className="w-4 h-4" /> :
                 <Clock className="w-4 h-4" />}
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-theme-text-primary truncate">{record.description || 'Untitled'}</p>
                  {record.maintenance_type && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-theme-surface-hover text-theme-text-muted flex-shrink-0">
                      {record.maintenance_type.name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-theme-text-muted">
                  <span>{getFacilityName(record.facility_id)}</span>
                  {record.scheduled_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{record.scheduled_date}</span>}
                  {record.vendor && <span>{record.vendor}</span>}
                  {record.cost != null && record.cost > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{record.cost.toLocaleString()}</span>}
                  {record.work_order_number && <span>WO# {record.work_order_number}</span>}
                </div>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!record.is_completed && (
                  <button onClick={() => handleComplete(record)} title="Mark completed" aria-label="Mark completed"
                    className="p-1.5 text-emerald-600 hover:bg-emerald-500/10 rounded-lg transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
                <button onClick={() => openEdit(record)} title="Edit" aria-label="Edit record"
                  className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors"
                >
                  <Wrench className="w-4 h-4" aria-hidden="true" />
                </button>
                <button onClick={() => handleDelete(record)} title="Delete" aria-label="Delete record"
                  className="p-1.5 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true"
          onKeyDown={e => { if (e.key === 'Escape') setShowModal(false); }}
        >
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">
                {editingRecord ? 'Edit Maintenance Record' : 'New Maintenance Record'}
              </h2>
              <button onClick={() => setShowModal(false)} aria-label="Close dialog" className="text-theme-text-muted hover:text-theme-text-primary"><X className="w-5 h-5" aria-hidden="true" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Facility *</label>
                <select value={formData.facility_id} onChange={e => setFormData(p => ({...p, facility_id: e.target.value}))} className={inputCls}>
                  <option value="">Select facility...</option>
                  {facilities.filter(f => !f.is_archived).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Description *</label>
                <textarea value={formData.description} onChange={e => setFormData(p => ({...p, description: e.target.value}))} rows={3} className={inputCls + ' resize-none'} placeholder="Describe the maintenance work..." />
              </div>
              {maintenanceTypes.length > 0 && (
                <div>
                  <label className={labelCls}>Maintenance Type</label>
                  <select value={formData.maintenance_type_id} onChange={e => setFormData(p => ({...p, maintenance_type_id: e.target.value}))} className={inputCls}>
                    <option value="">Select type...</option>
                    {maintenanceTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Scheduled Date</label><input type="date" value={formData.scheduled_date} onChange={e => setFormData(p => ({...p, scheduled_date: e.target.value}))} className={inputCls} /></div>
                <div><label className={labelCls}>Due Date</label><input type="date" value={formData.due_date} onChange={e => setFormData(p => ({...p, due_date: e.target.value}))} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Performed By</label><input type="text" value={formData.performed_by} onChange={e => setFormData(p => ({...p, performed_by: e.target.value}))} className={inputCls} placeholder="Name or company" /></div>
                <div><label className={labelCls}>Vendor</label><input type="text" value={formData.vendor} onChange={e => setFormData(p => ({...p, vendor: e.target.value}))} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Cost ($)</label><input type="number" value={formData.cost} onChange={e => setFormData(p => ({...p, cost: e.target.value}))} className={inputCls} placeholder="0.00" /></div>
                <div><label className={labelCls}>Work Order #</label><input type="text" value={formData.work_order_number} onChange={e => setFormData(p => ({...p, work_order_number: e.target.value}))} className={inputCls} /></div>
              </div>
              <div><label className={labelCls}>Notes</label><textarea value={formData.notes} onChange={e => setFormData(p => ({...p, notes: e.target.value}))} rows={2} className={inputCls + ' resize-none'} /></div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors text-sm">Cancel</button>
              <button onClick={handleSave} disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingRecord ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
