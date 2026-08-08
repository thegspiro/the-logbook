/**
 * Pipeline Kanban Board
 *
 * Kanban-style view where columns represent pipeline stages
 * and cards represent applicants. Supports drag-and-drop to advance.
 */

import React, { useState, useMemo } from 'react';
import { Users, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { PipelineStage, ApplicantListItem } from '../types';
import { STAGE_TYPE_ICONS, STAGE_HEADER_COLORS } from '../constants';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { ApplicantCard } from './ApplicantCard';
import { ApplicantStatus as ApplicantStatusEnum } from '../../../constants/enums';

interface PipelineKanbanProps {
  stages: PipelineStage[];
  applicants: ApplicantListItem[];
  /**
   * Total matching the current filters, which can exceed what was loaded.
   * The board groups client-side, so it says plainly when it is not showing
   * everything rather than rendering a silently partial picture.
   */
  totalApplicants?: number | undefined;
  onApplicantClick: (applicant: ApplicantListItem) => void;
  selectedApplicants?: Set<string> | undefined;
  onToggleSelect?: ((id: string) => void) | undefined;
}

export const PipelineKanban: React.FC<PipelineKanbanProps> = ({
  stages,
  applicants,
  totalApplicants,
  onApplicantClick,
  selectedApplicants,
  onToggleSelect,
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
      const stageGroup = grouped[applicant.current_stage_id];
      if (stageGroup) {
        stageGroup.push(applicant);
      }
    }
    return grouped;
  }, [stages, applicants]);

  const withheldCount = Math.max(0, (totalApplicants ?? applicants.length) - applicants.length);

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.sort_order - b.sort_order), [stages]);

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
    const currentStageIndex = sortedStages.findIndex((s) => s.id === draggedApplicant.current_stage_id);
    const targetStageIndex = sortedStages.findIndex((s) => s.id === targetStageId);

    if (targetStageIndex !== currentStageIndex + 1) {
      toast.error('Applicants can only be advanced to the next stage');
      setDraggedApplicant(null);
      return;
    }

    if (draggedApplicant.status !== ApplicantStatusEnum.ACTIVE) {
      toast.error('Only active applicants can be advanced');
      setDraggedApplicant(null);
      return;
    }

    try {
      await advanceApplicant(draggedApplicant.id);
      toast.success(
        `${draggedApplicant.first_name} advanced to ${sortedStages[targetStageIndex]?.name ?? 'next stage'}`
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
    <>
      {withheldCount > 0 && (
        <div
          role="status"
          className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Showing {applicants.length} of {totalApplicants} applicants. Narrow the list with search or filters, or use
            the table view to page through all of them.
          </span>
        </div>
      )}
      <div className="-mx-4 flex min-h-[300px] gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:min-h-[400px] sm:gap-4 sm:px-0">
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
              onDrop={(e) => {
                void handleDrop(e, stage.id);
              }}
              className={`bg-theme-input-bg w-64 shrink-0 rounded-lg border transition-all sm:w-72 ${
                isDropTarget ? 'border-red-500 bg-red-500/5' : 'border-theme-surface-border'
              }`}
            >
              {/* Column Header */}
              <div className={`border-theme-surface-border border-t-2 border-b p-3 ${headerColor} rounded-t-lg`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="text-theme-text-muted h-4 w-4" />
                    <h3 className="text-theme-text-primary truncate text-sm font-medium">{stage.name}</h3>
                  </div>
                  <div className="text-theme-text-muted flex items-center gap-1 text-xs">
                    <Users className="h-3 w-3" />
                    {stageApplicants.length}
                  </div>
                </div>
              </div>

              {/* Cards */}
              <div
                className="max-h-[calc(100dvh-300px)] min-h-[100px] space-y-2 overflow-y-auto p-2"
                onDragEnd={handleDragEnd}
              >
                {stageApplicants.length === 0 ? (
                  <div className="text-theme-text-muted flex h-20 items-center justify-center text-xs">
                    No applicants
                  </div>
                ) : (
                  stageApplicants.map((applicant) => (
                    <div key={applicant.id} className="relative">
                      {onToggleSelect && (
                        <div className="absolute top-2 left-2 z-10">
                          <input
                            type="checkbox"
                            checked={selectedApplicants?.has(applicant.id) ?? false}
                            onChange={(e) => {
                              e.stopPropagation();
                              onToggleSelect(applicant.id);
                            }}
                            aria-label={`Select ${applicant.first_name} ${applicant.last_name}`}
                            className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                          />
                        </div>
                      )}
                      <ApplicantCard
                        applicant={applicant}
                        onClick={onApplicantClick}
                        onDragStart={handleDragStart}
                        isDragging={draggedApplicant?.id === applicant.id}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};
