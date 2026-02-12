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
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { pipelineService } from '../services/api';
import { PipelineBuilder } from '../components/PipelineBuilder';
import type { Pipeline, PipelineListItem } from '../types';

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

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  useEffect(() => {
    if (currentPipeline) {
      setPipelineName(currentPipeline.name);
      setPipelineDescription(currentPipeline.description ?? '');
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
          className="p-2 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Settings className="w-7 h-7 text-red-500" />
            Pipeline Settings
          </h1>
          <p className="text-slate-400 mt-1">
            Configure the stages prospective members go through
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Pipeline List Sidebar */}
        <div className="col-span-4">
          <div className="bg-slate-800/50 border border-white/10 rounded-lg">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <h2 className="text-sm font-medium text-white">Pipelines</h2>
              <button
                onClick={() => {
                  setPipelineName('');
                  setPipelineDescription('');
                  setShowCreateModal(true);
                }}
                className="p-1.5 text-slate-400 hover:text-white transition-colors"
                title="Create pipeline"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {isLoadingPipelines ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
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
                        : 'hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white truncate">
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
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-red-500" />
            </div>
          ) : !currentPipeline ? (
            <div className="text-center py-20 bg-slate-800/30 rounded-lg border border-dashed border-white/10">
              <Settings className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">
                {pipelines.length === 0
                  ? 'Create your first pipeline'
                  : 'Select a pipeline'}
              </h3>
              <p className="text-sm text-slate-400 mb-4">
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
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4 mb-4">
                {editingPipelineName ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={pipelineName}
                      onChange={(e) => setPipelineName(e.target.value)}
                      className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <textarea
                      value={pipelineDescription}
                      onChange={(e) => setPipelineDescription(e.target.value)}
                      placeholder="Description (optional)"
                      rows={2}
                      className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingPipelineName(false);
                          setPipelineName(currentPipeline.name);
                          setPipelineDescription(currentPipeline.description ?? '');
                        }}
                        className="px-3 py-1.5 text-sm text-slate-300 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleUpdatePipelineName}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-bold text-white">
                          {currentPipeline.name}
                        </h2>
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            currentPipeline.is_active
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'bg-slate-500/20 text-slate-400'
                          }`}
                        >
                          {currentPipeline.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {currentPipeline.description && (
                        <p className="text-sm text-slate-400 mt-1">
                          {currentPipeline.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setEditingPipelineName(true)}
                        className="p-2 text-slate-400 hover:text-white transition-colors"
                        title="Edit name"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={handleToggleActive}
                        className="p-2 text-slate-400 hover:text-white transition-colors"
                        title={currentPipeline.is_active ? 'Deactivate' : 'Activate'}
                      >
                        {currentPipeline.is_active ? (
                          <PowerOff className="w-4 h-4" />
                        ) : (
                          <Power className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={handleDeletePipeline}
                        className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                        title="Delete pipeline"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Stage Builder */}
              <div className="bg-slate-800/50 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-medium text-slate-300 mb-4">
                  Pipeline Stages
                </h3>
                <PipelineBuilder
                  pipeline={currentPipeline}
                  onPipelineUpdated={handlePipelineUpdated}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Pipeline Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-white/10 rounded-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h2 className="text-lg font-bold text-white">Create Pipeline</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <Plus className="w-5 h-5 rotate-45" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Pipeline Name *
                </label>
                <input
                  type="text"
                  value={pipelineName}
                  onChange={(e) => setPipelineName(e.target.value)}
                  placeholder="e.g., New Member Onboarding"
                  className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Description
                </label>
                <textarea
                  value={pipelineDescription}
                  onChange={(e) => setPipelineDescription(e.target.value)}
                  placeholder="Describe this pipeline's purpose..."
                  rows={3}
                  className="w-full bg-slate-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6 border-t border-white/10">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePipeline}
                disabled={isCreating}
                className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
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
