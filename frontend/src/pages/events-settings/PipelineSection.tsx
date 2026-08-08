import React from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Calendar, UserCheck, Globe } from 'lucide-react';
import type { PipelineTaskConfig } from '../../types/event';
import type { PipelineSectionProps } from './types';

const PipelineSection: React.FC<PipelineSectionProps> = ({
  settings,
  saving,
  members,
  onUpdateLeadTime,
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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-theme-text-primary text-lg font-semibold">Request Pipeline</h3>
        <p className="text-theme-text-muted mt-1 text-sm">Configure how event requests are processed.</p>
      </div>

      {/* Default assignee */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <UserCheck className="text-theme-text-muted h-4 w-4" />
          <p className="text-theme-text-primary text-sm font-medium">Default Coordinator</p>
        </div>
        <p className="text-theme-text-muted mb-3 text-xs">All new requests will be auto-assigned to this person.</p>
        <select
          value={pipeline.default_assignee_id || ''}
          onChange={(e) => onUpdateDefaultAssignee(e.target.value || null)}
          disabled={saving}
          className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full max-w-md rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
        >
          <option value="">No default (manually assign)</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.first_name} {m.last_name}
              {m.rank ? ` — ${m.rank}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Public progress visibility */}
      <div className="border-theme-surface-border flex items-center justify-between border-t py-3">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="text-theme-text-muted h-4 w-4" />
            <p className="text-theme-text-primary text-sm font-medium">Public Progress Visibility</p>
          </div>
          <p className="text-theme-text-muted mt-0.5 ml-6 text-xs">
            Show pipeline task progress on the public status page
          </p>
        </div>
        <button
          type="button"
          onClick={onTogglePublicVisibility}
          disabled={saving}
          className={`focus:ring-theme-focus-ring relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 ${
            pipeline.public_progress_visible ? 'bg-green-500' : 'bg-theme-surface-hover'
          }`}
          role="switch"
          aria-checked={pipeline.public_progress_visible}
          aria-label="Public progress visibility"
        >
          <span className={`toggle-knob-sm ${pipeline.public_progress_visible ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Lead time */}
      <div className="border-theme-surface-border border-t pt-4">
        <div className="mb-2 flex items-center gap-2">
          <Calendar className="text-theme-text-muted h-4 w-4" />
          <p className="text-theme-text-primary text-sm font-medium">Minimum Lead Time</p>
        </div>
        <p className="text-theme-text-muted mb-3 text-xs">How far in advance must requests be submitted?</p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={365}
            value={pipeline.min_lead_time_days}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val) && val >= 0 && val <= 365) {
                onUpdateLeadTime(val);
              }
            }}
            className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-20 rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
          />
          <span className="text-theme-text-muted text-sm">
            days ({Math.floor(pipeline.min_lead_time_days / 7)} weeks)
          </span>
        </div>
      </div>

      {/* Pipeline tasks with reorder */}
      <div className="border-theme-surface-border border-t pt-4">
        <h4 className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">Pipeline Tasks</h4>
        <p className="text-theme-text-muted mb-3 text-xs">
          Checklist items your team uses when processing requests. Use arrows to reorder.
        </p>
        <div className="mb-4 space-y-2">
          {pipeline.tasks.map((task: PipelineTaskConfig, idx: number) => (
            <div
              key={task.id}
              className="border-theme-surface-border flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => onReorderTask(idx, 'up')}
                    disabled={saving || idx === 0}
                    className="text-theme-text-muted hover:text-theme-text-primary transition-colors disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onReorderTask(idx, 'down')}
                    disabled={saving || idx === pipeline.tasks.length - 1}
                    className="text-theme-text-muted hover:text-theme-text-primary transition-colors disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
                <div>
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
                className="text-theme-text-muted text-sm transition-colors hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
                title={`Remove "${task.label}"`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {pipeline.tasks.length === 0 && (
            <p className="text-theme-text-muted py-4 text-center text-sm italic">
              No pipeline tasks configured. Add tasks below.
            </p>
          )}
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="new-task-label" className="text-theme-text-muted mb-1 block text-xs font-medium">
              Task Name
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
