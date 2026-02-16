/**
 * Pipeline Settings Page
 *
 * Admin page for creating and configuring pipelines
 * with the drag-and-drop stage builder.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Settings,
  Loader2,
  Edit2,
  Trash2,
  Power,
  PowerOff,
  Save,
  Clock,
  Bell,
  AlertTriangle,
  Trash,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { pipelineService } from '../services/api';
import { PipelineBuilder } from '../components/PipelineBuilder';
import type {
  Pipeline,
  PipelineListItem,
  InactivityConfig,
  InactivityTimeoutPreset,
} from '../types';
import {
  DEFAULT_INACTIVITY_CONFIG,
  TIMEOUT_PRESET_LABELS,
  getEffectiveTimeoutDays,
} from '../types';

export const PipelineSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    pipelines,
    currentPipeline,
    isLoadingPipelines,
    isLoadingPipeline,
    fetchPipelines,
    fetchPipeline,
    setCurrentPipeline,
  } = useProspectiveMembersStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPipelineName, setEditingPipelineName] = useState(false);
  const [pipelineName, setPipelineName] = useState('');
  const [pipelineDescription, setPipelineDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [inactivityConfig, setInactivityConfig] = useState<InactivityConfig>(DEFAULT_INACTIVITY_CONFIG);
  const [isSavingInactivity, setIsSavingInactivity] = useState(false);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  useEffect(() => {
    if (currentPipeline) {
      setPipelineName(currentPipeline.name);
      setPipelineDescription(currentPipeline.description ?? '');
      setInactivityConfig(currentPipeline.inactivity_config ?? DEFAULT_INACTIVITY_CONFIG);
    }
  }, [currentPipeline]);

  const handleCreatePipeline = async () => {
    if (!pipelineName.trim()) {
      toast.error('Pipeline name is required');
      return;
    }
    setIsCreating(true);
    try {
      const newPipeline = await pipelineService.createPipeline({
        name: pipelineName.trim(),
        description: pipelineDescription.trim() || undefined,
        is_active: true,
      });
      await fetchPipelines();
      setCurrentPipeline(newPipeline);
      setShowCreateModal(false);
      setPipelineName('');
      setPipelineDescription('');
      toast.success('Pipeline created');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create pipeline';
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdatePipelineName = async () => {
    if (!currentPipeline || !pipelineName.trim()) return;
    try {
      const updated = await pipelineService.updatePipeline(currentPipeline.id, {
        name: pipelineName.trim(),
        description: pipelineDescription.trim() || undefined,
      });
      setCurrentPipeline(updated);
      setEditingPipelineName(false);
      await fetchPipelines();
      toast.success('Pipeline updated');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update pipeline';
      toast.error(msg);
    }
  };

  const handleToggleActive = async () => {
    if (!currentPipeline) return;
    try {
      const updated = await pipelineService.updatePipeline(currentPipeline.id, {
        is_active: !currentPipeline.is_active,
      });
      setCurrentPipeline(updated);
      await fetchPipelines();
      toast.success(
        updated.is_active ? 'Pipeline activated' : 'Pipeline deactivated'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle pipeline';
      toast.error(msg);
    }
  };

  const handleDeletePipeline = async () => {
    if (!currentPipeline) return;
    if (!window.confirm('Are you sure you want to delete this pipeline? This cannot be undone.')) {
      return;
    }
    try {
      await pipelineService.deletePipeline(currentPipeline.id);
      setCurrentPipeline(null);
      await fetchPipelines();
      toast.success('Pipeline deleted');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete pipeline';
      toast.error(msg);
    }
  };

  const handleSaveInactivitySettings = async () => {
    if (!currentPipeline) return;
    setIsSavingInactivity(true);
    try {
      const updated = await pipelineService.updatePipeline(currentPipeline.id, {
        inactivity_config: inactivityConfig,
      });
      setCurrentPipeline(updated);
      toast.success('Inactivity settings saved');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save inactivity settings';
      toast.error(msg);
    } finally {
      setIsSavingInactivity(false);
    }
  };

  const effectiveTimeoutDays = getEffectiveTimeoutDays(inactivityConfig);
  const warningDays = effectiveTimeoutDays
    ? Math.round(effectiveTimeoutDays * (inactivityConfig.warning_threshold_percent / 100))
    : null;

  const handlePipelineUpdated = (pipeline: Pipeline) => {
    setCurrentPipeline(pipeline);
  };

  const selectPipeline = (item: PipelineListItem) => {
    fetchPipeline(item.id);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/prospective-members')}
          className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
          aria-label="Back to prospective members"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary flex items-center gap-3">
            <Settings className="w-7 h-7 text-red-700 dark:text-red-500" aria-hidden="true" />
            Pipeline Settings
          </h1>
          <p className="text-theme-text-muted mt-1">
            Configure the stages prospective members go through
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Pipeline List Sidebar */}
        <div className="col-span-4">
          <div className="bg-slate-800/50 border border-theme-surface-border rounded-lg">
            <div className="flex items-center justify-between p-4 border-b border-theme-surface-border">
              <h2 className="text-sm font-medium text-theme-text-primary">Pipelines</h2>
              <button
                onClick={() => {
                  setPipelineName('');
                  setPipelineDescription('');
                  setShowCreateModal(true);
                }}
                className="p-1.5 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                aria-label="Create pipeline"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {isLoadingPipelines ? (
              <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
                <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" aria-hidden="true" />
                <span className="sr-only">Loading pipelines...</span>
              </div>
            ) : pipelines.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500">
                No pipelines yet
              </div>
            ) : (
              <div className="p-2">
                {pipelines.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectPipeline(p)}
                    className={`w-full text-left p-3 rounded-lg mb-1 transition-all ${
                      currentPipeline?.id === p.id
                        ? 'bg-red-600/20 border border-red-500/30'
                        : 'hover:bg-theme-surface-secondary border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-theme-text-primary truncate">
                        {p.name}
                      </span>
                      <span
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          p.is_active ? 'bg-emerald-400' : 'bg-slate-600'
                        }`}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {p.stage_count} stages &middot; {p.applicant_count} applicants
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pipeline Editor */}
        <div className="col-span-8">
          {isLoadingPipeline ? (
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="w-8 h-8 animate-spin text-red-700 dark:text-red-500" aria-hidden="true" />
              <span className="sr-only">Loading pipeline...</span>
            </div>
          ) : !currentPipeline ? (
            <div className="text-center py-20 bg-slate-800/30 rounded-lg border border-dashed border-theme-surface-border">
              <Settings className="w-12 h-12 text-slate-600 mx-auto mb-4" aria-hidden="true" />
              <h3 className="text-lg font-medium text-theme-text-primary mb-2">
                {pipelines.length === 0
                  ? 'Create your first pipeline'
                  : 'Select a pipeline'}
              </h3>
              <p className="text-sm text-theme-text-muted mb-4">
                {pipelines.length === 0
                  ? 'Set up the stages prospective members will go through.'
                  : 'Choose a pipeline from the left to configure its stages.'}
              </p>
              {pipelines.length === 0 && (
                <button
                  onClick={() => {
                    setPipelineName('');
                    setPipelineDescription('');
                    setShowCreateModal(true);
                  }}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  Create Pipeline
                </button>
              )}
            </div>
          ) : (
            <div>
              {/* Pipeline Name & Controls */}
              <div className="bg-slate-800/50 border border-theme-surface-border rounded-lg p-4 mb-4">
                {editingPipelineName ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={pipelineName}
                      onChange={(e) => setPipelineName(e.target.value)}
                      aria-label="Pipeline name"
                      className="w-full bg-slate-700 border border-theme-surface-border rounded-lg px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <textarea
                      value={pipelineDescription}
                      onChange={(e) => setPipelineDescription(e.target.value)}
                      placeholder="Description (optional)"
                      aria-label="Pipeline description"
                      rows={2}
                      className="w-full bg-slate-700 border border-theme-surface-border rounded-lg px-3 py-2 text-theme-text-primary text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingPipelineName(false);
                          setPipelineName(currentPipeline.name);
                          setPipelineDescription(currentPipeline.description ?? '');
                        }}
                        className="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleUpdatePipelineName}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                      >
                        <Save className="w-3.5 h-3.5" aria-hidden="true" />
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-theme-text-primary">
                          {currentPipeline.name}
                        </h2>
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            currentPipeline.is_active
                              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                              : 'bg-slate-500/20 text-theme-text-muted'
                          }`}
                        >
                          {currentPipeline.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {currentPipeline.description && (
                        <p className="text-sm text-theme-text-muted mt-1">
                          {currentPipeline.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingPipelineName(true)}
                        className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                        aria-label="Edit pipeline name"
                      >
                        <Edit2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={handleToggleActive}
                        className="p-2 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                        aria-label={currentPipeline.is_active ? 'Deactivate pipeline' : 'Activate pipeline'}
                      >
                        {currentPipeline.is_active ? (
                          <PowerOff className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Power className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        onClick={handleDeletePipeline}
                        className="p-2 text-theme-text-muted hover:text-red-700 dark:hover:text-red-400 transition-colors"
                        aria-label="Delete pipeline"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Stage Builder */}
              <div className="bg-slate-800/50 border border-theme-surface-border rounded-lg p-4">
                <h3 className="text-sm font-medium text-theme-text-secondary mb-4">
                  Pipeline Stages
                </h3>
                <PipelineBuilder
                  pipeline={currentPipeline}
                  onPipelineUpdated={handlePipelineUpdated}
                />
              </div>

              {/* Inactivity Configuration */}
              <div className="bg-slate-800/50 border border-theme-surface-border rounded-lg p-4 mt-4">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                  <h3 className="text-sm font-medium text-theme-text-secondary">
                    Inactivity Timeout
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mb-5">
                  Applications with no activity within the timeout period will be automatically
                  marked inactive. Individual stages can override this default in their settings.
                </p>

                {/* Timeout Preset */}
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm text-theme-text-muted mb-2">
                      Default Inactivity Period
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(TIMEOUT_PRESET_LABELS) as InactivityTimeoutPreset[]).map(
                        (preset) => (
                          <button
                            key={preset}
                            onClick={() =>
                              setInactivityConfig({ ...inactivityConfig, timeout_preset: preset })
                            }
                            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                              inactivityConfig.timeout_preset === preset
                                ? 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400'
                                : 'border-theme-surface-border text-theme-text-secondary hover:border-theme-surface-border'
                            }`}
                          >
                            {TIMEOUT_PRESET_LABELS[preset]}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Custom Days Input */}
                  {inactivityConfig.timeout_preset === 'custom' && (
                    <div>
                      <label htmlFor="custom-timeout-days" className="block text-sm text-theme-text-muted mb-2">
                        Custom Timeout (days)
                      </label>
                      <input
                        id="custom-timeout-days"
                        type="number"
                        min={1}
                        max={1095}
                        value={inactivityConfig.custom_timeout_days ?? 90}
                        onChange={(e) =>
                          setInactivityConfig({
                            ...inactivityConfig,
                            custom_timeout_days: Math.max(1, Number(e.target.value)),
                          })
                        }
                        className="w-32 bg-slate-700 border border-theme-surface-border rounded-lg px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                  )}

                  {/* Warning Threshold */}
                  {inactivityConfig.timeout_preset !== 'never' && (
                    <div>
                      <label htmlFor="warning-threshold" className="block text-sm text-theme-text-muted mb-2">
                        Warning Threshold
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          id="warning-threshold"
                          type="range"
                          min={50}
                          max={95}
                          step={5}
                          value={inactivityConfig.warning_threshold_percent}
                          onChange={(e) =>
                            setInactivityConfig({
                              ...inactivityConfig,
                              warning_threshold_percent: Number(e.target.value),
                            })
                          }
                          className="flex-1 accent-red-500"
                        />
                        <span className="text-sm text-theme-text-secondary w-12 text-right">
                          {inactivityConfig.warning_threshold_percent}%
                        </span>
                      </div>
                      {warningDays && effectiveTimeoutDays && (
                        <p className="text-xs text-slate-500 mt-1">
                          Warning at {warningDays} days, inactive at {effectiveTimeoutDays} days
                        </p>
                      )}
                    </div>
                  )}

                  {/* Notifications */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Bell className="w-3.5 h-3.5 text-theme-text-muted" aria-hidden="true" />
                      <label className="text-sm text-theme-text-muted">Notifications</label>
                    </div>
                    <div className="space-y-2 ml-5">
                      <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                        <input
                          type="checkbox"
                          checked={inactivityConfig.notify_coordinator}
                          onChange={(e) =>
                            setInactivityConfig({
                              ...inactivityConfig,
                              notify_coordinator: e.target.checked,
                            })
                          }
                          className="rounded border-theme-surface-border bg-slate-700 text-red-700 dark:text-red-500 focus:ring-red-500"
                        />
                        Notify membership coordinator when applications approach timeout
                      </label>
                      <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                        <input
                          type="checkbox"
                          checked={inactivityConfig.notify_applicant}
                          onChange={(e) =>
                            setInactivityConfig({
                              ...inactivityConfig,
                              notify_applicant: e.target.checked,
                            })
                          }
                          className="rounded border-theme-surface-border bg-slate-700 text-red-700 dark:text-red-500 focus:ring-red-500"
                        />
                        Notify the applicant that their application is going inactive
                      </label>
                    </div>
                  </div>

                  {/* Auto-Purge */}
                  <div className="border-t border-theme-surface-border pt-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Trash className="w-3.5 h-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                      <label className="text-sm text-theme-text-muted">Auto-Purge</label>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-theme-text-secondary mb-3">
                      <input
                        type="checkbox"
                        checked={inactivityConfig.auto_purge_enabled}
                        onChange={(e) =>
                          setInactivityConfig({
                            ...inactivityConfig,
                            auto_purge_enabled: e.target.checked,
                          })
                        }
                        className="rounded border-theme-surface-border bg-slate-700 text-red-700 dark:text-red-500 focus:ring-red-500"
                      />
                      Permanently delete inactive applications after a set period
                    </label>
                    {inactivityConfig.auto_purge_enabled && (
                      <>
                        <div className="flex items-center gap-3 ml-6 mb-3">
                          <input
                            type="number"
                            min={30}
                            max={1095}
                            value={inactivityConfig.purge_days_after_inactive}
                            onChange={(e) =>
                              setInactivityConfig({
                                ...inactivityConfig,
                                purge_days_after_inactive: Math.max(30, Number(e.target.value)),
                              })
                            }
                            aria-label="Days after becoming inactive before purging"
                            className="w-24 bg-slate-700 border border-theme-surface-border rounded-lg px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                          />
                          <span className="text-sm text-theme-text-muted">
                            days after becoming inactive
                          </span>
                        </div>
                        <div className="flex items-start gap-2 ml-6 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                          <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                          <p className="text-xs text-amber-700 dark:text-amber-300/80">
                            Purged applications are permanently deleted and cannot be recovered. This
                            helps reduce the amount of private information stored in the event of a
                            security incident.
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Save Button */}
                  <div className="flex items-center justify-end pt-2">
                    <button
                      onClick={handleSaveInactivitySettings}
                      disabled={isSavingInactivity}
                      className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {isSavingInactivity ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Save className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                      Save Inactivity Settings
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Pipeline Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-pipeline-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateModal(false); }}
        >
          <div className="bg-slate-800 border border-theme-surface-border rounded-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
              <h2 id="create-pipeline-title" className="text-lg font-bold text-theme-text-primary">Create Pipeline</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                aria-label="Close dialog"
              >
                <Plus className="w-5 h-5 rotate-45" aria-hidden="true" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="create-pipeline-name" className="block text-sm text-theme-text-muted mb-1">
                  Pipeline Name <span aria-hidden="true">*</span>
                </label>
                <input
                  id="create-pipeline-name"
                  type="text"
                  value={pipelineName}
                  onChange={(e) => setPipelineName(e.target.value)}
                  placeholder="e.g., New Member Onboarding"
                  required
                  aria-required="true"
                  className="w-full bg-slate-700 border border-theme-surface-border rounded-lg px-3 py-2 text-theme-text-primary text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label htmlFor="create-pipeline-description" className="block text-sm text-theme-text-muted mb-1">
                  Description
                </label>
                <textarea
                  id="create-pipeline-description"
                  value={pipelineDescription}
                  onChange={(e) => setPipelineDescription(e.target.value)}
                  placeholder="Describe this pipeline's purpose..."
                  rows={3}
                  className="w-full bg-slate-700 border border-theme-surface-border rounded-lg px-3 py-2 text-theme-text-primary text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-surface-border">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePipeline}
                disabled={isCreating}
                className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isCreating && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                Create Pipeline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PipelineSettingsPage;
