/**
 * Pipeline Detail Page
 *
 * Single pipeline detail view with Kanban board, Steps management,
 * and Statistics tabs. Supports adding prospects, managing steps,
 * advancing/completing prospects, and purging inactive.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import {
  ArrowLeft,
  Plus,
  Edit2,
  Trash2,
  ChevronUp,
  ChevronDown,
  CheckCircle,
  ArrowRight,
  BarChart3,
  Layers,
  LayoutGrid,
  Users,
  Loader2,
  AlertTriangle,
  X,
  GripVertical,
  UserPlus,
  Zap,
} from 'lucide-react';
import { prospectiveMemberService } from '../services/api';

// ==================== Interfaces ====================

interface PipelineStep {
  id: string;
  pipeline_id: string;
  name: string;
  description?: string;
  step_type: string;
  action_type?: string;
  is_first_step: boolean;
  is_final_step: boolean;
  sort_order: number;
  required: boolean;
  config?: Record<string, unknown>;
  inactivity_timeout_days?: number;
  created_at: string;
  updated_at: string;
}

interface Pipeline {
  id: string;
  name: string;
  description?: string;
  is_template: boolean;
  is_default: boolean;
  is_active: boolean;
  auto_transfer_on_approval: boolean;
  inactivity_config?: Record<string, unknown>;
  steps: PipelineStep[];
  prospect_count?: number;
  created_at: string;
  updated_at: string;
}

interface ProspectListItem {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  status: string;
  pipeline_id?: string;
  pipeline_name?: string;
  current_step_id?: string;
  current_step_name?: string;
  created_at: string;
}

interface KanbanColumn {
  step: PipelineStep;
  prospects: ProspectListItem[];
  count: number;
}

interface KanbanData {
  pipeline: Record<string, unknown>;
  columns: KanbanColumn[];
  total_prospects: number;
}

interface PipelineStats {
  pipeline_id: string;
  total_prospects: number;
  active_count: number;
  approved_count: number;
  rejected_count: number;
  withdrawn_count: number;
  transferred_count: number;
  by_step: Array<{ stage_id: string; stage_name: string; count: number }>;
  avg_days_to_transfer?: number;
  conversion_rate?: number;
}

type TabView = 'kanban' | 'steps' | 'stats';

const statusStyles: Record<string, string> = {
  active: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  pending: 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  transferred: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  withdrawn: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  approved: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  rejected: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

// ==================== Step Modal ====================

interface StepModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  pipelineId: string;
  step?: PipelineStep | null;
  nextSortOrder: number;
}

const StepModal: React.FC<StepModalProps> = ({ isOpen, onClose, onSuccess, pipelineId, step, nextSortOrder }) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    step_type: 'checkbox',
    action_type: '',
    is_first_step: false,
    is_final_step: false,
    sort_order: 0,
    required: true,
    inactivity_timeout_days: '' as string | number,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (step) {
      setFormData({
        name: step.name,
        description: step.description || '',
        step_type: step.step_type,
        action_type: step.action_type || '',
        is_first_step: step.is_first_step,
        is_final_step: step.is_final_step,
        sort_order: step.sort_order,
        required: step.required,
        inactivity_timeout_days: step.inactivity_timeout_days ?? '',
      });
    } else {
      setFormData({
        name: '',
        description: '',
        step_type: 'checkbox',
        action_type: '',
        is_first_step: false,
        is_final_step: false,
        sort_order: nextSortOrder,
        required: true,
        inactivity_timeout_days: '',
      });
    }
    setError('');
  }, [step, isOpen, nextSortOrder]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const data: Record<string, unknown> = {
        name: formData.name,
        step_type: formData.step_type,
        is_first_step: formData.is_first_step,
        is_final_step: formData.is_final_step,
        sort_order: formData.sort_order,
        required: formData.required,
      };
      if (formData.description) data.description = formData.description;
      if (formData.action_type) data.action_type = formData.action_type;
      if (formData.inactivity_timeout_days !== '' && formData.inactivity_timeout_days !== undefined) {
        data.inactivity_timeout_days = Number(formData.inactivity_timeout_days);
      }

      if (step) {
        await prospectiveMemberService.updateStep(pipelineId, step.id, data as Parameters<typeof prospectiveMemberService.updateStep>[2]);
        toast.success('Step updated');
      } else {
        await prospectiveMemberService.addStep(pipelineId, data as Parameters<typeof prospectiveMemberService.addStep>[1]);
        toast.success('Step added');
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, step ? 'Failed to update step' : 'Failed to add step'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="step-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-secondary rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="step-modal-title" className="text-xl font-bold text-theme-text-primary">
            {step ? 'Edit Step' : 'Add Step'}
          </h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-700 dark:text-red-400 px-4 py-3 rounded" role="alert">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="step-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="step-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              placeholder="e.g., Application Review"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="step-description" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Description
            </label>
            <textarea
              id="step-description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="step-type" className="block text-sm font-medium text-theme-text-secondary mb-2">
                Step Type
              </label>
              <select
                id="step-type"
                value={formData.step_type}
                onChange={(e) => setFormData(prev => ({ ...prev, step_type: e.target.value }))}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
              >
                <option value="checkbox">Checkbox</option>
                <option value="action">Action</option>
                <option value="note">Note</option>
              </select>
            </div>
            <div>
              <label htmlFor="step-action-type" className="block text-sm font-medium text-theme-text-secondary mb-2">
                Action Type
              </label>
              <select
                id="step-action-type"
                value={formData.action_type}
                onChange={(e) => setFormData(prev => ({ ...prev, action_type: e.target.value }))}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
              >
                <option value="">None</option>
                <option value="send_email">Send Email</option>
                <option value="schedule_meeting">Schedule Meeting</option>
                <option value="collect_document">Collect Document</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="step-sort-order" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Sort Order
            </label>
            <input
              id="step-sort-order"
              type="number"
              min="0"
              value={formData.sort_order}
              onChange={(e) => setFormData(prev => ({ ...prev, sort_order: parseInt(e.target.value) || 0 }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
            />
          </div>

          <div>
            <label htmlFor="step-inactivity" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Inactivity Timeout (days)
            </label>
            <input
              id="step-inactivity"
              type="number"
              min="0"
              value={formData.inactivity_timeout_days}
              onChange={(e) => setFormData(prev => ({ ...prev, inactivity_timeout_days: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              placeholder="Optional"
            />
          </div>

          <div className="space-y-3 border-t border-theme-surface-border pt-4">
            <div className="flex items-center justify-between">
              <label htmlFor="step-required" className="text-sm font-medium text-theme-text-secondary">Required</label>
              <button
                id="step-required"
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, required: !prev.required }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.required ? 'bg-red-600' : 'bg-theme-surface-hover'}`}
                role="switch"
                aria-checked={formData.required}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.required ? 'translate-x-6' : 'translate-x-1'}`} aria-hidden="true" />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <label htmlFor="step-first" className="text-sm font-medium text-theme-text-secondary">First Step</label>
              <button
                id="step-first"
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, is_first_step: !prev.is_first_step }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_first_step ? 'bg-red-600' : 'bg-theme-surface-hover'}`}
                role="switch"
                aria-checked={formData.is_first_step}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_first_step ? 'translate-x-6' : 'translate-x-1'}`} aria-hidden="true" />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <label htmlFor="step-final" className="text-sm font-medium text-theme-text-secondary">Final Step</label>
              <button
                id="step-final"
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, is_final_step: !prev.is_final_step }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_final_step ? 'bg-red-600' : 'bg-theme-surface-hover'}`}
                role="switch"
                aria-checked={formData.is_final_step}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_final_step ? 'translate-x-6' : 'translate-x-1'}`} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {step ? 'Update' : 'Add Step'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ==================== Add Prospect Modal (for pipeline) ====================

interface AddProspectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  pipelineId: string;
}

const AddProspectModal: React.FC<AddProspectModalProps> = ({ isOpen, onClose, onSuccess, pipelineId }) => {
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    interest_reason: '',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFormData({ first_name: '', last_name: '', email: '', phone: '', interest_reason: '', notes: '' });
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const submitData: Record<string, unknown> = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        pipeline_id: pipelineId,
      };
      if (formData.phone) submitData.phone = formData.phone;
      if (formData.interest_reason) submitData.interest_reason = formData.interest_reason;
      if (formData.notes) submitData.notes = formData.notes;

      await prospectiveMemberService.createProspect(submitData as Parameters<typeof prospectiveMemberService.createProspect>[0]);
      toast.success('Prospect added to pipeline');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to add prospect'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-prospect-pipeline-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-secondary rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="add-prospect-pipeline-title" className="text-xl font-bold text-theme-text-primary">Add Prospect to Pipeline</h2>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-700 dark:text-red-400 px-4 py-3 rounded" role="alert">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="ap-first-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
                First Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="ap-first-name"
                type="text"
                value={formData.first_name}
                onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                required
                aria-required="true"
              />
            </div>
            <div>
              <label htmlFor="ap-last-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
                Last Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="ap-last-name"
                type="text"
                value={formData.last_name}
                onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                required
                aria-required="true"
              />
            </div>
          </div>

          <div>
            <label htmlFor="ap-email" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Email <span aria-hidden="true">*</span>
            </label>
            <input
              id="ap-email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="ap-phone" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Phone
            </label>
            <input
              id="ap-phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
            />
          </div>

          <div>
            <label htmlFor="ap-interest" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Interest / Reason
            </label>
            <textarea
              id="ap-interest"
              value={formData.interest_reason}
              onChange={(e) => setFormData(prev => ({ ...prev, interest_reason: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button type="button" onClick={onClose} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Add Prospect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ==================== Main Page Component ====================

export const PipelineDetailPage: React.FC = () => {
  const { id: pipelineId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabView>('kanban');

  // Pipeline state
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Kanban state
  const [kanbanData, setKanbanData] = useState<KanbanData | null>(null);
  const [kanbanLoading, setKanbanLoading] = useState(false);

  // Steps state
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepModalOpen, setStepModalOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<PipelineStep | null>(null);

  // Stats state
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Prospect modal state
  const [addProspectOpen, setAddProspectOpen] = useState(false);

  // Purge state
  const [isPurging, setIsPurging] = useState(false);

  // ==================== Load Data ====================

  const loadPipeline = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    setError('');
    try {
      const data = await prospectiveMemberService.getPipeline(pipelineId);
      setPipeline(data as unknown as Pipeline);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load pipeline'));
    } finally {
      setLoading(false);
    }
  }, [pipelineId]);

  const loadKanban = useCallback(async () => {
    if (!pipelineId) return;
    setKanbanLoading(true);
    try {
      const data = await prospectiveMemberService.getKanbanBoard(pipelineId);
      setKanbanData(data as unknown as KanbanData);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load kanban board'));
    } finally {
      setKanbanLoading(false);
    }
  }, [pipelineId]);

  const loadSteps = useCallback(async () => {
    if (!pipelineId) return;
    setStepsLoading(true);
    try {
      const data = await prospectiveMemberService.listSteps(pipelineId);
      setSteps(data as unknown as PipelineStep[]);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load steps'));
    } finally {
      setStepsLoading(false);
    }
  }, [pipelineId]);

  const loadStats = useCallback(async () => {
    if (!pipelineId) return;
    setStatsLoading(true);
    try {
      const data = await prospectiveMemberService.getPipelineStats(pipelineId);
      setStats(data as unknown as PipelineStats);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load statistics'));
    } finally {
      setStatsLoading(false);
    }
  }, [pipelineId]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  useEffect(() => {
    if (activeTab === 'kanban') loadKanban();
    else if (activeTab === 'steps') loadSteps();
    else if (activeTab === 'stats') loadStats();
  }, [activeTab, loadKanban, loadSteps, loadStats]);

  // ==================== Actions ====================

  const handleCompleteStep = async (prospectId: string, stepId: string) => {
    try {
      await prospectiveMemberService.completeStep(prospectId, { step_id: stepId });
      toast.success('Step completed');
      loadKanban();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to complete step'));
    }
  };

  const handleAdvanceProspect = async (prospectId: string) => {
    try {
      await prospectiveMemberService.advanceProspect(prospectId);
      toast.success('Prospect advanced');
      loadKanban();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to advance prospect'));
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!pipelineId) return;
    if (!window.confirm('Delete this step? This cannot be undone.')) return;
    try {
      await prospectiveMemberService.deleteStep(pipelineId, stepId);
      toast.success('Step deleted');
      loadSteps();
      loadPipeline();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete step'));
    }
  };

  const handleMoveStep = async (stepId: string, direction: 'up' | 'down') => {
    const idx = steps.findIndex(s => s.id === stepId);
    if (idx < 0) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= steps.length) return;

    const newSteps = [...steps];
    [newSteps[idx], newSteps[newIdx]] = [newSteps[newIdx], newSteps[idx]];
    const stepIds = newSteps.map(s => s.id);

    try {
      await prospectiveMemberService.reorderSteps(pipelineId!, stepIds);
      toast.success('Steps reordered');
      loadSteps();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reorder steps'));
    }
  };

  const handlePurgeInactive = async () => {
    if (!pipelineId) return;
    if (!window.confirm('Purge all withdrawn/inactive prospects from this pipeline? This cannot be undone.')) return;
    setIsPurging(true);
    try {
      const result = await prospectiveMemberService.purgeInactive(pipelineId, { confirm: true });
      toast.success(result.message || `Purged ${result.purged_count} prospect(s)`);
      loadKanban();
      loadPipeline();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to purge inactive prospects'));
    } finally {
      setIsPurging(false);
    }
  };

  // ==================== Tab Definitions ====================

  const tabDefs: { id: TabView; label: string; icon: React.ReactNode }[] = [
    { id: 'kanban', label: 'Kanban Board', icon: <LayoutGrid className="w-4 h-4" /> },
    { id: 'steps', label: 'Steps', icon: <Layers className="w-4 h-4" /> },
    { id: 'stats', label: 'Statistics', icon: <BarChart3 className="w-4 h-4" /> },
  ];

  // ==================== Render ====================

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (error || !pipeline) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-theme-text-primary mb-2">Pipeline Not Found</h3>
          <p className="text-theme-text-muted mb-4">{error || 'The pipeline could not be loaded.'}</p>
          <button
            onClick={() => navigate('/prospective-members')}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
          >
            Back to Pipelines
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/prospective-members')}
          className="flex items-center gap-1 text-sm text-theme-text-muted hover:text-theme-text-primary mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Pipelines
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-theme-text-primary">{pipeline.name}</h1>
            {pipeline.description && (
              <p className="text-theme-text-muted mt-1">{pipeline.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <span className="text-sm text-theme-text-muted flex items-center gap-1">
                <Layers className="w-4 h-4" /> {pipeline.steps.length} steps
              </span>
              <span className="text-sm text-theme-text-muted flex items-center gap-1">
                <Users className="w-4 h-4" /> {pipeline.prospect_count ?? 0} prospects
              </span>
              {pipeline.is_default && (
                <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 rounded-full">Default</span>
              )}
              {!pipeline.is_active && (
                <span className="text-xs px-2 py-0.5 bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400 rounded-full">Inactive</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddProspectOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Add Prospect
            </button>
            <button
              onClick={handlePurgeInactive}
              disabled={isPurging}
              className="flex items-center gap-2 px-4 py-2 border border-theme-surface-border text-theme-text-secondary hover:text-red-600 hover:border-red-500/50 rounded-lg transition-colors disabled:opacity-50"
              title="Remove withdrawn/inactive prospects"
            >
              {isPurging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Purge Inactive
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-theme-surface-border mb-6">
        <nav className="flex gap-4" aria-label="Pipeline detail tabs">
          {tabDefs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors text-sm font-medium ${
                activeTab === tab.id
                  ? 'border-red-600 text-red-600'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Kanban Board Tab */}
      {activeTab === 'kanban' && (
        <div>
          {kanbanLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
            </div>
          ) : !kanbanData || kanbanData.columns.length === 0 ? (
            <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
              <LayoutGrid className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-theme-text-primary mb-2">No Steps Configured</h3>
              <p className="text-theme-text-muted mb-4">Add steps to this pipeline to see the kanban board.</p>
              <button
                onClick={() => setActiveTab('steps')}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                Manage Steps
              </button>
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {kanbanData.columns.map(column => (
                <div key={column.step.id} className="min-w-[300px] max-w-[340px] bg-theme-surface rounded-lg p-4 flex-shrink-0">
                  <h3 className="font-medium text-theme-text-primary mb-3 flex items-center justify-between">
                    <span>{column.step.name}</span>
                    <span className="text-xs text-theme-text-muted bg-theme-surface-secondary px-2 py-0.5 rounded-full">
                      {column.count}
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {column.prospects.length === 0 ? (
                      <p className="text-sm text-theme-text-muted py-4 text-center">No prospects</p>
                    ) : (
                      column.prospects.map(prospect => (
                        <div
                          key={prospect.id}
                          className="bg-theme-surface-secondary rounded-lg p-3 border border-theme-surface-border"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <button
                              onClick={() => navigate(`/prospective-members/prospects/${prospect.id}`)}
                              className="text-sm font-medium text-theme-text-primary hover:text-red-600 text-left"
                            >
                              {prospect.first_name} {prospect.last_name}
                            </button>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${statusStyles[prospect.status] || statusStyles.pending}`}>
                              {prospect.status}
                            </span>
                          </div>
                          <p className="text-xs text-theme-text-muted mb-3">{prospect.email}</p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleCompleteStep(prospect.id, column.step.id)}
                              className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 font-medium"
                              title="Mark step completed"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Complete
                            </button>
                            {!column.step.is_final_step && (
                              <button
                                onClick={() => handleAdvanceProspect(prospect.id)}
                                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                                title="Advance to next step"
                              >
                                <ArrowRight className="w-3.5 h-3.5" />
                                Advance
                              </button>
                            )}
                            <button
                              onClick={() => navigate(`/prospective-members/prospects/${prospect.id}`)}
                              className="ml-auto text-xs text-theme-text-muted hover:text-theme-text-primary"
                            >
                              Details
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Steps Tab */}
      {activeTab === 'steps' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-theme-text-primary">Pipeline Steps</h2>
            <button
              onClick={() => { setEditingStep(null); setStepModalOpen(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Step
            </button>
          </div>

          {stepsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
            </div>
          ) : steps.length === 0 ? (
            <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
              <Layers className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-theme-text-primary mb-2">No Steps</h3>
              <p className="text-theme-text-muted mb-4">Add steps to define the pipeline process.</p>
              <button
                onClick={() => { setEditingStep(null); setStepModalOpen(true); }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                Add First Step
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {steps.map((step, idx) => (
                <div
                  key={step.id}
                  className="bg-theme-surface rounded-lg border border-theme-surface-border p-4 flex items-center gap-4"
                >
                  <div className="flex flex-col items-center gap-1 text-theme-text-muted">
                    <button
                      onClick={() => handleMoveStep(step.id, 'up')}
                      disabled={idx === 0}
                      className="p-0.5 hover:text-theme-text-primary disabled:opacity-30"
                      title="Move up"
                      aria-label="Move step up"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <GripVertical className="w-4 h-4 text-theme-text-muted" />
                    <button
                      onClick={() => handleMoveStep(step.id, 'down')}
                      disabled={idx === steps.length - 1}
                      className="p-0.5 hover:text-theme-text-primary disabled:opacity-30"
                      title="Move down"
                      aria-label="Move step down"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-theme-text-muted bg-theme-surface-secondary px-2 py-0.5 rounded">
                        #{idx + 1}
                      </span>
                      <h3 className="font-medium text-theme-text-primary">{step.name}</h3>
                      {step.is_first_step && (
                        <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400 rounded-full">First</span>
                      )}
                      {step.is_final_step && (
                        <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 rounded-full">Final</span>
                      )}
                      {step.required && (
                        <span className="text-xs px-2 py-0.5 bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400 rounded-full">Required</span>
                      )}
                    </div>
                    {step.description && (
                      <p className="text-sm text-theme-text-muted">{step.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted">
                      <span>Type: {step.step_type}</span>
                      {step.action_type && <span>Action: {step.action_type}</span>}
                      {step.inactivity_timeout_days && <span>Timeout: {step.inactivity_timeout_days}d</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setEditingStep(step); setStepModalOpen(true); }}
                      className="p-2 text-theme-text-muted hover:text-theme-text-primary rounded"
                      title="Edit step"
                      aria-label={`Edit ${step.name}`}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteStep(step.id)}
                      className="p-2 text-theme-text-muted hover:text-red-600 rounded"
                      title="Delete step"
                      aria-label={`Delete ${step.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Statistics Tab */}
      {activeTab === 'stats' && (
        <div>
          {statsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
            </div>
          ) : !stats ? (
            <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
              <BarChart3 className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-theme-text-primary mb-2">No Statistics Available</h3>
              <p className="text-theme-text-muted">Statistics will appear once prospects are added to the pipeline.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
                  <p className="text-sm text-theme-text-muted">Total</p>
                  <p className="text-2xl font-bold text-theme-text-primary">{stats.total_prospects}</p>
                </div>
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
                  <p className="text-sm text-theme-text-muted">Active</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.active_count}</p>
                </div>
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
                  <p className="text-sm text-theme-text-muted">Approved</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.approved_count}</p>
                </div>
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
                  <p className="text-sm text-theme-text-muted">Rejected</p>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.rejected_count}</p>
                </div>
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
                  <p className="text-sm text-theme-text-muted">Withdrawn</p>
                  <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats.withdrawn_count}</p>
                </div>
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
                  <p className="text-sm text-theme-text-muted">Transferred</p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.transferred_count}</p>
                </div>
              </div>

              {/* Conversion & Timing */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-5">
                  <h3 className="text-lg font-semibold text-theme-text-primary mb-2">Conversion Rate</h3>
                  <p className="text-3xl font-bold text-theme-text-primary">
                    {stats.conversion_rate != null ? `${(stats.conversion_rate * 100).toFixed(1)}%` : 'N/A'}
                  </p>
                  <p className="text-sm text-theme-text-muted mt-1">Prospects that become full members</p>
                </div>
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-5">
                  <h3 className="text-lg font-semibold text-theme-text-primary mb-2">Avg. Time to Transfer</h3>
                  <p className="text-3xl font-bold text-theme-text-primary">
                    {stats.avg_days_to_transfer != null ? `${stats.avg_days_to_transfer.toFixed(1)} days` : 'N/A'}
                  </p>
                  <p className="text-sm text-theme-text-muted mt-1">Average days from start to full membership</p>
                </div>
              </div>

              {/* By Step */}
              {stats.by_step.length > 0 && (
                <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-5">
                  <h3 className="text-lg font-semibold text-theme-text-primary mb-4">Prospects by Step</h3>
                  <div className="space-y-3">
                    {stats.by_step.map(stepStat => {
                      const percentage = stats.total_prospects > 0
                        ? (stepStat.count / stats.total_prospects) * 100
                        : 0;
                      return (
                        <div key={stepStat.stage_id}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-theme-text-primary">{stepStat.stage_name}</span>
                            <span className="text-sm text-theme-text-muted">{stepStat.count} ({percentage.toFixed(0)}%)</span>
                          </div>
                          <div className="w-full bg-theme-surface-secondary rounded-full h-2">
                            <div
                              className="bg-red-600 h-2 rounded-full transition-all"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <StepModal
        isOpen={stepModalOpen}
        onClose={() => { setStepModalOpen(false); setEditingStep(null); }}
        onSuccess={() => { loadSteps(); loadPipeline(); }}
        pipelineId={pipelineId!}
        step={editingStep}
        nextSortOrder={steps.length}
      />
      <AddProspectModal
        isOpen={addProspectOpen}
        onClose={() => setAddProspectOpen(false)}
        onSuccess={() => { loadKanban(); loadPipeline(); }}
        pipelineId={pipelineId!}
      />
    </div>
  );
};

export default PipelineDetailPage;
