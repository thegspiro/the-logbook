/**
 * Pipeline Settings Page
 *
 * Admin page for creating and configuring pipelines
 * with the drag-and-drop stage builder.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
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
  Copy,
  Star,
  BookTemplate,
  TrendingUp,
  Users,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Globe,
  BarChart3,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { STAGE_TYPE_ICONS, STAGE_TYPE_COLORS } from '../constants';
import { pipelineService } from '../services/api';
import { PipelineBuilder } from '../components/PipelineBuilder';
import { ReportStageGroupsEditor } from '../components/ReportStageGroupsEditor';
import { ConfirmDialog } from '../../../components/ux/ConfirmDialog';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import type { Pipeline, PipelineListItem, InactivityConfig, InactivityTimeoutPreset } from '../types';
import { DEFAULT_INACTIVITY_CONFIG, TIMEOUT_PRESET_LABELS } from '../types';
import { getEffectiveTimeoutDays } from '../utils';

export const PipelineSettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    pipelines,
    currentPipeline,
    pipelineStats,
    isLoadingPipelines,
    isLoadingPipeline,
    isLoadingStats,
    fetchPipelines,
    fetchPipeline,
    fetchPipelineStats,
    setCurrentPipeline,
    duplicatePipeline,
    setDefaultPipeline,
    saveAsTemplate,
    fetchTemplates,
  } = useProspectiveMembersStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPipelineName, setEditingPipelineName] = useState(false);
  const [pipelineName, setPipelineName] = useState('');
  const [pipelineDescription, setPipelineDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [inactivityConfig, setInactivityConfig] = useState<InactivityConfig>(DEFAULT_INACTIVITY_CONFIG);
  const [isSavingInactivity, setIsSavingInactivity] = useState(false);

  // Confirm dialog state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Clone/Template state
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneName, setCloneName] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Template gallery
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [templates, setTemplates] = useState<PipelineListItem[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isCreatingFromTemplate, setIsCreatingFromTemplate] = useState(false);

  useEffect(() => {
    void fetchPipelines();
  }, [fetchPipelines]);

  useEffect(() => {
    if (currentPipeline) {
      setPipelineName(currentPipeline.name);
      setPipelineDescription(currentPipeline.description ?? '');
      setInactivityConfig(currentPipeline.inactivity_config ?? DEFAULT_INACTIVITY_CONFIG);
      void fetchPipelineStats(currentPipeline.id);
    }
  }, [currentPipeline, fetchPipelineStats]);

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
      const msg = getErrorMessage(err, 'Failed to create pipeline');
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
        // Null, not undefined: an omitted key reads as "leave alone", so an
        // emptied description would never actually be removed.
        description: blankToNull(pipelineDescription),
      });
      setCurrentPipeline(updated);
      setEditingPipelineName(false);
      await fetchPipelines();
      toast.success('Pipeline updated');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to update pipeline');
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
      toast.success(updated.is_active ? 'Pipeline activated' : 'Pipeline deactivated');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to toggle pipeline');
      toast.error(msg);
    }
  };

  const handleDeletePipeline = async () => {
    if (!currentPipeline) return;
    setIsDeleting(true);
    try {
      await pipelineService.deletePipeline(currentPipeline.id);
      setCurrentPipeline(null);
      await fetchPipelines();
      setDeleteConfirmOpen(false);
      toast.success('Pipeline deleted');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to delete pipeline');
      toast.error(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClonePipeline = async () => {
    if (!currentPipeline || !cloneName.trim()) return;
    setIsCloning(true);
    try {
      const cloned = await duplicatePipeline(currentPipeline.id, cloneName.trim());
      setCurrentPipeline(cloned);
      setShowCloneModal(false);
      setCloneName('');
      toast.success('Pipeline cloned');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to clone pipeline');
      toast.error(msg);
    } finally {
      setIsCloning(false);
    }
  };

  const handleSetDefault = async () => {
    if (!currentPipeline) return;
    try {
      await setDefaultPipeline(currentPipeline.id);
      toast.success('Set as default pipeline');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to set default');
      toast.error(msg);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!currentPipeline || !templateName.trim()) return;
    setIsSavingTemplate(true);
    try {
      await saveAsTemplate(currentPipeline.id, templateName.trim());
      setShowSaveTemplateModal(false);
      setTemplateName('');
      toast.success('Saved as template');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to save template');
      toast.error(msg);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleOpenTemplateGallery = async () => {
    setShowTemplateGallery(true);
    setIsLoadingTemplates(true);
    try {
      const tpls = await fetchTemplates();
      setTemplates(tpls);
    } catch {
      // error handled by store
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const handleUseTemplate = async (templateId: string, name: string) => {
    setIsCreatingFromTemplate(true);
    try {
      const cloned = await duplicatePipeline(templateId, name);
      // Make sure the new pipeline is not a template and is active
      const updated = await pipelineService.updatePipeline(cloned.id, {
        is_template: false,
        is_active: true,
      });
      await fetchPipelines();
      setCurrentPipeline(updated);
      setShowTemplateGallery(false);
      toast.success('Pipeline created from template');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to create from template');
      toast.error(msg);
    } finally {
      setIsCreatingFromTemplate(false);
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
      const msg = getErrorMessage(err, 'Failed to save inactivity settings');
      toast.error(msg);
    } finally {
      setIsSavingInactivity(false);
    }
  };

  const effectiveTimeoutDays = getEffectiveTimeoutDays(inactivityConfig);
  const warningDays = effectiveTimeoutDays
    ? Math.round(effectiveTimeoutDays * (inactivityConfig.warning_threshold_percent / 100))
    : null;

  const handleTogglePublicStatus = async () => {
    if (!currentPipeline) return;
    try {
      const updated = await pipelineService.updatePipeline(currentPipeline.id, {
        public_status_enabled: !currentPipeline.public_status_enabled,
      });
      setCurrentPipeline(updated);
      toast.success(updated.public_status_enabled ? 'Public status page enabled' : 'Public status page disabled');
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to toggle setting');
      toast.error(msg);
    }
  };

  const handlePipelineUpdated = (pipeline: Pipeline) => {
    setCurrentPipeline(pipeline);
  };

  const selectPipeline = (item: PipelineListItem) => {
    void fetchPipeline(item.id);
  };

  // Stages with stage-level inactivity overrides
  const stagesWithOverrides = useMemo(() => {
    if (!currentPipeline) return [];
    return currentPipeline.stages.filter((s) => s.inactivity_timeout_days != null && s.inactivity_timeout_days > 0);
  }, [currentPipeline]);

  // Non-template pipelines for sidebar display
  const visiblePipelines = useMemo(() => pipelines.filter((p) => !p.is_template), [pipelines]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={() => void navigate('/prospective-members')}
          className="text-theme-text-muted hover:text-theme-text-primary p-2 transition-colors"
          aria-label="Back to prospective members"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="flex-1">
          <h1 className="text-theme-text-primary flex items-center gap-3 text-2xl font-bold">
            <Settings className="h-7 w-7 text-red-700 dark:text-red-500" aria-hidden="true" />
            Pipeline Settings
          </h1>
          <p className="text-theme-text-muted mt-1">Configure the stages prospective members go through</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Pipeline List Sidebar */}
        <div className="space-y-4 lg:col-span-4">
          <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-4">
              <h2 className="text-theme-text-primary text-sm font-medium">Pipelines</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    void handleOpenTemplateGallery();
                  }}
                  className="text-theme-text-muted hover:text-theme-text-primary p-1.5 transition-colors"
                  aria-label="Browse templates"
                  title="Browse templates"
                >
                  <BookTemplate className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  onClick={() => {
                    setPipelineName('');
                    setPipelineDescription('');
                    setShowCreateModal(true);
                  }}
                  className="text-theme-text-muted hover:text-theme-text-primary p-1.5 transition-colors"
                  aria-label="Create pipeline"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {isLoadingPipelines ? (
              <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
                <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" aria-hidden="true" />
                <span className="sr-only">Loading pipelines...</span>
              </div>
            ) : visiblePipelines.length === 0 ? (
              <div className="text-theme-text-muted p-4 text-center text-sm">No pipelines yet</div>
            ) : (
              <div className="p-2">
                {visiblePipelines.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectPipeline(p)}
                    className={`mb-1 w-full rounded-lg p-3 text-left transition-all ${
                      currentPipeline?.id === p.id
                        ? 'border border-red-500/30 bg-red-600/20'
                        : 'hover:bg-theme-surface-secondary border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-theme-text-primary flex items-center gap-1.5 truncate text-sm font-medium">
                        {p.name}
                        {p.is_default && (
                          <Star className="h-3 w-3 shrink-0 fill-amber-500 text-amber-500" aria-label="Default" />
                        )}
                      </span>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          p.is_active ? 'bg-emerald-400' : 'bg-theme-surface-hover'
                        }`}
                      />
                    </div>
                    <p className="text-theme-text-muted mt-1 text-xs">
                      {p.stage_count} stages &middot; {p.applicant_count} applicants
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pipeline Editor */}
        <div className="lg:col-span-8">
          {isLoadingPipeline ? (
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <Loader2 className="h-8 w-8 animate-spin text-red-700 dark:text-red-500" aria-hidden="true" />
              <span className="sr-only">Loading pipeline...</span>
            </div>
          ) : !currentPipeline ? (
            <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border border-dashed py-20 text-center">
              <Settings className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
              <h3 className="text-theme-text-primary mb-2 text-lg font-medium">
                {visiblePipelines.length === 0 ? 'Create your first pipeline' : 'Select a pipeline'}
              </h3>
              <p className="text-theme-text-muted mb-4 text-sm">
                {visiblePipelines.length === 0
                  ? 'Set up the stages prospective members will go through.'
                  : 'Choose a pipeline from the left to configure its stages.'}
              </p>
              {visiblePipelines.length === 0 && (
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => {
                      setPipelineName('');
                      setPipelineDescription('');
                      setShowCreateModal(true);
                    }}
                    className="btn-primary px-6"
                  >
                    Create Pipeline
                  </button>
                  <button
                    onClick={() => {
                      void handleOpenTemplateGallery();
                    }}
                    className="text-theme-text-secondary border-theme-surface-border hover:text-theme-text-primary hover:border-theme-surface-border flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors"
                  >
                    <BookTemplate className="h-4 w-4" aria-hidden="true" />
                    Use Template
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Active Pipeline Warning Banner */}
              {currentPipeline.is_active && (currentPipeline.applicant_count ?? 0) > 0 && (
                <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      Active pipeline with {currentPipeline.applicant_count} applicant
                      {currentPipeline.applicant_count === 1 ? '' : 's'}
                    </p>
                    <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/60">
                      Changes to stages will affect in-progress applications. Consider cloning this pipeline before
                      making major changes.
                    </p>
                  </div>
                </div>
              )}

              {/* Pipeline Name & Controls */}
              <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
                {editingPipelineName ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={pipelineName}
                      onChange={(e) => setPipelineName(e.target.value)}
                      aria-label="Pipeline name"
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    />
                    <textarea
                      value={pipelineDescription}
                      onChange={(e) => setPipelineDescription(e.target.value)}
                      placeholder="Description (optional)"
                      aria-label="Pipeline description"
                      rows={2}
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingPipelineName(false);
                          setPipelineName(currentPipeline.name);
                          setPipelineDescription(currentPipeline.description ?? '');
                        }}
                        className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          void handleUpdatePipelineName();
                        }}
                        className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm"
                      >
                        <Save className="h-3.5 w-3.5" aria-hidden="true" />
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-theme-text-primary text-lg font-bold">{currentPipeline.name}</h2>
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            currentPipeline.is_active
                              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                              : 'bg-theme-surface-hover text-theme-text-muted'
                          }`}
                        >
                          {currentPipeline.is_active ? 'Active' : 'Inactive'}
                        </span>
                        {currentPipeline.is_default && (
                          <span className="flex items-center gap-1 rounded-sm bg-amber-500/20 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                            <Star className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                            Default
                          </span>
                        )}
                      </div>
                      {currentPipeline.description && (
                        <p className="text-theme-text-muted mt-1 text-sm">{currentPipeline.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingPipelineName(true)}
                        className="text-theme-text-muted hover:text-theme-text-primary p-2 transition-colors"
                        aria-label="Edit pipeline name"
                        title="Edit"
                      >
                        <Edit2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => {
                          setCloneName(`${currentPipeline.name} (Copy)`);
                          setShowCloneModal(true);
                        }}
                        className="text-theme-text-muted hover:text-theme-text-primary p-2 transition-colors"
                        aria-label="Clone pipeline"
                        title="Clone"
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {!currentPipeline.is_default && (
                        <button
                          onClick={() => {
                            void handleSetDefault();
                          }}
                          className="text-theme-text-muted p-2 transition-colors hover:text-amber-600 dark:hover:text-amber-400"
                          aria-label="Set as default pipeline"
                          title="Set as default"
                        >
                          <Star className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setTemplateName(`${currentPipeline.name} Template`);
                          setShowSaveTemplateModal(true);
                        }}
                        className="text-theme-text-muted hover:text-theme-text-primary p-2 transition-colors"
                        aria-label="Save as template"
                        title="Save as template"
                      >
                        <BookTemplate className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => {
                          void handleToggleActive();
                        }}
                        className="text-theme-text-muted hover:text-theme-text-primary p-2 transition-colors"
                        aria-label={currentPipeline.is_active ? 'Deactivate pipeline' : 'Activate pipeline'}
                        title={currentPipeline.is_active ? 'Deactivate' : 'Activate'}
                      >
                        {currentPipeline.is_active ? (
                          <PowerOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Power className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        onClick={() => setDeleteConfirmOpen(true)}
                        className="text-theme-text-muted p-2 transition-colors hover:text-red-700 dark:hover:text-red-400"
                        aria-label="Delete pipeline"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Pipeline Stats Dashboard */}
              {pipelineStats && !isLoadingStats && (
                <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <BarChart3 className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                    <h3 className="text-theme-text-secondary text-sm font-medium">Pipeline Statistics</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatCard
                      icon={Users}
                      label="Active"
                      value={pipelineStats.active_applicants}
                      color="text-blue-600 dark:text-blue-400 bg-blue-500/10"
                    />
                    <StatCard
                      icon={CheckCircle2}
                      label="Converted"
                      value={pipelineStats.converted_count}
                      color="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                    />
                    <StatCard
                      icon={XCircle}
                      label="Rejected"
                      value={pipelineStats.rejected_count}
                      color="text-red-600 dark:text-red-400 bg-red-500/10"
                    />
                    <StatCard
                      icon={TrendingUp}
                      label="Conversion"
                      value={`${Math.round(pipelineStats.conversion_rate)}%`}
                      color="text-purple-600 dark:text-purple-400 bg-purple-500/10"
                    />
                  </div>
                  {pipelineStats.avg_days_to_convert > 0 && (
                    <p className="text-theme-text-muted mt-3 text-xs">
                      Average {Math.round(pipelineStats.avg_days_to_convert)} days to convert
                      {pipelineStats.on_hold_count > 0 && ` \u00B7 ${pipelineStats.on_hold_count} on hold`}
                      {pipelineStats.withdrawn_count > 0 && ` \u00B7 ${pipelineStats.withdrawn_count} withdrawn`}
                    </p>
                  )}
                </div>
              )}

              {/* Pipeline Flow Visualization */}
              {currentPipeline.stages.length > 0 && (
                <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
                  <h3 className="text-theme-text-secondary mb-3 text-sm font-medium">Pipeline Flow</h3>
                  <div className="flex items-center gap-1 overflow-x-auto pb-2">
                    {[...currentPipeline.stages]
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((stage, idx) => {
                        const Icon = STAGE_TYPE_ICONS[stage.stage_type];
                        const colorClass = STAGE_TYPE_COLORS[stage.stage_type];
                        const stageStats = pipelineStats?.by_stage.find((s) => s.stage_id === stage.id);
                        return (
                          <React.Fragment key={stage.id}>
                            {idx > 0 && (
                              <ArrowRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
                            )}
                            <div
                              className={`border-theme-surface-border flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${colorClass}`}
                              title={stage.name}
                            >
                              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                              <span className="max-w-[100px] truncate text-xs font-medium whitespace-nowrap">
                                {stage.name}
                              </span>
                              {stageStats && stageStats.count > 0 && (
                                <span className="ml-0.5 text-[10px] font-bold opacity-70">{stageStats.count}</span>
                              )}
                            </div>
                          </React.Fragment>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Stage Builder */}
              <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
                <h3 className="text-theme-text-secondary mb-4 text-sm font-medium">Pipeline Stages</h3>
                <PipelineBuilder pipeline={currentPipeline} onPipelineUpdated={handlePipelineUpdated} />
              </div>

              {/* Inactivity Configuration */}
              <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-4">
                <div className="mb-1 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                  <h3 className="text-theme-text-secondary text-sm font-medium">Inactivity Timeout</h3>
                </div>
                <p className="text-theme-text-muted mb-5 text-xs">
                  Applications with no activity within the timeout period will be automatically marked inactive.
                  Individual stages can override this default in their settings.
                </p>

                {/* Timeout Preset */}
                <div className="space-y-5">
                  <div>
                    <label className="text-theme-text-muted mb-2 block text-sm">Default Inactivity Period</label>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(TIMEOUT_PRESET_LABELS) as InactivityTimeoutPreset[]).map((preset) => (
                        <button
                          key={preset}
                          onClick={() => setInactivityConfig({ ...inactivityConfig, timeout_preset: preset })}
                          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                            inactivityConfig.timeout_preset === preset
                              ? 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400'
                              : 'border-theme-surface-border text-theme-text-secondary hover:border-theme-surface-border'
                          }`}
                        >
                          {TIMEOUT_PRESET_LABELS[preset]}
                        </button>
                      ))}
                    </div>
                    {/* Calculated days display */}
                    {effectiveTimeoutDays && (
                      <p className="text-theme-text-muted mt-2 flex items-center gap-1 text-xs">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        Applications will go inactive after <strong>{effectiveTimeoutDays} days</strong> of no activity
                      </p>
                    )}
                  </div>

                  {/* Custom Days Input */}
                  {inactivityConfig.timeout_preset === 'custom' && (
                    <div>
                      <label htmlFor="custom-timeout-days" className="text-theme-text-muted mb-2 block text-sm">
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
                        className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-32 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                      />
                    </div>
                  )}

                  {/* Warning Threshold */}
                  {inactivityConfig.timeout_preset !== 'never' && (
                    <div>
                      <label htmlFor="warning-threshold" className="text-theme-text-muted mb-2 block text-sm">
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
                        <span className="text-theme-text-secondary w-12 text-right text-sm">
                          {inactivityConfig.warning_threshold_percent}%
                        </span>
                      </div>
                      {warningDays && effectiveTimeoutDays && (
                        <p className="text-theme-text-muted mt-1 text-xs">
                          Warning at {warningDays} days, inactive at {effectiveTimeoutDays} days
                        </p>
                      )}
                    </div>
                  )}

                  {/* Stage Override Indicators */}
                  {stagesWithOverrides.length > 0 && (
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                      <p className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-400">
                        Stage-specific timeout overrides:
                      </p>
                      <div className="space-y-1">
                        {stagesWithOverrides.map((stage) => (
                          <div key={stage.id} className="flex items-center justify-between text-xs">
                            <span className="text-theme-text-secondary">{stage.name}</span>
                            <span className="font-medium text-blue-700 dark:text-blue-400">
                              {stage.inactivity_timeout_days} days
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notifications */}
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <Bell className="text-theme-text-muted h-3.5 w-3.5" aria-hidden="true" />
                      <label className="text-theme-text-muted text-sm">Notifications</label>
                    </div>
                    <div className="ml-5 space-y-2">
                      <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={inactivityConfig.notify_coordinator}
                          onChange={(e) =>
                            setInactivityConfig({
                              ...inactivityConfig,
                              notify_coordinator: e.target.checked,
                            })
                          }
                          className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                        />
                        Notify membership coordinator when applications approach timeout
                      </label>
                      <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={inactivityConfig.notify_applicant}
                          onChange={(e) =>
                            setInactivityConfig({
                              ...inactivityConfig,
                              notify_applicant: e.target.checked,
                            })
                          }
                          className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                        />
                        Notify the applicant that their application is going inactive
                      </label>
                    </div>
                  </div>

                  {/* Auto-Purge */}
                  <div className="border-theme-surface-border border-t pt-5">
                    <div className="mb-3 flex items-center gap-2">
                      <Trash className="h-3.5 w-3.5 text-red-700 dark:text-red-400" aria-hidden="true" />
                      <label className="text-theme-text-muted text-sm">Auto-Purge</label>
                    </div>
                    <label className="text-theme-text-secondary mb-3 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={inactivityConfig.auto_purge_enabled}
                        onChange={(e) =>
                          setInactivityConfig({
                            ...inactivityConfig,
                            auto_purge_enabled: e.target.checked,
                          })
                        }
                        className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                      />
                      Permanently delete inactive applications after a set period
                    </label>
                    {inactivityConfig.auto_purge_enabled && (
                      <>
                        <div className="mb-3 ml-6 flex items-center gap-3">
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
                            className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-24 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                          />
                          <span className="text-theme-text-muted text-sm">days after becoming inactive</span>
                        </div>
                        <div className="ml-6 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                          <AlertTriangle
                            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
                            aria-hidden="true"
                          />
                          <p className="text-xs text-amber-700 dark:text-amber-300/80">
                            Purged applications are permanently deleted and cannot be recovered. This helps reduce the
                            amount of private information stored in the event of a security incident.
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Save Button */}
                  <div className="flex items-center justify-end pt-2">
                    <button
                      onClick={() => {
                        void handleSaveInactivitySettings();
                      }}
                      disabled={isSavingInactivity}
                      className="btn-primary flex items-center gap-2 text-sm"
                    >
                      {isSavingInactivity ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Save Inactivity Settings
                    </button>
                  </div>
                </div>
              </div>

              {/* Public Status Page Settings */}
              <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-5">
                <div className="mb-3 flex items-center gap-2">
                  <Globe className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                  <h3 className="text-theme-text-primary text-sm font-semibold">Public Application Status Page</h3>
                </div>
                <p className="text-theme-text-muted mb-4 text-xs">
                  When enabled, prospects receive a link to check their application status. Only stages marked as
                  &quot;public visible&quot; in the stage settings will be shown.
                </p>
                <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={currentPipeline.public_status_enabled}
                    onChange={() => {
                      void handleTogglePublicStatus();
                    }}
                    className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                  />
                  Allow prospects to check their application status via a public link
                </label>
              </div>

              {/* Report Stage Groups */}
              <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border p-5">
                <ReportStageGroupsEditor pipeline={currentPipeline} onSaved={handlePipelineUpdated} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          void handleDeletePipeline();
        }}
        title="Delete Pipeline"
        message={
          currentPipeline && (currentPipeline.applicant_count ?? 0) > 0
            ? `This pipeline has ${currentPipeline.applicant_count} applicant${currentPipeline.applicant_count === 1 ? '' : 's'}. Deleting it will permanently remove all applicant data. This cannot be undone.`
            : 'Are you sure you want to delete this pipeline? This cannot be undone.'
        }
        confirmLabel="Delete Pipeline"
        variant="danger"
        loading={isDeleting}
      />

      {/* Clone Pipeline Modal */}
      {showCloneModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clone-pipeline-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowCloneModal(false);
          }}
        >
          <div className="bg-theme-surface-modal border-theme-surface-border w-full max-w-md rounded-xl border">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <h2
                id="clone-pipeline-title"
                className="text-theme-text-primary flex items-center gap-2 text-lg font-bold"
              >
                <Copy className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                Clone Pipeline
              </h2>
              <button
                onClick={() => setShowCloneModal(false)}
                className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                aria-label="Close dialog"
              >
                <Plus className="h-5 w-5 rotate-45" aria-hidden="true" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-theme-text-muted mb-4 text-sm">
                Create a copy of &quot;{currentPipeline?.name}&quot; with all its stages.
              </p>
              <label htmlFor="clone-pipeline-name" className="text-theme-text-muted mb-1 block text-sm">
                New Pipeline Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="clone-pipeline-name"
                type="text"
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="e.g., New Member Onboarding (Copy)"
                required
                aria-required="true"
                className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
            <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
              <button
                onClick={() => setShowCloneModal(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleClonePipeline();
                }}
                disabled={isCloning || !cloneName.trim()}
                className="btn-primary flex items-center gap-2 px-6"
              >
                {isCloning && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Clone
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save as Template Modal */}
      {showSaveTemplateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-template-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowSaveTemplateModal(false);
          }}
        >
          <div className="bg-theme-surface-modal border-theme-surface-border w-full max-w-md rounded-xl border">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <h2
                id="save-template-title"
                className="text-theme-text-primary flex items-center gap-2 text-lg font-bold"
              >
                <BookTemplate className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                Save as Template
              </h2>
              <button
                onClick={() => setShowSaveTemplateModal(false)}
                className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                aria-label="Close dialog"
              >
                <Plus className="h-5 w-5 rotate-45" aria-hidden="true" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-theme-text-muted mb-4 text-sm">
                Save &quot;{currentPipeline?.name}&quot; as a reusable template for future pipelines.
              </p>
              <label htmlFor="template-name" className="text-theme-text-muted mb-1 block text-sm">
                Template Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="template-name"
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Standard Onboarding Template"
                required
                aria-required="true"
                className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              />
            </div>
            <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
              <button
                onClick={() => setShowSaveTemplateModal(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleSaveAsTemplate();
                }}
                disabled={isSavingTemplate || !templateName.trim()}
                className="btn-primary flex items-center gap-2 px-6"
              >
                {isSavingTemplate && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Gallery Modal */}
      {showTemplateGallery && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-gallery-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowTemplateGallery(false);
          }}
        >
          <div className="bg-theme-surface-modal border-theme-surface-border flex max-h-[80dvh] w-full max-w-lg flex-col rounded-xl border">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <h2
                id="template-gallery-title"
                className="text-theme-text-primary flex items-center gap-2 text-lg font-bold"
              >
                <BookTemplate className="text-theme-text-muted h-5 w-5" aria-hidden="true" />
                Template Gallery
              </h2>
              <button
                onClick={() => setShowTemplateGallery(false)}
                className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                aria-label="Close dialog"
              >
                <Plus className="h-5 w-5 rotate-45" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {isLoadingTemplates ? (
                <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
                  <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" aria-hidden="true" />
                </div>
              ) : templates.length === 0 ? (
                <div className="py-8 text-center">
                  <BookTemplate className="text-theme-text-muted mx-auto mb-3 h-10 w-10" aria-hidden="true" />
                  <p className="text-theme-text-muted mb-1 text-sm">No templates available</p>
                  <p className="text-theme-text-muted text-xs">Save a pipeline as a template to see it here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {templates.map((tpl) => (
                    <div
                      key={tpl.id}
                      className="border-theme-surface-border rounded-lg border p-4 transition-colors hover:border-red-500/30"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-theme-text-primary text-sm font-medium">{tpl.name}</h3>
                        <span className="text-theme-text-muted text-xs">{tpl.stage_count} stages</span>
                      </div>
                      {tpl.description && <p className="text-theme-text-muted mb-3 text-xs">{tpl.description}</p>}
                      <button
                        onClick={() => {
                          void handleUseTemplate(tpl.id, `${tpl.name} Pipeline`);
                        }}
                        disabled={isCreatingFromTemplate}
                        className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                      >
                        {isCreatingFromTemplate ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <Plus className="h-3 w-3" aria-hidden="true" />
                        )}
                        Use Template
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Pipeline Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-pipeline-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowCreateModal(false);
          }}
        >
          <div className="bg-theme-surface-modal border-theme-surface-border w-full max-w-md rounded-xl border">
            <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
              <h2 id="create-pipeline-title" className="text-theme-text-primary text-lg font-bold">
                Create Pipeline
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
                aria-label="Close dialog"
              >
                <Plus className="h-5 w-5 rotate-45" aria-hidden="true" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label htmlFor="create-pipeline-name" className="text-theme-text-muted mb-1 block text-sm">
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
                  className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                />
              </div>
              <div>
                <label htmlFor="create-pipeline-description" className="text-theme-text-muted mb-1 block text-sm">
                  Description
                </label>
                <textarea
                  id="create-pipeline-description"
                  value={pipelineDescription}
                  onChange={(e) => setPipelineDescription(e.target.value)}
                  placeholder="Describe this pipeline's purpose..."
                  rows={3}
                  className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                />
              </div>
            </div>
            <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleCreatePipeline();
                }}
                disabled={isCreating}
                className="btn-primary flex items-center gap-2 px-6"
              >
                {isCreating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Create Pipeline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Stat card sub-component */
const StatCard: React.FC<{
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
}> = ({ icon: Icon, label, value, color }) => (
  <div className="bg-theme-surface-hover rounded-lg p-3">
    <div className="mb-1 flex items-center gap-2">
      <div className={`flex h-6 w-6 items-center justify-center rounded-sm ${color}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
      <span className="text-theme-text-muted text-xs">{label}</span>
    </div>
    <p className="text-theme-text-primary text-lg font-bold">{value}</p>
  </div>
);

export default PipelineSettingsPage;
