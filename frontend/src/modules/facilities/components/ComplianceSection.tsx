/**
 * ComplianceSection — Compliance checklists for a single facility.
 */

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Plus, Trash2, Loader2, CheckCircle2, Circle, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import { facilitiesService } from '../../../services/api';
import type { ComplianceChecklist, ComplianceChecklistCreate } from '../../../services/facilitiesServices';
import { enumLabel } from '../types';
import { inputCls, labelCls, COMPLIANCE_TYPE_OPTIONS } from '../constants';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate, isPastDate } from '../../../utils/dateFormatting';

import { useConfirm } from '../../../contexts/ConfirmContext';
interface Props {
  facilityId: string;
  canManage: boolean;
}

export default function ComplianceSection({ facilityId, canManage }: Props) {
  const { confirm } = useConfirm();
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

  useEffect(() => {
    void loadChecklists();
  }, [loadChecklists]);

  const handleCreate = async () => {
    if (!formData.title.trim()) {
      toast.error('Title is required');
      return;
    }
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
    if (
      !(await confirm({
        title: 'Delete checklist',
        message: `Delete the compliance checklist "${checklist.title}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    try {
      await facilitiesService.deleteComplianceChecklist(checklist.id);
      toast.success('Checklist deleted');
      void loadChecklists();
    } catch {
      toast.error('Failed to delete checklist');
    }
  };

  return (
    <div className="bg-theme-surface border-theme-surface-border rounded-xl border">
      <div className="border-theme-surface-border flex items-center justify-between border-b p-5">
        <h2 className="text-theme-text-primary text-sm font-semibold">
          Compliance Checklists {!isLoading && `(${checklists.length})`}
        </h2>
        {canManage && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
          >
            <Plus className="h-3.5 w-3.5" /> Add Checklist
          </button>
        )}
      </div>

      <div className="p-5">
        {canManage && showForm && (
          <div className="bg-theme-surface-hover/50 mb-5 space-y-3 rounded-lg p-4">
            <h3 className="text-theme-text-primary text-sm font-medium">New Compliance Checklist</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData((p) => ({ ...p, title: e.target.value }))}
                  placeholder="e.g., NFPA 1500 Annual Review"
                  className={inputCls}
                  autoFocus
                />
              </div>
              <div>
                <label className={labelCls}>Type</label>
                <select
                  value={formData.compliance_type}
                  onChange={(e) => setFormData((p) => ({ ...p, compliance_type: e.target.value }))}
                  className={inputCls}
                >
                  {COMPLIANCE_TYPE_OPTIONS.map((ct) => (
                    <option key={ct} value={ct}>
                      {enumLabel(ct)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Due Date</label>
                <input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData((p) => ({ ...p, due_date: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  void handleCreate();
                }}
                disabled={isSaving}
                className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create
              </button>
              <button
                onClick={() => setShowForm(false)}
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
        ) : checklists.length === 0 ? (
          <div className="py-8 text-center">
            <ShieldCheck className="text-theme-text-muted mx-auto mb-2 h-8 w-8" />
            <p className="text-theme-text-muted text-sm">No compliance checklists yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {checklists.map((checklist) => (
              <div
                key={checklist.id}
                className="bg-theme-surface-hover/30 group flex items-center justify-between rounded-lg p-3"
              >
                <div className="flex items-center gap-3">
                  {checklist.isCompleted ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Circle className="text-theme-text-muted h-4 w-4" />
                  )}
                  <div>
                    <p className="text-theme-text-primary text-sm font-medium">{checklist.title}</p>
                    <div className="text-theme-text-muted flex items-center gap-2 text-xs">
                      <span>{enumLabel(checklist.complianceType)}</span>
                      {checklist.dueDate && (
                        <span
                          className={`flex items-center gap-1 ${isPastDate(checklist.dueDate) && !checklist.isCompleted ? 'font-medium text-red-500' : ''}`}
                        >
                          <Calendar className="h-3 w-3" />
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
                {canManage && (
                  <button
                    onClick={() => {
                      void handleDelete(checklist);
                    }}
                    className="text-theme-text-muted rounded-lg p-1.5 transition-all hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label={`Delete ${checklist.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
