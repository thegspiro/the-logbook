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

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { formatDateTime } from '../utils/dateFormatting';
import type {
  SkillCriterion,
  SkillTemplateSection,
  CriterionResult,
  SectionResult,
} from '../types/skillsTesting';

// ==================== Helpers ====================

/**
 * Hydrate raw template section JSON (from the API) with stable generated IDs.
 * The backend stores sections/criteria without IDs, so we generate
 * deterministic IDs based on section/criterion indices.
 */
function hydrateTemplateSections(
  raw: Record<string, unknown>[] | undefined | null
): SkillTemplateSection[] {
  if (!raw) return [];
  return raw.map((section, si) => {
    const criteria = (section.criteria as Record<string, unknown>[] | undefined) ?? [];
    return {
      id: `section-${si}`,
      name: (section.name as string) ?? `Section ${si + 1}`,
      description: section.description as string | undefined,
      sort_order: (section.sort_order as number) ?? si,
      criteria: criteria.map((c, ci) => ({
        id: `criterion-${si}-${ci}`,
        label: (c.label as string) ?? `Criterion ${ci + 1}`,
        description: c.description as string | undefined,
        type: (c.type as SkillCriterion['type']) ?? 'pass_fail',
        required: (c.required as boolean) ?? false,
        sort_order: (c.sort_order as number) ?? ci,
        passing_score: c.passing_score as number | undefined,
        max_score: c.max_score as number | undefined,
        time_limit_seconds: c.time_limit_seconds as number | undefined,
        checklist_items: c.checklist_items as string[] | undefined,
        statement_text: c.statement_text as string | undefined,
      })),
    };
  });
}

// ==================== Timer Component ====================

const TestTimer: React.FC<{
  seconds: number;
  running: boolean;
  timeLimit?: number;
  onToggle: () => void;
}> = ({ seconds, running, timeLimit, onToggle }) => {
  const isOverTime = timeLimit != null && seconds > timeLimit;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl font-mono ${
      isOverTime
        ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
        : 'bg-theme-surface text-theme-text-primary'
    }`}>
      <button
        onClick={onToggle}
        className={`p-3 rounded-full transition-colors ${
          running
            ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
            : 'bg-green-500 hover:bg-green-600 text-white'
        }`}
        aria-label={running ? 'Pause timer' : 'Start timer'}
      >
        {running ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
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
      {isOverTime && (
        <AlertTriangle className="w-6 h-6 text-red-600 animate-pulse" />
      )}
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
        <p className="font-medium text-theme-text-primary text-base">
          {criterion.label}
          {criterion.required && <span className="ml-1 text-red-500 text-sm">(Critical)</span>}
        </p>
        {criterion.description && (
          <p className="text-sm text-theme-text-muted mt-0.5">{criterion.description}</p>
        )}
      </div>
    </div>
    <div className="flex gap-3">
      <button
        onClick={() => onChange({ passed: true })}
        className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl text-lg font-bold transition-all ${
          result?.passed === true
            ? 'bg-green-600 text-white shadow-lg shadow-green-600/30 scale-[1.02]'
            : 'bg-theme-surface border-2 border-theme-surface-border text-theme-text-muted hover:border-green-500'
        }`}
      >
        <Check className="w-6 h-6" />
        PASS
      </button>
      <button
        onClick={() => onChange({ passed: false })}
        className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl text-lg font-bold transition-all ${
          result?.passed === false
            ? 'bg-red-600 text-white shadow-lg shadow-red-600/30 scale-[1.02]'
            : 'bg-theme-surface border-2 border-theme-surface-border text-theme-text-muted hover:border-red-500'
        }`}
      >
        <X className="w-6 h-6" />
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
  const scoreColor = isCritical
    ? isPassing ? 'text-green-600' : 'text-red-600'
    : 'text-blue-600 dark:text-blue-400';

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-theme-text-primary text-base">
            {criterion.label}
            {isCritical && <span className="ml-1 text-red-500 text-sm">(Critical)</span>}
          </p>
          {criterion.description && (
            <p className="text-sm text-theme-text-muted mt-0.5">{criterion.description}</p>
          )}
        </div>
        <div className={`text-2xl font-bold ${scoreColor}`}>
          {currentScore}/{maxScore}
        </div>
      </div>
      {usePointButtons ? (
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: maxScore + 1 }, (_, i) => (
            <button
              key={i}
              onClick={() => handleScoreChange(i)}
              className={`min-w-[3rem] h-12 rounded-xl text-lg font-bold transition-all ${
                currentScore === i
                  ? isCritical
                    ? i >= passingScore
                      ? 'bg-green-600 text-white shadow-lg shadow-green-600/30 scale-105'
                      : 'bg-red-600 text-white shadow-lg shadow-red-600/30 scale-105'
                    : 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 scale-105'
                  : 'bg-theme-surface border-2 border-theme-surface-border text-theme-text-muted hover:border-theme-text-muted'
              }`}
            >
              {i}
            </button>
          ))}
          {isCritical && passingScore > 0 && (
            <p className="w-full text-xs text-theme-text-muted mt-1">
              Must score {passingScore}+ pts to pass
            </p>
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
            className="w-full h-3 rounded-lg appearance-none cursor-pointer accent-red-600"
            style={{ background: `linear-gradient(to right, ${isCritical ? (isPassing ? '#16a34a' : '#dc2626') : '#2563eb'} ${(currentScore / maxScore) * 100}%, var(--surface-border) ${(currentScore / maxScore) * 100}%)` }}
          />
          <div className="flex justify-between text-xs text-theme-text-muted">
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
        <p className="font-medium text-theme-text-primary text-base">
          {criterion.label}
          {criterion.required && <span className="ml-1 text-red-500 text-sm">(Critical)</span>}
        </p>
        {criterion.description && (
          <p className="text-sm text-theme-text-muted mt-0.5">{criterion.description}</p>
        )}
      </div>
      <div className={`flex items-center gap-4 p-4 rounded-xl ${isOverLimit ? 'bg-red-100 dark:bg-red-900/30' : 'bg-theme-surface border border-theme-surface-border'}`}>
        <div className="flex-1">
          <div className={`text-3xl font-mono font-bold ${isOverLimit ? 'text-red-600' : 'text-theme-text-primary'}`}>
            {Math.floor(localTimer / 60)}:{String(localTimer % 60).padStart(2, '0')}
          </div>
          {timeLimit > 0 && (
            <p className="text-xs text-theme-text-muted">
              Limit: {Math.floor(timeLimit / 60)}:{String(timeLimit % 60).padStart(2, '0')}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {!isRunning ? (
            <button
              onClick={() => setIsRunning(true)}
              className="p-3 rounded-full bg-green-500 hover:bg-green-600 text-white transition-colors"
              aria-label="Start timer"
            >
              <Play className="w-6 h-6" />
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="p-3 rounded-full bg-red-500 hover:bg-red-600 text-white transition-colors"
              aria-label="Stop timer"
            >
              <Square className="w-6 h-6" />
            </button>
          )}
          <button
            onClick={handleReset}
            className="p-3 rounded-full bg-theme-surface-hover text-theme-text-muted transition-colors"
            aria-label="Reset timer"
          >
            <Timer className="w-6 h-6" />
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
          <p className="font-medium text-theme-text-primary text-base">
            {criterion.label}
            {criterion.required && <span className="ml-1 text-red-500 text-sm">(Critical)</span>}
          </p>
          {criterion.description && (
            <p className="text-sm text-theme-text-muted mt-0.5">{criterion.description}</p>
          )}
        </div>
        <span className="text-sm font-medium text-theme-text-muted">
          {checkedCount}/{items.length}
        </span>
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => toggleItem(i)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all ${
              completed[i]
                ? 'bg-green-100 dark:bg-green-900/30 border border-green-500/30'
                : 'bg-theme-surface border border-theme-surface-border'
            }`}
          >
            <div className={`w-6 h-6 rounded-md flex items-center justify-center border-2 transition-colors ${
              completed[i]
                ? 'bg-green-600 border-green-600 text-white'
                : 'border-theme-surface-border'
            }`}>
              {completed[i] && <Check className="w-4 h-4" />}
            </div>
            <span className={`text-sm ${completed[i] ? 'text-green-700 dark:text-green-300 line-through' : 'text-theme-text-primary'}`}>
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
        <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <p className="font-medium text-theme-text-primary text-base">
          {criterion.label}
        </p>
      </div>
      {criterion.description && (
        <p className="text-sm text-theme-text-muted">{criterion.description}</p>
      )}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-1.5">
          Read aloud to candidate:
        </p>
        <p className="text-sm text-blue-900 dark:text-blue-100 whitespace-pre-wrap leading-relaxed">
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
          className="flex items-center gap-1 text-xs text-theme-text-muted hover:text-theme-text-primary transition-colors"
        >
          <MessageSquare className="w-3 h-3" />
          Add note
        </button>
      ) : (
        <textarea
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Notes for this criterion..."
          rows={2}
          className="w-full px-3 py-2 text-sm bg-theme-surface border border-theme-surface-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
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
  const getResult = (criterionId: string) =>
    sectionResults.find((r) => r.criterion_id === criterionId);

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="pb-2 border-b border-theme-surface-border">
        <h2 className="text-xl font-bold text-theme-text-primary">{section.name}</h2>
        {section.description && (
          <p className="text-sm text-theme-text-muted mt-1">{section.description}</p>
        )}
        <div className="flex items-center gap-4 mt-2">
          <span className="text-xs text-theme-text-muted">
            {sectionResults.filter((r) => r.passed !== null).length} / {section.criteria.length} evaluated
          </span>
          <span className="text-xs text-green-600">
            {sectionResults.filter((r) => r.passed === true).length} passed
          </span>
          <span className="text-xs text-red-600">
            {sectionResults.filter((r) => r.passed === false).length} failed
          </span>
        </div>
      </div>

      {/* Criteria */}
      {section.criteria.map((criterion) => {
        const result = getResult(criterion.id);
        return (
          <div key={criterion.id} className="pb-4 border-b border-theme-surface-border last:border-b-0">
            {criterion.type === 'pass_fail' && (
              <PassFailCriterion criterion={criterion} result={result} onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label)} />
            )}
            {criterion.type === 'score' && (
              <ScoreCriterion criterion={criterion} result={result} onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label)} />
            )}
            {criterion.type === 'time_limit' && (
              <TimedCriterion criterion={criterion} result={result} onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label)} />
            )}
            {criterion.type === 'checklist' && (
              <ChecklistCriterion criterion={criterion} result={result} onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label)} />
            )}
            {criterion.type === 'statement' && (
              <StatementCriterion criterion={criterion} result={result} onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label)} />
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
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Statement</span>
      );
    }
    // Non-critical score criteria show a neutral "Scored" badge — not earning
    // full points is NOT a fail, only critical steps can fail.
    if (!isCritical && criterion.type === 'score' && result?.score != null) {
      return (
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
          {result.score}/{criterion.max_score ?? 100} pts
        </span>
      );
    }
    if (passed === true) {
      return (
        <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
          <Check className="w-3 h-3" /> Pass
        </span>
      );
    }
    if (passed === false) {
      return (
        <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
          <X className="w-3 h-3" /> Fail
        </span>
      );
    }
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">Not evaluated</span>
    );
  };

  return (
    <div className="flex items-start justify-between gap-2 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-theme-text-primary">
          {criterion.label}
          {isCritical && <span className="ml-1 text-red-500 text-xs">(Critical)</span>}
        </p>
        {criterion.type === 'score' && result?.score != null && isCritical && (
          <p className="text-xs text-theme-text-muted mt-0.5">
            {result.score}/{criterion.max_score ?? 100} pts
            {criterion.passing_score != null && ` (pass: ${criterion.passing_score}+)`}
          </p>
        )}
        {criterion.type === 'score' && result?.score != null && !isCritical && (
          <p className="text-xs text-theme-text-muted mt-0.5">
            {result.score}/{criterion.max_score ?? 100} pts
          </p>
        )}
        {criterion.type === 'time_limit' && result?.time_seconds != null && (
          <p className="text-xs text-theme-text-muted mt-0.5">
            Time: {Math.floor(result.time_seconds / 60)}:{String(result.time_seconds % 60).padStart(2, '0')}
            {criterion.time_limit_seconds != null && ` / ${Math.floor(criterion.time_limit_seconds / 60)}:${String(criterion.time_limit_seconds % 60).padStart(2, '0')}`}
          </p>
        )}
        {criterion.type === 'checklist' && result?.checklist_completed && (
          <p className="text-xs text-theme-text-muted mt-0.5">
            {result.checklist_completed.filter(Boolean).length}/{criterion.checklist_items?.length ?? 0} items completed
          </p>
        )}
        {criterion.type === 'statement' && criterion.statement_text && (
          <p className="text-xs text-theme-text-muted mt-0.5 italic line-clamp-2">
            {criterion.statement_text}
          </p>
        )}
        {result?.notes && (
          <p className="text-xs text-theme-text-muted mt-1 italic">&ldquo;{result.notes}&rdquo;</p>
        )}
      </div>
      {statusBadge()}
    </div>
  );
};

/** Compute point totals for score-type criteria in a section */
function computeSectionPoints(
  criteria: SkillCriterion[],
  criteriaResults: CriterionResult[],
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
    <div className="bg-theme-surface rounded-xl border border-theme-surface-border overflow-hidden">
      {/* Section header */}
      <div className="px-4 py-3 border-b border-theme-surface-border bg-theme-surface-hover/50">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-theme-text-primary">{section.name}</h3>
          <div className="flex items-center gap-2 text-xs">
            {points && (
              <span className="font-bold text-theme-text-primary">
                {points.earned}/{points.available} pts
              </span>
            )}
            {passCount > 0 && (
              <span className="text-green-600 font-medium">{passCount} passed</span>
            )}
            {failCount > 0 && (
              <span className="text-red-600 font-medium">{failCount} failed</span>
            )}
            {nonStatementCriteria.length - passCount - failCount > 0 && (
              <span className="text-gray-500 font-medium">
                {nonStatementCriteria.length - passCount - failCount} unevaluated
              </span>
            )}
          </div>
        </div>
        {section.description && (
          <p className="text-xs text-theme-text-muted mt-0.5">{section.description}</p>
        )}
      </div>

      {/* Criteria results */}
      <div className="px-4 divide-y divide-theme-surface-border">
        {section.criteria.map((criterion) => {
          const result = criteriaResults.find((r) => r.criterion_id === criterion.id);
          return (
            <CriterionResultDisplay
              key={criterion.id}
              criterion={criterion}
              result={result}
            />
          );
        })}
      </div>

      {/* Section notes */}
      <div className="px-4 py-3 border-t border-theme-surface-border">
        <label className="flex items-center gap-1.5 text-xs font-medium text-theme-text-muted mb-1.5">
          <FileText className="w-3 h-3" />
          Section Notes
        </label>
        <textarea
          value={sectionNotes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Add notes for this section..."
          rows={2}
          className="w-full px-3 py-2 text-sm bg-theme-bg border border-theme-surface-border rounded-lg text-theme-text-primary placeholder:text-theme-text-muted/50 focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
        />
      </div>
    </div>
  );
};

/** Read-only section view for completed tests (no editable fields) */
const ReadOnlySectionView: React.FC<{
  section: SkillTemplateSection;
  sectionResult: SectionResult | undefined;
}> = ({ section, sectionResult }) => {
  const criteriaResults = sectionResult?.criteria_results ?? [];
  // Filter out the special review-notes entry for display
  const actualCriteria = criteriaResults.filter(
    (r) => !r.criterion_id.endsWith('-review-notes')
  );
  const reviewNotesEntry = criteriaResults.find(
    (r) => r.criterion_id.endsWith('-review-notes')
  );
  const passCount = actualCriteria.filter((r) => r.passed === true).length;
  const failCount = actualCriteria.filter((r) => r.passed === false).length;
  const nonStatementCriteria = section.criteria.filter((c) => c.type !== 'statement');
  const points = computeSectionPoints(section.criteria, actualCriteria);

  return (
    <div className="bg-theme-surface rounded-xl border border-theme-surface-border overflow-hidden">
      {/* Section header */}
      <div className="px-4 py-3 border-b border-theme-surface-border bg-theme-surface-hover/50">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-theme-text-primary">{section.name}</h3>
          <div className="flex items-center gap-2 text-xs">
            {points && (
              <span className="font-bold text-theme-text-primary">
                {points.earned}/{points.available} pts
              </span>
            )}
            {passCount > 0 && (
              <span className="text-green-600 font-medium">{passCount} passed</span>
            )}
            {failCount > 0 && (
              <span className="text-red-600 font-medium">{failCount} failed</span>
            )}
            {nonStatementCriteria.length - passCount - failCount > 0 && (
              <span className="text-gray-500 font-medium">
                {nonStatementCriteria.length - passCount - failCount} unevaluated
              </span>
            )}
          </div>
        </div>
        {section.description && (
          <p className="text-xs text-theme-text-muted mt-0.5">{section.description}</p>
        )}
      </div>

      {/* Criteria results */}
      <div className="px-4 divide-y divide-theme-surface-border">
        {section.criteria.map((criterion) => {
          const result = actualCriteria.find(
            (r) => r.criterion_id === criterion.id || r.criterion_label === criterion.label
          );
          return (
            <CriterionResultDisplay
              key={criterion.id}
              criterion={criterion}
              result={result}
            />
          );
        })}
      </div>

      {/* Section review notes (read-only) */}
      {reviewNotesEntry?.notes && (
        <div className="px-4 py-3 border-t border-theme-surface-border">
          <p className="flex items-center gap-1.5 text-xs font-medium text-theme-text-muted mb-1">
            <FileText className="w-3 h-3" />
            Section Notes
          </p>
          <p className="text-sm text-theme-text-primary whitespace-pre-wrap">
            {reviewNotesEntry.notes}
          </p>
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

  // Hydrate template sections from the API response (must be before callbacks that reference it)
  const templateSections = hydrateTemplateSections(
    currentTest?.template_sections as Record<string, unknown>[] | undefined
  );
  const globalTimeLimit = currentTest?.template_time_limit_seconds;

  const toggleTimer = useCallback(() => {
    setActiveTestRunning(!activeTestRunning);
    if (!activeTestRunning && currentTest?.status === 'draft') {
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
      navigate(`/training/skills-testing/test/${currentTest.id}`);
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

      // Navigate to the completed view within this same page
      navigate(`/training/skills-testing/test/${currentTest.id}`);
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
      navigate('/training/skills-testing');
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
      navigate(`/training/skills-testing/test/${newTest.id}/active`);
    } catch {
      toast.error('Failed to start new practice');
    }
  }, [currentTest, navigate]);

  const handleUpdateCriterion = useCallback((
    sectionId: string,
    criterionId: string,
    result: Partial<CriterionResult>,
    sectionName?: string,
    criterionLabel?: string,
  ) => {
    updateCriterionResult(sectionId, criterionId, result, sectionName, criterionLabel);
  }, [updateCriterionResult]);

  // Loading state
  if (testLoading || !currentTest) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-red-500" />
      </div>
    );
  }

  // Completed test — full detail view (read-only)
  if (currentTest.status === 'completed' && !reviewing) {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-theme-surface/95 backdrop-blur-sm border-b border-theme-surface-border px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate(currentTest.is_practice ? '/training/skills-testing' : '/training/admin?page=skills-testing&tab=tests')}
              className="flex items-center gap-1 p-2 rounded-lg hover:bg-theme-surface-hover transition-colors text-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            <div className="text-center">
              <p className="font-bold text-theme-text-primary text-sm">{currentTest.template_name}</p>
              <p className="text-xs text-theme-text-muted">{currentTest.is_practice ? 'Practice Results' : 'Test Results'}</p>
            </div>
            <div className="w-16" /> {/* Spacer for centering */}
          </div>
        </div>

        <div className="flex-1 px-4 py-4 overflow-y-auto">
          {/* Practice banner */}
          {currentTest.is_practice && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-3 mb-4 text-center">
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                Practice Attempt — Not recorded in official history
              </p>
            </div>
          )}
          {/* Result banner */}
          <div className={`flex items-center gap-3 p-4 rounded-xl mb-4 ${
            currentTest.result === 'pass'
              ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
          }`}>
            {currentTest.result === 'pass' ? (
              <CheckCircle2 className="w-10 h-10 text-green-500 flex-shrink-0" />
            ) : (
              <XCircle className="w-10 h-10 text-red-500 flex-shrink-0" />
            )}
            <div className="flex-1">
              <p className={`text-lg font-bold ${currentTest.result === 'pass' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                {currentTest.result === 'pass' ? 'Passed' : 'Failed'}
              </p>
              {currentTest.overall_score != null && (
                <p className={`text-sm font-medium ${currentTest.result === 'pass' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  Overall Score: {Math.round(currentTest.overall_score)}%
                </p>
              )}
            </div>
          </div>

          {/* Test details grid */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-theme-surface rounded-xl p-3 border border-theme-surface-border">
              <div className="flex items-center gap-1.5 mb-1">
                <User className="w-3 h-3 text-theme-text-muted" />
                <p className="text-xs text-theme-text-muted">Candidate</p>
              </div>
              <p className="font-medium text-theme-text-primary text-sm">{currentTest.candidate_name}</p>
            </div>
            <div className="bg-theme-surface rounded-xl p-3 border border-theme-surface-border">
              <div className="flex items-center gap-1.5 mb-1">
                <ClipboardCheck className="w-3 h-3 text-theme-text-muted" />
                <p className="text-xs text-theme-text-muted">Examiner</p>
              </div>
              <p className="font-medium text-theme-text-primary text-sm">{currentTest.examiner_name}</p>
            </div>
            {currentTest.elapsed_seconds != null && (
              <div className="bg-theme-surface rounded-xl p-3 border border-theme-surface-border">
                <div className="flex items-center gap-1.5 mb-1">
                  <Timer className="w-3 h-3 text-theme-text-muted" />
                  <p className="text-xs text-theme-text-muted">Total Time</p>
                </div>
                <p className="font-medium font-mono text-theme-text-primary text-sm">
                  {Math.floor(currentTest.elapsed_seconds / 60)}:{String(currentTest.elapsed_seconds % 60).padStart(2, '0')}
                </p>
              </div>
            )}
            {currentTest.completed_at && (
              <div className="bg-theme-surface rounded-xl p-3 border border-theme-surface-border">
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar className="w-3 h-3 text-theme-text-muted" />
                  <p className="text-xs text-theme-text-muted">Completed</p>
                </div>
                <p className="font-medium text-theme-text-primary text-sm">
                  {formatDateTime(currentTest.completed_at)}
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
              return (
                <ReadOnlySectionView
                  key={section.id}
                  section={section}
                  sectionResult={sectionResult}
                />
              );
            })}
          </div>

          {/* Test notes */}
          {currentTest.notes && (
            <div className="bg-theme-surface rounded-xl border border-theme-surface-border p-4 mt-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-theme-text-muted mb-2">
                <FileText className="w-3 h-3" />
                Test Notes
              </p>
              <p className="text-sm text-theme-text-primary whitespace-pre-wrap">{currentTest.notes}</p>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="sticky bottom-0 bg-theme-surface/95 backdrop-blur-sm border-t border-theme-surface-border px-4 py-3 safe-area-inset-bottom">
          {currentTest.is_practice ? (
            <div className="space-y-2">
              <button
                onClick={() => void handleEmailResults()}
                disabled={emailing}
                className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold transition-colors"
              >
                <Mail className="w-5 h-5" />
                {emailing ? 'Sending...' : 'Email Results to Candidate'}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => void handleRetake()}
                  className="flex items-center justify-center gap-2 py-3 bg-theme-surface border-2 border-blue-500/50 hover:border-blue-500 text-blue-600 dark:text-blue-400 rounded-xl font-medium transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Retake
                </button>
                <button
                  onClick={() => void handleDiscardPractice()}
                  disabled={discarding}
                  className="flex items-center justify-center gap-2 py-3 bg-theme-surface border-2 border-theme-surface-border hover:border-red-500 text-theme-text-muted hover:text-red-600 rounded-xl font-medium transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  {discarding ? 'Discarding...' : 'Discard'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => navigate('/training/admin?page=skills-testing&tab=tests')}
              className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors"
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
      <div className="min-h-screen flex flex-col">
        {/* Review Header */}
        <div className="sticky top-0 z-10 bg-theme-surface/95 backdrop-blur-sm border-b border-theme-surface-border px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setReviewing(false)}
              className="flex items-center gap-1 p-2 rounded-lg hover:bg-theme-surface-hover transition-colors text-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            <div className="text-center">
              <p className="font-bold text-theme-text-primary text-sm">{currentTest.template_name}</p>
              <p className="text-xs text-theme-text-muted">Review &amp; Submit</p>
            </div>
            <div className="w-16" /> {/* Spacer for centering */}
          </div>
        </div>

        {/* Practice Mode Banner */}
        {currentTest.is_practice && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-4 py-2 text-center">
            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Practice Mode — This attempt will not be recorded
            </p>
          </div>
        )}

        {/* Review Content */}
        <div className="flex-1 px-4 py-4 overflow-y-auto">
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-theme-surface rounded-xl p-4 border border-theme-surface-border text-center">
              <p className="text-xs text-theme-text-muted">Candidate</p>
              <p className="font-bold text-theme-text-primary text-sm mt-1">{currentTest.candidate_name}</p>
            </div>
            <div className="bg-theme-surface rounded-xl p-4 border border-theme-surface-border text-center">
              <p className="text-xs text-theme-text-muted">Total Time</p>
              <p className="font-bold font-mono text-theme-text-primary text-sm mt-1">
                {Math.floor(activeTestTimer / 60)}:{String(activeTestTimer % 60).padStart(2, '0')}
              </p>
            </div>
          </div>

          {/* Sections with results and notes */}
          <div className="space-y-4">
            {templateSections.map((section) => {
              const sectionResult = currentTest.section_results?.find(
                (sr) => sr.section_id === section.id
              );
              return (
                <ReviewSection
                  key={section.id}
                  section={section}
                  sectionResult={sectionResult}
                  sectionNotes={reviewNotes[section.id] ?? ''}
                  onNotesChange={(notes) =>
                    setReviewNotes((prev) => ({ ...prev, [section.id]: notes }))
                  }
                />
              );
            })}
          </div>
        </div>

        {/* Action Bar */}
        <div className="sticky bottom-0 bg-theme-surface/95 backdrop-blur-sm border-t border-theme-surface-border px-4 py-3 safe-area-inset-bottom">
          {currentTest.is_practice ? (
            <div className="space-y-2">
              <button
                onClick={() => void handlePracticeViewResults()}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold transition-colors"
              >
                <ClipboardCheck className="w-5 h-5" />
                {submitting ? 'Calculating...' : 'View Results'}
              </button>
              <button
                onClick={() => void handleDiscardPractice()}
                disabled={discarding}
                className="w-full flex items-center justify-center gap-2 py-3 bg-theme-surface border-2 border-theme-surface-border hover:border-red-500 text-theme-text-muted hover:text-red-600 rounded-xl font-medium transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                {discarding ? 'Discarding...' : 'Discard & Return'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl font-bold text-lg transition-colors"
            >
              <Save className="w-5 h-5" />
              {submitting ? 'Submitting...' : 'Submit Test'}
            </button>
          )}
        </div>
      </div>
    );
  }

  const currentSection = templateSections[activeSectionIndex];
  const currentSectionResults = currentTest.section_results?.find(
    (s) => currentSection && s.section_id === currentSection.id
  )?.criteria_results ?? [];

  const canGoBack = activeSectionIndex > 0;
  const canGoForward = activeSectionIndex < templateSections.length - 1;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Bar */}
      <div className="sticky top-0 z-10 bg-theme-surface/95 backdrop-blur-sm border-b border-theme-surface-border px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => navigate('/training/admin?page=skills-testing&tab=tests')}
            className="p-2 rounded-lg hover:bg-theme-surface-hover transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <p className="font-bold text-theme-text-primary text-sm">{currentTest.template_name}</p>
            <p className="text-xs text-theme-text-muted">
              Section {activeSectionIndex + 1} of {templateSections.length}
            </p>
          </div>
          <button
            onClick={() => void handleSaveProgress()}
            className="px-3 py-1.5 text-xs font-medium bg-theme-surface border border-theme-surface-border rounded-lg"
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
        <div className="flex justify-center gap-1.5 mt-2">
          {templateSections.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveSectionIndex(i)}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i === activeSectionIndex
                  ? 'bg-red-600'
                  : 'bg-theme-surface-border hover:bg-theme-text-muted'
              }`}
              aria-label={`Go to section ${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Practice Mode Banner */}
      {currentTest.is_practice && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-4 py-2 text-center">
          <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
            Practice Mode — This attempt will not be recorded
          </p>
        </div>
      )}

      {/* Section Content */}
      <div className="flex-1 px-4 py-4 overflow-y-auto">
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
      <div className="sticky bottom-0 bg-theme-surface/95 backdrop-blur-sm border-t border-theme-surface-border px-4 py-3 safe-area-inset-bottom">
        <div className="flex gap-3">
          <button
            onClick={() => setActiveSectionIndex(activeSectionIndex - 1)}
            disabled={!canGoBack}
            className="flex items-center justify-center gap-1 py-3 px-4 bg-theme-surface border border-theme-surface-border rounded-xl font-medium transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="w-5 h-5" />
            Prev
          </button>
          <button
            onClick={() => void handleComplete()}
            className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors"
          >
            Complete Test
          </button>
          <button
            onClick={() => setActiveSectionIndex(activeSectionIndex + 1)}
            disabled={!canGoForward}
            className="flex items-center justify-center gap-1 py-3 px-4 bg-theme-surface border border-theme-surface-border rounded-xl font-medium transition-colors disabled:opacity-30"
          >
            Next
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActiveSkillTestPage;
