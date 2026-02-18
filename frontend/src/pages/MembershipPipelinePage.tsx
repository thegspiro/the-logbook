/**
 * Membership Pipeline Page
 *
 * Kanban-style board showing prospective members organized by their
 * current pipeline step. Allows coordinators to manage prospects,
 * complete steps, and advance prospects through the pipeline.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { membershipPipelineService } from '../services/membershipPipelineApi';
import type {
  PipelineListItem,
  KanbanBoard,
  ProspectCreate,
} from '../services/membershipPipelineApi';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import {
  Settings,
  Search,
  Filter,
  UserPlus,
  ArrowRight,
  Mail,
  Phone,
  Calendar,
  X,
  RefreshCw,
  ClipboardList,
} from 'lucide-react';

const MembershipPipelinePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [pipelines, setPipelines] = useState<PipelineListItem[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(
    searchParams.get('pipeline') || null
  );
  const [kanbanBoard, setKanbanBoard] = useState<KanbanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addFormData, setAddFormData] = useState<ProspectCreate>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    interest_reason: '',
    referral_source: '',
  });
  const [addError, setAddError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('members.manage');
  const canCreate = checkPermission('members.create');

  const fetchPipelines = useCallback(async () => {
    try {
      const data = await membershipPipelineService.listPipelines(false);
      setPipelines(data);
      // Auto-select default pipeline if none selected
      if (!selectedPipelineId && data.length > 0) {
        const defaultPipeline = data.find(p => p.is_default) || data[0];
        setSelectedPipelineId(defaultPipeline.id);
      }
    } catch (_err) {
      setError('Failed to load pipelines');
    }
  }, [selectedPipelineId]);

  const fetchKanbanBoard = useCallback(async () => {
    if (!selectedPipelineId) return;
    try {
      setLoading(true);
      setError(null);
      const board = await membershipPipelineService.getKanbanBoard(selectedPipelineId);
      setKanbanBoard(board);
    } catch (_err) {
      setError('Failed to load pipeline board');
    } finally {
      setLoading(false);
    }
  }, [selectedPipelineId]);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  useEffect(() => {
    if (selectedPipelineId) {
      fetchKanbanBoard();
      setSearchParams({ pipeline: selectedPipelineId });
    }
  }, [selectedPipelineId, fetchKanbanBoard, setSearchParams]);

  const handleAddProspect = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setAddError(null);
      await membershipPipelineService.createProspect({
        ...addFormData,
        pipeline_id: selectedPipelineId || undefined,
      });
      setShowAddModal(false);
      setAddFormData({ first_name: '', last_name: '', email: '', phone: '', interest_reason: '', referral_source: '' });
      fetchKanbanBoard();
    } catch (err: unknown) {
      setAddError(getErrorMessage(err, 'Failed to add prospect'));
    }
  };

  const handleAdvanceProspect = async (prospectId: string) => {
    try {
      await membershipPipelineService.advanceProspect(prospectId);
      fetchKanbanBoard();
    } catch {
      setError('Failed to advance prospect');
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-blue-500/20 text-blue-700',
      approved: 'bg-green-500/20 text-green-700',
      rejected: 'bg-red-500/20 text-red-700',
      withdrawn: 'bg-theme-surface-secondary text-theme-text-muted',
      transferred: 'bg-purple-500/20 text-purple-700',
    };
    return colors[status] || 'bg-theme-surface-secondary text-theme-text-muted';
  };

  const filteredColumns = kanbanBoard?.columns?.map(col => ({
    ...col,
    prospects: searchTerm
      ? col.prospects.filter(
          p =>
            `${p.first_name} ${p.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.email.toLowerCase().includes(searchTerm.toLowerCase())
        )
      : col.prospects,
  }));

  return (
    <div className="min-h-screen space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-3">
            <ClipboardList className="h-7 w-7 text-red-700" />
            Membership Pipeline
          </h1>
          <p className="text-theme-text-muted mt-1">
            Track and manage prospective members through the application process
          </p>
        </div>
        <div className="flex gap-3">
          {canManage && (
            <Link
              to="/membership-pipeline/settings"
              className="flex items-center gap-2 px-4 py-2 bg-theme-input-bg text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover transition-colors"
            >
              <Settings className="h-4 w-4" />
              Pipeline Settings
            </Link>
          )}
          {canCreate && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              Add Prospect
            </button>
          )}
        </div>
      </div>

      {/* Pipeline Selector & Search */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-theme-text-muted" />
          <select
            value={selectedPipelineId || ''}
            onChange={e => setSelectedPipelineId(e.target.value)}
            className="bg-theme-surface border border-theme-input-border rounded-lg px-3 py-2 text-theme-text-primary focus:ring-2 focus:ring-red-500 focus:border-transparent"
          >
            {pipelines.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {p.is_default ? '(Default)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-muted" />
          <input
            type="text"
            placeholder="Search prospects..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-theme-surface border border-theme-input-border rounded-lg pl-10 pr-4 py-2 text-theme-text-primary placeholder-theme-text-muted focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
        </div>
        <button
          onClick={fetchKanbanBoard}
          className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        {kanbanBoard && (
          <span className="text-sm text-theme-text-muted">
            {kanbanBoard.total_prospects} prospect{kanbanBoard.total_prospects !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-4">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && pipelines.length === 0 && (
        <div className="text-center py-16 bg-theme-input-bg/50 rounded-xl border border-theme-surface-border">
          <ClipboardList className="h-16 w-16 mx-auto text-theme-text-muted mb-4" />
          <h3 className="text-xl font-medium text-theme-text-primary mb-2">No Pipelines Configured</h3>
          <p className="text-theme-text-muted mb-6 max-w-md mx-auto">
            Set up a membership pipeline to start tracking prospective members through your application process.
          </p>
          {canManage && (
            <Link
              to="/membership-pipeline/settings"
              className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <Settings className="h-4 w-4" />
              Configure Pipeline
            </Link>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-red-500" />
        </div>
      )}

      {/* Kanban Board */}
      {!loading && kanbanBoard && filteredColumns && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {filteredColumns.map((column, _idx) => (
            <div
              key={column.step?.id || 'unassigned'}
              className="flex-shrink-0 w-80 bg-theme-input-bg/50 rounded-xl border border-theme-surface-border"
            >
              {/* Column Header */}
              <div className="p-4 border-b border-theme-surface-border">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-theme-text-primary text-sm truncate">
                    {column.step?.name || 'Unassigned'}
                  </h3>
                  <span className="bg-theme-input-bg text-theme-text-secondary text-xs font-medium px-2 py-1 rounded-full">
                    {column.prospects.length}
                  </span>
                </div>
                {column.step?.step_type && (
                  <div className="mt-1 flex items-center gap-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      column.step.step_type === 'action'
                        ? 'bg-blue-500/20 text-blue-700'
                        : column.step.step_type === 'note'
                        ? 'bg-yellow-500/20 text-yellow-700'
                        : 'bg-green-500/20 text-green-700'
                    }`}>
                      {column.step.step_type}
                    </span>
                    {column.step.is_first_step && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700">start</span>
                    )}
                    {column.step.is_final_step && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-700">final</span>
                    )}
                  </div>
                )}
              </div>

              {/* Prospect Cards */}
              <div className="p-2 space-y-2 max-h-[calc(100vh-340px)] overflow-y-auto">
                {column.prospects.length === 0 && (
                  <div className="text-center py-8 text-theme-text-muted text-sm">
                    No prospects at this step
                  </div>
                )}
                {column.prospects.map(prospect => (
                  <Link
                    key={prospect.id}
                    to={`/membership-pipeline/prospects/${prospect.id}`}
                    className="block bg-theme-input-bg/50 rounded-lg p-3 hover:bg-theme-input-bg transition-colors border border-theme-input-border/50 hover:border-theme-input-border"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-medium text-theme-text-primary text-sm">
                        {prospect.first_name} {prospect.last_name}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${getStatusColor(prospect.status)}`}>
                        {prospect.status}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {prospect.email && (
                        <div className="flex items-center gap-1.5 text-xs text-theme-text-muted">
                          <Mail className="h-3 w-3" />
                          <span className="truncate">{prospect.email}</span>
                        </div>
                      )}
                      {prospect.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-theme-text-muted">
                          <Phone className="h-3 w-3" />
                          <span>{prospect.phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-xs text-theme-text-muted">
                        <Calendar className="h-3 w-3" />
                        <span>{new Date(prospect.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    {canManage && !column.step?.is_final_step && (
                      <button
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleAdvanceProspect(prospect.id);
                        }}
                        className="mt-2 flex items-center gap-1 text-xs text-red-700 hover:text-red-600 transition-colors"
                      >
                        <ArrowRight className="h-3 w-3" />
                        Advance
                      </button>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Prospect Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-theme-surface-modal rounded-xl border border-theme-surface-border w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
              <h2 className="text-lg font-semibold text-theme-text-primary">Add Prospective Member</h2>
              <button onClick={() => setShowAddModal(false)} className="text-theme-text-muted hover:text-theme-text-primary">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAddProspect} className="p-6 space-y-4">
              {addError && (
                <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-3 text-sm">
                  {addError}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    value={addFormData.first_name}
                    onChange={e => setAddFormData(prev => ({ ...prev, first_name: e.target.value }))}
                    className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-theme-text-primary focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-theme-text-secondary mb-1">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={addFormData.last_name}
                    onChange={e => setAddFormData(prev => ({ ...prev, last_name: e.target.value }))}
                    className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-theme-text-primary focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={addFormData.email}
                  onChange={e => setAddFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-theme-text-primary focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Phone</label>
                <input
                  type="tel"
                  value={addFormData.phone || ''}
                  onChange={e => setAddFormData(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-theme-text-primary focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Interest / Reason</label>
                <textarea
                  rows={3}
                  value={addFormData.interest_reason || ''}
                  onChange={e => setAddFormData(prev => ({ ...prev, interest_reason: e.target.value }))}
                  className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-theme-text-primary focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-theme-text-secondary mb-1">Referral Source</label>
                <input
                  type="text"
                  value={addFormData.referral_source || ''}
                  onChange={e => setAddFormData(prev => ({ ...prev, referral_source: e.target.value }))}
                  placeholder="e.g., Website, Community Event, Referral"
                  className="w-full bg-theme-input-bg border border-theme-input-border rounded-lg px-3 py-2 text-theme-text-primary placeholder-theme-text-muted focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-theme-surface-border">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-theme-input-bg text-theme-text-secondary rounded-lg hover:bg-theme-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Add Prospect
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MembershipPipelinePage;
