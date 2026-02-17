/**
 * Pipeline Kanban Board
 *
 * Kanban-style view where columns represent pipeline stages
 * and cards represent applicants. Supports drag-and-drop to advance.
 */

import React, { useState, useMemo } from 'react';
import {
  FileText,
  Upload,
  Vote,
  CheckCircle,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  PipelineStage,
  ApplicantListItem,
  StageType,
} from '../types';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { ApplicantCard } from './ApplicantCard';

interface PipelineKanbanProps {
  stages: PipelineStage[];
  applicants: ApplicantListItem[];
  onApplicantClick: (applicant: ApplicantListItem) => void;
}

const STAGE_TYPE_ICONS: Record<StageType, React.ElementType> = {
  form_submission: FileText,
  document_upload: Upload,
  election_vote: Vote,
  manual_approval: CheckCircle,
};

const STAGE_HEADER_COLORS: Record<StageType, string> = {
  form_submission: 'border-blue-500',
  document_upload: 'border-amber-500',
  election_vote: 'border-purple-500',
  manual_approval: 'border-emerald-500',
};

export const PipelineKanban: React.FC<PipelineKanbanProps> = ({
  stages,
  applicants,
  onApplicantClick,
}) => {
  const { advanceApplicant, isAdvancing } = useProspectiveMembersStore();
  const [draggedApplicant, setDraggedApplicant] = useState<ApplicantListItem | null>(null);
  const [dropTargetStageId, setDropTargetStageId] = useState<string | null>(null);

  // Group applicants by current stage
  const applicantsByStage = useMemo(() => {
    const grouped: Record<string, ApplicantListItem[]> = {};
    for (const stage of stages) {
      grouped[stage.id] = [];
    }
    for (const applicant of applicants) {
      if (grouped[applicant.current_stage_id]) {
        grouped[applicant.current_stage_id].push(applicant);
      }
    }
    return grouped;
  }, [stages, applicants]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.sort_order - b.sort_order),
    [stages]
  );

  const handleDragStart = (e: React.DragEvent, applicant: ApplicantListItem) => {
    setDraggedApplicant(applicant);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetStageId(stageId);
  };

  const handleDragLeave = () => {
    setDropTargetStageId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    setDropTargetStageId(null);

    if (!draggedApplicant || isAdvancing) return;

    // Only allow advancing to the next stage
    const currentStageIndex = sortedStages.findIndex(
      (s) => s.id === draggedApplicant.current_stage_id
    );
    const targetStageIndex = sortedStages.findIndex(
      (s) => s.id === targetStageId
    );

    if (targetStageIndex !== currentStageIndex + 1) {
      toast.error('Applicants can only be advanced to the next stage');
      setDraggedApplicant(null);
      return;
    }

    if (draggedApplicant.status !== 'active') {
      toast.error('Only active applicants can be advanced');
      setDraggedApplicant(null);
      return;
    }

    try {
      await advanceApplicant(draggedApplicant.id);
      toast.success(
        `${draggedApplicant.first_name} advanced to ${sortedStages[targetStageIndex].name}`
      );
    } catch {
      toast.error('Failed to advance applicant');
    }

    setDraggedApplicant(null);
  };

  const handleDragEnd = () => {
    setDraggedApplicant(null);
    setDropTargetStageId(null);
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[500px]">
      {sortedStages.map((stage) => {
        const Icon = STAGE_TYPE_ICONS[stage.stage_type];
        const headerColor = STAGE_HEADER_COLORS[stage.stage_type];
        const stageApplicants = applicantsByStage[stage.id] ?? [];
        const isDropTarget = dropTargetStageId === stage.id;

        return (
          <div
            key={stage.id}
            onDragOver={(e) => handleDragOver(e, stage.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, stage.id)}
            className={`flex-shrink-0 w-72 bg-theme-input-bg rounded-lg border transition-all ${
              isDropTarget
                ? 'border-red-500 bg-red-500/5'
                : 'border-theme-surface-border'
            }`}
          >
            {/* Column Header */}
            <div className={`p-3 border-b border-theme-surface-border border-t-2 ${headerColor} rounded-t-lg`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-theme-text-muted" />
                  <h3 className="text-sm font-medium text-theme-text-primary truncate">
                    {stage.name}
                  </h3>
                </div>
                <div className="flex items-center gap-1 text-xs text-theme-text-muted">
                  <Users className="w-3 h-3" />
                  {stageApplicants.length}
                </div>
              </div>
            </div>

            {/* Cards */}
            <div
              className="p-2 space-y-2 min-h-[100px] max-h-[calc(100vh-300px)] overflow-y-auto"
              onDragEnd={handleDragEnd}
            >
              {stageApplicants.length === 0 ? (
                <div className="flex items-center justify-center h-20 text-xs text-theme-text-muted">
                  No applicants
                </div>
              ) : (
                stageApplicants.map((applicant) => (
                  <ApplicantCard
                    key={applicant.id}
                    applicant={applicant}
                    onClick={onApplicantClick}
                    onDragStart={handleDragStart}
                    isDragging={draggedApplicant?.id === applicant.id}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
