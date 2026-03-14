/**
 * ComplianceSection — Compliance checklists for a single facility.
 */

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Plus, Trash2, Loader2, CheckCircle2, Circle, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { ComplianceChecklist, ComplianceChecklistCreate } from '../../../services/facilitiesServices';
import { enumLabel } from '../types';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, isPastDate } from '../../../utils/dateFormatting';

const COMPLIANCE_TYPE_OPTIONS = [
  'nfpa', 'osha', 'ada', 'building_code', 'fire_code',
  'environmental', 'insurance', 'other',
] as const;

interface Props {
  facilityId: string;
}

export default function ComplianceSection({ facilityId }: Props) {
  const tz = useTimezone();
  const [checklists, setChecklists] = useState<ComplianceChecklist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    compliance_type: 'nfpa',
    title: '',
    description: '',
    due_date: '',
  });

  const loadChecklists = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await facilitiesService.getComplianceChecklists({ facility_id: facilityId });
      setChecklists(data);
    } catch {
      toast.error('Failed to load compliance checklists');
    } finally {
      setIsLoading(false);
    }
  }, [facilityId]);

  useEffect(() => { void loadChecklists(); }, [loadChecklists]);

  const handleCreate = async () => {
    if (!formData.title.trim()) { toast.error('Title is required'); return; }
    setIsSaving(true);
    try {
      const payload: ComplianceChecklistCreate = {
        facility_id: facilityId,
        compliance_type: formData.compliance_type,
        title: formData.title.trim(),
      };
      if (formData.description.trim()) payload.description = formData.description.trim();
      if (formData.due_date) payload.due_date = formData.due_date;

      await facilitiesService.createComplianceChecklist(payload);
      toast.success('Checklist created');
      setShowForm(false);
      setFormData({ compliance_type: 'nfpa', title: '', description: '', due_date: '' });
      void loadChecklists();
    } catch {
      toast.error('Failed to create checklist');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (checklist: ComplianceChecklist) => {
    if (!window.confirm(`Delete checklist "${checklist.title}"?`)) return;
    try {
      await facilitiesService.deleteComplianceChecklist(checklist.id);
      toast.success('Checklist deleted');
      void loadChecklists();
    } catch {
      toast.error('Failed to delete checklist');
    }
  };

  const inputCls = 'w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring';
  const labelCls = 'block text-xs font-medium text-theme-text-muted mb-1';

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl">
      <div className="flex items-center justify-between p-5 border-b border-theme-surface-border">
        <h2 className="text-sm font-semibold text-theme-text-primary">
          Compliance Checklists {!isLoading && `(${checklists.length})`}
        </h2>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add Checklist
        </button>
      </div>

      <div className="p-5">
        {showForm && (
          <div className="mb-5 p-4 bg-theme-surface-hover/50 rounded-lg space-y-3">
            <h3 className="text-sm font-medium text-theme-text-primary">New Compliance Checklist</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Title *</label>
                <input type="text" value={formData.title} onChange={e => setFormData(p => ({...p, title: e.target.value}))} placeholder="e.g., NFPA 1500 Annual Review" className={inputCls} autoFocus />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select value={formData.compliance_type} onChange={e => setFormData(p => ({...p, compliance_type: e.target.value}))} className={inputCls}>
                  {COMPLIANCE_TYPE_OPTIONS.map(ct => <option key={ct} value={ct}>{enumLabel(ct)}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Due Date</label>
                <input type="date" value={formData.due_date} onChange={e => setFormData(p => ({...p, due_date: e.target.value}))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <input type="text" value={formData.description} onChange={e => setFormData(p => ({...p, description: e.target.value}))} className={inputCls} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => { void handleCreate(); }} disabled={isSaving} className="btn-primary flex gap-1.5 items-center px-3 py-1.5 text-xs">
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Create
              </button>
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors">Cancel</button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" /></div>
        ) : checklists.length === 0 ? (
          <div className="text-center py-8">
            <ShieldCheck className="w-8 h-8 text-theme-text-muted mx-auto mb-2" />
            <p className="text-sm text-theme-text-muted">No compliance checklists yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {checklists.map(checklist => (
              <div key={checklist.id} className="flex items-center justify-between p-3 bg-theme-surface-hover/30 rounded-lg group">
                <div className="flex items-center gap-3">
                  {checklist.isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Circle className="w-4 h-4 text-theme-text-muted" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-theme-text-primary">{checklist.title}</p>
                    <div className="flex items-center gap-2 text-xs text-theme-text-muted">
                      <span>{enumLabel(checklist.complianceType)}</span>
                      {checklist.dueDate && (
                        <span className={`flex items-center gap-1 ${isPastDate(checklist.dueDate) && !checklist.isCompleted ? 'text-red-500 font-medium' : ''}`}>
                          <Calendar className="w-3 h-3" />
                          Due: {formatDate(checklist.dueDate, tz)}
                        </span>
                      )}
                      {checklist.isCompleted && checklist.completedDate && (
                        <span className="text-emerald-600 dark:text-emerald-400">
                          Completed: {formatDate(checklist.completedDate, tz)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => { void handleDelete(checklist); }} className="opacity-0 group-hover:opacity-100 p-1.5 text-theme-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all" aria-label={`Delete ${checklist.title}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
