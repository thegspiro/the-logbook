/**
 * Manual Shift Report Page
 *
 * Standalone page for departments that don't use the scheduling module.
 * Officers select an apparatus, enter start/end datetimes, and the page
 * auto-calculates shift hours (including shifts that span midnight).
 *
 * Only accessible when the scheduling module is disabled.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  FileText,
  Loader2,
  Search,
  User as UserIcon,
  X,
  Save,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { shiftCompletionService, trainingModuleConfigService } from '../../services/api';
import { userService } from '../../services/api';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ApparatusOption } from '../../modules/scheduling/services/api';
import { useAuthStore } from '../../stores/authStore';
import { useTimezone } from '../../hooks/useTimezone';
import { getTodayLocalDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { DEFAULT_CALL_TYPE_OPTIONS } from '../../modules/scheduling/constants/shiftReportConstants';
import { StarRating } from '../../modules/scheduling/components/StarRating';
import type { BatchShiftReportCreate, CrewMemberEvaluation, TrainingModuleConfig } from '../../types/training';
import type { User } from '../../types/user';

/** Calculate hours between two datetime strings, handling midnight crossover. */
function calculateHours(startDate: string, startTime: string, endDate: string, endTime: string): number {
  if (!startDate || !startTime || !endDate || !endTime) return 0;
  const start = new Date(`${startDate}T${startTime}`);
  const end = new Date(`${endDate}T${endTime}`);
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return 0;
  return Math.round((diffMs / 3_600_000) * 100) / 100;
}

const toggleCallType = (setter: React.Dispatch<React.SetStateAction<string[]>>, type: string) => {
  setter((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
};

interface CrewEntry {
  user_id: string;
  user_name: string;
}

export const ManualShiftReportPage: React.FC = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const tz = useTimezone();

  // Form state
  const [apparatusId, setApparatusId] = useState('');
  const [shiftDate, setShiftDate] = useState(getTodayLocalDate(tz));
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState(getTodayLocalDate(tz));
  const [endTime, setEndTime] = useState('');
  const [callsResponded, setCallsResponded] = useState(0);
  const [callTypes, setCallTypes] = useState<string[]>([]);
  const [narrative, setNarrative] = useState('');

  // Crew
  const [members, setMembers] = useState<User[]>([]);
  const [crew, setCrew] = useState<CrewEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState('');

  // Config & apparatus
  const [config, setConfig] = useState<TrainingModuleConfig | null>(null);
  const [apparatusOptions, setApparatusOptions] = useState<ApparatusOption[]>([]);
  const [loadingApparatus, setLoadingApparatus] = useState(true);

  // Evaluations
  const [traineeEvals, setTraineeEvals] = useState<Record<string, CrewMemberEvaluation>>({});
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  // Auto-calculated hours
  const calculatedHours = useMemo(
    () => calculateHours(shiftDate, startTime, endDate, endTime),
    [shiftDate, startTime, endDate, endTime]
  );

  // Load config, members, apparatus
  useEffect(() => {
    userService
      .getUsers()
      .then(setMembers)
      .catch(() => {});
    trainingModuleConfigService
      .getConfig()
      .then((cfg) => {
        setConfig(cfg);
        if (cfg.manual_entry_default_start_time) {
          setStartTime(cfg.manual_entry_default_start_time);
        }
        if (cfg.manual_entry_default_duration_hours && cfg.manual_entry_default_start_time) {
          const [h, m] = cfg.manual_entry_default_start_time.split(':').map(Number);
          const startMinutes = (h ?? 0) * 60 + (m ?? 0);
          const endMinutes = startMinutes + Math.round(cfg.manual_entry_default_duration_hours * 60);
          const endH = Math.floor(endMinutes / 60) % 24;
          const endM = endMinutes % 60;
          setEndTime(`${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`);
          if (endMinutes >= 24 * 60) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            setEndDate(tomorrow.toISOString().split('T')[0] ?? getTodayLocalDate(tz));
          }
        }
      })
      .catch(() => {});
    setLoadingApparatus(true);
    schedulingService
      .getApparatusOptions()
      .then((res) => setApparatusOptions(res.options.filter((o) => o.source !== 'default')))
      .catch(() => {})
      .finally(() => setLoadingApparatus(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter apparatus by config's allowed IDs
  const availableApparatus = useMemo(() => {
    const allowedIds = config?.manual_entry_apparatus_ids;
    if (!allowedIds || allowedIds.length === 0) return apparatusOptions;
    return apparatusOptions.filter((a) => a.id && allowedIds.includes(a.id));
  }, [apparatusOptions, config?.manual_entry_apparatus_ids]);

  const filteredMembers = useMemo(() => {
    if (memberSearch.trim().length < 2) return [];
    const q = memberSearch.toLowerCase();
    return members
      .filter((m) => {
        const name = `${m.first_name || ''} ${m.last_name || ''}`.toLowerCase();
        return (
          (name.includes(q) || (m.username || '').toLowerCase().includes(q)) &&
          !crew.some((c) => c.user_id === m.id) &&
          m.id !== user?.id
        );
      })
      .slice(0, 10);
  }, [memberSearch, members, crew, user?.id]);

  const addMember = (m: User) => {
    const name = `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.username;
    setCrew((prev) => [...prev, { user_id: m.id, user_name: name }]);
    setSelectedIds((prev) => new Set([...prev, m.id]));
    setMemberSearch('');
  };

  const removeMember = (userId: string) => {
    setCrew((prev) => prev.filter((c) => c.user_id !== userId));
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.delete(userId);
      return n;
    });
  };

  const toggleMember = (userId: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(userId)) n.delete(userId);
      else n.add(userId);
      return n;
    });
  };

  const updateEval = (userId: string, field: keyof CrewMemberEvaluation, value: unknown) => {
    setTraineeEvals((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], user_id: userId, [field]: value },
    }));
  };

  const handleSubmit = async (asDraft: boolean) => {
    if (config?.manual_entry_require_apparatus && !apparatusId) {
      toast.error('Please select an apparatus');
      return;
    }
    if (!shiftDate) {
      toast.error('Please enter a shift date');
      return;
    }
    if (!startTime || !endTime) {
      toast.error('Please enter start and end times');
      return;
    }
    if (calculatedHours <= 0) {
      toast.error('End time must be after start time');
      return;
    }
    if (selectedIds.size === 0) {
      toast.error('Please select at least one crew member');
      return;
    }

    const evaluations: CrewMemberEvaluation[] = Array.from(selectedIds)
      .map((id) => traineeEvals[id])
      .filter(
        (ev): ev is CrewMemberEvaluation =>
          !!ev && !!(ev.performance_rating || ev.areas_of_strength || ev.areas_for_improvement || ev.remarks)
      );

    const selectedApparatus = availableApparatus.find((a) => a.id === apparatusId);
    const apparatusLabel = selectedApparatus
      ? `${selectedApparatus.name}${selectedApparatus.unit_number ? ` (${selectedApparatus.unit_number})` : ''}`
      : '';

    const fullNarrative = [
      apparatusLabel ? `Apparatus: ${apparatusLabel}` : '',
      `Shift: ${shiftDate} ${startTime} — ${endDate} ${endTime}`,
      narrative,
    ]
      .filter(Boolean)
      .join('\n');

    const payload: BatchShiftReportCreate = {
      shift_date: shiftDate,
      hours_on_shift: calculatedHours,
      calls_responded: callsResponded || 0,
      ...(callTypes.length ? { call_types: callTypes } : {}),
      ...(fullNarrative.trim() ? { officer_narrative: fullNarrative.trim() } : {}),
      crew_member_ids: Array.from(selectedIds),
      ...(evaluations.length > 0 ? { trainee_evaluations: evaluations } : {}),
      save_as_draft: asDraft,
    };

    if (asDraft) setSavingDraft(true);
    else setSubmitting(true);

    try {
      const result = await shiftCompletionService.batchCreateReports(payload);
      const msg = asDraft
        ? `Saved ${result.created} draft${result.created !== 1 ? 's' : ''}`
        : `Submitted ${result.created} report${result.created !== 1 ? 's' : ''}`;
      toast.success(msg);
      void navigate('/training/admin?page=records&tab=shift-reports');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to submit reports'));
    } finally {
      setSubmitting(false);
      setSavingDraft(false);
    }
  };

  const callTypeOptions = config?.shift_review_call_types ?? DEFAULT_CALL_TYPE_OPTIONS;
  const includeTraining = config?.shift_reports_include_training ?? true;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-theme-text-primary text-xl font-bold">Log Shift Report</h1>
          <p className="text-theme-text-muted mt-1 text-sm">
            Manually log hours, calls, and evaluations for your crew.
          </p>
        </div>
        <button
          onClick={() => void navigate(-1)}
          className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border rounded-lg border px-3 py-1.5 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>

      <div className="bg-theme-surface border-theme-surface-border space-y-5 rounded-xl border p-5">
        {/* Apparatus Selection */}
        <div>
          <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
            Apparatus{config?.manual_entry_require_apparatus ? ' *' : ''}
          </label>
          {loadingApparatus ? (
            <div className="text-theme-text-muted flex items-center gap-2 py-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading apparatus...
            </div>
          ) : availableApparatus.length === 0 ? (
            <div className="text-theme-text-muted flex items-center gap-2 py-2 text-sm">
              <AlertCircle className="h-4 w-4" />
              No apparatus configured. Contact an administrator.
            </div>
          ) : (
            <select
              value={apparatusId}
              onChange={(e) => setApparatusId(e.target.value)}
              className="form-input text-sm focus:ring-violet-500"
            >
              <option value="">Select apparatus...</option>
              {availableApparatus.map((a) => (
                <option key={a.id || a.name} value={a.id || a.name}>
                  {a.name}
                  {a.unit_number ? ` (${a.unit_number})` : ''} — {a.apparatus_type}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Start Date *</label>
            <input
              type="date"
              value={shiftDate}
              onChange={(e) => {
                setShiftDate(e.target.value);
                if (!endDate || endDate < e.target.value) setEndDate(e.target.value);
              }}
              className="form-input text-sm focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Start Time *</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="form-input text-sm focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">End Date *</label>
            <input
              type="date"
              value={endDate}
              min={shiftDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="form-input text-sm focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">End Time *</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="form-input text-sm focus:ring-violet-500"
            />
          </div>
        </div>

        {/* Calculated hours display */}
        {calculatedHours > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-sm text-green-700 dark:text-green-400">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="font-medium">{calculatedHours}h</span> shift duration
            {calculatedHours > 24 && <span className="text-theme-text-muted text-xs">(multi-day shift)</span>}
          </div>
        )}

        {/* Calls */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Calls Responded</label>
            <input
              type="number"
              min="0"
              value={callsResponded || 0}
              onChange={(e) => setCallsResponded(parseInt(e.target.value) || 0)}
              className="form-input text-sm focus:ring-violet-500"
            />
          </div>
        </div>

        {/* Call Types */}
        {callTypeOptions.length > 0 && (
          <div>
            <label className="text-theme-text-secondary mb-1.5 block text-sm font-medium">Call Types</label>
            <div className="flex flex-wrap gap-1.5">
              {callTypeOptions.map((type: string) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleCallType(setCallTypes, type)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    callTypes.includes(type)
                      ? 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400'
                      : 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border hover:border-blue-500/30'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Narrative */}
        <div>
          <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Overall Shift Narrative</label>
          <textarea
            rows={3}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            placeholder="General observations about the shift for leadership review..."
            className="form-input resize-none text-sm focus:ring-violet-500"
          />
        </div>

        {/* Crew Members */}
        <div>
          <label className="text-theme-text-secondary mb-2 block text-sm font-medium">
            Crew Members
            {crew.length > 0 && (
              <span className="text-theme-text-muted ml-2 text-xs font-normal">
                ({selectedIds.size} of {crew.length} selected)
              </span>
            )}
          </label>

          <div className="relative mb-3">
            <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              type="text"
              placeholder="Search members to add..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="form-input pr-3 pl-9 text-sm focus:ring-violet-500"
            />
          </div>

          {filteredMembers.length > 0 && (
            <div className="border-theme-surface-border bg-theme-surface mb-3 max-h-40 overflow-y-auto rounded-lg border">
              {filteredMembers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => addMember(m)}
                  className="hover:bg-theme-surface-hover flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
                >
                  <UserIcon className="text-theme-text-muted h-3.5 w-3.5 shrink-0" />
                  <span>
                    {m.first_name} {m.last_name}
                  </span>
                  <span className="text-theme-text-muted text-xs">@{m.username}</span>
                </button>
              ))}
            </div>
          )}
          {memberSearch.trim().length >= 2 && filteredMembers.length === 0 && (
            <p className="text-theme-text-muted border-theme-surface-border mb-3 rounded-lg border px-3 py-2 text-xs">
              No matching members found.
            </p>
          )}

          {crew.length === 0 ? (
            <p className="text-theme-text-muted py-4 text-sm">Search and add members above.</p>
          ) : (
            <div className="space-y-2">
              {crew.map((member) => {
                const isSelected = selectedIds.has(member.user_id);
                const isExpanded = expandedMemberId === member.user_id;
                const eval_ = traineeEvals[member.user_id];

                return (
                  <div key={member.user_id} className="border-theme-surface-border rounded-lg border">
                    <div className="flex items-center gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleMember(member.user_id)}
                        className="border-theme-surface-border rounded text-violet-600 focus:ring-violet-500"
                      />
                      <span className="text-theme-text-primary flex-1 text-sm">{member.user_name}</span>
                      {includeTraining && (
                        <button
                          type="button"
                          onClick={() => setExpandedMemberId(isExpanded ? null : member.user_id)}
                          className="inline-flex items-center gap-1 text-xs text-violet-600 hover:underline dark:text-violet-400"
                        >
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          Evaluate
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeMember(member.user_id)}
                        className="text-theme-text-muted transition-colors hover:text-red-500"
                        aria-label={`Remove ${member.user_name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="border-theme-surface-border space-y-3 border-t px-4 pt-1 pb-3">
                        <div>
                          <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                            Performance Rating
                          </label>
                          <StarRating
                            value={eval_?.performance_rating || 0}
                            onChange={(v) => updateEval(member.user_id, 'performance_rating', v)}
                            size="sm"
                          />
                        </div>
                        <div>
                          <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Strengths</label>
                          <input
                            type="text"
                            value={eval_?.areas_of_strength || ''}
                            onChange={(e) => updateEval(member.user_id, 'areas_of_strength', e.target.value)}
                            className="form-input text-sm focus:ring-violet-500"
                            placeholder="Areas of strength..."
                          />
                        </div>
                        <div>
                          <label className="text-theme-text-secondary mb-1 block text-xs font-medium">
                            Areas for Improvement
                          </label>
                          <input
                            type="text"
                            value={eval_?.areas_for_improvement || ''}
                            onChange={(e) => updateEval(member.user_id, 'areas_for_improvement', e.target.value)}
                            className="form-input text-sm focus:ring-violet-500"
                            placeholder="Areas to work on..."
                          />
                        </div>
                        <div>
                          <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Remarks</label>
                          <textarea
                            rows={2}
                            value={eval_?.remarks || ''}
                            onChange={(e) => updateEval(member.user_id, 'remarks', e.target.value)}
                            className="form-input resize-none text-sm focus:ring-violet-500"
                            placeholder="Additional notes..."
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="border-theme-surface-border flex items-center gap-3 border-t pt-2">
          <button
            onClick={() => {
              void handleSubmit(true);
            }}
            disabled={savingDraft || submitting}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {savingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save as Draft
          </button>
          <button
            onClick={() => {
              void handleSubmit(false);
            }}
            disabled={submitting || savingDraft}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Submit Report{selectedIds.size > 1 ? `s (${selectedIds.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualShiftReportPage;
