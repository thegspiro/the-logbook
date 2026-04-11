/**
 * MaintenanceListPage — Cross-facility maintenance records view.
 *
 * Accessible at /facilities/maintenance. Shows all maintenance records
 * across facilities with filtering and CRUD capabilities.
 */

import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Wrench, Plus, Search, Loader2, X, CheckCircle2, Clock,
  AlertTriangle, Calendar, DollarSign, ArrowLeft, RotateCcw,
} from 'lucide-react';
import { inputCls, labelCls } from '../constants';
import { useMaintenanceForm } from '../hooks/useMaintenanceForm';
import { useFacilitiesStore } from '../store/facilitiesStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, formatNumber } from '../../../utils/dateFormatting';

export default function MaintenanceListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tz = useTimezone();
  const { facilities, loadFacilities, loadLookupData } = useFacilitiesStore();

  useEffect(() => {
    void loadFacilities();
    void loadLookupData();
  }, [loadFacilities, loadLookupData]);

  const initialStatus = (searchParams.get('status') as 'overdue') || 'all';

  const {
    records: filtered, maintenanceTypes, isLoading, loadError, reload,
    searchQuery, setSearchQuery, statusFilter, setStatusFilter,
    showModal, setShowModal, editingRecord, isSaving,
    formData, setFormData, openCreate, openEdit, handleSave, handleComplete, handleDelete,
  } = useMaintenanceForm({ initialStatusFilter: initialStatus });

  const getFacilityName = (facilityId: string) =>
    facilities.find(f => f.id === facilityId)?.name || 'Unknown';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/facilities')} className="p-2 rounded-lg text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors" aria-label="Back to facilities">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary">Maintenance Records</h1>
            <p className="text-theme-text-secondary text-sm mt-0.5">Track and manage maintenance across all facilities</p>
          </div>
        </div>
        <button onClick={() => openCreate()} className="btn-primary flex gap-2 items-center py-2.5 text-sm">
          <Plus className="w-4 h-4" /> New Record
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search records..." placeholder="Search records..." className="form-input pl-10 placeholder-theme-text-muted pr-4 py-2.5" />
        </div>
        <div className="flex items-center border border-theme-surface-border rounded-lg overflow-hidden">
          {(['all', 'pending', 'completed', 'overdue'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${statusFilter === s ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
            >{s.charAt(0).toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite"><Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" /></div>
      ) : loadError ? (
        <div className="text-center py-20">
          <Wrench className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted mb-3">Failed to load maintenance records.</p>
          <button onClick={() => { void reload(); }} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
            <RotateCcw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Wrench className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted">{searchQuery || statusFilter !== 'all' ? 'No records match your filters.' : 'No maintenance records yet.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(record => (
            <div key={record.id} className="flex items-center gap-4 p-4 bg-theme-surface border border-theme-surface-border rounded-lg hover:border-theme-surface-border transition-all group">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                record.isCompleted ? 'bg-emerald-500/10 text-emerald-500' :
                record.isOverdue ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'
              }`}>
                {record.isCompleted ? <CheckCircle2 className="w-4 h-4" /> :
                 record.isOverdue ? <AlertTriangle className="w-4 h-4" /> :
                 <Clock className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-theme-text-primary truncate">{record.description || 'Untitled'}</p>
                  {record.maintenanceType && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-theme-surface-hover text-theme-text-muted shrink-0">{record.maintenanceType.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-theme-text-muted">
                  <span>{getFacilityName(record.facilityId)}</span>
                  {record.scheduledDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(record.scheduledDate, tz)}</span>}
                  {record.vendor && <span>{record.vendor}</span>}
                  {record.cost != null && record.cost > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />${formatNumber(record.cost)}</span>}
                  {record.workOrderNumber && <span>WO# {record.workOrderNumber}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!record.isCompleted && (
                  <button onClick={() => { void handleComplete(record); }} title="Mark completed" aria-label="Mark completed"
                    className="p-1.5 text-emerald-600 hover:bg-emerald-500/10 rounded-lg transition-colors">
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => openEdit(record)} title="Edit" aria-label="Edit record"
                  className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors">
                  <Wrench className="w-4 h-4" />
                </button>
                <button onClick={() => { void handleDelete(record); }} title="Delete" aria-label="Delete record"
                  className="p-1.5 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true"
          onKeyDown={e => { if (e.key === 'Escape') setShowModal(false); }}>
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">{editingRecord ? 'Edit Maintenance Record' : 'New Maintenance Record'}</h2>
              <button onClick={() => setShowModal(false)} aria-label="Close dialog" className="text-theme-text-muted hover:text-theme-text-primary"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Facility *</label>
                <select value={formData.facility_id} onChange={e => setFormData(p => ({...p, facility_id: e.target.value}))} className={inputCls}>
                  <option value="">Select facility...</option>
                  {facilities.filter(f => !f.isArchived).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
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
                <div><label className={labelCls}>Performed By</label><input type="text" value={formData.performed_by} onChange={e => setFormData(p => ({...p, performed_by: e.target.value}))} className={inputCls} /></div>
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
              <button onClick={() => { void handleSave(); }} disabled={isSaving} className="btn-primary flex gap-2 items-center px-5 text-sm">
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
