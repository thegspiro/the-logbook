/**
 * Prospective Members Page
 *
 * Main pipeline management page with tabs for Pipelines, All Prospects,
 * and Election Packages.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Copy,
  Settings,
  Users,
  ChevronRight,
  LayoutGrid,
  ListFilter,
  Package,
  Loader2,
  AlertTriangle,
  X,
  Layers,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { prospectiveMemberService } from '../services/api';

// ==================== Interfaces ====================

interface PipelineListItem {
  id: string;
  name: string;
  description?: string;
  is_template: boolean;
  is_default: boolean;
  is_active: boolean;
  auto_transfer_on_approval: boolean;
  step_count?: number;
  prospect_count?: number;
  created_at: string;
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

interface ElectionPackageItem {
  id: string;
  prospect_id: string;
  pipeline_id?: string;
  step_id?: string;
  election_id?: string;
  status: string;
  applicant_snapshot?: Record<string, unknown>;
  coordinator_notes?: string;
  package_config?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

type TabView = 'pipelines' | 'prospects' | 'election-packages';

const statusStyles: Record<string, string> = {
  active: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  pending: 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  transferred: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  withdrawn: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  approved: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  rejected: 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  draft: 'bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300',
  submitted: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  completed: 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400',
};

// ==================== Pipeline Modal ====================

interface PipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  pipeline?: PipelineListItem | null;
}

const PipelineModal: React.FC<PipelineModalProps> = ({ isOpen, onClose, onSuccess, pipeline }) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_template: false,
    is_default: false,
    is_active: true,
    auto_transfer_on_approval: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (pipeline) {
      setFormData({
        name: pipeline.name,
        description: pipeline.description || '',
        is_template: pipeline.is_template,
        is_default: pipeline.is_default,
        is_active: pipeline.is_active,
        auto_transfer_on_approval: pipeline.auto_transfer_on_approval,
      });
    } else {
      setFormData({
        name: '',
        description: '',
        is_template: false,
        is_default: false,
        is_active: true,
        auto_transfer_on_approval: false,
      });
    }
    setError('');
  }, [pipeline, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      if (pipeline) {
        await prospectiveMemberService.updatePipeline(pipeline.id, formData);
        toast.success('Pipeline updated');
      } else {
        await prospectiveMemberService.createPipeline(formData);
        toast.success('Pipeline created');
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, pipeline ? 'Failed to update pipeline' : 'Failed to create pipeline'));
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
      aria-labelledby="pipeline-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="pipeline-modal-title" className="text-xl font-bold text-theme-text-primary">
            {pipeline ? 'Edit Pipeline' : 'Create Pipeline'}
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
            <label htmlFor="pipeline-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="pipeline-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              placeholder="e.g., New Member Application Process"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="pipeline-description" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Description
            </label>
            <textarea
              id="pipeline-description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              placeholder="Describe the pipeline purpose..."
              rows={3}
            />
          </div>

          <div className="space-y-3 border-t border-theme-surface-border pt-4">
            <div className="flex items-center justify-between">
              <div>
                <label htmlFor="pipeline-active" className="text-sm font-medium text-theme-text-secondary">Active</label>
                <p className="text-xs text-theme-text-muted">Pipeline is available for new prospects</p>
              </div>
              <button
                id="pipeline-active"
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, is_active: !prev.is_active }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_active ? 'bg-red-600' : 'bg-theme-surface-hover'}`}
                role="switch"
                aria-checked={formData.is_active}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_active ? 'translate-x-6' : 'translate-x-1'}`} aria-hidden="true" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label htmlFor="pipeline-default" className="text-sm font-medium text-theme-text-secondary">Default Pipeline</label>
                <p className="text-xs text-theme-text-muted">New prospects use this pipeline when none specified</p>
              </div>
              <button
                id="pipeline-default"
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, is_default: !prev.is_default }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_default ? 'bg-red-600' : 'bg-theme-surface-hover'}`}
                role="switch"
                aria-checked={formData.is_default}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_default ? 'translate-x-6' : 'translate-x-1'}`} aria-hidden="true" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label htmlFor="pipeline-template" className="text-sm font-medium text-theme-text-secondary">Template</label>
                <p className="text-xs text-theme-text-muted">Mark as a reusable template</p>
              </div>
              <button
                id="pipeline-template"
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, is_template: !prev.is_template }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.is_template ? 'bg-red-600' : 'bg-theme-surface-hover'}`}
                role="switch"
                aria-checked={formData.is_template}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.is_template ? 'translate-x-6' : 'translate-x-1'}`} aria-hidden="true" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label htmlFor="pipeline-auto-transfer" className="text-sm font-medium text-theme-text-secondary">Auto-Transfer on Approval</label>
                <p className="text-xs text-theme-text-muted">Automatically transfer prospects to full membership upon approval</p>
              </div>
              <button
                id="pipeline-auto-transfer"
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, auto_transfer_on_approval: !prev.auto_transfer_on_approval }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.auto_transfer_on_approval ? 'bg-red-600' : 'bg-theme-surface-hover'}`}
                role="switch"
                aria-checked={formData.auto_transfer_on_approval}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.auto_transfer_on_approval ? 'translate-x-6' : 'translate-x-1'}`} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {pipeline ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ==================== Duplicate Modal ====================

interface DuplicateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  pipeline: PipelineListItem | null;
}

const DuplicateModal: React.FC<DuplicateModalProps> = ({ isOpen, onClose, onSuccess, pipeline }) => {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (pipeline) {
      setName(`${pipeline.name} (Copy)`);
    }
  }, [pipeline]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pipeline) return;
    setIsSubmitting(true);
    try {
      await prospectiveMemberService.duplicatePipeline(pipeline.id, name);
      toast.success('Pipeline duplicated');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to duplicate pipeline'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !pipeline) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-theme-surface-border">
          <h2 id="duplicate-modal-title" className="text-xl font-bold text-theme-text-primary">Duplicate Pipeline</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-theme-text-muted">
            Create a copy of &quot;{pipeline.name}&quot; with all its steps.
          </p>
          <div>
            <label htmlFor="dup-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
              New Pipeline Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="dup-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              required
              aria-required="true"
            />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Duplicate
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ==================== Create Prospect Modal ====================

interface CreateProspectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  pipelines: PipelineListItem[];
}

const CreateProspectModal: React.FC<CreateProspectModalProps> = ({ isOpen, onClose, onSuccess, pipelines }) => {
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    pipeline_id: '',
    interest_reason: '',
    referral_source: '',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setFormData({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        pipeline_id: '',
        interest_reason: '',
        referral_source: '',
        notes: '',
      });
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
      };
      if (formData.phone) submitData.phone = formData.phone;
      if (formData.pipeline_id) submitData.pipeline_id = formData.pipeline_id;
      if (formData.interest_reason) submitData.interest_reason = formData.interest_reason;
      if (formData.referral_source) submitData.referral_source = formData.referral_source;
      if (formData.notes) submitData.notes = formData.notes;

      await prospectiveMemberService.createProspect(submitData as Parameters<typeof prospectiveMemberService.createProspect>[0]);
      toast.success('Prospect created');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create prospect'));
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
      aria-labelledby="create-prospect-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-theme-surface-border flex items-center justify-between">
          <h2 id="create-prospect-title" className="text-xl font-bold text-theme-text-primary">Add Prospect</h2>
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
              <label htmlFor="prospect-first-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
                First Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="prospect-first-name"
                type="text"
                value={formData.first_name}
                onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                required
                aria-required="true"
              />
            </div>
            <div>
              <label htmlFor="prospect-last-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
                Last Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="prospect-last-name"
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
            <label htmlFor="prospect-email" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Email <span aria-hidden="true">*</span>
            </label>
            <input
              id="prospect-email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="prospect-phone" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Phone
            </label>
            <input
              id="prospect-phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
            />
          </div>

          <div>
            <label htmlFor="prospect-pipeline" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Pipeline
            </label>
            <select
              id="prospect-pipeline"
              value={formData.pipeline_id}
              onChange={(e) => setFormData(prev => ({ ...prev, pipeline_id: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
            >
              <option value="">Use default pipeline</option>
              {pipelines.filter(p => p.is_active && !p.is_template).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="prospect-interest" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Interest / Reason for Joining
            </label>
            <textarea
              id="prospect-interest"
              value={formData.interest_reason}
              onChange={(e) => setFormData(prev => ({ ...prev, interest_reason: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              rows={2}
            />
          </div>

          <div>
            <label htmlFor="prospect-referral" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Referral Source
            </label>
            <input
              id="prospect-referral"
              type="text"
              value={formData.referral_source}
              onChange={(e) => setFormData(prev => ({ ...prev, referral_source: e.target.value }))}
              className="w-full px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              placeholder="e.g., Website, Referral, Walk-in"
            />
          </div>

          <div>
            <label htmlFor="prospect-notes" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Notes
            </label>
            <textarea
              id="prospect-notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
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

export const ProspectiveMembersPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabView>('pipelines');

  // Pipelines state
  const [pipelines, setPipelines] = useState<PipelineListItem[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(true);
  const [pipelineModalOpen, setPipelineModalOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<PipelineListItem | null>(null);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [duplicatingPipeline, setDuplicatingPipeline] = useState<PipelineListItem | null>(null);

  // Prospects state
  const [prospects, setProspects] = useState<ProspectListItem[]>([]);
  const [prospectsLoading, setProspectsLoading] = useState(false);
  const [prospectSearch, setProspectSearch] = useState('');
  const [prospectStatusFilter, setProspectStatusFilter] = useState('');
  const [prospectPipelineFilter, setProspectPipelineFilter] = useState('');
  const [createProspectOpen, setCreateProspectOpen] = useState(false);

  // Election Packages state
  const [electionPackages, setElectionPackages] = useState<ElectionPackageItem[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(false);
  const [packageStatusFilter, setPackageStatusFilter] = useState('');

  // ==================== Load Data ====================

  const loadPipelines = useCallback(async () => {
    setPipelinesLoading(true);
    try {
      const data = await prospectiveMemberService.listPipelines(true);
      setPipelines(data as unknown as PipelineListItem[]);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load pipelines'));
    } finally {
      setPipelinesLoading(false);
    }
  }, []);

  const loadProspects = useCallback(async () => {
    setProspectsLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 100, offset: 0 };
      if (prospectSearch) params.search = prospectSearch;
      if (prospectStatusFilter) params.status = prospectStatusFilter;
      if (prospectPipelineFilter) params.pipeline_id = prospectPipelineFilter;
      const data = await prospectiveMemberService.listProspects(params as Parameters<typeof prospectiveMemberService.listProspects>[0]);
      setProspects(data as unknown as ProspectListItem[]);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load prospects'));
    } finally {
      setProspectsLoading(false);
    }
  }, [prospectSearch, prospectStatusFilter, prospectPipelineFilter]);

  const loadElectionPackages = useCallback(async () => {
    setPackagesLoading(true);
    try {
      const params: Record<string, string> = {};
      if (packageStatusFilter) params.status = packageStatusFilter;
      const data = await prospectiveMemberService.listElectionPackages(params);
      setElectionPackages(data as unknown as ElectionPackageItem[]);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load election packages'));
    } finally {
      setPackagesLoading(false);
    }
  }, [packageStatusFilter]);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  useEffect(() => {
    if (activeTab === 'prospects') {
      loadProspects();
    }
  }, [activeTab, loadProspects]);

  useEffect(() => {
    if (activeTab === 'election-packages') {
      loadElectionPackages();
    }
  }, [activeTab, loadElectionPackages]);

  // ==================== Actions ====================

  const handleDeletePipeline = async (pipeline: PipelineListItem) => {
    if (!window.confirm(`Delete pipeline "${pipeline.name}"? This cannot be undone.`)) return;
    try {
      await prospectiveMemberService.deletePipeline(pipeline.id);
      toast.success('Pipeline deleted');
      loadPipelines();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete pipeline'));
    }
  };

  const handleSeedTemplates = async (pipeline: PipelineListItem) => {
    try {
      const result = await prospectiveMemberService.seedTemplates(pipeline.id);
      toast.success(result.message || 'Templates seeded');
      loadPipelines();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to seed templates'));
    }
  };

  // ==================== Tab Definitions ====================

  const tabs: { id: TabView; label: string; icon: React.ReactNode }[] = [
    { id: 'pipelines', label: 'Pipelines', icon: <Layers className="w-4 h-4" /> },
    { id: 'prospects', label: 'All Prospects', icon: <Users className="w-4 h-4" /> },
    { id: 'election-packages', label: 'Election Packages', icon: <Package className="w-4 h-4" /> },
  ];

  // ==================== Render ====================

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-theme-text-primary">Prospective Members</h1>
        <p className="text-theme-text-muted mt-1">Manage membership pipelines and track prospective members</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-theme-surface-border mb-6">
        <nav className="flex gap-4" aria-label="Pipeline tabs">
          {tabs.map(tab => (
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

      {/* Pipelines Tab */}
      {activeTab === 'pipelines' && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-theme-text-primary">Membership Pipelines</h2>
            <button
              onClick={() => { setEditingPipeline(null); setPipelineModalOpen(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Pipeline
            </button>
          </div>

          {pipelinesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
            </div>
          ) : pipelines.length === 0 ? (
            <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
              <LayoutGrid className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-theme-text-primary mb-2">No Pipelines Yet</h3>
              <p className="text-theme-text-muted mb-4">Create your first pipeline to start tracking prospective members.</p>
              <button
                onClick={() => { setEditingPipeline(null); setPipelineModalOpen(true); }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                Create Pipeline
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pipelines.map(pipeline => (
                <div
                  key={pipeline.id}
                  className="bg-theme-surface rounded-lg border border-theme-surface-border p-5 hover:border-red-500/30 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold text-theme-text-primary truncate">{pipeline.name}</h3>
                      {pipeline.description && (
                        <p className="text-sm text-theme-text-muted mt-1 line-clamp-2">{pipeline.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {pipeline.is_default && (
                        <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 rounded-full">Default</span>
                      )}
                      {pipeline.is_template && (
                        <span className="text-xs px-2 py-0.5 bg-purple-500/10 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400 rounded-full">Template</span>
                      )}
                      {!pipeline.is_active && (
                        <span className="text-xs px-2 py-0.5 bg-gray-500/10 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400 rounded-full">Inactive</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-theme-text-muted mb-4">
                    <span className="flex items-center gap-1">
                      <Layers className="w-4 h-4" />
                      {pipeline.step_count ?? 0} steps
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-4 h-4" />
                      {pipeline.prospect_count ?? 0} prospects
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-theme-surface-border">
                    <button
                      onClick={() => navigate(`/prospective-members/pipelines/${pipeline.id}`)}
                      className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700 font-medium"
                    >
                      View Details
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setEditingPipeline(pipeline); setPipelineModalOpen(true); }}
                        className="p-1.5 text-theme-text-muted hover:text-theme-text-primary rounded"
                        title="Edit pipeline"
                        aria-label={`Edit ${pipeline.name}`}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { setDuplicatingPipeline(pipeline); setDuplicateModalOpen(true); }}
                        className="p-1.5 text-theme-text-muted hover:text-theme-text-primary rounded"
                        title="Duplicate pipeline"
                        aria-label={`Duplicate ${pipeline.name}`}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleSeedTemplates(pipeline)}
                        className="p-1.5 text-theme-text-muted hover:text-theme-text-primary rounded"
                        title="Seed default templates"
                        aria-label={`Seed templates for ${pipeline.name}`}
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeletePipeline(pipeline)}
                        className="p-1.5 text-theme-text-muted hover:text-red-600 rounded"
                        title="Delete pipeline"
                        aria-label={`Delete ${pipeline.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* All Prospects Tab */}
      {activeTab === 'prospects' && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-theme-text-primary">All Prospects</h2>
            <button
              onClick={() => setCreateProspectOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Prospect
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-text-muted" />
              <input
                type="text"
                value={prospectSearch}
                onChange={(e) => setProspectSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
              />
            </div>
            <select
              value={prospectStatusFilter}
              onChange={(e) => setProspectStatusFilter(e.target.value)}
              className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
              aria-label="Filter by status"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="transferred">Transferred</option>
            </select>
            <select
              value={prospectPipelineFilter}
              onChange={(e) => setProspectPipelineFilter(e.target.value)}
              className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
              aria-label="Filter by pipeline"
            >
              <option value="">All Pipelines</option>
              {pipelines.filter(p => !p.is_template).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {prospectsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
            </div>
          ) : prospects.length === 0 ? (
            <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
              <Users className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-theme-text-primary mb-2">No Prospects Found</h3>
              <p className="text-theme-text-muted mb-4">
                {prospectSearch || prospectStatusFilter || prospectPipelineFilter
                  ? 'Try adjusting your search or filters.'
                  : 'Add your first prospective member to get started.'}
              </p>
              {!prospectSearch && !prospectStatusFilter && !prospectPipelineFilter && (
                <button
                  onClick={() => setCreateProspectOpen(true)}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                >
                  Add Prospect
                </button>
              )}
            </div>
          ) : (
            <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-theme-surface-border">
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Name</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Email</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Pipeline</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Current Step</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Status</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Created</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-theme-text-secondary">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prospects.map(prospect => (
                      <tr key={prospect.id} className="border-b border-theme-surface-border last:border-b-0 hover:bg-theme-surface-hover">
                        <td className="px-4 py-3 text-sm text-theme-text-primary font-medium">
                          {prospect.first_name} {prospect.last_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">{prospect.email}</td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">{prospect.pipeline_name || '-'}</td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">{prospect.current_step_name || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[prospect.status] || statusStyles.pending}`}>
                            {prospect.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-muted">
                          {new Date(prospect.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => navigate(`/prospective-members/prospects/${prospect.id}`)}
                            className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1 ml-auto"
                          >
                            View
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Election Packages Tab */}
      {activeTab === 'election-packages' && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-theme-text-primary">Election Packages</h2>
            <div className="flex items-center gap-3">
              <select
                value={packageStatusFilter}
                onChange={(e) => setPackageStatusFilter(e.target.value)}
                className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                aria-label="Filter by status"
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          {packagesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
            </div>
          ) : electionPackages.length === 0 ? (
            <div className="text-center py-12 bg-theme-surface rounded-lg border border-theme-surface-border">
              <FileText className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-theme-text-primary mb-2">No Election Packages</h3>
              <p className="text-theme-text-muted">Election packages will appear here when created for prospects.</p>
            </div>
          ) : (
            <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-theme-surface-border">
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Package ID</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Prospect</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Status</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Notes</th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-theme-text-secondary">Created</th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-theme-text-secondary">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {electionPackages.map(pkg => (
                      <tr key={pkg.id} className="border-b border-theme-surface-border last:border-b-0 hover:bg-theme-surface-hover">
                        <td className="px-4 py-3 text-sm text-theme-text-primary font-mono">
                          {pkg.id.substring(0, 8)}...
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-secondary">
                          {pkg.applicant_snapshot
                            ? `${(pkg.applicant_snapshot as Record<string, string>).first_name || ''} ${(pkg.applicant_snapshot as Record<string, string>).last_name || ''}`.trim() || pkg.prospect_id.substring(0, 8)
                            : pkg.prospect_id.substring(0, 8)
                          }
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[pkg.status] || statusStyles.draft}`}>
                            {pkg.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-muted max-w-[200px] truncate">
                          {pkg.coordinator_notes || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-theme-text-muted">
                          {new Date(pkg.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => navigate(`/prospective-members/prospects/${pkg.prospect_id}`)}
                            className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1 ml-auto"
                          >
                            View Prospect
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <PipelineModal
        isOpen={pipelineModalOpen}
        onClose={() => { setPipelineModalOpen(false); setEditingPipeline(null); }}
        onSuccess={loadPipelines}
        pipeline={editingPipeline}
      />
      <DuplicateModal
        isOpen={duplicateModalOpen}
        onClose={() => { setDuplicateModalOpen(false); setDuplicatingPipeline(null); }}
        onSuccess={loadPipelines}
        pipeline={duplicatingPipeline}
      />
      <CreateProspectModal
        isOpen={createProspectOpen}
        onClose={() => setCreateProspectOpen(false)}
        onSuccess={() => { loadProspects(); }}
        pipelines={pipelines}
      />
    </div>
  );
};

export default ProspectiveMembersPage;
