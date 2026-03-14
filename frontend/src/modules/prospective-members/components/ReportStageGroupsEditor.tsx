/**
 * Report Stage Groups Editor
 *
 * Allows membership coordinators to create named groups of pipeline stages
 * for consolidated reporting. Stages can be assigned to groups, and ungrouped
 * stages appear individually in reports.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Save, Loader2, GripVertical } from 'lucide-react';
import toast from 'react-hot-toast';
import { pipelineService } from '../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { Pipeline, PipelineStage, ReportStageGroup } from '../types';

interface Props {
  pipeline: Pipeline;
  onSaved?: (pipeline: Pipeline) => void;
}

export const ReportStageGroupsEditor: React.FC<Props> = ({ pipeline, onSaved }) => {
  const [groups, setGroups] = useState<ReportStageGroup[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setGroups(pipeline.report_stage_groups ?? []);
  }, [pipeline.report_stage_groups]);

  // All stage IDs that are assigned to a group
  const assignedStageIds = new Set(groups.flatMap((g) => g.step_ids));

  // Stages not assigned to any group
  const unassignedStages = pipeline.stages.filter((s) => !assignedStageIds.has(s.id));

  const addGroup = useCallback(() => {
    setGroups((prev) => [...prev, { name: '', step_ids: [] }]);
  }, []);

  const removeGroup = useCallback((index: number) => {
    setGroups((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateGroupName = useCallback((index: number, name: string) => {
    setGroups((prev) => prev.map((g, i) => (i === index ? { ...g, name } : g)));
  }, []);

  const addStageToGroup = useCallback((groupIndex: number, stageId: string) => {
    setGroups((prev) =>
      prev.map((g, i) => (i === groupIndex ? { ...g, step_ids: [...g.step_ids, stageId] } : g)),
    );
  }, []);

  const removeStageFromGroup = useCallback((groupIndex: number, stageId: string) => {
    setGroups((prev) =>
      prev.map((g, i) => (i === groupIndex ? { ...g, step_ids: g.step_ids.filter((id) => id !== stageId) } : g)),
    );
  }, []);

  const handleSave = async () => {
    // Validate
    for (const group of groups) {
      if (!group.name.trim()) {
        toast.error('All groups must have a name');
        return;
      }
      if (group.step_ids.length === 0) {
        toast.error(`Group "${group.name}" has no stages assigned`);
        return;
      }
    }

    // Check for duplicate names
    const names = groups.map((g) => g.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      toast.error('Group names must be unique');
      return;
    }

    setIsSaving(true);
    try {
      const updated = await pipelineService.updateReportSettings(pipeline.id, groups);
      toast.success('Report settings saved');
      onSaved?.(updated);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save report settings'));
    } finally {
      setIsSaving(false);
    }
  };

  const getStageById = (id: string): PipelineStage | undefined => pipeline.stages.find((s) => s.id === id);

  const inputClass =
    'w-full rounded-lg border border-theme-input-border bg-theme-input-bg px-3 py-2 text-sm text-theme-text-primary focus:ring-2 focus:ring-theme-focus-ring focus:outline-hidden';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-theme-text-primary text-lg font-semibold">Report Stage Groups</h3>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Group pipeline stages together for consolidated reporting. Ungrouped stages appear individually.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={addGroup} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Plus className="h-4 w-4" />
            Add Group
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={isSaving}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </div>
      </div>

      {/* Groups */}
      {groups.length === 0 && (
        <div className="card-secondary rounded-lg p-8 text-center">
          <p className="text-theme-text-muted text-sm">
            No groups configured. All stages will appear individually in reports.
          </p>
          <button type="button" onClick={addGroup} className="btn-secondary mt-3 text-sm">
            Create your first group
          </button>
        </div>
      )}

      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="card-secondary rounded-lg p-4">
          <div className="mb-3 flex items-center gap-3">
            <GripVertical className="text-theme-text-muted h-4 w-4 shrink-0" />
            <input
              type="text"
              value={group.name}
              onChange={(e) => updateGroupName(groupIndex, e.target.value)}
              placeholder="Group name (e.g., Application Phase)"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => removeGroup(groupIndex)}
              className="text-theme-text-muted hover:text-red-500 shrink-0 transition-colors"
              title="Remove group"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {/* Stages in this group */}
          <div className="ml-7 space-y-1.5">
            {group.step_ids.map((stepId) => {
              const stage = getStageById(stepId);
              return (
                <div
                  key={stepId}
                  className="bg-theme-surface flex items-center justify-between rounded px-3 py-1.5 text-sm"
                >
                  <span className="text-theme-text-primary">{stage?.name ?? 'Unknown stage'}</span>
                  <button
                    type="button"
                    onClick={() => removeStageFromGroup(groupIndex, stepId)}
                    className="text-theme-text-muted hover:text-red-500 text-xs transition-colors"
                  >
                    Remove
                  </button>
                </div>
              );
            })}

            {/* Add stage dropdown */}
            {unassignedStages.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    addStageToGroup(groupIndex, e.target.value);
                  }
                }}
                className={`${inputClass} mt-1`}
              >
                <option value="">+ Add a stage to this group...</option>
                {unassignedStages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </select>
            )}

            {group.step_ids.length === 0 && unassignedStages.length === 0 && (
              <p className="text-theme-text-muted text-xs italic">All stages are already assigned to groups.</p>
            )}
          </div>
        </div>
      ))}

      {/* Ungrouped stages info */}
      {groups.length > 0 && unassignedStages.length > 0 && (
        <div className="card-secondary rounded-lg p-4">
          <h4 className="text-theme-text-secondary mb-2 text-sm font-medium">
            Ungrouped Stages ({unassignedStages.length})
          </h4>
          <p className="text-theme-text-muted mb-2 text-xs">
            These stages will appear individually in the pipeline report.
          </p>
          <div className="space-y-1">
            {unassignedStages.map((stage) => (
              <div key={stage.id} className="bg-theme-surface rounded px-3 py-1.5 text-sm">
                <span className="text-theme-text-primary">{stage.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportStageGroupsEditor;
