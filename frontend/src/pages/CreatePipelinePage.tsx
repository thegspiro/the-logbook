import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  GraduationCap,
  Info,
  Layers,
  ListChecks,
  Flag,
  Eye,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { trainingProgramService } from '../services/api';
import type {
  ProgramStructureType,
  RequirementType,
  RequirementFrequency,
} from '../types/training';

// ==================== Types ====================

interface PhaseFormData {
  id: string; // client-side only
  phase_number: number;
  name: string;
  description: string;
  time_limit_days: string;
  requires_manual_advancement: boolean;
  requirements: RequirementFormData[];
  milestones: MilestoneFormData[];
  isExpanded: boolean;
}

interface RequirementFormData {
  id: string;
  name: string;
  description: string;
  requirement_type: RequirementType;
  frequency: RequirementFrequency;
  required_hours: string;
  required_shifts: string;
  required_calls: string;
  passing_score: string;
  max_attempts: string;
  checklist_items: string[];
  is_required: boolean;
  sort_order: number;
}

interface MilestoneFormData {
  id: string;
  name: string;
  description: string;
  completion_percentage_threshold: string;
  notification_message: string;
}

type WizardStep = 'info' | 'phases' | 'requirements' | 'milestones' | 'review';

const WIZARD_STEPS: { key: WizardStep; label: string; icon: React.ElementType }[] = [
  { key: 'info', label: 'Program Info', icon: Info },
  { key: 'phases', label: 'Phases', icon: Layers },
  { key: 'requirements', label: 'Requirements', icon: ListChecks },
  { key: 'milestones', label: 'Milestones', icon: Flag },
  { key: 'review', label: 'Review', icon: Eye },
];

// ==================== Helper ====================

let clientIdCounter = 0;
const nextId = () => `client-${++clientIdCounter}`;

const emptyPhase = (num: number): PhaseFormData => ({
  id: nextId(),
  phase_number: num,
  name: '',
  description: '',
  time_limit_days: '',
  requires_manual_advancement: false,
  requirements: [],
  milestones: [],
  isExpanded: true,
});

const emptyRequirement = (sortOrder: number): RequirementFormData => ({
  id: nextId(),
  name: '',
  description: '',
  requirement_type: 'hours',
  frequency: 'one_time',
  required_hours: '',
  required_shifts: '',
  required_calls: '',
  passing_score: '',
  max_attempts: '',
  checklist_items: [],
  is_required: true,
  sort_order: sortOrder,
});

const emptyMilestone = (): MilestoneFormData => ({
  id: nextId(),
  name: '',
  description: '',
  completion_percentage_threshold: '',
  notification_message: '',
});

// ==================== Step Components ====================

const StepInfo: React.FC<{
  data: {
    name: string;
    description: string;
    code: string;
    target_position: string;
    structure_type: ProgramStructureType;
    time_limit_days: string;
    warning_days_before: string;
    is_template: boolean;
  };
  onChange: (field: string, value: string | boolean) => void;
}> = ({ data, onChange }) => (
  <div className="space-y-6">
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Program Information</h2>
      <p className="text-gray-400 text-sm">Define the basic details for your training pipeline.</p>
    </div>

    <div>
      <label htmlFor="prog-name" className="block text-sm font-medium text-gray-300 mb-1">
        Program Name <span className="text-red-400">*</span>
      </label>
      <input
        id="prog-name"
        type="text"
        value={data.name}
        onChange={(e) => onChange('name', e.target.value)}
        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
        placeholder="e.g., Recruit / Probationary Firefighter"
        required
      />
    </div>

    <div>
      <label htmlFor="prog-desc" className="block text-sm font-medium text-gray-300 mb-1">
        Description
      </label>
      <textarea
        id="prog-desc"
        value={data.description}
        onChange={(e) => onChange('description', e.target.value)}
        rows={3}
        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
        placeholder="Describe what this program covers and who it's for..."
      />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label htmlFor="prog-code" className="block text-sm font-medium text-gray-300 mb-1">
          Program Code
        </label>
        <input
          id="prog-code"
          type="text"
          value={data.code}
          onChange={(e) => onChange('code', e.target.value.toUpperCase())}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          placeholder="e.g., RECRUIT"
          maxLength={50}
        />
      </div>

      <div>
        <label htmlFor="prog-target" className="block text-sm font-medium text-gray-300 mb-1">
          Target Position
        </label>
        <select
          id="prog-target"
          value={data.target_position}
          onChange={(e) => onChange('target_position', e.target.value)}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="">All Positions</option>
          <option value="probationary">Probationary</option>
          <option value="firefighter">Firefighter</option>
          <option value="driver_candidate">Driver Candidate</option>
          <option value="driver">Driver</option>
          <option value="officer">Officer</option>
          <option value="aic">AIC (Attendant in Charge)</option>
        </select>
      </div>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <label htmlFor="prog-structure" className="block text-sm font-medium text-gray-300 mb-1">
          Structure Type
        </label>
        <select
          id="prog-structure"
          value={data.structure_type}
          onChange={(e) => onChange('structure_type', e.target.value)}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="phases">Phases (stages in order)</option>
          <option value="sequential">Sequential (strict order)</option>
          <option value="flexible">Flexible (any order)</option>
        </select>
      </div>

      <div>
        <label htmlFor="prog-timelimit" className="block text-sm font-medium text-gray-300 mb-1">
          Time Limit (days)
        </label>
        <input
          id="prog-timelimit"
          type="number"
          value={data.time_limit_days}
          onChange={(e) => onChange('time_limit_days', e.target.value)}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          placeholder="e.g., 365"
          min={1}
        />
      </div>

      <div>
        <label htmlFor="prog-warning" className="block text-sm font-medium text-gray-300 mb-1">
          Warning (days before)
        </label>
        <input
          id="prog-warning"
          type="number"
          value={data.warning_days_before}
          onChange={(e) => onChange('warning_days_before', e.target.value)}
          className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-red-500"
          placeholder="30"
          min={1}
        />
      </div>
    </div>

    <div className="flex items-center space-x-2">
      <input
        type="checkbox"
        id="is-template"
        checked={data.is_template}
        onChange={(e) => onChange('is_template', e.target.checked)}
        className="w-4 h-4 text-red-500 bg-gray-700 border-gray-600 rounded focus:ring-red-500"
      />
      <label htmlFor="is-template" className="text-sm text-gray-300">
        Save as template (can be cloned for future use)
      </label>
    </div>
  </div>
);

const StepPhases: React.FC<{
  phases: PhaseFormData[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, field: string, value: string | boolean) => void;
  onToggleExpand: (id: string) => void;
}> = ({ phases, onAdd, onRemove, onUpdate, onToggleExpand }) => (
  <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Program Phases</h2>
        <p className="text-gray-400 text-sm">Define the phases or stages of your training pipeline. Members progress through these in order.</p>
      </div>
      <button
        onClick={onAdd}
        className="flex items-center space-x-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
      >
        <Plus className="w-4 h-4" />
        <span>Add Phase</span>
      </button>
    </div>

    {phases.length === 0 ? (
      <div className="text-center py-12 bg-gray-800/50 rounded-lg border border-dashed border-gray-600">
        <Layers className="w-12 h-12 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-400 mb-2">No phases defined yet</p>
        <p className="text-gray-500 text-sm mb-4">Add phases to structure your training pipeline</p>
        <button
          onClick={onAdd}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
        >
          Add First Phase
        </button>
      </div>
    ) : (
      <div className="space-y-3">
        {phases.map((phase) => (
          <div key={phase.id} className="bg-gray-800 rounded-lg border border-gray-700">
            <div
              className="flex items-center justify-between p-4 cursor-pointer"
              onClick={() => onToggleExpand(phase.id)}
            >
              <div className="flex items-center space-x-3">
                <GripVertical className="w-4 h-4 text-gray-500" />
                <span className="text-red-400 font-bold text-sm">Phase {phase.phase_number}</span>
                <span className="text-white font-medium">{phase.name || 'Untitled Phase'}</span>
                {phase.requirements.length > 0 && (
                  <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded">
                    {phase.requirements.length} req{phase.requirements.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(phase.id); }}
                  className="p-1 text-gray-400 hover:text-red-400"
                  aria-label={`Remove phase ${phase.phase_number}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                {phase.isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </div>
            </div>

            {phase.isExpanded && (
              <div className="px-4 pb-4 space-y-4 border-t border-gray-700 pt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Phase Name *</label>
                  <input
                    type="text"
                    value={phase.name}
                    onChange={(e) => onUpdate(phase.id, 'name', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="e.g., Engine Company Operations"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
                  <textarea
                    value={phase.description}
                    onChange={(e) => onUpdate(phase.id, 'description', e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="Describe what this phase covers..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">Time Limit (days)</label>
                    <input
                      type="number"
                      value={phase.time_limit_days}
                      onChange={(e) => onUpdate(phase.id, 'time_limit_days', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      placeholder="Optional"
                      min={1}
                    />
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center space-x-2 text-sm text-gray-300 pb-2">
                      <input
                        type="checkbox"
                        checked={phase.requires_manual_advancement}
                        onChange={(e) => onUpdate(phase.id, 'requires_manual_advancement', e.target.checked)}
                        className="w-4 h-4 text-red-500 bg-gray-700 border-gray-600 rounded"
                      />
                      <span>Require officer approval to advance</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

const StepRequirements: React.FC<{
  phases: PhaseFormData[];
  onAddRequirement: (phaseId: string) => void;
  onRemoveRequirement: (phaseId: string, reqId: string) => void;
  onUpdateRequirement: (phaseId: string, reqId: string, field: string, value: string | boolean | string[]) => void;
}> = ({ phases, onAddRequirement, onRemoveRequirement, onUpdateRequirement }) => (
  <div className="space-y-6">
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Requirements</h2>
      <p className="text-gray-400 text-sm">Define the requirements members must complete within each phase.</p>
    </div>

    {phases.length === 0 ? (
      <div className="text-center py-12 bg-gray-800/50 rounded-lg border border-dashed border-gray-600">
        <ListChecks className="w-12 h-12 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-400">Add phases first before defining requirements.</p>
      </div>
    ) : (
      phases.map((phase) => (
        <div key={phase.id} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-medium">
              <span className="text-red-400">Phase {phase.phase_number}:</span> {phase.name || 'Untitled'}
            </h3>
            <button
              onClick={() => onAddRequirement(phase.id)}
              className="flex items-center space-x-1 px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-xs"
            >
              <Plus className="w-3 h-3" />
              <span>Add Requirement</span>
            </button>
          </div>

          {phase.requirements.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No requirements yet for this phase.</p>
          ) : (
            <div className="space-y-3">
              {phase.requirements.map((req) => (
                <div key={req.id} className="bg-gray-700/50 rounded-lg p-3 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">Requirement Name *</label>
                        <input
                          type="text"
                          value={req.name}
                          onChange={(e) => onUpdateRequirement(phase.id, req.id, 'name', e.target.value)}
                          className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                          placeholder="e.g., Hose Operations Skills"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">Type</label>
                        <select
                          value={req.requirement_type}
                          onChange={(e) => onUpdateRequirement(phase.id, req.id, 'requirement_type', e.target.value)}
                          className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                        >
                          <option value="hours">Training Hours</option>
                          <option value="courses">Course Completion</option>
                          <option value="skills_evaluation">Skills Evaluation</option>
                          <option value="knowledge_test">Knowledge Test</option>
                          <option value="checklist">Checklist</option>
                          <option value="certification">Certification</option>
                          <option value="shifts">Shift Hours</option>
                          <option value="calls">Call Responses</option>
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={() => onRemoveRequirement(phase.id, req.id)}
                      className="p-1 text-gray-400 hover:text-red-400 ml-2"
                      aria-label="Remove requirement"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
                    <textarea
                      value={req.description}
                      onChange={(e) => onUpdateRequirement(phase.id, req.id, 'description', e.target.value)}
                      rows={2}
                      className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                      placeholder="Describe what this requirement entails..."
                    />
                  </div>

                  {/* Conditional fields based on type */}
                  {req.requirement_type === 'hours' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">Required Hours</label>
                        <input
                          type="number"
                          value={req.required_hours}
                          onChange={(e) => onUpdateRequirement(phase.id, req.id, 'required_hours', e.target.value)}
                          className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                          placeholder="e.g., 40"
                          min={0}
                          step={0.5}
                        />
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center space-x-2 text-xs text-gray-300 pb-1">
                          <input
                            type="checkbox"
                            checked={req.is_required}
                            onChange={(e) => onUpdateRequirement(phase.id, req.id, 'is_required', e.target.checked)}
                            className="w-3 h-3 text-red-500 bg-gray-700 border-gray-600 rounded"
                          />
                          <span>Required</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {req.requirement_type === 'shifts' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Required Shifts</label>
                      <input
                        type="number"
                        value={req.required_shifts}
                        onChange={(e) => onUpdateRequirement(phase.id, req.id, 'required_shifts', e.target.value)}
                        className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                        placeholder="e.g., 10"
                        min={1}
                      />
                    </div>
                  )}

                  {req.requirement_type === 'calls' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Required Calls</label>
                      <input
                        type="number"
                        value={req.required_calls}
                        onChange={(e) => onUpdateRequirement(phase.id, req.id, 'required_calls', e.target.value)}
                        className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                        placeholder="e.g., 20"
                        min={1}
                      />
                    </div>
                  )}

                  {req.requirement_type === 'checklist' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">
                        Checklist Items (one per line)
                      </label>
                      <textarea
                        value={req.checklist_items.join('\n')}
                        onChange={(e) => onUpdateRequirement(phase.id, req.id, 'checklist_items', e.target.value.split('\n'))}
                        rows={4}
                        className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                        placeholder="Enter each checklist item on a new line..."
                      />
                    </div>
                  )}

                  {req.requirement_type === 'knowledge_test' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">Passing Score (%)</label>
                        <input
                          type="number"
                          value={req.passing_score}
                          onChange={(e) => onUpdateRequirement(phase.id, req.id, 'passing_score', e.target.value)}
                          className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                          placeholder="e.g., 70"
                          min={0}
                          max={100}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-400 mb-1">Max Attempts</label>
                        <input
                          type="number"
                          value={req.max_attempts}
                          onChange={(e) => onUpdateRequirement(phase.id, req.id, 'max_attempts', e.target.value)}
                          className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                          placeholder="Unlimited"
                          min={1}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))
    )}
  </div>
);

const StepMilestones: React.FC<{
  phases: PhaseFormData[];
  onAddMilestone: (phaseId: string) => void;
  onRemoveMilestone: (phaseId: string, msId: string) => void;
  onUpdateMilestone: (phaseId: string, msId: string, field: string, value: string) => void;
  onMoveMilestone: (phaseId: string, msId: string, direction: 'up' | 'down') => void;
}> = ({ phases, onAddMilestone, onRemoveMilestone, onUpdateMilestone, onMoveMilestone }) => (
  <div className="space-y-6">
    <div>
      <h2 className="text-xl font-semibold text-white mb-1">Milestones</h2>
      <p className="text-gray-400 text-sm">Define milestones to celebrate member progress and trigger notifications. Use the arrows to reorder.</p>
    </div>

    {phases.length === 0 ? (
      <div className="text-center py-12 bg-gray-800/50 rounded-lg border border-dashed border-gray-600">
        <Flag className="w-12 h-12 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-400">Add phases first before defining milestones.</p>
      </div>
    ) : (
      phases.map((phase) => (
        <div key={phase.id} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-medium">
              <span className="text-red-400">Phase {phase.phase_number}:</span> {phase.name || 'Untitled'}
            </h3>
            <button
              onClick={() => onAddMilestone(phase.id)}
              className="flex items-center space-x-1 px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-xs"
            >
              <Plus className="w-3 h-3" />
              <span>Add Milestone</span>
            </button>
          </div>

          {phase.milestones.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No milestones for this phase (optional).</p>
          ) : (
            <div className="space-y-3">
              {phase.milestones.map((ms, msIndex) => (
                <div key={ms.id} className="bg-gray-700/50 rounded-lg p-3 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-2">
                      {/* Reorder buttons */}
                      <div className="flex flex-col space-y-0.5 pt-1">
                        <button
                          onClick={() => onMoveMilestone(phase.id, ms.id, 'up')}
                          disabled={msIndex === 0}
                          className="p-0.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Move milestone up"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onMoveMilestone(phase.id, ms.id, 'down')}
                          disabled={msIndex === phase.milestones.length - 1}
                          className="p-0.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Move milestone down"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1">Milestone Name *</label>
                          <input
                            type="text"
                            value={ms.name}
                            onChange={(e) => onUpdateMilestone(phase.id, ms.id, 'name', e.target.value)}
                            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                            placeholder="e.g., Halfway Complete"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1">Trigger at (% complete)</label>
                          <input
                            type="number"
                            value={ms.completion_percentage_threshold}
                            onChange={(e) => onUpdateMilestone(phase.id, ms.id, 'completion_percentage_threshold', e.target.value)}
                            className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                            placeholder="e.g., 50"
                            min={1}
                            max={100}
                          />
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => onRemoveMilestone(phase.id, ms.id)}
                      className="p-1 text-gray-400 hover:text-red-400 ml-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="pl-7">
                    <label className="block text-xs font-medium text-gray-400 mb-1">Notification Message</label>
                    <input
                      type="text"
                      value={ms.notification_message}
                      onChange={(e) => onUpdateMilestone(phase.id, ms.id, 'notification_message', e.target.value)}
                      className="w-full px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-red-500"
                      placeholder="Message sent when this milestone is reached..."
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))
    )}
  </div>
);

const StepReview: React.FC<{
  info: {
    name: string;
    description: string;
    code: string;
    target_position: string;
    structure_type: ProgramStructureType;
    time_limit_days: string;
    warning_days_before: string;
    is_template: boolean;
  };
  phases: PhaseFormData[];
}> = ({ info, phases }) => {
  const totalReqs = phases.reduce((sum, p) => sum + p.requirements.length, 0);
  const totalMs = phases.reduce((sum, p) => sum + p.milestones.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Review Your Pipeline</h2>
        <p className="text-gray-400 text-sm">Review all details before creating the training pipeline.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{phases.length}</p>
          <p className="text-gray-400 text-sm">Phases</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-blue-400">{totalReqs}</p>
          <p className="text-gray-400 text-sm">Requirements</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-yellow-400">{totalMs}</p>
          <p className="text-gray-400 text-sm">Milestones</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-400">{info.time_limit_days || '—'}</p>
          <p className="text-gray-400 text-sm">Days Limit</p>
        </div>
      </div>

      {/* Program info */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-white mb-3">{info.name || 'Untitled Program'}</h3>
        {info.description && <p className="text-gray-400 text-sm mb-3">{info.description}</p>}
        <div className="flex flex-wrap gap-2 text-xs">
          {info.code && <span className="px-2 py-1 bg-gray-700 text-gray-300 rounded">{info.code}</span>}
          {info.target_position && <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded">{info.target_position}</span>}
          <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded">{info.structure_type}</span>
          {info.is_template && <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded">Template</span>}
        </div>
      </div>

      {/* Phase details */}
      {phases.map((phase) => (
        <div key={phase.id} className="bg-gray-800 rounded-lg p-4">
          <h4 className="font-medium text-white mb-2">
            <span className="text-red-400">Phase {phase.phase_number}:</span> {phase.name || 'Untitled'}
          </h4>
          {phase.description && <p className="text-gray-400 text-sm mb-3">{phase.description}</p>}
          <div className="flex flex-wrap gap-2 text-xs mb-3">
            {phase.time_limit_days && <span className="px-2 py-1 bg-gray-700 text-gray-300 rounded">{phase.time_limit_days} day limit</span>}
            {phase.requires_manual_advancement && <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded">Manual advancement</span>}
          </div>

          {phase.requirements.length > 0 && (
            <div className="space-y-1 mb-2">
              <p className="text-xs font-medium text-gray-400 uppercase">Requirements:</p>
              {phase.requirements.map((req) => (
                <div key={req.id} className="flex items-center space-x-2 text-sm text-gray-300">
                  <ListChecks className="w-3 h-3 text-blue-400" />
                  <span>{req.name || 'Untitled'}</span>
                  <span className="text-xs text-gray-500">({req.requirement_type})</span>
                  {req.required_hours && <span className="text-xs text-gray-500">- {req.required_hours}h</span>}
                </div>
              ))}
            </div>
          )}

          {phase.milestones.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-400 uppercase">Milestones:</p>
              {phase.milestones.map((ms) => (
                <div key={ms.id} className="flex items-center space-x-2 text-sm text-gray-300">
                  <Flag className="w-3 h-3 text-yellow-400" />
                  <span>{ms.name || 'Untitled'}</span>
                  {ms.completion_percentage_threshold && <span className="text-xs text-gray-500">at {ms.completion_percentage_threshold}%</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ==================== Main Component ====================

const CreatePipelinePage: React.FC = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<WizardStep>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Program info state
  const [info, setInfo] = useState({
    name: '',
    description: '',
    code: '',
    target_position: '',
    structure_type: 'phases' as ProgramStructureType,
    time_limit_days: '',
    warning_days_before: '30',
    is_template: false,
  });

  // Phases state
  const [phases, setPhases] = useState<PhaseFormData[]>([]);

  // ---- Step navigation ----
  const stepIndex = WIZARD_STEPS.findIndex((s) => s.key === currentStep);

  const canGoNext = () => {
    if (currentStep === 'info') return info.name.trim().length > 0;
    return true;
  };

  const goNext = () => {
    const idx = WIZARD_STEPS.findIndex((s) => s.key === currentStep);
    if (idx < WIZARD_STEPS.length - 1) setCurrentStep(WIZARD_STEPS[idx + 1].key);
  };

  const goBack = () => {
    const idx = WIZARD_STEPS.findIndex((s) => s.key === currentStep);
    if (idx > 0) setCurrentStep(WIZARD_STEPS[idx - 1].key);
  };

  // ---- Info handlers ----
  const handleInfoChange = (field: string, value: string | boolean) => {
    setInfo((prev) => ({ ...prev, [field]: value }));
  };

  // ---- Phase handlers ----
  const addPhase = () => {
    setPhases((prev) => [...prev, emptyPhase(prev.length + 1)]);
  };

  const removePhase = (id: string) => {
    setPhases((prev) => {
      const filtered = prev.filter((p) => p.id !== id);
      return filtered.map((p, i) => ({ ...p, phase_number: i + 1 }));
    });
  };

  const updatePhase = (id: string, field: string, value: string | boolean) => {
    setPhases((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const togglePhaseExpand = (id: string) => {
    setPhases((prev) => prev.map((p) => (p.id === id ? { ...p, isExpanded: !p.isExpanded } : p)));
  };

  // ---- Requirement handlers ----
  const addRequirement = (phaseId: string) => {
    setPhases((prev) =>
      prev.map((p) =>
        p.id === phaseId
          ? { ...p, requirements: [...p.requirements, emptyRequirement(p.requirements.length + 1)] }
          : p
      )
    );
  };

  const removeRequirement = (phaseId: string, reqId: string) => {
    setPhases((prev) =>
      prev.map((p) =>
        p.id === phaseId
          ? { ...p, requirements: p.requirements.filter((r) => r.id !== reqId) }
          : p
      )
    );
  };

  const updateRequirement = (phaseId: string, reqId: string, field: string, value: string | boolean | string[]) => {
    setPhases((prev) =>
      prev.map((p) =>
        p.id === phaseId
          ? {
              ...p,
              requirements: p.requirements.map((r) =>
                r.id === reqId ? { ...r, [field]: value } : r
              ),
            }
          : p
      )
    );
  };

  // ---- Milestone handlers ----
  const addMilestone = (phaseId: string) => {
    setPhases((prev) =>
      prev.map((p) =>
        p.id === phaseId
          ? { ...p, milestones: [...p.milestones, emptyMilestone()] }
          : p
      )
    );
  };

  const removeMilestone = (phaseId: string, msId: string) => {
    setPhases((prev) =>
      prev.map((p) =>
        p.id === phaseId
          ? { ...p, milestones: p.milestones.filter((m) => m.id !== msId) }
          : p
      )
    );
  };

  const updateMilestone = (phaseId: string, msId: string, field: string, value: string) => {
    setPhases((prev) =>
      prev.map((p) =>
        p.id === phaseId
          ? {
              ...p,
              milestones: p.milestones.map((m) =>
                m.id === msId ? { ...m, [field]: value } : m
              ),
            }
          : p
      )
    );
  };

  const moveMilestone = (phaseId: string, msId: string, direction: 'up' | 'down') => {
    setPhases((prev) =>
      prev.map((p) => {
        if (p.id !== phaseId) return p;
        const idx = p.milestones.findIndex((m) => m.id === msId);
        if (idx < 0) return p;
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= p.milestones.length) return p;
        const updated = [...p.milestones];
        [updated[idx], updated[swapIdx]] = [updated[swapIdx], updated[idx]];
        return { ...p, milestones: updated };
      })
    );
  };

  // ---- Submit ----
  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      // 1. Create the program
      const program = await trainingProgramService.createProgram({
        name: info.name,
        description: info.description || undefined,
        code: info.code || undefined,
        target_position: info.target_position || undefined,
        structure_type: info.structure_type,
        time_limit_days: info.time_limit_days ? parseInt(info.time_limit_days) : undefined,
        warning_days_before: info.warning_days_before ? parseInt(info.warning_days_before) : undefined,
        is_template: info.is_template,
      });

      // 2. Create phases sequentially (they depend on program)
      for (const phaseData of phases) {
        const phase = await trainingProgramService.createProgramPhase(program.id, {
          program_id: program.id,
          phase_number: phaseData.phase_number,
          name: phaseData.name,
          description: phaseData.description || undefined,
          time_limit_days: phaseData.time_limit_days ? parseInt(phaseData.time_limit_days) : undefined,
          requires_manual_advancement: phaseData.requires_manual_advancement,
        });

        // 3. Create requirements for this phase
        for (const reqData of phaseData.requirements) {
          // First create the training requirement
          const requirement = await trainingProgramService.createRequirementEnhanced({
            name: reqData.name,
            description: reqData.description || undefined,
            requirement_type: reqData.requirement_type,
            source: 'department',
            frequency: reqData.frequency,
            required_hours: reqData.required_hours ? parseFloat(reqData.required_hours) : undefined,
            required_shifts: reqData.required_shifts ? parseInt(reqData.required_shifts) : undefined,
            required_calls: reqData.required_calls ? parseInt(reqData.required_calls) : undefined,
            passing_score: reqData.passing_score ? parseFloat(reqData.passing_score) : undefined,
            max_attempts: reqData.max_attempts ? parseInt(reqData.max_attempts) : undefined,
            checklist_items: reqData.checklist_items.filter((i) => i.trim()),
            is_editable: true,
            applies_to_all: false,
          });

          // Then link it to the program
          await trainingProgramService.addProgramRequirement(program.id, {
            program_id: program.id,
            phase_id: phase.id,
            requirement_id: requirement.id,
            is_required: reqData.is_required,
            sort_order: reqData.sort_order,
          });
        }

        // 4. Create milestones for this phase
        for (const msData of phaseData.milestones) {
          await trainingProgramService.createMilestone(program.id, {
            program_id: program.id,
            phase_id: phase.id,
            name: msData.name,
            description: msData.description || undefined,
            completion_percentage_threshold: msData.completion_percentage_threshold
              ? parseFloat(msData.completion_percentage_threshold)
              : 100,
            notification_message: msData.notification_message || undefined,
          });
        }
      }

      toast.success('Training pipeline created successfully!');
      navigate(`/training/programs/${program.id}`);
    } catch (err: unknown) {
      const errorMessage =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to create pipeline';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center space-x-4 mb-8">
          <button
            onClick={() => navigate('/training/programs')}
            className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800"
            aria-label="Back to programs"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center space-x-2">
              <GraduationCap className="w-7 h-7 text-red-500" />
              <span>Create Training Pipeline</span>
            </h1>
            <p className="text-gray-400 text-sm">Step-by-step wizard to build your training program</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center mb-8 bg-gray-800 rounded-lg p-3">
          {WIZARD_STEPS.map((step, i) => {
            const StepIcon = step.icon;
            const isActive = step.key === currentStep;
            const isComplete = i < stepIndex;

            return (
              <React.Fragment key={step.key}>
                {i > 0 && (
                  <div className={`flex-1 h-0.5 mx-2 ${isComplete ? 'bg-red-500' : 'bg-gray-600'}`} />
                )}
                <button
                  onClick={() => { if (i <= stepIndex || canGoNext()) setCurrentStep(step.key); }}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-red-600 text-white'
                      : isComplete
                      ? 'text-red-400 hover:bg-gray-700'
                      : 'text-gray-500 hover:text-gray-400'
                  }`}
                >
                  {isComplete ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <StepIcon className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Step content */}
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6 mb-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {currentStep === 'info' && <StepInfo data={info} onChange={handleInfoChange} />}
          {currentStep === 'phases' && (
            <StepPhases
              phases={phases}
              onAdd={addPhase}
              onRemove={removePhase}
              onUpdate={updatePhase}
              onToggleExpand={togglePhaseExpand}
            />
          )}
          {currentStep === 'requirements' && (
            <StepRequirements
              phases={phases}
              onAddRequirement={addRequirement}
              onRemoveRequirement={removeRequirement}
              onUpdateRequirement={updateRequirement}
            />
          )}
          {currentStep === 'milestones' && (
            <StepMilestones
              phases={phases}
              onAddMilestone={addMilestone}
              onRemoveMilestone={removeMilestone}
              onUpdateMilestone={updateMilestone}
              onMoveMilestone={moveMilestone}
            />
          )}
          {currentStep === 'review' && <StepReview info={info} phases={phases} />}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={goBack}
            disabled={stepIndex === 0}
            className="flex items-center space-x-2 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          {currentStep === 'review' ? (
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !info.name.trim()}
              className="flex items-center space-x-2 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Create Pipeline</span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={goNext}
              disabled={!canGoNext()}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              <span>Next</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </main>
    </div>
  );
};

export default CreatePipelinePage;
