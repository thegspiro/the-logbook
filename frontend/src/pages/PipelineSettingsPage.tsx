/**
 * Pipeline Settings Page
 *
 * Allows membership coordinators to create, configure, and manage
 * pipelines and their steps. Supports creating from templates,
 * adding/removing/reordering steps, and configuring auto-transfer.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { membershipPipelineService } from '../services/membershipPipelineApi';
import type {
  Pipeline,
  PipelineListItem,
  PipelineStep,
  PipelineCreate,
  PipelineStepCreate,
} from '../services/membershipPipelineApi';
import { getErrorMessage } from '../utils/errorHandling';
import {
  ArrowLeft,
  Plus,
  Settings,
  Trash2,
  Copy,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Save,
  Star,
  Zap,
  FileText,
  CheckSquare,
  MessageSquare,
  Mail,
  CalendarDays,
  FolderOpen,
  Wrench,
  X,
  AlertCircle,
  Layers,
} from 'lucide-react';

const PipelineSettingsPage: React.FC = () => {
  const [pipelines, setPipelines] = useState<PipelineListItem[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Create pipeline modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createFormData, setCreateFormData] = useState<PipelineCreate>({
    name: '',
    description: '',
    is_default: false,
    auto_transfer_on_approval: false,
  });
  const [createError, setCreateError] = useState<string | null>(null);

  // Add step modal
  const [showAddStepModal, setShowAddStepModal] = useState(false);
  const [stepFormData, setStepFormData] = useState<PipelineStepCreate>({
    name: '',
    description: '',
    step_type: 'checkbox',
    required: true,
    is_first_step: false,
    is_final_step: false,
  });

  // Edit step
  const [editingStepId, setEditingStepId] = useState<string | null>(null);

  const fetchPipelines = useCallback(async () => {
    try {
      setLoading(true);
      const data = await membershipPipelineService.listPipelines(true);
      setPipelines(data);
    } catch {
      setError('Failed to load pipelines');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPipelineDetail = useCallback(async (id: string) => {
    try {
      const data = await membershipPipelineService.getPipeline(id);
      setSelectedPipeline(data);
    } catch {
      setError('Failed to load pipeline details');
    }
  }, []);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  const handleCreatePipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreateError(null);
      const pipeline = await membershipPipelineService.createPipeline(createFormData);
      setShowCreateModal(false);
      setCreateFormData({ name: '', description: '', is_default: false, auto_transfer_on_approval: false });
      await fetchPipelines();
      fetchPipelineDetail(pipeline.id);
    } catch (err: unknown) {
      setCreateError(getErrorMessage(err, 'Failed to create pipeline'));
    }
  };

  const handleDuplicate = async (pipelineId: string, originalName: string) => {
    try {
      const pipeline = await membershipPipelineService.duplicatePipeline(pipelineId, `${originalName} (Copy)`);
      await fetchPipelines();
      fetchPipelineDetail(pipeline.id);
      showSuccess('Pipeline duplicated');
    } catch {
      setError('Failed to duplicate pipeline');
    }
  };

  const handleDeletePipeline = async (pipelineId: string) => {
    try {
      await membershipPipelineService.deletePipeline(pipelineId);
      if (selectedPipeline?.id === pipelineId) {
        setSelectedPipeline(null);
      }
      await fetchPipelines();
      showSuccess('Pipeline deleted');
    } catch {
      setError('Failed to delete pipeline');
    }
  };

  const handleUpdatePipeline = async (field: string, value: boolean) => {
    if (!selectedPipeline) return;
    try {
      const updated = await membershipPipelineService.updatePipeline(selectedPipeline.id, { [field]: value });
      setSelectedPipeline(updated);
      await fetchPipelines();
      showSuccess('Pipeline updated');
    } catch {
      setError('Failed to update pipeline');
    }
  };

  const handleAddStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPipeline) return;
    try {
      await membershipPipelineService.addStep(selectedPipeline.id, stepFormData);
      setShowAddStepModal(false);
      setStepFormData({ name: '', description: '', step_type: 'checkbox', required: true, is_first_step: false, is_final_step: false });
      fetchPipelineDetail(selectedPipeline.id);
      showSuccess('Step added');
    } catch {
      setError('Failed to add step');
    }
  };

  const handleUpdateStep = async (stepId: string, data: Partial<PipelineStepCreate>) => {
    if (!selectedPipeline) return;
    try {
      await membershipPipelineService.updateStep(selectedPipeline.id, stepId, data);
      fetchPipelineDetail(selectedPipeline.id);
      setEditingStepId(null);
      showSuccess('Step updated');
    } catch {
      setError('Failed to update step');
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!selectedPipeline) return;
    try {
      await membershipPipelineService.deleteStep(selectedPipeline.id, stepId);
      fetchPipelineDetail(selectedPipeline.id);
      showSuccess('Step removed');
    } catch {
      setError('Failed to remove step');
    }
  };

  const handleMoveStep = async (stepIndex: number, direction: 'up' | 'down') => {
    if (!selectedPipeline) return;
    const steps = [...selectedPipeline.steps];
    const targetIndex = direction === 'up' ? stepIndex - 1 : stepIndex + 1;
    if (targetIndex < 0 || targetIndex >= steps.length) return;

    [steps[stepIndex], steps[targetIndex]] = [steps[targetIndex], steps[stepIndex]];
    const stepIds = steps.map(s => s.id);

    try {
      await membershipPipelineService.reorderSteps(selectedPipeline.id, stepIds);
      fetchPipelineDetail(selectedPipeline.id);
    } catch {
      setError('Failed to reorder steps');
    }
  };

  const handleSeedTemplates = async () => {
    try {
      await membershipPipelineService.seedTemplates();
      await fetchPipelines();
      showSuccess('Default templates created');
    } catch {
      setError('Failed to create templates');
    }
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const getStepTypeIcon = (type: string) => {
    switch (type) {
      case 'action': return <Zap className="h-4 w-4 text-blue-400" />;
      case 'note': return <MessageSquare className="h-4 w-4 text-yellow-400" />;
      default: return <CheckSquare className="h-4 w-4 text-green-400" />;
    }
  };

  const getActionTypeIcon = (type?: string) => {
    switch (type) {
      case 'send_email': return <Mail className="h-3 w-3" />;
      case 'schedule_meeting': return <CalendarDays className="h-3 w-3" />;
      case 'collect_document': return <FolderOpen className="h-3 w-3" />;
      case 'custom': return <Wrench className="h-3 w-3" />;
      default: return null;
    }
  };

  const templates = pipelines.filter(p => p.is_template);
  const customPipelines = pipelines.filter(p => !p.is_template);

  return (
    <div className="min-h-screen space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link to="/membership-pipeline" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-2">
            <ArrowLeft className="h-4 w-4" /> Back to Pipeline Board
          </Link>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Settings className="h-7 w-7 text-red-500" />
            Pipeline Settings
          </h1>
          <p className="text-slate-400 mt-1">
            Configure membership pipelines and customize steps for your department
          </p>
        </div>
        <div className="flex gap-3">
          {templates.length === 0 && (
            <button
              onClick={handleSeedTemplates}
              className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-gray-300 rounded-lg hover:bg-slate-600 transition-colors"
            >
              <Layers className="h-4 w-4" />
              Create Default Templates
            </button>
          )}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Pipeline
          </button>
        </div>
      </div>

      {/* Success / Error messages */}
      {successMsg && (
        <div className="bg-green-900/50 border border-green-700 text-green-300 rounded-lg p-3 text-sm">
          {successMsg}
        </div>
      )}
      {error && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline List */}
        <div className="space-y-4">
          {/* Templates */}
          {templates.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-2">Templates</h3>
              <div className="space-y-2">
                {templates.map(p => (
                  <div
                    key={p.id}
                    onClick={() => fetchPipelineDetail(p.id)}
                    className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                      selectedPipeline?.id === p.id
                        ? 'bg-red-500/10 border-red-500/30'
                        : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-white text-sm">{p.name}</span>
                      <button
                        onClick={e => { e.stopPropagation(); handleDuplicate(p.id, p.name); }}
                        className="p-1 text-slate-400 hover:text-white transition-colors"
                        title="Use as template"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span>{p.step_count || 0} steps</span>
                      <span className="bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">template</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom Pipelines */}
          <div>
            <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-2">Your Pipelines</h3>
            {customPipelines.length === 0 ? (
              <div className="text-center py-8 bg-slate-800/50 rounded-xl border border-slate-700">
                <FileText className="h-8 w-8 mx-auto text-slate-500 mb-2" />
                <p className="text-sm text-slate-400">No custom pipelines yet</p>
                <p className="text-xs text-slate-500 mt-1">Create one or duplicate a template</p>
              </div>
            ) : (
              <div className="space-y-2">
                {customPipelines.map(p => (
                  <div
                    key={p.id}
                    onClick={() => fetchPipelineDetail(p.id)}
                    className={`p-4 rounded-xl border cursor-pointer transition-colors ${
                      selectedPipeline?.id === p.id
                        ? 'bg-red-500/10 border-red-500/30'
                        : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {p.is_default && <Star className="h-4 w-4 text-yellow-500" />}
                        <span className="font-medium text-white text-sm">{p.name}</span>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeletePipeline(p.id); }}
                        className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                        title="Delete pipeline"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span>{p.step_count || 0} steps</span>
                      <span>{p.prospect_count || 0} prospects</span>
                      {p.auto_transfer_on_approval && (
                        <span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">auto-transfer</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pipeline Detail / Step Editor */}
        <div className="lg:col-span-2">
          {!selectedPipeline ? (
            <div className="text-center py-16 bg-slate-800/50 rounded-xl border border-slate-700">
              <Settings className="h-12 w-12 mx-auto text-slate-500 mb-3" />
              <p className="text-slate-400">Select a pipeline to configure its steps</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Pipeline Settings */}
              <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
                <h2 className="text-lg font-semibold text-white mb-4">{selectedPipeline.name}</h2>
                {selectedPipeline.description && (
                  <p className="text-sm text-slate-400 mb-4">{selectedPipeline.description}</p>
                )}
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPipeline.is_default}
                      onChange={e => handleUpdatePipeline('is_default', e.target.checked)}
                      disabled={selectedPipeline.is_template}
                      className="rounded border-slate-600 bg-slate-700 text-red-500 focus:ring-red-500"
                    />
                    <span className="text-sm text-gray-300">Default pipeline for new prospects</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedPipeline.auto_transfer_on_approval}
                      onChange={e => handleUpdatePipeline('auto_transfer_on_approval', e.target.checked)}
                      disabled={selectedPipeline.is_template}
                      className="rounded border-slate-600 bg-slate-700 text-red-500 focus:ring-red-500"
                    />
                    <span className="text-sm text-gray-300">Auto-transfer to membership on final step completion</span>
                  </label>
                </div>
              </div>

              {/* Steps */}
              <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">Pipeline Steps</h3>
                  {!selectedPipeline.is_template && (
                    <button
                      onClick={() => setShowAddStepModal(true)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
                    >
                      <Plus className="h-4 w-4" />
                      Add Step
                    </button>
                  )}
                </div>

                {selectedPipeline.steps.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    No steps configured. Add steps to define the prospect journey.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedPipeline.steps
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((step, idx) => (
                        <div
                          key={step.id}
                          className="flex items-center gap-3 p-3 bg-slate-700/30 rounded-lg border border-slate-600/50 group"
                        >
                          {/* Reorder buttons */}
                          {!selectedPipeline.is_template && (
                            <div className="flex flex-col gap-0.5">
                              <button
                                onClick={() => handleMoveStep(idx, 'up')}
                                disabled={idx === 0}
                                className="p-0.5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => handleMoveStep(idx, 'down')}
                                disabled={idx === selectedPipeline.steps.length - 1}
                                className="p-0.5 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            </div>
                          )}

                          {/* Step icon */}
                          {getStepTypeIcon(step.step_type)}

                          {/* Step details */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white text-sm">{step.name}</span>
                              {step.is_first_step && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">start</span>
                              )}
                              {step.is_final_step && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">final</span>
                              )}
                              {step.required && (
                                <span className="text-xs text-red-400">required</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                step.step_type === 'action' ? 'bg-blue-500/20 text-blue-400' :
                                step.step_type === 'note' ? 'bg-yellow-500/20 text-yellow-400' :
                                'bg-green-500/20 text-green-400'
                              }`}>
                                {step.step_type}
                              </span>
                              {step.action_type && (
                                <span className="flex items-center gap-1 text-xs text-slate-400">
                                  {getActionTypeIcon(step.action_type)}
                                  {step.action_type.replace(/_/g, ' ')}
                                </span>
                              )}
                              {step.description && (
                                <span className="text-xs text-slate-500 truncate">{step.description}</span>
                              )}
                            </div>
                          </div>

                          {/* Actions */}
                          {!selectedPipeline.is_template && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleDeleteStep(step.id)}
                                className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                                title="Remove step"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Pipeline Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">Create Pipeline</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreatePipeline} className="p-6 space-y-4">
              {createError && (
                <div className="bg-red-900/50 border border-red-700 text-red-300 rounded-lg p-3 text-sm">{createError}</div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Name *</label>
                <input
                  type="text"
                  required
                  value={createFormData.name}
                  onChange={e => setCreateFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Standard Membership Pipeline"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={createFormData.description || ''}
                  onChange={e => setCreateFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createFormData.is_default}
                    onChange={e => setCreateFormData(prev => ({ ...prev, is_default: e.target.checked }))}
                    className="rounded border-slate-600 bg-slate-700 text-red-500 focus:ring-red-500"
                  />
                  <span className="text-sm text-gray-300">Set as default pipeline</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createFormData.auto_transfer_on_approval}
                    onChange={e => setCreateFormData(prev => ({ ...prev, auto_transfer_on_approval: e.target.checked }))}
                    className="rounded border-slate-600 bg-slate-700 text-red-500 focus:ring-red-500"
                  />
                  <span className="text-sm text-gray-300">Auto-transfer on final step completion</span>
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-700 text-gray-300 rounded-lg hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Create Pipeline
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Step Modal */}
      {showAddStepModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">Add Pipeline Step</h2>
              <button onClick={() => setShowAddStepModal(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAddStep} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Step Name *</label>
                <input
                  type="text"
                  required
                  value={stepFormData.name}
                  onChange={e => setStepFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Background Check Complete"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={stepFormData.description || ''}
                  onChange={e => setStepFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Step Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['checkbox', 'action', 'note'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setStepFormData(prev => ({ ...prev, step_type: type, action_type: type === 'action' ? 'custom' : undefined }))}
                      className={`p-3 rounded-lg border text-center transition-colors ${
                        stepFormData.step_type === type
                          ? 'border-red-500 bg-red-500/10 text-white'
                          : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500'
                      }`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        {getStepTypeIcon(type)}
                        <span className="text-xs capitalize">{type}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              {stepFormData.step_type === 'action' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Action Type</label>
                  <select
                    value={stepFormData.action_type || 'custom'}
                    onChange={e => setStepFormData(prev => ({ ...prev, action_type: e.target.value }))}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  >
                    <option value="send_email">Send Email</option>
                    <option value="schedule_meeting">Schedule Meeting</option>
                    <option value="collect_document">Collect Document</option>
                    <option value="custom">Custom Action</option>
                  </select>
                </div>
              )}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stepFormData.required}
                    onChange={e => setStepFormData(prev => ({ ...prev, required: e.target.checked }))}
                    className="rounded border-slate-600 bg-slate-700 text-red-500 focus:ring-red-500"
                  />
                  <span className="text-sm text-gray-300">Required step</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stepFormData.is_first_step}
                    onChange={e => setStepFormData(prev => ({ ...prev, is_first_step: e.target.checked }))}
                    className="rounded border-slate-600 bg-slate-700 text-red-500 focus:ring-red-500"
                  />
                  <span className="text-sm text-gray-300">Mark as first step (pipeline entry point)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stepFormData.is_final_step}
                    onChange={e => setStepFormData(prev => ({ ...prev, is_final_step: e.target.checked }))}
                    className="rounded border-slate-600 bg-slate-700 text-red-500 focus:ring-red-500"
                  />
                  <span className="text-sm text-gray-300">Mark as final step (approval / election)</span>
                </label>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
                <button
                  type="button"
                  onClick={() => setShowAddStepModal(false)}
                  className="px-4 py-2 bg-slate-700 text-gray-300 rounded-lg hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Add Step
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PipelineSettingsPage;
