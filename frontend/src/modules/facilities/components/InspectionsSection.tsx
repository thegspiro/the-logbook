/**
 * InspectionsSection — Inspection records for a single facility.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck, Plus, Search, Loader2, X, CheckCircle2,
  XCircle, MinusCircle, Calendar, AlertTriangle, Pencil,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { InspectionCreate } from '../../../services/facilitiesServices';
import type { Inspection } from '../types';
import { enumLabel } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { getTodayLocalDate, formatDate } from '../../../utils/dateFormatting';

const INSPECTION_TYPE_OPTIONS = [
  'fire', 'building_code', 'health', 'ada', 'environmental',
  'insurance', 'routine', 'other',
] as const;

interface Props {
  facilityId: string;
}

export default function InspectionsSection({ facilityId }: Props) {
  const tz = useTimezone();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'passed' | 'failed' | 'pending'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingInspection, setEditingInspection] = useState<Inspection | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    inspection_type: 'routine',
    title: '',
    description: '',
    inspection_date: '',
    next_inspection_date: '',
    inspector_name: '',
    inspector_organization: '',
    passed: '',
    findings: '',
    corrective_actions: '',
    corrective_action_deadline: '',
    notes: '',
  });

  const loadInspections = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await facilitiesService.getInspections({ facility_id: facilityId });
      setInspections(data);
    } catch {
      toast.error('Failed to load inspections');
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => { void loadInspections(); }, [loadInspections]);

  const filtered = inspections.filter(i => {
    if (resultFilter === 'passed' && i.passed !== true) return false;
    if (resultFilter === 'failed' && i.passed !== false) return false;
    if (resultFilter === 'pending' && i.passed !== null && i.passed !== undefined) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return !!(
        i.title?.toLowerCase().includes(q) ||
        i.inspectorName?.toLowerCase().includes(q) ||
        i.inspectorOrganization?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const openCreate = () => {
    setEditingInspection(null);
    setFormData({
      inspection_type: 'routine', title: '', description: '',
      inspection_date: getTodayLocalDate(tz), next_inspection_date: '',
      inspector_name: '', inspector_organization: '', passed: '',
      findings: '', corrective_actions: '', corrective_action_deadline: '', notes: '',
    });
    setShowModal(true);
  };

  const openEdit = (insp: Inspection) => {
    setEditingInspection(insp);
    setFormData({
      inspection_type: insp.inspectionType || 'routine',
      title: insp.title || '',
      description: insp.description || '',
      inspection_date: insp.inspectionDate || '',
      next_inspection_date: insp.nextInspectionDate || '',
      inspector_name: insp.inspectorName || '',
      inspector_organization: insp.inspectorOrganization || '',
      passed: insp.passed === true ? 'true' : insp.passed === false ? 'false' : '',
      findings: insp.findings || '',
      corrective_actions: insp.correctiveActions || '',
      corrective_action_deadline: insp.correctiveActionDeadline || '',
      notes: insp.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) { toast.error('Title is required'); return; }
    if (!formData.inspection_date) { toast.error('Inspection date is required'); return; }
    setIsSaving(true);
    try {
      const payload: InspectionCreate = {
        facility_id: facilityId,
        inspection_type: formData.inspection_type,
        title: formData.title.trim(),
        inspection_date: formData.inspection_date,
        passed: formData.passed === 'true' ? true : formData.passed === 'false' ? false : null,
      };
      if (formData.description.trim()) payload.description = formData.description.trim();
      if (formData.next_inspection_date) payload.next_inspection_date = formData.next_inspection_date;
      if (formData.inspector_name.trim()) payload.inspector_name = formData.inspector_name.trim();
      if (formData.inspector_organization.trim()) payload.inspector_organization = formData.inspector_organization.trim();
      if (formData.findings.trim()) payload.findings = formData.findings.trim();
      if (formData.corrective_actions.trim()) payload.corrective_actions = formData.corrective_actions.trim();
      if (formData.corrective_action_deadline) payload.corrective_action_deadline = formData.corrective_action_deadline;
      if (formData.notes.trim()) payload.notes = formData.notes.trim();

      if (editingInspection) {
        await facilitiesService.updateInspection(editingInspection.id, payload);
        toast.success('Inspection updated');
      } else {
        await facilitiesService.createInspection(payload);
        toast.success('Inspection created');
      }
      setShowModal(false);
      void loadInspections();
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
      void loadInspections();
    } catch {
      toast.error('Failed to delete inspection');
    }
  };

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
  const labelCls = 'block text-xs font-medium text-theme-text-muted mb-1';

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl">
      <div className="flex items-center justify-between p-5 border-b border-theme-surface-border">
        <h2 className="text-sm font-semibold text-theme-text-primary">Inspections</h2>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
          <Plus className="w-3.5 h-3.5" /> New Inspection
        </button>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} aria-label="Search inspections..." placeholder="Search inspections..." className={inputCls + ' pl-9'} />
          </div>
          <div className="flex items-center border border-theme-surface-border rounded-lg overflow-hidden">
            {(['all', 'passed', 'failed', 'pending'] as const).map(s => (
              <button key={s} onClick={() => setResultFilter(s)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${resultFilter === s ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
              >{s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <ClipboardCheck className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
            <p className="text-sm text-theme-text-muted">{searchQuery || resultFilter !== 'all' ? 'No inspections match your filters.' : 'No inspections recorded yet.'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(insp => (
              <div key={insp.id} className="flex items-center gap-3 p-3 bg-theme-surface-hover/30 rounded-lg group">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                  insp.passed === true ? 'bg-emerald-500/10 text-emerald-500' :
                  insp.passed === false ? 'bg-red-500/10 text-red-500' :
                  'bg-theme-surface-secondary text-theme-text-muted'
                }`}>
                  {insp.passed === true ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                   insp.passed === false ? <XCircle className="w-3.5 h-3.5" /> :
                   <MinusCircle className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium text-theme-text-primary truncate">{insp.title}</p>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-theme-surface-hover text-theme-text-muted shrink-0">{enumLabel(insp.inspectionType)}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-theme-text-muted">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDate(insp.inspectionDate, tz)}</span>
                    {insp.inspectorName && <span>{insp.inspectorName}</span>}
                    {insp.nextInspectionDate && <span>Next: {formatDate(insp.nextInspectionDate, tz)}</span>}
                    {insp.correctiveActions && !insp.correctiveActionCompleted && (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-3 h-3" /> Corrective action needed
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(insp)} title="Edit" aria-label="Edit inspection" className="p-1.5 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { void handleDelete(insp); }} title="Delete" aria-label="Delete inspection" className="p-1.5 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true"
          onKeyDown={e => { if (e.key === 'Escape') setShowModal(false); }}>
          <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-bold text-theme-text-primary">{editingInspection ? 'Edit Inspection' : 'New Inspection'}</h2>
              <button onClick={() => setShowModal(false)} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close dialog"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Title *</label>
                <input type="text" value={formData.title} onChange={e => setFormData(p => ({...p, title: e.target.value}))} className={inputCls} placeholder="e.g., Annual Fire Inspection 2026" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Type</label>
                  <select value={formData.inspection_type} onChange={e => setFormData(p => ({...p, inspection_type: e.target.value}))} className={inputCls}>
                    {INSPECTION_TYPE_OPTIONS.map(t => <option key={t} value={t}>{enumLabel(t)}</option>)}
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
              <button onClick={() => { void handleSave(); }} disabled={isSaving} className="btn-primary flex gap-2 items-center px-5 text-sm">
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
