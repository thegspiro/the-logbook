/**
 * Active Skill Test Page
 *
 * Mobile-optimized screen for examiners conducting skill evaluations
 * in the field. Designed for use with gloves, in bright sunlight,
 * and under time pressure.
 *
 * Key mobile UX decisions:
 * - Large touch targets (min 48px)
 * - Prominent always-visible timer at top
 * - One section at a time with swipe-like navigation
 * - Bottom-anchored action bar within thumb reach
 * - High contrast, minimal scrolling per section
 */

import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Square,
  Check,
  X,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Timer,
  Save,
  FileText,
  Calendar,
  User,
  ClipboardCheck,
  Trash2,
  Mail,
  RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { useAutoSave } from '../hooks/useAutoSave';
import { formatDateTime } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { FormStatus } from '../constants/enums';
import { hydrateTemplateSections } from '../utils/skillTemplateSections';
import type { SkillCriterion, SkillTemplateSection, CriterionResult, SectionResult } from '../types/skillsTesting';

// ==================== Timer Component ====================

const TestTimer: React.FC<{
  seconds: number;
  running: boolean;
  timeLimit?: number | undefined;
  onToggle: () => void;
}> = ({ seconds, running, timeLimit, onToggle }) => {
  const isOverTime = timeLimit != null && seconds > timeLimit;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-4 py-3 font-mono ${
        isOverTime
          ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
          : 'bg-theme-surface text-theme-text-primary'
      }`}
    >
      <button
        onClick={onToggle}
        className={`rounded-full p-3 transition-colors ${
          running ? 'bg-yellow-500 text-white hover:bg-yellow-600' : 'bg-green-500 text-white hover:bg-green-600'
        }`}
        aria-label={running ? 'Pause timer' : 'Start timer'}
      >
        {running ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </button>
      <div className="flex-1">
        <div className="text-3xl font-bold tracking-wider">
          {String(minutes).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </div>
        {timeLimit != null && (
          <div className="text-xs opacity-75">
            Limit: {Math.floor(timeLimit / 60)}:{String(timeLimit % 60).padStart(2, '0')}
          </div>
        )}
      </div>
      {isOverTime && <AlertTriangle className="h-6 w-6 animate-pulse text-red-600" />}
    </div>
  );
};

// ==================== Criterion Components ====================

const PassFailCriterion: React.FC<{
  criterion: SkillCriterion;
  result: CriterionResult | undefined;
  onChange: (result: Partial<CriterionResult>) => void;
}> = ({ criterion, result, onChange }) => (
  <div className="space-y-2">
    <div className="flex items-start gap-3">
      <div className="flex-1">
        <p className="text-theme-text-primary text-base font-medium">
          {criterion.label}
          {criterion.required && <span className="ml-1 text-sm text-red-500">(Critical)</span>}
        </p>
        {criterion.description && <p className="text-theme-text-muted mt-0.5 text-sm">{criterion.description}</p>}
      </div>
    </div>
    <div className="flex gap-3">
      <button
        onClick={() => onChange({ passed: true })}
        className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold transition-all ${
          result?.passed === true
            ? 'scale-[1.02] bg-green-600 text-white shadow-lg shadow-green-600/30'
            : 'bg-theme-surface border-theme-surface-border text-theme-text-muted border-2 hover:border-green-500'
        }`}
      >
        <Check className="h-6 w-6" />
        PASS
      </button>
      <button
        onClick={() => onChange({ passed: false })}
        className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold transition-all ${
          result?.passed === false
            ? 'scale-[1.02] bg-red-600 text-white shadow-lg shadow-red-600/30'
            : 'bg-theme-surface border-theme-surface-border text-theme-text-muted border-2 hover:border-red-500'
        }`}
      >
        <X className="h-6 w-6" />
        FAIL
      </button>
    </div>
  </div>
);

const ScoreCriterion: React.FC<{
  criterion: SkillCriterion;
  result: CriterionResult | undefined;
  onChange: (result: Partial<CriterionResult>) => void;
}> = ({ criterion, result, onChange }) => {
  const maxScore = criterion.max_score ?? 100;
  const passingScore = criterion.passing_score ?? 0;
  const currentScore = result?.score ?? 0;
  const isCritical = criterion.required;
  // Non-critical criteria always "pass" — only critical criteria can fail
  const isPassing = isCritical ? currentScore >= passingScore : true;
  const usePointButtons = maxScore <= 10;

  const handleScoreChange = (score: number) => {
    // Non-critical: always passed (score just contributes to overall %).
    // Critical: passed only when score meets the passing threshold.
    const passed = isCritical ? score >= passingScore : true;
    onChange({ score, passed });
  };

  // Non-critical uses neutral blue styling; critical uses green/red
  const scoreColor = isCritical ? (isPassing ? 'text-green-600' : 'text-red-600') : 'text-blue-600 dark:text-blue-400';

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-theme-text-primary text-base font-medium">
            {criterion.label}
            {isCritical && <span className="ml-1 text-sm text-red-500">(Critical)</span>}
          </p>
          {criterion.description && <p className="text-theme-text-muted mt-0.5 text-sm">{criterion.description}</p>}
        </div>
        <div className={`text-2xl font-bold ${scoreColor}`}>
          {currentScore}/{maxScore}
        </div>
      </div>
      {usePointButtons ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: maxScore + 1 }, (_, i) => (
            <button
              key={i}
              onClick={() => handleScoreChange(i)}
              className={`h-12 min-w-12 rounded-xl text-lg font-bold transition-all ${
                currentScore === i
                  ? isCritical
                    ? i >= passingScore
                      ? 'scale-105 bg-green-600 text-white shadow-lg shadow-green-600/30'
                      : 'scale-105 bg-red-600 text-white shadow-lg shadow-red-600/30'
                    : 'scale-105 bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                  : 'bg-theme-surface border-theme-surface-border text-theme-text-muted hover:border-theme-text-muted border-2'
              }`}
            >
              {i}
            </button>
          ))}
          {isCritical && passingScore > 0 && (
            <p className="text-theme-text-muted mt-1 w-full text-xs">Must score {passingScore}+ pts to pass</p>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <input
            type="range"
            min="0"
            max={maxScore}
            value={currentScore}
            onChange={(e) => handleScoreChange(Number(e.target.value))}
            className="h-3 w-full cursor-pointer appearance-none rounded-lg accent-red-600"
            style={{
              background: `linear-gradient(to right, ${isCritical ? (isPassing ? 'var(--status-passed)' : 'var(--status-failed)') : 'var(--accent-blue)'} ${(currentScore / maxScore) * 100}%, var(--surface-border) ${(currentScore / maxScore) * 100}%)`,
            }}
          />
          <div className="text-theme-text-muted flex justify-between text-xs">
            <span>0</span>
            {isCritical && <span className="text-yellow-600">Pass: {passingScore}</span>}
            <span>{maxScore}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const TimedCriterion: React.FC<{
  criterion: SkillCriterion;
  result: CriterionResult | undefined;
  onChange: (result: Partial<CriterionResult>) => void;
}> = ({ criterion, result, onChange }) => {
  const [localTimer, setLocalTimer] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeLimit = criterion.time_limit_seconds ?? 0;

  useEffect(() => {
    if (result?.time_seconds != null) {
      setLocalTimer(result.time_seconds);
    }
  }, [result?.time_seconds]);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setLocalTimer((prev) => {
          const next = prev + 1;
          return next;
        });
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning]);

  const handleStop = () => {
    setIsRunning(false);
    const passed = timeLimit > 0 ? localTimer <= timeLimit : true;
    onChange({ time_seconds: localTimer, passed });
  };

  const handleReset = () => {
    setIsRunning(false);
    setLocalTimer(0);
    onChange({ time_seconds: 0, passed: null });
  };

  const isOverLimit = timeLimit > 0 && localTimer > timeLimit;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-theme-text-primary text-base font-medium">
          {criterion.label}
          {criterion.required && <span className="ml-1 text-sm text-red-500">(Critical)</span>}
        </p>
        {criterion.description && <p className="text-theme-text-muted mt-0.5 text-sm">{criterion.description}</p>}
      </div>
      <div
        className={`flex items-center gap-4 rounded-xl p-4 ${isOverLimit ? 'bg-red-100 dark:bg-red-900/30' : 'bg-theme-surface border-theme-surface-border border'}`}
      >
        <div className="flex-1">
          <div className={`font-mono text-3xl font-bold ${isOverLimit ? 'text-red-600' : 'text-theme-text-primary'}`}>
            {Math.floor(localTimer / 60)}:{String(localTimer % 60).padStart(2, '0')}
          </div>
          {timeLimit > 0 && (
            <p className="text-theme-text-muted text-xs">
              Limit: {Math.floor(timeLimit / 60)}:{String(timeLimit % 60).padStart(2, '0')}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {!isRunning ? (
            <button
              onClick={() => setIsRunning(true)}
              className="rounded-full bg-green-500 p-3 text-white transition-colors hover:bg-green-600"
              aria-label="Start timer"
            >
              <Play className="h-6 w-6" />
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="rounded-full bg-red-500 p-3 text-white transition-colors hover:bg-red-600"
              aria-label="Stop timer"
            >
              <Square className="h-6 w-6" />
            </button>
          )}
          <button
            onClick={handleReset}
            className="bg-theme-surface-hover text-theme-text-muted rounded-full p-3 transition-colors"
            aria-label="Reset timer"
          >
            <Timer className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
};

const ChecklistCriterion: React.FC<{
  criterion: SkillCriterion;
  result: CriterionResult | undefined;
  onChange: (result: Partial<CriterionResult>) => void;
}> = ({ criterion, result, onChange }) => {
  const items = criterion.checklist_items ?? [];
  const completed = result?.checklist_completed ?? items.map(() => false);

  const toggleItem = (index: number) => {
    const newCompleted = [...completed];
    newCompleted[index] = !newCompleted[index];
    const allDone = newCompleted.every(Boolean);
    onChange({ checklist_completed: newCompleted, passed: allDone });
  };

  const checkedCount = completed.filter(Boolean).length;

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-theme-text-primary text-base font-medium">
            {criterion.label}
            {criterion.required && <span className="ml-1 text-sm text-red-500">(Critical)</span>}
          </p>
          {criterion.description && <p className="text-theme-text-muted mt-0.5 text-sm">{criterion.description}</p>}
        </div>
        <span className="text-theme-text-muted text-sm font-medium">
          {checkedCount}/{items.length}
        </span>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => toggleItem(i)}
            className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-all ${
              completed[i]
                ? 'border border-green-500/30 bg-green-100 dark:bg-green-900/30'
                : 'bg-theme-surface border-theme-surface-border border'
            }`}
          >
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-md border-2 transition-colors ${
                completed[i] ? 'border-green-600 bg-green-600 text-white' : 'border-theme-surface-border'
              }`}
            >
              {completed[i] && <Check className="h-4 w-4" />}
            </div>
            <span
              className={`text-sm ${completed[i] ? 'text-green-700 line-through dark:text-green-300' : 'text-theme-text-primary'}`}
            >
              {item}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

const StatementCriterion: React.FC<{
  criterion: SkillCriterion;
  result: CriterionResult | undefined;
  onChange: (result: Partial<CriterionResult>) => void;
}> = ({ criterion, onChange }) => {
  // Statements are read-only boxes for the assessor to read aloud.
  // Auto-mark as passed on first render so they don't block completion.
  useEffect(() => {
    onChange({ passed: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <p className="text-theme-text-primary text-base font-medium">{criterion.label}</p>
      </div>
      {criterion.description && <p className="text-theme-text-muted text-sm">{criterion.description}</p>}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
        <p className="mb-1.5 text-xs font-medium tracking-wide text-blue-600 uppercase dark:text-blue-400">
          Read aloud to candidate:
        </p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-blue-900 dark:text-blue-100">
          {criterion.statement_text}
        </p>
      </div>
    </div>
  );
};

// ==================== Notes Input ====================

const CriterionNotes: React.FC<{
  notes: string;
  onChange: (notes: string) => void;
}> = ({ notes, onChange }) => {
  const [isOpen, setIsOpen] = useState(Boolean(notes));

  return (
    <div className="mt-2">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 text-xs transition-colors"
        >
          <MessageSquare className="h-3 w-3" />
          Add note
        </button>
      ) : (
        <textarea
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Notes for this criterion..."
          rows={2}
          className="bg-theme-surface border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring/50 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
          autoFocus
        />
      )}
    </div>
  );
};

// ==================== Section View ====================

const SectionView: React.FC<{
  section: SkillTemplateSection;
  sectionResults: CriterionResult[];
  onUpdateCriterion: (criterionId: string, result: Partial<CriterionResult>, criterionLabel?: string) => void;
}> = ({ section, sectionResults, onUpdateCriterion }) => {
  const getResult = (criterionId: string) => sectionResults.find((r) => r.criterion_id === criterionId);

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="border-theme-surface-border border-b pb-2">
        <h2 className="text-theme-text-primary text-xl font-bold">{section.name}</h2>
        {section.description && <p className="text-theme-text-muted mt-1 text-sm">{section.description}</p>}
        <div className="mt-2 flex items-center gap-4">
          <span className="text-theme-text-muted text-xs">
            {sectionResults.filter((r) => r.passed !== null).length} / {section.criteria.length} evaluated
          </span>
          <span className="text-xs text-green-600">
            {sectionResults.filter((r) => r.passed === true).length} passed
          </span>
          <span className="text-xs text-red-600">{sectionResults.filter((r) => r.passed === false).length} failed</span>
        </div>
      </div>

      {/* Criteria */}
      {section.criteria.map((criterion) => {
        const result = getResult(criterion.id);
        return (
          <div key={criterion.id} className="border-theme-surface-border border-b pb-4 last:border-b-0">
            {criterion.type === 'pass_fail' && (
              <PassFailCriterion
                criterion={criterion}
                result={result}
                onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label)}
              />
            )}
            {criterion.type === 'score' && (
              <ScoreCriterion
                criterion={criterion}
                result={result}
                onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label)}
              />
            )}
            {criterion.type === 'time_limit' && (
              <TimedCriterion
                criterion={criterion}
                result={result}
                onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label)}
              />
            )}
            {criterion.type === 'checklist' && (
              <ChecklistCriterion
                criterion={criterion}
                result={result}
                onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label)}
              />
            )}
            {criterion.type === 'statement' && (
              <StatementCriterion
                criterion={criterion}
                result={result}
                onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label)}
              />
            )}
            <CriterionNotes
              notes={result?.notes ?? ''}
              onChange={(n) => onUpdateCriterion(criterion.id, { notes: n }, criterion.label)}
            />
          </div>
        );
      })}
    </div>
  );
};

// ==================== Completed Test Review ====================

/** Read-only display of a single criterion result */
const CriterionResultDisplay: React.FC<{
  criterion: SkillCriterion;
  result: CriterionResult | undefined;
}> = ({ criterion, result }) => {
  const passed = result?.passed;
  const isCritical = criterion.required;

  const statusBadge = () => {
    if (criterion.type === 'statement') {
      return (
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          Statement
        </span>
      );
    }
    // Non-critical score criteria show a neutral "Scored" badge — not earning
    // full points is NOT a fail, only critical steps can fail.
    if (!isCritical && criterion.type === 'score' && result?.score != null) {
      return (
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          {result.score}/{criterion.max_score ?? 100} pts
        </span>
      );
    }
    if (passed === true) {
      return (
        <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
          <Check className="h-3 w-3" /> Pass
        </span>
      );
    }
    if (passed === false) {
      return (
        <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
          <X className="h-3 w-3" /> Fail
        </span>
      );
    }
    return (
      <span className="bg-theme-surface-secondary text-theme-text-muted rounded-full px-2 py-0.5 text-xs font-medium">
        Not evaluated
      </span>
    );
  };

  return (
    <div className="flex items-start justify-between gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-theme-text-primary text-sm font-medium">
          {criterion.label}
          {isCritical && <span className="ml-1 text-xs text-red-500">(Critical)</span>}
        </p>
        {criterion.type === 'score' && result?.score != null && isCritical && (
          <p className="text-theme-text-muted mt-0.5 text-xs">
            {result.score}/{criterion.max_score ?? 100} pts
            {criterion.passing_score != null && ` (pass: ${criterion.passing_score}+)`}
          </p>
        )}
        {criterion.type === 'score' && result?.score != null && !isCritical && (
          <p className="text-theme-text-muted mt-0.5 text-xs">
            {result.score}/{criterion.max_score ?? 100} pts
          </p>
        )}
        {criterion.type === 'time_limit' && result?.time_seconds != null && (
          <p className="text-theme-text-muted mt-0.5 text-xs">
            Time: {Math.floor(result.time_seconds / 60)}:{String(result.time_seconds % 60).padStart(2, '0')}
            {criterion.time_limit_seconds != null &&
              ` / ${Math.floor(criterion.time_limit_seconds / 60)}:${String(criterion.time_limit_seconds % 60).padStart(2, '0')}`}
          </p>
        )}
        {criterion.type === 'checklist' && result?.checklist_completed && (
          <p className="text-theme-text-muted mt-0.5 text-xs">
            {result.checklist_completed.filter(Boolean).length}/{criterion.checklist_items?.length ?? 0} items completed
          </p>
        )}
        {criterion.type === 'statement' && criterion.statement_text && (
          <p className="text-theme-text-muted mt-0.5 line-clamp-2 text-xs italic">{criterion.statement_text}</p>
        )}
        {result?.notes && <p className="text-theme-text-muted mt-1 text-xs italic">&ldquo;{result.notes}&rdquo;</p>}
      </div>
      {statusBadge()}
    </div>
  );
};

/** Compute point totals for score-type criteria in a section */
function computeSectionPoints(
  criteria: SkillCriterion[],
  criteriaResults: CriterionResult[]
): { earned: number; available: number } | null {
  const scoreCriteria = criteria.filter((c) => c.type === 'score' && c.max_score != null && c.max_score > 0);
  if (scoreCriteria.length === 0) return null;

  let earned = 0;
  let available = 0;
  for (const criterion of scoreCriteria) {
    available += criterion.max_score ?? 0;
    const result = criteriaResults.find(
      (r) => r.criterion_id === criterion.id || r.criterion_label === criterion.label
    );
    if (result?.score != null) {
      earned += result.score;
    }
  }
  return { earned, available };
}

/** Review section showing results + editable notes for a completed test */
const ReviewSection: React.FC<{
  section: SkillTemplateSection;
  sectionResult: SectionResult | undefined;
  sectionNotes: string;
  onNotesChange: (notes: string) => void;
}> = ({ section, sectionResult, sectionNotes, onNotesChange }) => {
  const criteriaResults = sectionResult?.criteria_results ?? [];
  const passCount = criteriaResults.filter((r) => r.passed === true).length;
  const failCount = criteriaResults.filter((r) => r.passed === false).length;
  const nonStatementCriteria = section.criteria.filter((c) => c.type !== 'statement');
  const points = computeSectionPoints(section.criteria, criteriaResults);

  return (
    <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-xl border">
      {/* Section header */}
      <div className="border-theme-surface-border bg-theme-surface-hover/50 border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-theme-text-primary font-bold">{section.name}</h3>
          <div className="flex items-center gap-2 text-xs">
            {points && (
              <span className="text-theme-text-primary font-bold">
                {points.earned}/{points.available} pts
              </span>
            )}
            {passCount > 0 && <span className="font-medium text-green-600">{passCount} passed</span>}
            {failCount > 0 && <span className="font-medium text-red-600">{failCount} failed</span>}
            {nonStatementCriteria.length - passCount - failCount > 0 && (
              <span className="text-theme-text-muted font-medium">
                {nonStatementCriteria.length - passCount - failCount} unevaluated
              </span>
            )}
          </div>
        </div>
        {section.description && <p className="text-theme-text-muted mt-0.5 text-xs">{section.description}</p>}
      </div>

      {/* Criteria results */}
      <div className="divide-theme-surface-border divide-y px-4">
        {section.criteria.map((criterion) => {
          const result = criteriaResults.find((r) => r.criterion_id === criterion.id);
          return <CriterionResultDisplay key={criterion.id} criterion={criterion} result={result} />;
        })}
      </div>

      {/* Section notes */}
      <div className="border-theme-surface-border border-t px-4 py-3">
        <label className="text-theme-text-muted mb-1.5 flex items-center gap-1.5 text-xs font-medium">
          <FileText className="h-3 w-3" />
          Section Notes
        </label>
        <textarea
          value={sectionNotes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Add notes for this section..."
          rows={2}
          className="bg-theme-bg border-theme-surface-border text-theme-text-primary placeholder:text-theme-text-muted/50 focus:ring-theme-focus-ring/50 w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
        />
      </div>
    </div>
  );
};

/** Read-only section view for completed tests (no editable fields) */
export const ReadOnlySectionView: React.FC<{
  section: SkillTemplateSection;
  sectionResult: SectionResult | undefined;
}> = ({ section, sectionResult }) => {
  const criteriaResults = sectionResult?.criteria_results ?? [];
  // Filter out the special review-notes entry for display
  const actualCriteria = criteriaResults.filter((r) => !r.criterion_id.endsWith('-review-notes'));
  const reviewNotesEntry = criteriaResults.find((r) => r.criterion_id.endsWith('-review-notes'));
  const passCount = actualCriteria.filter((r) => r.passed === true).length;
  const failCount = actualCriteria.filter((r) => r.passed === false).length;
  const nonStatementCriteria = section.criteria.filter((c) => c.type !== 'statement');
  const points = computeSectionPoints(section.criteria, actualCriteria);

  return (
    <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-xl border">
      {/* Section header */}
      <div className="border-theme-surface-border bg-theme-surface-hover/50 border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-theme-text-primary font-bold">{section.name}</h3>
          <div className="flex items-center gap-2 text-xs">
            {points && (
              <span className="text-theme-text-primary font-bold">
                {points.earned}/{points.available} pts
              </span>
            )}
            {passCount > 0 && <span className="font-medium text-green-600">{passCount} passed</span>}
            {failCount > 0 && <span className="font-medium text-red-600">{failCount} failed</span>}
            {nonStatementCriteria.length - passCount - failCount > 0 && (
              <span className="text-theme-text-muted font-medium">
                {nonStatementCriteria.length - passCount - failCount} unevaluated
              </span>
            )}
          </div>
        </div>
        {section.description && <p className="text-theme-text-muted mt-0.5 text-xs">{section.description}</p>}
      </div>

      {/* Criteria results */}
      <div className="divide-theme-surface-border divide-y px-4">
        {section.criteria.map((criterion) => {
          const result = actualCriteria.find(
            (r) => r.criterion_id === criterion.id || r.criterion_label === criterion.label
          );
          return <CriterionResultDisplay key={criterion.id} criterion={criterion} result={result} />;
        })}
      </div>

      {/* Section review notes (read-only) */}
      {reviewNotesEntry?.notes && (
        <div className="border-theme-surface-border border-t px-4 py-3">
          <p className="text-theme-text-muted mb-1 flex items-center gap-1.5 text-xs font-medium">
            <FileText className="h-3 w-3" />
            Section Notes
          </p>
          <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{reviewNotesEntry.notes}</p>
        </div>
      )}
    </div>
  );
};

// ==================== Main Active Test Page ====================

export const ActiveSkillTestPage: React.FC = () => {
  const navigate = useNavigate();
  const { testId } = useParams<{ testId: string }>();
  const {
    currentTest,
    testLoading,
    loadTest,
    updateTest,
    completeTest,
    discardPracticeTest,
    emailTestResults,
    activeTestTimer,
    activeTestRunning,
    activeSectionIndex,
    setActiveSectionIndex,
    setActiveTestTimer,
    setActiveTestRunning,
    updateCriterionResult,
    clearCurrentTest,
  } = useSkillsTestingStore();

  const tz = useTimezone();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  // Load the test
  useEffect(() => {
    if (testId) {
      void loadTest(testId);
    }
    return () => clearCurrentTest();
  }, [testId, loadTest, clearCurrentTest]);

  // Clear per-test state when moving from one test straight to another —
  // "Retake" navigates between two test ids and every route here renders this
  // same component, so React keeps it mounted and nothing resets on its own.
  // reviewNotes is the dangerous one: it is keyed by section id, a retake uses
  // the same template, and submit merges it into section_results — so the
  // previous attempt's notes would silently land on the new attempt. Skipped on
  // first mount and on same-id navigation (completing a test routes to its own
  // detail view) so a resumed test keeps its running clock.
  const loadedTestIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previousTestId = loadedTestIdRef.current;
    loadedTestIdRef.current = testId;
    if (!previousTestId || previousTestId === testId) return;

    setReviewing(false);
    setReviewNotes({});
    setSubmitting(false);
    setActiveSectionIndex(0);
    setActiveTestTimer(0);
    setActiveTestRunning(false);
  }, [testId, setActiveSectionIndex, setActiveTestTimer, setActiveTestRunning]);

  // Return to the top whenever the visible content is swapped out underneath
  // the examiner. Moving between sections, entering review, and showing results
  // all happen without a route change, and the controls that trigger them sit
  // at the bottom of the page — so the next screen would otherwise render with
  // the window still scrolled down, below its own questions, forcing a scroll
  // back up every single time.
  const showingResults = currentTest?.status === 'completed' || currentTest?.status === 'voided';
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [activeSectionIndex, reviewing, showingResults]);

  // Global timer
  useEffect(() => {
    if (activeTestRunning) {
      timerRef.current = setInterval(() => {
        setActiveTestTimer(useSkillsTestingStore.getState().activeTestTimer + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeTestRunning, setActiveTestTimer]);

  // Restore the clock when reopening a test that was already under way. The
  // timer lives in the store, which is memory-only, so a refresh or a return
  // trip through the dashboard used to restart an in-progress evaluation at
  // 00:00 — and that reading is what gets recorded as the test's duration.
  // Runs once per test id, and never while the clock is running, so it can't
  // stamp on a live count.
  const hydratedTimerForTestRef = useRef<string | undefined>(undefined);
  const loadedTestId = currentTest?.id;
  const loadedElapsedSeconds = currentTest?.elapsed_seconds;
  useEffect(() => {
    if (!loadedTestId || hydratedTimerForTestRef.current === loadedTestId) return;
    hydratedTimerForTestRef.current = loadedTestId;

    // The running flag is read from the store rather than the render closure so
    // it stays out of the dependency list — this is a one-shot restore keyed on
    // the test, not something to redo when the examiner starts or pauses.
    if (!useSkillsTestingStore.getState().activeTestRunning && loadedElapsedSeconds) {
      setActiveTestTimer(loadedElapsedSeconds);
    }
  }, [loadedTestId, loadedElapsedSeconds, setActiveTestTimer]);

  // Hydrate template sections from the API response (must be before callbacks that reference it)
  const templateSections = hydrateTemplateSections(
    currentTest?.template_sections as Record<string, unknown>[] | undefined
  );
  const globalTimeLimit = currentTest?.template_time_limit_seconds;

  const toggleTimer = useCallback(() => {
    setActiveTestRunning(!activeTestRunning);
    if (!activeTestRunning && currentTest?.status === FormStatus.DRAFT) {
      // Start the test
      void updateTest(currentTest.id, { status: 'in_progress' });
    }
  }, [activeTestRunning, setActiveTestRunning, currentTest, updateTest]);

  const handleSaveProgress = useCallback(async () => {
    if (!currentTest) return;
    try {
      await updateTest(currentTest.id, {
        section_results: currentTest.section_results,
        elapsed_seconds: activeTestTimer,
      });
      toast.success('Progress saved');
    } catch {
      toast.error('Failed to save progress');
    }
  }, [currentTest, activeTestTimer, updateTest]);

  // Autosave. This screen is used one-handed on a phone, outdoors, often with
  // gloves — and until now it only persisted on an explicit Save or on entering
  // review. A locked screen, a dropped call, or a killed tab partway through an
  // evaluation lost every criterion scored since the examiner last thought to
  // press Save, with the candidate already dismissed.
  //
  // Silent by design: no toast. An autosave the examiner didn't ask for should
  // not interrupt them mid-evaluation, and the failure path is already covered
  // — a save that never lands leaves the work in memory, where the next manual
  // Save or Complete will report the error properly.
  const autoSavePayload = useMemo(
    () => ({
      section_results: currentTest?.section_results ?? [],
      elapsed_seconds: activeTestTimer,
    }),
    [currentTest?.section_results, activeTestTimer]
  );

  const persistAutoSave = useCallback(
    async (payload: { section_results: SectionResult[]; elapsed_seconds: number }) => {
      if (!currentTest) return;
      await updateTest(currentTest.id, payload);
    },
    [currentTest, updateTest]
  );

  useAutoSave({
    data: autoSavePayload,
    onSave: persistAutoSave,
    // Only while the evaluation is live. A completed or voided test is
    // read-only, and update_test rejects writes to it.
    enabled:
      currentTest != null && !reviewing && (currentTest.status === 'draft' || currentTest.status === 'in_progress'),
  });

  /** "Complete Test" — stops the clock, saves progress, and enters review mode */
  const handleComplete = useCallback(async () => {
    if (!currentTest) return;

    // Stop the clock immediately
    setActiveTestRunning(false);

    // Check for unevaluated criteria
    const totalCriteria = templateSections.reduce(
      (sum, s) => sum + s.criteria.filter((c) => c.type !== 'statement').length,
      0
    );
    const evaluatedCriteria = (currentTest.section_results ?? []).reduce(
      (sum, sr) => sum + sr.criteria_results.filter((cr) => cr.passed !== null && cr.passed !== undefined).length,
      0
    );
    const unevaluated = totalCriteria - evaluatedCriteria;

    if (unevaluated > 0) {
      const confirmMessage = `${unevaluated} criterion${unevaluated === 1 ? '' : 'a'} ha${unevaluated === 1 ? 's' : 've'} not been evaluated. Continue to review?`;
      if (!window.confirm(confirmMessage)) return;
    }

    try {
      // Save current state before entering review
      await updateTest(currentTest.id, {
        section_results: currentTest.section_results,
        elapsed_seconds: activeTestTimer,
      });
      setReviewing(true);
    } catch {
      toast.error('Failed to save progress');
    }
  }, [currentTest, activeTestTimer, updateTest, templateSections, setActiveTestRunning]);

  /** "Submit Test" — finalizes the test with notes from review, calculates results */
  const handleSubmit = useCallback(async () => {
    if (!currentTest) return;

    if (!window.confirm('Submit this test? Results will be finalized and cannot be changed.')) return;

    setSubmitting(true);
    try {
      // Merge review notes into section results before submitting
      const updatedSectionResults: SectionResult[] = templateSections.map((section) => {
        const existing = currentTest.section_results?.find((sr) => sr.section_id === section.id);
        const sectionNotes = reviewNotes[section.id] ?? '';
        const criteriaResults = existing?.criteria_results ?? [];

        // Append section-level review note to the first criterion's notes or store as section note
        // For now, store section notes in a special criterion entry
        const finalCriteria = [...criteriaResults];
        if (sectionNotes) {
          // Add section notes as a special entry
          const existingNoteEntry = finalCriteria.find((cr) => cr.criterion_id === `${section.id}-review-notes`);
          if (existingNoteEntry) {
            existingNoteEntry.notes = sectionNotes;
          } else {
            finalCriteria.push({
              criterion_id: `${section.id}-review-notes`,
              criterion_label: 'Section Review Notes',
              passed: null,
              notes: sectionNotes,
            });
          }
        }

        return {
          section_id: section.id,
          section_name: existing?.section_name ?? section.name,
          criteria_results: finalCriteria,
        };
      });

      // Save section results with review notes
      await updateTest(currentTest.id, {
        section_results: updatedSectionResults,
        elapsed_seconds: activeTestTimer,
      });

      // Then finalize
      const completed = await completeTest(currentTest.id);
      toast.success(`Test submitted: ${completed.result.toUpperCase()}`);
      // Leave review mode before navigating. Both the active and detail routes
      // render THIS component, so react-router swaps the URL without remounting
      // and `reviewing` would survive the transition — pinning the page on the
      // review screen even though the test is now complete.
      setReviewing(false);
      void navigate(`/training/skills-testing/test/${currentTest.id}`);
    } catch {
      toast.error('Failed to submit test');
    } finally {
      setSubmitting(false);
    }
  }, [currentTest, activeTestTimer, updateTest, completeTest, navigate, templateSections, reviewNotes]);

  /** Practice: complete the test (calculate results) but keep in review mode */
  const handlePracticeViewResults = useCallback(async () => {
    if (!currentTest) return;

    setSubmitting(true);
    try {
      // Merge review notes into section results
      const updatedSectionResults: SectionResult[] = templateSections.map((section) => {
        const existing = currentTest.section_results?.find((sr) => sr.section_id === section.id);
        const sectionNotes = reviewNotes[section.id] ?? '';
        const criteriaResults = existing?.criteria_results ?? [];
        const finalCriteria = [...criteriaResults];
        if (sectionNotes) {
          const existingNoteEntry = finalCriteria.find((cr) => cr.criterion_id === `${section.id}-review-notes`);
          if (existingNoteEntry) {
            existingNoteEntry.notes = sectionNotes;
          } else {
            finalCriteria.push({
              criterion_id: `${section.id}-review-notes`,
              criterion_label: 'Section Review Notes',
              passed: null,
              notes: sectionNotes,
            });
          }
        }
        return {
          section_id: section.id,
          section_name: existing?.section_name ?? section.name,
          criteria_results: finalCriteria,
        };
      });

      await updateTest(currentTest.id, {
        section_results: updatedSectionResults,
        elapsed_seconds: activeTestTimer,
      });
      await completeTest(currentTest.id);

      // Leaving review mode is what actually reveals the results: the completed
      // view below is gated on `!reviewing`, and navigating between the active
      // and detail routes does not remount this component (both routes render
      // it), so without this the page re-renders the identical review screen
      // and the button appears to do nothing.
      setReviewing(false);
      void navigate(`/training/skills-testing/test/${currentTest.id}`);
    } catch {
      toast.error('Failed to calculate results');
    } finally {
      setSubmitting(false);
    }
  }, [currentTest, activeTestTimer, updateTest, completeTest, navigate, templateSections, reviewNotes]);

  /** Practice: email results to candidate */
  const handleEmailResults = useCallback(async () => {
    if (!currentTest) return;
    setEmailing(true);
    try {
      const msg = await emailTestResults(currentTest.id);
      toast.success(msg);
    } catch {
      toast.error('Failed to email results');
    } finally {
      setEmailing(false);
    }
  }, [currentTest, emailTestResults]);

  /** Practice: discard and return to dashboard */
  const handleDiscardPractice = useCallback(async () => {
    if (!currentTest) return;
    if (!window.confirm('Discard this practice attempt? It will be permanently deleted.')) return;
    setDiscarding(true);
    try {
      await discardPracticeTest(currentTest.id);
      toast.success('Practice attempt discarded');
      void navigate('/training/skills-testing');
    } catch {
      toast.error('Failed to discard practice test');
    } finally {
      setDiscarding(false);
    }
  }, [currentTest, discardPracticeTest, navigate]);

  /** Practice: retake — start a new practice with same template + candidate */
  const handleRetake = useCallback(async () => {
    if (!currentTest) return;
    try {
      const newTest = await useSkillsTestingStore.getState().createTest({
        template_id: currentTest.template_id,
        candidate_id: currentTest.candidate_id,
        is_practice: true,
      });
      toast.success('New practice session started');
      void navigate(`/training/skills-testing/test/${newTest.id}/active`);
    } catch {
      toast.error('Failed to start new practice');
    }
  }, [currentTest, navigate]);

  const handleUpdateCriterion = useCallback(
    (
      sectionId: string,
      criterionId: string,
      result: Partial<CriterionResult>,
      sectionName?: string,
      criterionLabel?: string
    ) => {
      updateCriterionResult(sectionId, criterionId, result, sectionName, criterionLabel);
    },
    [updateCriterionResult]
  );

  // Loading state
  if (testLoading || !currentTest) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <div
          role="status"
          aria-live="polite"
          className="h-12 w-12 animate-spin rounded-full border-t-4 border-b-4 border-red-500"
        />
      </div>
    );
  }

  // Completed test — full detail view (read-only)
  if (currentTest.status === 'completed' && !reviewing) {
    return (
      <div className="flex min-h-screen flex-col">
        {/* Header */}
        <div className="bg-theme-surface-modal border-theme-surface-border sticky top-0 z-10 border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() =>
                void navigate(
                  currentTest.is_practice ? '/training/skills-testing' : '/training/admin?page=skills-testing&tab=tests'
                )
              }
              className="hover:bg-theme-surface-hover flex items-center gap-1 rounded-lg p-2 text-sm transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <div className="text-center">
              <p className="text-theme-text-primary text-sm font-bold">{currentTest.template_name}</p>
              <p className="text-theme-text-muted text-xs">
                {currentTest.is_practice ? 'Practice Results' : 'Test Results'}
              </p>
            </div>
            <div className="w-16" /> {/* Spacer for centering */}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Practice banner */}
          {currentTest.is_practice && (
            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-center dark:border-blue-800 dark:bg-blue-900/20">
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                Practice Attempt — Not recorded in official history
              </p>
            </div>
          )}
          {/* Result banner */}
          <div
            className={`mb-4 flex items-center gap-3 rounded-xl p-4 ${
              currentTest.result === 'pass'
                ? 'border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                : 'border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
            }`}
          >
            {currentTest.result === 'pass' ? (
              <CheckCircle2 className="h-10 w-10 shrink-0 text-green-500" />
            ) : (
              <XCircle className="h-10 w-10 shrink-0 text-red-500" />
            )}
            <div className="flex-1">
              <p
                className={`text-lg font-bold ${currentTest.result === 'pass' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}
              >
                {currentTest.result === 'pass' ? 'Passed' : 'Failed'}
              </p>
              {currentTest.overall_score != null && (
                <p
                  className={`text-sm font-medium ${currentTest.result === 'pass' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
                >
                  Overall Score: {Math.round(currentTest.overall_score)}%
                </p>
              )}
            </div>
          </div>

          {/* Test details grid */}
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-3">
              <div className="mb-1 flex items-center gap-1.5">
                <User className="text-theme-text-muted h-3 w-3" />
                <p className="text-theme-text-muted text-xs">Candidate</p>
              </div>
              <p className="text-theme-text-primary text-sm font-medium">{currentTest.candidate_name}</p>
            </div>
            <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-3">
              <div className="mb-1 flex items-center gap-1.5">
                <ClipboardCheck className="text-theme-text-muted h-3 w-3" />
                <p className="text-theme-text-muted text-xs">Examiner</p>
              </div>
              <p className="text-theme-text-primary text-sm font-medium">{currentTest.examiner_name}</p>
            </div>
            {currentTest.elapsed_seconds != null && (
              <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <Timer className="text-theme-text-muted h-3 w-3" />
                  <p className="text-theme-text-muted text-xs">Total Time</p>
                </div>
                <p className="text-theme-text-primary font-mono text-sm font-medium">
                  {Math.floor(currentTest.elapsed_seconds / 60)}:
                  {String(currentTest.elapsed_seconds % 60).padStart(2, '0')}
                </p>
              </div>
            )}
            {currentTest.completed_at && (
              <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <Calendar className="text-theme-text-muted h-3 w-3" />
                  <p className="text-theme-text-muted text-xs">Completed</p>
                </div>
                <p className="text-theme-text-primary text-sm font-medium">
                  {formatDateTime(currentTest.completed_at, tz)}
                </p>
              </div>
            )}
          </div>

          {/* Section-by-section results */}
          <div className="space-y-4">
            {templateSections.map((section) => {
              const sectionResult = currentTest.section_results?.find(
                (sr) => sr.section_id === section.id || sr.section_name === section.name
              );
              return <ReadOnlySectionView key={section.id} section={section} sectionResult={sectionResult} />;
            })}
          </div>

          {/* Test notes */}
          {currentTest.notes && (
            <div className="bg-theme-surface border-theme-surface-border mt-4 rounded-xl border p-4">
              <p className="text-theme-text-muted mb-2 flex items-center gap-1.5 text-xs font-medium">
                <FileText className="h-3 w-3" />
                Test Notes
              </p>
              <p className="text-theme-text-primary text-sm whitespace-pre-wrap">{currentTest.notes}</p>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="bg-theme-surface-modal border-theme-surface-border action-bar-safe sticky bottom-0 border-t px-4">
          {currentTest.is_practice ? (
            <div className="space-y-2">
              <button
                onClick={() => void handleEmailResults()}
                disabled={emailing}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <Mail className="h-5 w-5" />
                {emailing ? 'Sending...' : 'Email Results to Candidate'}
              </button>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  onClick={() => void handleRetake()}
                  className="bg-theme-surface flex items-center justify-center gap-2 rounded-xl border-2 border-blue-500/50 py-3 font-medium text-blue-600 transition-colors hover:border-blue-500 dark:text-blue-400"
                >
                  <RotateCcw className="h-4 w-4" />
                  Retake
                </button>
                <button
                  onClick={() => void handleDiscardPractice()}
                  disabled={discarding}
                  className="bg-theme-surface border-theme-surface-border text-theme-text-muted flex items-center justify-center gap-2 rounded-xl border-2 py-3 font-medium transition-colors hover:border-red-500 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                  {discarding ? 'Discarding...' : 'Discard'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => void navigate('/training/admin?page=skills-testing&tab=tests')}
              className="w-full rounded-xl bg-red-600 py-3 font-medium text-white transition-colors hover:bg-red-700"
            >
              Back to Tests
            </button>
          )}
        </div>
      </div>
    );
  }

  // Review screen — shown after completing evaluation, before final submission
  if (reviewing) {
    return (
      <div className="flex min-h-screen flex-col">
        {/* Review Header */}
        <div className="bg-theme-surface-modal border-theme-surface-border sticky top-0 z-10 border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setReviewing(false)}
              className="hover:bg-theme-surface-hover flex items-center gap-1 rounded-lg p-2 text-sm transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <div className="text-center">
              <p className="text-theme-text-primary text-sm font-bold">{currentTest.template_name}</p>
              <p className="text-theme-text-muted text-xs">Review &amp; Submit</p>
            </div>
            <div className="w-16" /> {/* Spacer for centering */}
          </div>
        </div>

        {/* Practice Mode Banner */}
        {currentTest.is_practice && (
          <div className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-center dark:border-blue-800 dark:bg-blue-900/20">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Practice Mode — This attempt will not be recorded
            </p>
          </div>
        )}

        {/* Review Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Summary stats */}
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-4 text-center">
              <p className="text-theme-text-muted text-xs">Candidate</p>
              <p className="text-theme-text-primary mt-1 text-sm font-bold">{currentTest.candidate_name}</p>
            </div>
            <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-4 text-center">
              <p className="text-theme-text-muted text-xs">Total Time</p>
              <p className="text-theme-text-primary mt-1 font-mono text-sm font-bold">
                {Math.floor(activeTestTimer / 60)}:{String(activeTestTimer % 60).padStart(2, '0')}
              </p>
            </div>
          </div>

          {/* Sections with results and notes */}
          <div className="space-y-4">
            {templateSections.map((section) => {
              const sectionResult = currentTest.section_results?.find((sr) => sr.section_id === section.id);
              return (
                <ReviewSection
                  key={section.id}
                  section={section}
                  sectionResult={sectionResult}
                  sectionNotes={reviewNotes[section.id] ?? ''}
                  onNotesChange={(notes) => setReviewNotes((prev) => ({ ...prev, [section.id]: notes }))}
                />
              );
            })}
          </div>
        </div>

        {/* Action Bar */}
        <div className="bg-theme-surface-modal border-theme-surface-border action-bar-safe sticky bottom-0 border-t px-4">
          {currentTest.is_practice ? (
            <div className="space-y-2">
              <button
                onClick={() => void handlePracticeViewResults()}
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                <ClipboardCheck className="h-5 w-5" />
                {submitting ? 'Calculating...' : 'View Results'}
              </button>
              <button
                onClick={() => void handleDiscardPractice()}
                disabled={discarding}
                className="bg-theme-surface border-theme-surface-border text-theme-text-muted flex w-full items-center justify-center gap-2 rounded-xl border-2 py-3 font-medium transition-colors hover:border-red-500 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
                {discarding ? 'Discarding...' : 'Discard & Return'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-4 text-lg font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              <Save className="h-5 w-5" />
              {submitting ? 'Submitting...' : 'Submit Test'}
            </button>
          )}
        </div>
      </div>
    );
  }

  const currentSection = templateSections[activeSectionIndex];
  const currentSectionResults =
    currentTest.section_results?.find((s) => currentSection && s.section_id === currentSection.id)?.criteria_results ??
    [];

  const canGoBack = activeSectionIndex > 0;
  const canGoForward = activeSectionIndex < templateSections.length - 1;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top Bar */}
      <div className="bg-theme-surface-modal border-theme-surface-border sticky top-0 z-10 border-b px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            onClick={() => void navigate('/training/admin?page=skills-testing&tab=tests')}
            className="hover:bg-theme-surface-hover rounded-lg p-2 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="text-center">
            <p className="text-theme-text-primary text-sm font-bold">{currentTest.template_name}</p>
            <p className="text-theme-text-muted text-xs">
              Section {activeSectionIndex + 1} of {templateSections.length}
            </p>
          </div>
          <button
            onClick={() => void handleSaveProgress()}
            className="bg-theme-surface border-theme-surface-border rounded-lg border px-3 py-1.5 text-xs font-medium"
          >
            Save
          </button>
        </div>
        <TestTimer
          seconds={activeTestTimer}
          running={activeTestRunning}
          timeLimit={globalTimeLimit}
          onToggle={toggleTimer}
        />

        {/* Section Progress Dots */}
        <div className="mt-2 flex justify-center gap-1.5">
          {templateSections.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveSectionIndex(i)}
              className={`h-2.5 w-2.5 rounded-full transition-colors ${
                i === activeSectionIndex ? 'bg-red-600' : 'bg-theme-surface-border hover:bg-theme-text-muted'
              }`}
              aria-label={`Go to section ${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Practice Mode Banner */}
      {currentTest.is_practice && (
        <div className="border-b border-blue-200 bg-blue-50 px-4 py-2 text-center dark:border-blue-800 dark:bg-blue-900/20">
          <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
            Practice Mode — This attempt will not be recorded
          </p>
        </div>
      )}

      {/* Section Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {currentSection && (
          <SectionView
            section={currentSection}
            sectionResults={currentSectionResults}
            onUpdateCriterion={(criterionId, result, criterionLabel) =>
              handleUpdateCriterion(currentSection.id, criterionId, result, currentSection.name, criterionLabel)
            }
          />
        )}
      </div>

      {/* Bottom Navigation Bar */}
      <div className="bg-theme-surface-modal border-theme-surface-border action-bar-safe sticky bottom-0 border-t px-4">
        <div className="flex gap-3">
          <button
            onClick={() => setActiveSectionIndex(activeSectionIndex - 1)}
            disabled={!canGoBack}
            className="bg-theme-surface border-theme-surface-border flex items-center justify-center gap-1 rounded-xl border px-4 py-3 font-medium transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
            Prev
          </button>
          <button
            onClick={() => void handleComplete()}
            className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white transition-colors hover:bg-red-700"
          >
            Complete Test
          </button>
          <button
            onClick={() => setActiveSectionIndex(activeSectionIndex + 1)}
            disabled={!canGoForward}
            className="bg-theme-surface border-theme-surface-border flex items-center justify-center gap-1 rounded-xl border px-4 py-3 font-medium transition-colors disabled:opacity-30"
          >
            Next
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActiveSkillTestPage;
