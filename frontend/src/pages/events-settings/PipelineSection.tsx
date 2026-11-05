import React from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, UserCheck, Globe } from 'lucide-react';
import type { PipelineTaskConfig } from '../../types/event';
import type { PipelineSectionProps } from './types';
import { useRanks } from '../../hooks/useRanks';
import { displayNameOf } from '../../utils/memberName';

const PipelineSection: React.FC<PipelineSectionProps> = ({
  settings,
  saving,
  members,
  onUpdateDefaultAssignee,
  onTogglePublicVisibility,
  onAddTask,
  onRemoveTask,
  onReorderTask,
  newTaskLabel,
  onNewTaskLabelChange,
  newTaskDesc,
  onNewTaskDescChange,
}) => {
  const pipeline = settings.request_pipeline;
  // Inactive ranks too, so a member holding a retired rank still reads by its name.
  const { formatRank } = useRanks(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-theme-text-primary text-lg font-semibold">Request Handling</h2>
        <p className="text-theme-text-muted mt-1 text-sm">
          What happens to a public event request once it arrives: who picks it up, and the steps your team works through
          before it becomes a scheduled event.
        </p>
      </div>

      {/* Default assignee */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <UserCheck className="text-theme-text-muted h-4 w-4" />
          <p className="text-theme-text-primary text-sm font-medium">Default Coordinator</p>
        </div>
        <p className="text-theme-text-muted mb-3 text-xs">Every new public request is assigned to this person.</p>
        <select
          value={pipeline.default_assignee_id || ''}
          onChange={(e) => onUpdateDefaultAssignee(e.target.value || null)}
          disabled={saving}
          className="form-input max-w-md"
        >
          <option value="">No default (manually assign)</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {displayNameOf(m)}
              {m.rank ? ` — ${formatRank(m.rank)}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Public progress visibility */}
      <div className="border-theme-surface-border flex items-center justify-between border-t py-3">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="text-theme-text-muted h-4 w-4" />
            <p className="text-theme-text-primary text-sm font-medium">Show Checklist Progress to the Requester</p>
          </div>
          <p className="text-theme-text-muted mt-0.5 ml-6 text-xs">
            Show the requester how far through your checklist their request is, on the request&apos;s public status page
          </p>
        </div>
        <button
          type="button"
          onClick={onTogglePublicVisibility}
          disabled={saving}
          className={`focus:ring-theme-focus-ring toggle-track-md ${
            pipeline.public_progress_visible ? 'bg-green-500' : 'bg-theme-surface-hover'
          }`}
          role="switch"
          aria-checked={pipeline.public_progress_visible}
          aria-label="Public progress visibility"
        >
          <span className={`toggle-knob-sm ${pipeline.public_progress_visible ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Pipeline tasks with reorder */}
      <div className="border-theme-surface-border border-t pt-4">
        <h3 className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">Request Checklist</h3>
        <p className="text-theme-text-muted mb-3 text-xs">
          The steps your team checks off on each request, in order — for example, chief approval or confirming apparatus
          availability. Use the arrows to reorder.
        </p>
        <div className="mb-4 space-y-2">
          {pipeline.tasks.map((task: PipelineTaskConfig, idx: number) => (
            <div
              key={task.id}
              className="border-theme-surface-border flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => onReorderTask(idx, 'up')}
                    disabled={saving || idx === 0}
                    aria-label={`Move "${task.label}" up`}
                    className="text-theme-text-muted hover:text-theme-text-primary touch-target-phone transition-colors disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onReorderTask(idx, 'down')}
                    disabled={saving || idx === pipeline.tasks.length - 1}
                    aria-label={`Move "${task.label}" down`}
                    className="text-theme-text-muted hover:text-theme-text-primary touch-target-phone transition-colors disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-w-0">
                  <span className="text-theme-text-primary text-sm font-medium">{task.label}</span>
                  {task.description && task.description !== task.label && (
                    <p className="text-theme-text-muted mt-0.5 text-xs">{task.description}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemoveTask(task.id)}
                disabled={saving}
                className="text-theme-text-muted touch-target-phone shrink-0 text-sm transition-colors hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                title={`Remove "${task.label}"`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {pipeline.tasks.length === 0 && (
            <p className="text-theme-text-muted py-4 text-center text-sm italic">
              No checklist steps yet. Add one below.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="new-task-label" className="text-theme-text-muted mb-1 block text-xs font-medium">
              Step Name
            </label>
            <input
              id="new-task-label"
              type="text"
              value={newTaskLabel}
              onChange={(e) => onNewTaskLabelChange(e.target.value)}
              placeholder="e.g., Chief Approval"
              className="form-input placeholder-theme-text-muted text-sm"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="new-task-desc" className="text-theme-text-muted mb-1 block text-xs font-medium">
              Description (optional)
            </label>
            <input
              id="new-task-desc"
              type="text"
              value={newTaskDesc}
              onChange={(e) => onNewTaskDescChange(e.target.value)}
              placeholder="Brief description of this step"
              className="form-input placeholder-theme-text-muted text-sm"
            />
          </div>
          <button
            type="button"
            onClick={onAddTask}
            disabled={saving || !newTaskLabel.trim()}
            className="btn-primary flex items-center gap-1.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
};

export default PipelineSection;
