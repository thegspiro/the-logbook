/**
 * Pipeline Builder
 *
 * Drag-and-drop interface for configuring pipeline stages.
 */

import React, { useState, useEffect } from 'react';
import { GripVertical, Plus, Trash2, Edit2, ArrowUp, ArrowDown, Loader2, Bell, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Pipeline, PipelineStage, PipelineStageCreate } from '../types';
import { STAGE_TYPE_ICONS, STAGE_TYPE_COLORS, STAGE_TYPE_LABELS } from '../constants';
import { pipelineService } from '../services/api';
import { StageConfigModal } from './StageConfigModal';
import { getErrorMessage } from '../../../utils/errorHandling';

interface PipelineBuilderProps {
  pipeline: Pipeline;
  onPipelineUpdated: (pipeline: Pipeline) => void;
}

export const PipelineBuilder: React.FC<PipelineBuilderProps> = ({ pipeline, onPipelineUpdated }) => {
  const [stages, setStages] = useState<PipelineStage[]>(pipeline.stages);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<PipelineStage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    setStages(pipeline.stages);
  }, [pipeline.stages]);

  const handleAddStage = async (stageData: PipelineStageCreate) => {
    try {
      const newStage = await pipelineService.addStage(pipeline.id, stageData);
      const updated = [...stages, newStage].sort((a, b) => a.sort_order - b.sort_order);
      setStages(updated);
      onPipelineUpdated({ ...pipeline, stages: updated });
      toast.success('Stage added');
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to add stage');
      toast.error(message);
    }
  };

  const handleUpdateStage = async (stageData: PipelineStageCreate) => {
    if (!editingStage) return;
    try {
      const updatedStage = await pipelineService.updateStage(pipeline.id, editingStage.id, stageData);
      const updated = stages.map((s) => (s.id === editingStage.id ? updatedStage : s));
      setStages(updated);
      onPipelineUpdated({ ...pipeline, stages: updated });
      setEditingStage(null);
      toast.success('Stage updated');
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to update stage');
      toast.error(message);
    }
  };

  const handleDeleteStage = async (stageId: string) => {
    try {
      await pipelineService.deleteStage(pipeline.id, stageId);
      const updated = stages.filter((s) => s.id !== stageId);
      setStages(updated);
      onPipelineUpdated({ ...pipeline, stages: updated });
      toast.success('Stage removed');
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to remove stage');
      toast.error(message);
    }
  };

  const moveStage = async (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= stages.length) return;

    const reordered = [...stages];
    const [moved] = reordered.splice(fromIndex, 1);
    if (moved) {
      reordered.splice(toIndex, 0, moved);
    }

    // Update sort_order values
    const withNewOrder = reordered.map((s, idx) => ({
      ...s,
      sort_order: idx,
    }));

    setStages(withNewOrder);

    setIsSaving(true);
    try {
      await pipelineService.reorderStages(
        pipeline.id,
        withNewOrder.map((s) => s.id)
      );
      onPipelineUpdated({ ...pipeline, stages: withNewOrder });
    } catch (err: unknown) {
      // Revert on error
      setStages(pipeline.stages);
      const message = getErrorMessage(err, 'Failed to reorder stages');
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== toIndex && !isSaving) {
      void moveStage(dragIndex, toIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div>
      {/* Stage List */}
      <div className="space-y-2">
        {stages.length === 0 ? (
          <div className="bg-theme-input-bg border-theme-surface-border rounded-lg border border-dashed py-12 text-center">
            <p className="text-theme-text-muted mb-2">No stages configured yet.</p>
            <p className="text-theme-text-muted text-sm">Add stages to define the prospective member journey.</p>
          </div>
        ) : (
          stages.map((stage, index) => {
            const Icon = STAGE_TYPE_ICONS[stage.stage_type];
            const colorClass = STAGE_TYPE_COLORS[stage.stage_type];
            const isDragging = dragIndex === index;
            const isDragOver = dragOverIndex === index;

            return (
              <div
                key={stage.id}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-3 rounded-lg border p-4 transition-all ${
                  isDragging
                    ? 'bg-theme-surface border-red-500/50 opacity-50'
                    : isDragOver
                      ? 'bg-theme-surface-hover border-red-500'
                      : 'border-theme-surface-border bg-theme-input-bg hover:border-theme-surface-border'
                }`}
              >
                {/* Drag Handle */}
                <div className="text-theme-text-muted hover:text-theme-text-secondary cursor-grab active:cursor-grabbing">
                  <GripVertical className="h-5 w-5" />
                </div>

                {/* Stage Number */}
                <div className="bg-theme-surface-hover text-theme-text-secondary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                  {index + 1}
                </div>

                {/* Type Badge */}
                <div
                  className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${colorClass}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {STAGE_TYPE_LABELS[stage.stage_type]}
                </div>

                {/* Name & Description */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-theme-text-primary truncate font-medium">{stage.name}</span>
                    {stage.is_required && (
                      <span className="rounded-sm bg-red-500/10 px-1.5 py-0.5 text-xs text-red-700 dark:text-red-400">
                        Required
                      </span>
                    )}
                    {stage.notify_prospect_on_completion && (
                      <span
                        className="flex items-center gap-0.5 rounded-sm bg-blue-500/10 px-1.5 py-0.5 text-xs text-blue-700 dark:text-blue-400"
                        title="Notifies prospect on completion"
                      >
                        <Bell className="h-2.5 w-2.5" />
                        Notify
                      </span>
                    )}
                    {!stage.public_visible && (
                      <span
                        className="text-theme-text-muted bg-theme-surface-hover flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-xs"
                        title="Hidden from public status page"
                      >
                        <EyeOff className="h-2.5 w-2.5" />
                        Hidden
                      </span>
                    )}
                  </div>
                  {stage.description && (
                    <p className="text-theme-text-muted mt-0.5 truncate text-sm">{stage.description}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => {
                      void moveStage(index, index - 1);
                    }}
                    disabled={index === 0 || isSaving}
                    className="text-theme-text-muted hover:text-theme-text-primary p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                    title="Move up"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      void moveStage(index, index + 1);
                    }}
                    disabled={index === stages.length - 1 || isSaving}
                    className="text-theme-text-muted hover:text-theme-text-primary p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                    title="Move down"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingStage(stage);
                      setModalOpen(true);
                    }}
                    className="text-theme-text-muted p-1.5 transition-colors hover:text-blue-700 dark:hover:text-blue-400"
                    title="Edit stage"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  {deleteConfirmId === stage.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-theme-text-muted hover:text-theme-text-primary px-1.5 py-0.5 text-xs transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          void handleDeleteStage(stage.id);
                          setDeleteConfirmId(null);
                        }}
                        className="px-1.5 py-0.5 text-xs font-medium text-red-700 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(stage.id)}
                      className="text-theme-text-muted p-1.5 transition-colors hover:text-red-700 dark:hover:text-red-400"
                      title="Remove stage"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Stage Button */}
      <button
        onClick={() => {
          setEditingStage(null);
          setModalOpen(true);
        }}
        className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed py-3 transition-all hover:border-red-500/50"
      >
        <Plus className="h-4 w-4" />
        <span className="text-sm font-medium">Add Stage</span>
      </button>

      {/* Saving indicator */}
      {isSaving && (
        <div className="text-theme-text-muted mt-3 flex items-center gap-2 text-sm" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" />
          Saving order...
        </div>
      )}

      {/* Stage Config Modal */}
      <StageConfigModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingStage(null);
        }}
        onSave={(data) => {
          void (editingStage ? handleUpdateStage(data) : handleAddStage(data));
        }}
        editingStage={editingStage}
        existingStageCount={stages.length}
      />
    </div>
  );
};
