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
        <h3 className="text-lg font-semibold text-theme-text-primary">Request Pipeline</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Configure how event requests are processed.
        </p>
      </div>

      {/* Default assignee */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <UserCheck className="w-4 h-4 text-theme-text-muted" />
          <p className="text-sm font-medium text-theme-text-primary">Default Coordinator</p>
        </div>
        <p className="text-xs text-theme-text-muted mb-3">
          All new requests will be auto-assigned to this person.
        </p>
        <select
          value={pipeline.default_assignee_id || ''}
          onChange={(e) => onUpdateDefaultAssignee(e.target.value || null)}
          disabled={saving}
          className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring max-w-md"
        >
          <option value="">No default (manually assign)</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.first_name} {m.last_name}{m.rank ? ` — ${m.rank}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Public progress visibility */}
      <div className="flex items-center justify-between py-3 border-t border-theme-surface-border">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-theme-text-muted" />
            <p className="text-sm font-medium text-theme-text-primary">Public Progress Visibility</p>
          </div>
          <p className="text-xs text-theme-text-muted mt-0.5 ml-6">
            Show pipeline task progress on the public status page
          </p>
        </div>
        <button
          type="button"
          onClick={onTogglePublicVisibility}
          disabled={saving}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${
            pipeline.public_progress_visible ? 'bg-green-500' : 'bg-theme-surface-hover'
          }`}
          role="switch"
          aria-checked={pipeline.public_progress_visible}
          aria-label="Public progress visibility"
        >
          <span
            className={`toggle-knob-sm ${
              pipeline.public_progress_visible ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Lead time */}
      <div className="border-t border-theme-surface-border pt-4">
        <div className="flex items-center gap-2 mb-2">
          <Calendar className="w-4 h-4 text-theme-text-muted" />
          <p className="text-sm font-medium text-theme-text-primary">Minimum Lead Time</p>
        </div>
        <p className="text-xs text-theme-text-muted mb-3">
          How far in advance must requests be submitted?
        </p>
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
            className="w-20 px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-md text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
          />
          <span className="text-sm text-theme-text-muted">
            days ({Math.floor(pipeline.min_lead_time_days / 7)} weeks)
          </span>
        </div>
      </div>

      {/* Pipeline tasks with reorder */}
      <div className="border-t border-theme-surface-border pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
          Pipeline Tasks
        </h4>
        <p className="text-xs text-theme-text-muted mb-3">
          Checklist items your team uses when processing requests. Use arrows to reorder.
        </p>
        <div className="space-y-2 mb-4">
          {pipeline.tasks.map((task: PipelineTaskConfig, idx: number) => (
            <div
              key={task.id}
              className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border"
            >
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => onReorderTask(idx, 'up')}
                    disabled={saving || idx === 0}
                    className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30 transition-colors"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onReorderTask(idx, 'down')}
                    disabled={saving || idx === pipeline.tasks.length - 1}
                    className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30 transition-colors"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
                <div>
                  <span className="text-sm font-medium text-theme-text-primary">{task.label}</span>
                  {task.description && task.description !== task.label && (
                    <p className="text-xs text-theme-text-muted mt-0.5">{task.description}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemoveTask(task.id)}
                disabled={saving}
                className="text-sm text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
                title={`Remove "${task.label}"`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {pipeline.tasks.length === 0 && (
            <p className="text-sm text-theme-text-muted italic py-4 text-center">
              No pipeline tasks configured. Add tasks below.
            </p>
          )}
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="new-task-label" className="block text-xs font-medium text-theme-text-muted mb-1">
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
            <label htmlFor="new-task-desc" className="block text-xs font-medium text-theme-text-muted mb-1">
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
            className="btn-primary flex font-medium gap-1.5 items-center text-sm"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
};

export default PipelineSection;
