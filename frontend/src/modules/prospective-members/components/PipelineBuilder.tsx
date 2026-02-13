/**
 * Pipeline Builder
 *
 * Drag-and-drop interface for configuring pipeline stages.
 */

import React, { useState, useEffect } from 'react';
import {
  GripVertical,
  Plus,
  Trash2,
  Edit2,
  ArrowUp,
  ArrowDown,
  FileText,
  Upload,
  Vote,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  Pipeline,
  PipelineStage,
  PipelineStageCreate,
  StageType,
} from '../types';
import { pipelineService } from '../services/api';
import { StageConfigModal } from './StageConfigModal';

interface PipelineBuilderProps {
  pipeline: Pipeline;
  onPipelineUpdated: (pipeline: Pipeline) => void;
}

const STAGE_TYPE_ICONS: Record<StageType, React.ElementType> = {
  form_submission: FileText,
  document_upload: Upload,
  election_vote: Vote,
  manual_approval: CheckCircle,
};

const STAGE_TYPE_COLORS: Record<StageType, string> = {
  form_submission: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  document_upload: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  election_vote: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  manual_approval: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
};

const STAGE_TYPE_LABELS: Record<StageType, string> = {
  form_submission: 'Form Submission',
  document_upload: 'Document Upload',
  election_vote: 'Election / Vote',
  manual_approval: 'Manual Approval',
};

export const PipelineBuilder: React.FC<PipelineBuilderProps> = ({
  pipeline,
  onPipelineUpdated,
}) => {
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
      const message = err instanceof Error ? err.message : 'Failed to add stage';
      toast.error(message);
    }
  };

  const handleUpdateStage = async (stageData: PipelineStageCreate) => {
    if (!editingStage) return;
    try {
      const updatedStage = await pipelineService.updateStage(
        pipeline.id,
        editingStage.id,
        stageData
      );
      const updated = stages.map((s) =>
        s.id === editingStage.id ? updatedStage : s
      );
      setStages(updated);
      onPipelineUpdated({ ...pipeline, stages: updated });
      setEditingStage(null);
      toast.success('Stage updated');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update stage';
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
      const message = err instanceof Error ? err.message : 'Failed to remove stage';
      toast.error(message);
    }
  };

  const moveStage = async (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= stages.length) return;

    const reordered = [...stages];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

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
      const message = err instanceof Error ? err.message : 'Failed to reorder stages';
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
      moveStage(dragIndex, toIndex);
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
          <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-dashed border-white/10">
            <p className="text-slate-400 mb-2">No stages configured yet.</p>
            <p className="text-sm text-slate-500">
              Add stages to define the prospective member journey.
            </p>
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
                className={`flex items-center gap-3 p-4 rounded-lg border transition-all ${
                  isDragging
                    ? 'opacity-50 border-red-500/50 bg-slate-800'
                    : isDragOver
                    ? 'border-red-500 bg-slate-700/50'
                    : 'border-white/10 bg-slate-800/50 hover:border-white/20'
                }`}
              >
                {/* Drag Handle */}
                <div className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300">
                  <GripVertical className="w-5 h-5" />
                </div>

                {/* Stage Number */}
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-300 flex-shrink-0">
                  {index + 1}
                </div>

                {/* Type Badge */}
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium flex-shrink-0 ${colorClass}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {STAGE_TYPE_LABELS[stage.stage_type]}
                </div>

                {/* Name & Description */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium truncate">
                      {stage.name}
                    </span>
                    {stage.is_required && (
                      <span className="text-xs text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                        Required
                      </span>
                    )}
                  </div>
                  {stage.description && (
                    <p className="text-sm text-slate-400 truncate mt-0.5">
                      {stage.description}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => moveStage(index, index - 1)}
                    disabled={index === 0 || isSaving}
                    className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Move up"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => moveStage(index, index + 1)}
                    disabled={index === stages.length - 1 || isSaving}
                    className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Move down"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setEditingStage(stage);
                      setModalOpen(true);
                    }}
                    className="p-1.5 text-slate-400 hover:text-blue-400 transition-colors"
                    title="Edit stage"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  {deleteConfirmId === stage.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="px-1.5 py-0.5 text-xs text-slate-400 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          handleDeleteStage(stage.id);
                          setDeleteConfirmId(null);
                        }}
                        className="px-1.5 py-0.5 text-xs text-red-400 hover:text-red-300 font-medium transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(stage.id)}
                      className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                      title="Remove stage"
                    >
                      <Trash2 className="w-4 h-4" />
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
        className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-white/20 text-slate-400 hover:text-white hover:border-red-500/50 transition-all"
      >
        <Plus className="w-4 h-4" />
        <span className="text-sm font-medium">Add Stage</span>
      </button>

      {/* Saving indicator */}
      {isSaving && (
        <div className="flex items-center gap-2 mt-3 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" />
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
        onSave={editingStage ? handleUpdateStage : handleAddStage}
        editingStage={editingStage}
        existingStageCount={stages.length}
      />
    </div>
  );
};
