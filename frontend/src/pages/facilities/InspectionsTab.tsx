/**
 * Inspections Tab - Full CRUD for facility inspections.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck, Plus, Search, Loader2, X, CheckCircle2, XCircle,
  Calendar, Filter, AlertTriangle, MinusCircle, Pencil,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../services/api';
import type { Inspection, Facility, INSPECTION_TYPES } from './types';

const INSPECTION_TYPE_OPTIONS: Array<typeof INSPECTION_TYPES[number]> = [
  'FIRE', 'BUILDING_CODE', 'HEALTH', 'ADA', 'ENVIRONMENTAL',
  'INSURANCE', 'ROUTINE', 'OTHER',
];

interface Props {
  facilities: Facility[];
  filterFacilityId?: string | null;
  onClearFilter: () => void;
}

export default function InspectionsTab({ facilities, filterFacilityId, onClearFilter }: Props) {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'passed' | 'failed' | 'pending'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingInspection, setEditingInspection] = useState<Inspection | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    facility_id: '', inspection_type: 'ROUTINE', title: '', description: '',
    inspection_date: '', next_inspection_date: '', inspector_name: '',
    inspector_organization: '', passed: '', findings: '', corrective_actions: '',
    corrective_action_deadline: '', notes: '',
  });

  const loadInspections = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (filterFacilityId) params.facility_id = filterFacilityId;
      const data = await facilitiesService.getInspections(params as { facility_id?: string });
      setInspections(data as unknown as Inspection[]);
    } catch {
      toast.error('Failed to load inspections');
    } finally {
      setIsLoading(false);
    }
  }, [filterFacilityId]);

  useEffect(() => { loadInspections(); }, [loadInspections]);

  const filtered = inspections.filter(i => {
    if (resultFilter === 'passed' && i.passed !== true) return false;
    if (resultFilter === 'failed' && i.passed !== false) return false;
    if (resultFilter === 'pending' && i.passed !== null && i.passed !== undefined) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (i.title?.toLowerCase().includes(q) || i.inspector_name?.toLowerCase().includes(q) || i.inspector_organization?.toLowerCase().includes(q));
    }
    return true;
  });

  const openCreate = () => {
    setEditingInspection(null);
    setFormData({
      facility_id: filterFacilityId || '', inspection_type: 'ROUTINE', title: '',
      description: '', inspection_date: new Date().toISOString().split('T')[0],
      next_inspection_date: '', inspector_name: '', inspector_organization: '',
      passed: '', findings: '', corrective_actions: '', corrective_action_deadline: '', notes: '',
    });
    setShowModal(true);
  };

  const openEdit = (insp: Inspection) => {
    setEditingInspection(insp);
    setFormData({
      facility_id: insp.facility_id,
      inspection_type: insp.inspection_type || 'ROUTINE',
      title: insp.title || '',
      description: insp.description || '',
      inspection_date: insp.inspection_date || '',
      next_inspection_date: insp.next_inspection_date || '',
      inspector_name: insp.inspector_name || '',
      inspector_organization: insp.inspector_organization || '',
      passed: insp.passed === true ? 'true' : insp.passed === false ? 'false' : '',
      findings: insp.findings || '',
      corrective_actions: insp.corrective_actions || '',
      corrective_action_deadline: insp.corrective_action_deadline || '',
      notes: insp.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.facility_id) { toast.error('Please select a facility'); return; }
    if (!formData.title.trim()) { toast.error('Title is required'); return; }
    if (!formData.inspection_date) { toast.error('Inspection date is required'); return; }
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        facility_id: formData.facility_id,
        inspection_type: formData.inspection_type,
        title: formData.title.trim(),
        description: formData.description.trim() || undefined,
        inspection_date: formData.inspection_date,
        next_inspection_date: formData.next_inspection_date || undefined,
        inspector_name: formData.inspector_name.trim() || undefined,
        inspector_organization: formData.inspector_organization.trim() || undefined,
        passed: formData.passed === 'true' ? true : formData.passed === 'false' ? false : null,
        findings: formData.findings.trim() || undefined,
        corrective_actions: formData.corrective_actions.trim() || undefined,
        corrective_action_deadline: formData.corrective_action_deadline || undefined,
        notes: formData.notes.trim() || undefined,
      };
      if (editingInspection) {
        await facilitiesService.updateInspection(editingInspection.id, payload);
        toast.success('Inspection updated');
      } else {
        await facilitiesService.createInspection(payload);
        toast.success('Inspection created');
      }
      setShowModal(false);
      loadInspections();
    } catch {
      toast.error('Failed to save inspection');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (insp: Inspection) => {
    if (!window.confirm(`Delete inspection "${insp.title}"?`)) return;
    try {
      await facilitiesService.deleteInspection(insp.id);
      toast.success('Inspection deleted');
      loadInspections();
    } catch {
      toast.error('Failed to delete inspection');
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
            placeholder="Search inspections..." className="w-full pl-10 pr-4 py-2.5 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
          {(['all', 'passed', 'failed', 'pending'] as const).map(s => (
            <button key={s} onClick={() => setResultFilter(s)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${resultFilter === s ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors ml-auto"
        >
          <Plus className="w-4 h-4" /> New Inspection
        </button>
      </div>

      {/* Inspections List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <ClipboardCheck className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted">{searchQuery || resultFilter !== 'all' ? 'No inspections match your filters.' : 'No inspections recorded yet.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(insp => (
            <div key={insp.id} className="flex items-center gap-4 p-4 bg-theme-surface border border-theme-surface-border rounded-lg hover:border-theme-surface-border transition-all group">
              {/* Result Icon */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                insp.passed === true ? 'bg-emerald-500/10 text-emerald-500' :
                insp.passed === false ? 'bg-red-500/10 text-red-500' :
                'bg-gray-500/10 text-gray-500'
              }`}>
                {insp.passed === true ? <CheckCircle2 className="w-4 h-4" /> :
                 insp.passed === false ? <XCircle className="w-4 h-4" /> :
                 <MinusCircle className="w-4 h-4" />}
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-medium text-theme-text-primary truncate">{insp.title}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-theme-surface-hover text-theme-text-muted flex-shrink-0">
                    {insp.inspection_type?.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-theme-text-muted">
                  <span>{getFacilityName(insp.facility_id)}</span>
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{insp.inspection_date}</span>
                  {insp.inspector_name && <span>{insp.inspector_name}</span>}
                  {insp.next_inspection_date && <span>Next: {insp.next_inspection_date}</span>}
                  {insp.corrective_actions && !insp.corrective_action_completed && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="w-3 h-3" /> Corrective action needed
                    </span>
                  )}
                </div>
              </div>
              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => openEdit(insp)} title="Edit"
                  className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(insp)} title="Delete"
                  className="p-1.5 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
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
                {editingInspection ? 'Edit Inspection' : 'New Inspection'}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-theme-text-muted hover:text-theme-text-primary"><X className="w-5 h-5" /></button>
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
                <label className={labelCls}>Title *</label>
                <input type="text" value={formData.title} onChange={e => setFormData(p => ({...p, title: e.target.value}))} className={inputCls} placeholder="e.g., Annual Fire Inspection 2026" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Inspection Type</label>
                  <select value={formData.inspection_type} onChange={e => setFormData(p => ({...p, inspection_type: e.target.value}))} className={inputCls}>
                    {INSPECTION_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Result</label>
                  <select value={formData.passed} onChange={e => setFormData(p => ({...p, passed: e.target.value}))} className={inputCls}>
                    <option value="">Pending</option>
                    <option value="true">Passed</option>
                    <option value="false">Failed</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Inspection Date *</label><input type="date" value={formData.inspection_date} onChange={e => setFormData(p => ({...p, inspection_date: e.target.value}))} className={inputCls} /></div>
                <div><label className={labelCls}>Next Inspection Date</label><input type="date" value={formData.next_inspection_date} onChange={e => setFormData(p => ({...p, next_inspection_date: e.target.value}))} className={inputCls} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>Inspector Name</label><input type="text" value={formData.inspector_name} onChange={e => setFormData(p => ({...p, inspector_name: e.target.value}))} className={inputCls} /></div>
                <div><label className={labelCls}>Organization</label><input type="text" value={formData.inspector_organization} onChange={e => setFormData(p => ({...p, inspector_organization: e.target.value}))} className={inputCls} /></div>
              </div>
              <div><label className={labelCls}>Description</label><textarea value={formData.description} onChange={e => setFormData(p => ({...p, description: e.target.value}))} rows={2} className={inputCls + ' resize-none'} /></div>
              <div><label className={labelCls}>Findings</label><textarea value={formData.findings} onChange={e => setFormData(p => ({...p, findings: e.target.value}))} rows={2} className={inputCls + ' resize-none'} /></div>
              <div><label className={labelCls}>Corrective Actions</label><textarea value={formData.corrective_actions} onChange={e => setFormData(p => ({...p, corrective_actions: e.target.value}))} rows={2} className={inputCls + ' resize-none'} /></div>
              {formData.corrective_actions && (
                <div><label className={labelCls}>Corrective Action Deadline</label><input type="date" value={formData.corrective_action_deadline} onChange={e => setFormData(p => ({...p, corrective_action_deadline: e.target.value}))} className={inputCls} /></div>
              )}
              <div><label className={labelCls}>Notes</label><textarea value={formData.notes} onChange={e => setFormData(p => ({...p, notes: e.target.value}))} rows={2} className={inputCls + ' resize-none'} /></div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors text-sm">Cancel</button>
              <button onClick={handleSave} disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
              >
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingInspection ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
