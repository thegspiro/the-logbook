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
  Ban,
  CircleSlash,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSkillsTestingStore } from '../stores/skillsTestingStore';
import { useAuthStore } from '../stores/authStore';
import { useAutoSave } from '../hooks/useAutoSave';
import { formatDateTime } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { FormStatus } from '../constants/enums';
import { hydrateTemplateSections } from '../utils/skillTemplateSections';
import { TestViewersPanel } from '../components/training/TestViewersPanel';
import { SkillTestOfficerActions } from '../components/training/SkillTestOfficerActions';
import { ScoreBreakdownPanel } from '../components/training/ScoreBreakdownPanel';
import { ConfirmDialog } from '../components/ux/ConfirmDialog';
import { getErrorMessage, toAppError } from '../utils/errorHandling';
import { computeSectionTally } from '../utils/skillTestTallies';
import type { SectionTally } from '../utils/skillTestTallies';
import type {
  SkillCriterion,
  SkillTemplateSection,
  CriterionResult,
  ScoreBreakdownSection,
  SectionResult,
  SkillTestStatus,
  SkillTestUpdate,
} from '../types/skillsTesting';

/** The evaluation is still live: the clock may run and the server accepts writes. */
function isTestLive(status: SkillTestStatus | undefined): boolean {
  return status === 'draft' || status === 'in_progress';
}

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
}> = ({ criterion, result, onChange }) => {
  const marked = result?.passed === true || result?.passed === false;

  return (
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
        {/* Tapping the mark that is already set clears it. Without this the only
            way out of a mis-tap is to record the opposite verdict on a candidate
            — there is no other route back to "not scored", and an unscored step
            and a failed one are very different things on a scorecard. */}
        <button
          onClick={() => onChange({ passed: result?.passed === true ? null : true })}
          aria-pressed={result?.passed === true}
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
          onClick={() => onChange({ passed: result?.passed === false ? null : false })}
          aria-pressed={result?.passed === false}
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
      {marked && <p className="text-theme-text-muted text-xs">Tapped the wrong one? Tap it again to clear it.</p>}
    </div>
  );
};

const ScoreCriterion: React.FC<{
  criterion: SkillCriterion;
  result: CriterionResult | undefined;
  onChange: (result: Partial<CriterionResult>) => void;
}> = ({ criterion, result, onChange }) => {
  const maxScore = criterion.max_score ?? 100;
  const passingScore = criterion.passing_score ?? 0;
  // A step nobody has scored yet is not a zero. Defaulting the display to 0
  // painted every untouched critical step red before the candidate had done
  // anything, which reads as a fail the examiner never recorded.
  const scored = result?.score != null;
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

  /** Tapping the selected number again clears it, as PASS/FAIL does. Without a
   *  way back to "not scored", a mis-tap on a 0 is indistinguishable from a
   *  deliberate zero — and on a critical step those score the same but mean
   *  very different things to whoever reads the scorecard. */
  const handlePointTap = (score: number) => {
    if (scored && currentScore === score) {
      onChange({ score: undefined, passed: null });
      return;
    }
    handleScoreChange(score);
  };

  // Non-critical uses neutral blue styling; critical uses green/red
  const scoreColor = !scored
    ? 'text-theme-text-muted'
    : isCritical
      ? isPassing
        ? 'text-green-600'
        : 'text-red-600'
      : 'text-blue-600 dark:text-blue-400';

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
          {scored ? currentScore : '—'}/{maxScore}
        </div>
      </div>
      {usePointButtons ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: maxScore + 1 }, (_, i) => (
            <button
              key={i}
              onClick={() => handlePointTap(i)}
              aria-pressed={scored && currentScore === i}
              className={`h-12 min-w-12 rounded-xl text-lg font-bold transition-all ${
                scored && currentScore === i
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
          <p className="text-theme-text-muted mt-1 w-full text-xs">
            {scored ? 'Tap the same number again to clear it.' : 'Tap a number to score this step.'}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <input
            type="range"
            min="0"
            max={maxScore}
            value={currentScore}
            onChange={(e) => handleScoreChange(Number(e.target.value))}
            aria-label={`${criterion.label} score out of ${maxScore}`}
            className="h-3 w-full cursor-pointer appearance-none rounded-lg accent-red-600"
            style={{
              background: `linear-gradient(to right, ${!scored ? 'var(--surface-border)' : isCritical ? (isPassing ? 'var(--status-passed)' : 'var(--status-failed)') : 'var(--accent-blue)'} ${(currentScore / maxScore) * 100}%, var(--surface-border) ${(currentScore / maxScore) * 100}%)`,
            }}
          />
          {!scored && <p className="text-theme-text-muted text-xs">Drag the slider to score this step.</p>}
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

  const commitTime = (seconds: number) => {
    onChange({ time_seconds: seconds, passed: timeLimit > 0 ? seconds <= timeLimit : true });
  };

  // Record whatever the stopwatch is showing if this criterion is torn down
  // while it is still running. Only the Stop button used to write a value, and
  // the whole section unmounts on Prev/Next — so an examiner who timed an
  // evolution and then swiped to the next section lost the reading entirely,
  // on a step whose time limit is the pass/fail criterion.
  const latestRef = useRef({ localTimer, isRunning, timeLimit, onChange });
  // Kept current without a dependency list, so the cleanup below stays a
  // genuine unmount handler rather than re-running on every tick.
  useEffect(() => {
    latestRef.current = { localTimer, isRunning, timeLimit, onChange };
  });
  useEffect(
    () => () => {
      const { localTimer: seconds, isRunning: running, timeLimit: limit, onChange: commit } = latestRef.current;
      if (!running || seconds === 0) return;
      commit({ time_seconds: seconds, passed: limit > 0 ? seconds <= limit : true });
    },
    []
  );

  const handleStart = () => {
    setIsRunning(true);
    // Timing an evolution is the examiner acting on the candidate, so it starts
    // the test clock too — the parent only learns of an action when onChange
    // fires, and until Stop that could be minutes away.
    onChange({ time_seconds: localTimer });
  };

  const handleStop = () => {
    setIsRunning(false);
    commitTime(localTimer);
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
              onClick={handleStart}
              className="rounded-full bg-green-500 p-3 text-white transition-colors hover:bg-green-600"
              aria-label={`Start timer for ${criterion.label}`}
            >
              <Play className="h-6 w-6" />
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="rounded-full bg-red-500 p-3 text-white transition-colors hover:bg-red-600"
              aria-label={`Stop timer for ${criterion.label}`}
            >
              <Square className="h-6 w-6" />
            </button>
          )}
          <button
            onClick={handleReset}
            className="bg-theme-surface-hover text-theme-text-muted rounded-full p-3 transition-colors"
            aria-label={`Reset timer for ${criterion.label}`}
          >
            <Timer className="h-6 w-6" />
          </button>
        </div>
      </div>
      <p className="text-theme-text-muted text-xs">
        {isRunning ? 'Press the red square when the candidate finishes.' : 'Press the green arrow to start timing.'}
      </p>
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
  const recorded = result?.passed != null;

  const toggleItem = (index: number) => {
    const newCompleted = [...completed];
    newCompleted[index] = !newCompleted[index];
    // `items.length > 0` guards the empty case: [].every() is true, which would
    // pass a checklist that has nothing in it.
    const allDone = items.length > 0 && newCompleted.every(Boolean);
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
      {/* A checklist only counted as scored once a box was ticked, so the one
          case an examiner most needs to record — the candidate did none of it —
          was indistinguishable from a step they forgot, and could only be
          entered by ticking a box and unticking it again. */}
      {recorded ? (
        <button
          onClick={() => onChange({ checklist_completed: items.map(() => false), passed: null })}
          className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target text-xs transition-colors"
        >
          Clear this step
        </button>
      ) : (
        <button
          onClick={() => onChange({ checklist_completed: items.map(() => false), passed: false })}
          className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target text-xs transition-colors"
        >
          Candidate did none of these
        </button>
      )}
    </div>
  );
};

const StatementCriterion: React.FC<{
  criterion: SkillCriterion;
  result: CriterionResult | undefined;
  onChange: (result: Partial<CriterionResult>) => void;
  /** Whether the test clock is already running. */
  timerRunning: boolean;
  /** Start the clock. Only offered on statements the template marks as falling
   *  inside the timed evolution. */
  onStartTimer: () => void;
}> = ({ criterion, result, onChange, timerRunning, onStartTimer }) => {
  // NOTE: the mount-time onChange below is the one criterion write the examiner
  // did not make. SectionView tags it `autoMarked` so it cannot start the
  // clock — otherwise merely opening a test whose first section leads with a
  // statement would begin timing before the candidate is even in position.
  //
  // Statements are read-only boxes for the assessor to read aloud.
  // Auto-mark as passed on first render so they don't block completion.
  //
  // Skipped when the mark is already on the record: this component remounts
  // every time the examiner navigates back to its section, and re-writing an
  // unchanged value dirties the scorecard and triggers a pointless autosave on
  // each visit.
  const alreadyMarked = result?.passed === true;
  const markedRef = useRef(alreadyMarked);
  useEffect(() => {
    if (markedRef.current) return;
    markedRef.current = true;
    onChange({ passed: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deliberately a button rather than a mount effect. Whether a statement is
  // read on or off the clock is a property of the sheet, but *when* it is read
  // is not: an examiner opens the test to have it ready and reads the prompt
  // when the candidate is in position, which may be minutes later. Starting on
  // render would time the wait.
  const startsTimer = criterion.type === 'statement' && criterion.starts_timer === true;

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
      {startsTimer &&
        (timerRunning ? (
          <p className="text-theme-text-muted flex items-center gap-1.5 text-xs">
            <Timer className="h-3 w-3 shrink-0" />
            This statement is inside the time limit. The clock is running.
          </p>
        ) : (
          <div className="space-y-1">
            <button
              onClick={onStartTimer}
              className="mobile-touch-target flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-4 text-lg font-bold text-white shadow-lg shadow-green-600/30 transition-colors hover:bg-green-700"
            >
              <Play className="h-6 w-6" />
              START CLOCK &amp; READ
            </button>
            <p className="text-theme-text-muted text-xs">
              This statement is read inside the time limit — start the clock as you begin reading it.
            </p>
          </div>
        ))}
    </div>
  );
};

// ==================== Notes Input ====================

const CriterionNotes: React.FC<{
  criterionLabel: string;
  notes: string;
  onChange: (notes: string) => void;
}> = ({ criterionLabel, notes, onChange }) => {
  const [isOpen, setIsOpen] = useState(Boolean(notes));

  return (
    <div className="mt-2">
      {!isOpen ? (
        // A 12px text link was the control for the one thing that explains a
        // fail to whoever reads the scorecard later, on a screen used outdoors
        // with gloves on. Given a real touch target instead.
        <button
          onClick={() => setIsOpen(true)}
          className="text-theme-text-muted hover:text-theme-text-primary mobile-touch-target gap-1.5 text-xs transition-colors"
        >
          <MessageSquare className="h-4 w-4" />
          Add a note
        </button>
      ) : (
        <textarea
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Note for ${criterionLabel}`}
          placeholder="What happened? This is what explains the mark later."
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
  sectionNumber: number;
  sectionCount: number;
  sectionResults: CriterionResult[];
  requireAllCritical: boolean;
  onUpdateCriterion: (
    criterionId: string,
    result: Partial<CriterionResult>,
    criterionLabel?: string,
    options?: { autoMarked?: boolean }
  ) => void;
  timerRunning: boolean;
  onStartTimer: () => void;
}> = ({
  section,
  sectionNumber,
  sectionCount,
  sectionResults,
  requireAllCritical,
  onUpdateCriterion,
  timerRunning,
  onStartTimer,
}) => {
  const getResult = (criterionId: string) => sectionResults.find((r) => r.criterion_id === criterionId);

  // Statements are excluded from every count here. They read aloud and mark
  // themselves, so counting them showed a section part-finished before the
  // examiner had touched it — and let a section read "3 / 3" with a real step
  // still blank.
  const scorable = section.criteria.filter((c) => c.type !== 'statement');
  const scoredCount = scorable.filter((c) => getResult(c.id)?.passed != null).length;
  const passedCount = scorable.filter((c) => getResult(c.id)?.passed === true).length;
  const failedCount = scorable.filter((c) => getResult(c.id)?.passed === false).length;
  const hasCritical = scorable.some((c) => c.required);

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="border-theme-surface-border border-b pb-2">
        <p className="text-theme-text-muted text-xs font-medium tracking-wide uppercase">
          Section {sectionNumber} of {sectionCount}
        </p>
        <h2 className="text-theme-text-primary text-xl font-bold">{section.name}</h2>
        {section.description && <p className="text-theme-text-muted mt-1 text-sm">{section.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-theme-text-muted text-xs">
            {scoredCount} of {scorable.length} steps scored
          </span>
          {passedCount > 0 && <span className="text-xs text-green-600">{passedCount} passed</span>}
          {failedCount > 0 && <span className="text-xs text-red-600">{failedCount} failed</span>}
        </div>
        {hasCritical && requireAllCritical && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            Steps marked <span className="font-semibold">(Critical)</span> must pass. Leaving one unscored counts the
            same as a fail.
          </p>
        )}
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
                onChange={(r) => onUpdateCriterion(criterion.id, r, criterion.label, { autoMarked: true })}
                timerRunning={timerRunning}
                onStartTimer={onStartTimer}
              />
            )}
            <CriterionNotes
              criterionLabel={criterion.label}
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
    // A critical step left blank is flagged, not greyed out: the scorer treats
    // an unscored critical step exactly like a failed one, so it must not sit
    // on the review screen looking like a harmless omission.
    if (isCritical) {
      return (
        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" /> Not scored
        </span>
      );
    }
    return (
      <span className="bg-theme-surface-secondary text-theme-text-muted rounded-full px-2 py-0.5 text-xs font-medium">
        Not scored
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

/** The figures beside a section heading on a completed scorecard.
 *
 *  Rendered from a single tally so the review screen and the filed record read
 *  identically. Counts that are zero are omitted rather than shown as "0
 *  failed" — a clean section should look clean at a glance.
 */
const SectionTallyBadges: React.FC<{ tally: SectionTally }> = ({ tally }) => (
  <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
    {tally.countsTowardScore && (
      <span className="text-theme-text-primary font-bold">
        {tally.earned}/{tally.available} pts
      </span>
    )}
    {tally.passed > 0 && <span className="font-medium text-green-600">{tally.passed} passed</span>}
    {tally.failed > 0 && <span className="font-medium text-red-600">{tally.failed} failed</span>}
    {tally.notScored > 0 && (
      <span className="font-medium text-amber-600 dark:text-amber-400">{tally.notScored} not scored</span>
    )}
    {/* Statements are not a score, but dropping them silently would leave rows
        on the scorecard that no number above accounts for. */}
    {tally.statements > 0 && (
      <span className="text-theme-text-muted">
        {tally.statements} statement{tally.statements === 1 ? '' : 's'}
      </span>
    )}
  </div>
);

/** The server's tally for one section, in the shape the badges render.
 *
 *  A filed result shows the arithmetic that actually scored it — computed
 *  against the template snapshot the test was taken under — rather than a
 *  second calculation over the live template, which may since have been edited.
 */
function tallyFromBreakdown(section: ScoreBreakdownSection): SectionTally {
  return {
    earned: section.earned ?? null,
    available: section.available ?? null,
    countsTowardScore: section.counts_toward_score,
    passed: section.passed,
    failed: section.failed,
    notScored: section.not_scored,
    statements: section.statements,
  };
}

/** Review section showing results + editable notes for a completed test */
const ReviewSection: React.FC<{
  section: SkillTemplateSection;
  sectionResult: SectionResult | undefined;
  sectionNotes: string;
  onNotesChange: (notes: string) => void;
  scorePassFailCriteria?: boolean | undefined;
}> = ({ section, sectionResult, sectionNotes, onNotesChange, scorePassFailCriteria }) => {
  const criteriaResults = sectionResult?.criteria_results ?? [];
  const tally = computeSectionTally(section.criteria, criteriaResults, scorePassFailCriteria ?? false);

  return (
    <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-xl border">
      {/* Section header */}
      <div className="border-theme-surface-border bg-theme-surface-hover/50 border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-theme-text-primary font-bold">{section.name}</h3>
          <SectionTallyBadges tally={tally} />
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
  /** The server's tally for this section, from the test's score_breakdown.
   *  Preferred over recomputing: it is the arithmetic that scored the test. */
  breakdownSection?: ScoreBreakdownSection | undefined;
  scorePassFailCriteria?: boolean | undefined;
}> = ({ section, sectionResult, breakdownSection, scorePassFailCriteria }) => {
  const criteriaResults = sectionResult?.criteria_results ?? [];
  // Filter out the special review-notes entry for display
  const actualCriteria = criteriaResults.filter((r) => !r.criterion_id.endsWith('-review-notes'));
  const reviewNotesEntry = criteriaResults.find((r) => r.criterion_id.endsWith('-review-notes'));
  const tally = breakdownSection
    ? tallyFromBreakdown(breakdownSection)
    : computeSectionTally(section.criteria, actualCriteria, scorePassFailCriteria ?? false);

  return (
    <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-xl border">
      {/* Section header */}
      <div className="border-theme-surface-border bg-theme-surface-hover/50 border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-theme-text-primary font-bold">{section.name}</h3>
          <SectionTallyBadges tally={tally} />
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

// ==================== Progress ====================

/** How far along one section is, in the only unit the examiner cares about:
 *  steps they still have to make a call on.
 *
 *  Statements are excluded throughout. They are read aloud and mark themselves,
 *  so including them would report progress the examiner has not made.
 */
interface SectionProgress {
  id: string;
  name: string;
  /** Steps in this section that need a call from the examiner. */
  total: number;
  scored: number;
  /** Steps still blank that are marked critical — these score as failures. */
  criticalUnscored: number;
}

function buildSectionProgress(
  sections: SkillTemplateSection[],
  sectionResults: SectionResult[] | undefined
): SectionProgress[] {
  return sections.map((section) => {
    const results = sectionResults?.find((sr) => sr.section_id === section.id)?.criteria_results ?? [];
    const scorable = section.criteria.filter((c) => c.type !== 'statement');
    let scored = 0;
    let criticalUnscored = 0;
    for (const criterion of scorable) {
      if (results.find((r) => r.criterion_id === criterion.id)?.passed != null) {
        scored += 1;
      } else if (criterion.required) {
        criticalUnscored += 1;
      }
    }
    return { id: section.id, name: section.name, total: scorable.length, scored, criticalUnscored };
  });
}

/** `1 step` / `2 steps`, so messages read like a sentence rather than a report. */
function steps(count: number): string {
  return `${count} step${count === 1 ? '' : 's'}`;
}

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

  const isOfficer = useAuthStore((state) => state.checkPermission('training.manage'));

  const tz = useTimezone();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // An explicit pause is a decision — equipment reset, an interruption, a
  // candidate sent back to the staging area — so nothing may quietly undo it.
  // Auto-start only ever covers the examiner who never started the clock.
  const manuallyPausedRef = useRef(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  // Confirmations are in-app dialogs rather than window.confirm: the native one
  // is unstyled, cannot say more than one sentence, and on a phone renders as a
  // system alert an examiner dismisses by reflex.
  const [finishPrompt, setFinishPrompt] = useState(false);
  const [submitPrompt, setSubmitPrompt] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  // Nobody presses Save on a screen they are using with gloves on, so the
  // examiner needs to be told, without asking, that their scoring is safe.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

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
    // A pause belongs to the attempt it was made in; the next test starts with
    // auto-start armed again.
    manuallyPausedRef.current = false;
  }, [testId, setActiveSectionIndex, setActiveTestTimer, setActiveTestRunning]);

  // Return to the top whenever the visible content is swapped out underneath
  // the examiner. Moving between sections, entering review, and showing results
  // all happen without a route change, and the controls that trigger them sit
  // at the bottom of the page — so the next screen would otherwise render still
  // scrolled down, below its own questions. That is not cosmetic here: an
  // examiner watching the candidate never looks up, so anything above the fold
  // (the section's instructions, a statement to read aloud) is simply missed.
  //
  // Scrolling the window is not enough. Each screen below puts its body in a
  // `flex-1 overflow-y-auto` div inside a `min-h-screen` flex column, which
  // makes that div its own scroll container — the window offset this effect
  // used to reset was never the one holding the examiner partway down the page.
  // The window call stays for the outer document (header offset, footer).
  const contentRef = useRef<HTMLDivElement | null>(null);
  // Every status that is finished with, in one way or another. `cancelled`
  // belongs here for the same reason `voided` does: update_test rejects writes
  // to it with a 400, so falling through to the live evaluation screen handed
  // an officer editable criteria, a running clock and a Finish button for a
  // record the API will not accept a single one of them on.
  const showingResults =
    currentTest?.status === 'completed' || currentTest?.status === 'voided' || currentTest?.status === 'cancelled';
  const loadedTestKey = currentTest?.id;
  useEffect(() => {
    // Assignment rather than scrollTo(): this runs on every screen change and
    // must not depend on an element method jsdom leaves unimplemented.
    if (contentRef.current) contentRef.current.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    // loadedTestKey is in the list so the first paint after the spinner lands
    // at the top too — the content mounts one render after this effect first
    // runs, when the ref is still null.
  }, [activeSectionIndex, reviewing, showingResults, loadedTestKey]);

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
  // Kept until a save succeeds so a dropped connection cannot erase the fact
  // that this clock was restored rather than continuously measured.
  const pendingResumeRef = useRef(false);
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
      pendingResumeRef.current = true;
    }
  }, [loadedTestId, loadedElapsedSeconds, setActiveTestTimer]);

  // Hydrate template sections from the API response (must be before callbacks
  // that reference it). Memoized on the raw payload so the derived progress
  // below — and every callback that closes over the sections — keeps a stable
  // identity between renders.
  const rawTemplateSections = currentTest?.template_sections;
  const templateSections = useMemo(
    () => hydrateTemplateSections(rawTemplateSections as Record<string, unknown>[] | undefined),
    [rawTemplateSections]
  );
  const globalTimeLimit = currentTest?.template_time_limit_seconds;
  // Defaults to true, matching the template model's own default: the safer read
  // is that critical steps matter, so an older record without the field still
  // gets the warning rather than silently dropping it.
  const requireAllCritical = currentTest?.template_require_all_critical ?? true;

  // What is left to do, section by section — drives the section chips, the
  // progress readout, the finish warning and the review banner, so all four
  // always agree with each other.
  const sectionResultsForProgress = currentTest?.section_results;
  const sectionProgress = useMemo(
    () => buildSectionProgress(templateSections, sectionResultsForProgress),
    [templateSections, sectionResultsForProgress]
  );
  const totalSteps = sectionProgress.reduce((sum, s) => sum + s.total, 0);
  const scoredSteps = sectionProgress.reduce((sum, s) => sum + s.scored, 0);
  const unscoredSteps = totalSteps - scoredSteps;
  const criticalUnscored = sectionProgress.reduce((sum, s) => sum + s.criticalUnscored, 0);
  const firstIncompleteIndex = sectionProgress.findIndex((s) => s.scored < s.total);

  // Pick up where the examiner left off. loadTest resets the section index, so
  // returning to an interrupted evaluation — a locked phone, a call, a walk
  // back to the apparatus — dropped them at section 1 to hunt for the step they
  // had reached. Runs once per test, and only for one already under way: a
  // fresh draft has nothing to resume and belongs at the top.
  const resumedTestRef = useRef<string | undefined>(undefined);
  const loadedStatus = currentTest?.status;
  useEffect(() => {
    if (!loadedTestId || resumedTestRef.current === loadedTestId) return;
    if (sectionProgress.length === 0) return;
    resumedTestRef.current = loadedTestId;
    if (loadedStatus !== 'in_progress' || firstIncompleteIndex <= 0) return;
    setActiveSectionIndex(firstIncompleteIndex);
  }, [loadedTestId, loadedStatus, sectionProgress.length, firstIncompleteIndex, setActiveSectionIndex]);

  // "Saves as you go" rather than a bare "Saved" before anything has been
  // written: the promise is what an examiner needs to read before they trust
  // the screen, not a status for a save that hasn't happened yet.
  const saveStatusLabel = {
    idle: 'Saves as you go',
    saving: 'Saving…',
    saved: 'Saved',
    failed: 'Not saved',
  }[saveState];

  /** Set the clock running, and stamp the test as under way the first time.
   *
   * The status write carries the scoring recorded so far on purpose. update_test
   * returns the whole record and the store adopts the response, so a
   * status-only write would echo back the server's older section_results and
   * wipe the criterion the examiner just tapped — which, now, is the very tap
   * that starts the clock.
   */
  const startTimer = useCallback(() => {
    const state = useSkillsTestingStore.getState();
    if (state.activeTestRunning) return;

    setActiveTestRunning(true);

    const test = state.currentTest;
    if (test?.status === FormStatus.DRAFT) {
      void updateTest(test.id, {
        status: 'in_progress',
        section_results: test.section_results ?? [],
        elapsed_seconds: state.activeTestTimer,
      }).catch(() => {
        // The clock is already running locally. A failure here surfaces on the
        // next save or on Complete Test, which report it properly.
      });
    }
  }, [setActiveTestRunning, updateTest]);

  const toggleTimer = useCallback(() => {
    if (activeTestRunning) {
      manuallyPausedRef.current = true;
      setActiveTestRunning(false);
      return;
    }
    manuallyPausedRef.current = false;
    startTimer();
  }, [activeTestRunning, setActiveTestRunning, startTimer]);

  /** The examiner tapping "Start clock & read" on a statement the template
   *  places inside the timed evolution.
   *
   *  Deliberate in the way pressing play is, so it clears a manual pause —
   *  unlike autoStartTimer, which honours one. An examiner who paused the clock
   *  and then chose to read a timed prompt means to be timing again. */
  const startTimerForStatement = useCallback(() => {
    manuallyPausedRef.current = false;
    startTimer();
  }, [startTimer]);

  /** Start the clock on the examiner's first real action.
   *
   * The examiner is watching the candidate, not the phone, and a timer that
   * only starts when someone remembers to press play records 00:00 on a skill
   * whose time limit is itself a pass/fail criterion. Moving between sections
   * and recording any result both mean the evaluation is under way, so either
   * one starts the clock if it isn't running already.
   */
  const autoStartTimer = useCallback(() => {
    if (manuallyPausedRef.current || reviewing) return;
    if (!isTestLive(useSkillsTestingStore.getState().currentTest?.status)) return;
    startTimer();
  }, [reviewing, startTimer]);

  const goToSection = useCallback(
    (index: number) => {
      setActiveSectionIndex(index);
      autoStartTimer();
    },
    [setActiveSectionIndex, autoStartTimer]
  );

  // Every write goes through here so it carries the version this screen is
  // working from. The server refuses a stale one with 409 instead of quietly
  // overwriting whoever saved in between — a second examiner on the same test,
  // or an officer editing the scorecard in the admin UI.
  const [conflict, setConflict] = useState(false);
  const saveTest = useCallback(
    async (updates: SkillTestUpdate) => {
      if (!currentTest) return;
      setSaveState('saving');
      const reportingResume = pendingResumeRef.current;
      try {
        await updateTest(currentTest.id, {
          ...updates,
          ...(reportingResume ? { resumed: true } : {}),
          expected_version: currentTest.version,
        });
        if (reportingResume) pendingResumeRef.current = false;
        setSaveState('saved');
      } catch (err: unknown) {
        setSaveState('failed');
        if (toAppError(err).status === 409) {
          setConflict(true);
        }
        throw err;
      }
    },
    [currentTest, updateTest]
  );

  const handleSaveProgress = useCallback(async () => {
    if (!currentTest) return;
    try {
      await saveTest({
        section_results: currentTest.section_results,
        elapsed_seconds: activeTestTimer,
      });
      toast.success('Progress saved');
    } catch (err: unknown) {
      toast.error(
        toAppError(err).status === 409
          ? 'This test changed elsewhere — reload before saving'
          : 'Failed to save progress'
      );
    }
  }, [currentTest, activeTestTimer, saveTest]);

  const handleReloadAfterConflict = useCallback(async () => {
    if (!testId) return;
    setConflict(false);
    setSaveState('idle');
    await loadTest(testId);
    toast.success('Reloaded the current results');
  }, [testId, loadTest]);

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
      await saveTest(payload);
    },
    [currentTest, saveTest]
  );

  useAutoSave({
    data: autoSavePayload,
    onSave: persistAutoSave,
    // Only while the evaluation is live. A completed or voided test is
    // read-only, and update_test rejects writes to it.
    //
    // Suspended once a concurrent edit is detected, as the banner tells the
    // examiner it is: every retry carries the same stale version, so it can
    // only 409 again, and each failure re-stamps the save indicator as failed
    // on a screen already explaining why.
    enabled: currentTest != null && !reviewing && !conflict && isTestLive(currentTest.status),
  });

  /** Stop the clock, save, and move on to the review screen. */
  const enterReview = useCallback(async () => {
    if (!currentTest) return;

    setActiveTestRunning(false);

    try {
      // Save current state before entering review
      await saveTest({
        section_results: currentTest.section_results,
        elapsed_seconds: activeTestTimer,
      });
      setReviewing(true);
    } catch {
      toast.error('Failed to save progress');
    }
  }, [currentTest, activeTestTimer, saveTest, setActiveTestRunning]);

  /** "Finish" — warns about steps left blank before leaving the scoring screen.
   *
   * The clock is deliberately left running until review is actually entered: an
   * examiner who taps Finish, reads the warning and goes back to score the last
   * step is still mid-evaluation, and stopping the clock on them would
   * under-record the duration on a test whose time limit may itself be the
   * criterion.
   */
  const handleFinish = useCallback(() => {
    if (unscoredSteps > 0) {
      setFinishPrompt(true);
      return;
    }
    void enterReview();
  }, [unscoredSteps, enterReview]);

  /** Send the examiner back to the first section that still has blank steps. */
  const goToFirstUnscored = useCallback(() => {
    setFinishPrompt(false);
    setReviewing(false);
    setActiveSectionIndex(firstIncompleteIndex >= 0 ? firstIncompleteIndex : 0);
  }, [firstIncompleteIndex, setActiveSectionIndex]);

  /** Leave review mode and show the scored result.
   *
   * Both the active and detail routes render THIS component, so react-router
   * swaps the URL without remounting and `reviewing` would survive the
   * transition — pinning the page on the review screen even though the test is
   * finished. Clearing the flag is what actually reveals the results view,
   * which is gated on `!reviewing`.
   */
  const showResults = useCallback(
    (id: string) => {
      setReviewing(false);
      void navigate(`/training/skills-testing/test/${id}`);
    },
    [navigate]
  );

  /** Report a failed finalize with the server's own message.
   *
   * These paths used to swallow the error and print a fixed string, which meant
   * an examiner (and anyone debugging from their report) was told "failed" with
   * no indication of whether the test was already submitted, someone else had
   * edited it, or the network had dropped.
   */
  const reportFinalizeError = useCallback((err: unknown, fallback: string) => {
    toast.error(
      toAppError(err).status === 409
        ? 'This test changed elsewhere — reload before submitting'
        : getErrorMessage(err, fallback)
    );
  }, []);

  /** Did the finalize land despite the error, leaving the test scored?
   *
   * Scoring is two calls — save the review notes, then complete — and the
   * completion commits server-side before its response reaches the phone. A
   * timeout, a dropped cell connection, or a duplicate tap therefore surfaces
   * as a failure on a test that *is* finished: the examiner sees an error,
   * refreshes out of desperation, and finds the scored result waiting. Ask the
   * server what actually happened before calling anything a failure.
   */
  const reloadAndCheckFinalized = useCallback(
    async (id: string): Promise<boolean> => {
      await loadTest(id);
      const latest = useSkillsTestingStore.getState().currentTest;
      return latest?.id === id && latest.status === 'completed';
    },
    [loadTest]
  );

  /** The scorecard as it will be filed: recorded criteria plus the review
   *  screen's section notes, which ride along as a reserved criterion entry. */
  const mergeReviewNotes = useCallback((): SectionResult[] => {
    return templateSections.map((section) => {
      const existing = currentTest?.section_results?.find((sr) => sr.section_id === section.id);
      const sectionNotes = reviewNotes[section.id] ?? '';
      const finalCriteria = [...(existing?.criteria_results ?? [])];

      if (sectionNotes) {
        const noteId = `${section.id}-review-notes`;
        const existingNoteEntry = finalCriteria.find((cr) => cr.criterion_id === noteId);
        if (existingNoteEntry) {
          existingNoteEntry.notes = sectionNotes;
        } else {
          finalCriteria.push({
            criterion_id: noteId,
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
  }, [templateSections, currentTest?.section_results, reviewNotes]);

  /** "Submit Test" — ask first; this is the point of no return. */
  const requestSubmit = useCallback(() => {
    if (!currentTest) return;

    // Already finalized — nothing left to save. Reachable when a previous
    // attempt completed server-side but its response never arrived (a dropped
    // connection on a phone, mid-drill). Without this the retry re-runs the
    // pre-submit save, which update_test refuses on a completed test, so the
    // screen would fail permanently on a test that had in fact gone through.
    if (currentTest.status === 'completed') {
      showResults(currentTest.id);
      return;
    }

    setSubmitPrompt(true);
  }, [currentTest, showResults]);

  /** Finalizes the test with notes from review, calculates results */
  const handleSubmit = useCallback(async () => {
    if (!currentTest) return;

    setSubmitPrompt(false);
    setSubmitting(true);
    try {
      // Save section results with review notes
      await saveTest({
        section_results: mergeReviewNotes(),
        elapsed_seconds: activeTestTimer,
      });

      // Then finalize
      const completed = await completeTest(currentTest.id);
      toast.success(
        completed.pending_validation
          ? 'Test submitted — a training officer will validate the result'
          : `Test submitted: ${completed.result.toUpperCase()}`
      );
      showResults(currentTest.id);
    } catch (err: unknown) {
      // The submission may already be filed — see reloadAndCheckFinalized.
      if (await reloadAndCheckFinalized(currentTest.id)) {
        const filed = useSkillsTestingStore.getState().currentTest;
        toast.success(
          filed?.pending_validation
            ? 'Test submitted — a training officer will validate the result'
            : `Test submitted: ${(filed?.result ?? '').toUpperCase()}`
        );
        showResults(currentTest.id);
        return;
      }
      reportFinalizeError(err, 'Failed to submit test');
    } finally {
      setSubmitting(false);
    }
  }, [
    currentTest,
    activeTestTimer,
    saveTest,
    completeTest,
    mergeReviewNotes,
    showResults,
    reportFinalizeError,
    reloadAndCheckFinalized,
  ]);

  /** Practice: complete the test (calculate results) but keep in review mode */
  const handlePracticeViewResults = useCallback(async () => {
    if (!currentTest) return;

    // See handleSubmit: a completed test is read-only, so re-running the save
    // would fail every time. Show the results that already exist instead.
    if (currentTest.status === 'completed') {
      showResults(currentTest.id);
      return;
    }

    setSubmitting(true);
    try {
      await saveTest({
        section_results: mergeReviewNotes(),
        elapsed_seconds: activeTestTimer,
      });
      await completeTest(currentTest.id);
      showResults(currentTest.id);
    } catch (err: unknown) {
      // The scoring may already be filed — see reloadAndCheckFinalized. Showing
      // the results the server holds is the honest outcome; an error toast here
      // would send the examiner off to refresh the page and find them anyway.
      if (await reloadAndCheckFinalized(currentTest.id)) {
        showResults(currentTest.id);
        return;
      }
      reportFinalizeError(err, 'Failed to calculate results');
    } finally {
      setSubmitting(false);
    }
  }, [
    currentTest,
    activeTestTimer,
    saveTest,
    completeTest,
    mergeReviewNotes,
    showResults,
    reportFinalizeError,
    reloadAndCheckFinalized,
  ]);

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
    setDiscardPrompt(false);
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
      criterionLabel?: string,
      options?: { autoMarked?: boolean }
    ) => {
      updateCriterionResult(sectionId, criterionId, result, sectionName, criterionLabel);
      // Recording a pass/fail, a score, a time, or a checklist tick means the
      // candidate is performing — so the clock starts here if the examiner
      // never pressed play. Statements mark themselves as the section renders,
      // which is nobody's action.
      if (!options?.autoMarked) {
        autoStartTimer();
      }
    },
    [updateCriterionResult, autoStartTimer]
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

  // Where "back" goes, from every screen here. Training Admin is an
  // officer-only page: a member examiner — or anyone on a practice run — came
  // from the member-facing list and has to be returned to it, or they land on a
  // page they cannot open. Resolved once so the header, the results header and
  // the results footer button cannot disagree, which they previously did.
  const backTarget =
    currentTest.is_practice || !isOfficer
      ? '/training/skills-testing'
      : '/training/admin?page=skills-testing&tab=tests';

  // Discarding a practice attempt is offered from both the review screen and
  // the results screen, so the confirmation is built once and rendered in both.
  const discardDialog = (
    <ConfirmDialog
      isOpen={discardPrompt}
      onClose={() => setDiscardPrompt(false)}
      onConfirm={() => void handleDiscardPractice()}
      title="Discard this practice attempt?"
      message="This practice attempt will be deleted for good. Nothing is recorded against the candidate."
      cancelLabel="Keep it"
      confirmLabel="Discard"
      loading={discarding}
    />
  );

  // Completed test — full detail view (read-only). A voided test lands here
  // too: it is a finished result that was withdrawn, and routing it to the live
  // evaluation UI below would hand an officer editable criteria for a record
  // the API refuses every write on.
  if (showingResults && !reviewing) {
    return (
      <div className="flex min-h-screen flex-col">
        {/* Header */}
        <div className="bg-theme-surface-modal border-theme-surface-border sticky top-0 z-10 border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => void navigate(backTarget)}
              className="hover:bg-theme-surface-hover flex items-center gap-1 rounded-lg p-2 text-sm transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
            <div className="text-center">
              <p className="text-theme-text-primary text-sm font-bold">{currentTest.template_name}</p>
              <p className="text-theme-text-muted text-xs">
                {currentTest.status === 'voided'
                  ? 'Voided Result'
                  : currentTest.status === 'cancelled'
                    ? 'Cancelled Test'
                    : currentTest.is_practice
                      ? 'Practice Results'
                      : 'Test Results'}
              </p>
            </div>
            <div className="w-16" /> {/* Spacer for centering */}
          </div>
        </div>

        <div ref={contentRef} className="flex-1 overflow-y-auto px-4 py-4">
          {/* Practice banner */}
          {currentTest.is_practice && (
            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-center dark:border-blue-800 dark:bg-blue-900/20">
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                Practice Attempt — Not recorded in official history
              </p>
            </div>
          )}
          {/* Pending-validation banner. The examiner sees the marks they
              recorded — withholding them from their author would be pointless —
              but must not leave thinking the result already counts. */}
          {currentTest.pending_validation && (
            <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-900/20">
              <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                Awaiting a training officer&apos;s validation
              </p>
              <p className="mt-1 text-sm text-purple-700/90 dark:text-purple-300/90">
                Until then this result doesn&apos;t count toward {currentTest.candidate_name}&apos;s record, credit a
                program requirement, or use one of their attempts. They can see the test is under review, but not the
                score.
              </p>
            </div>
          )}

          {/* Result banner. A voided result keeps its marks on display — the
              scorecard is the evidence of what was withdrawn — but must not
              read as a standing pass or fail, so the outcome is stated as
              withdrawn and the pass/green treatment is dropped. */}
          {currentTest.status === 'voided' ? (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
              <Ban className="h-10 w-10 shrink-0 text-amber-500" />
              <div className="flex-1">
                <p className="text-lg font-bold text-amber-700 dark:text-amber-300">Voided</p>
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  This result was withdrawn and counts toward nothing
                  {currentTest.overall_score != null
                    ? ` (recorded ${currentTest.result === 'pass' ? 'pass' : 'fail'}, ${Math.round(currentTest.overall_score)}%)`
                    : ''}
                </p>
              </div>
            </div>
          ) : currentTest.status === 'cancelled' ? (
            /* Closed out before it was finished. Whatever was scored stays on
               display as the record of how far the evaluation got, but there is
               no outcome here — it was never completed, so nothing was decided. */
            <div className="bg-theme-surface border-theme-surface-border mb-4 flex items-center gap-3 rounded-xl border p-4">
              <CircleSlash className="text-theme-text-muted h-10 w-10 shrink-0" />
              <div className="flex-1">
                <p className="text-theme-text-primary text-lg font-bold">Cancelled</p>
                <p className="text-theme-text-muted text-sm font-medium">
                  This test was closed out before it finished. Anything scored below is kept as a record, but there is
                  no pass or fail, and it counts toward nothing.
                </p>
              </div>
            </div>
          ) : (
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
          )}

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

          {/* How the headline percentage was reached. Sits above the sections
              so a reader meets the arithmetic before the detail it summarizes. */}
          {currentTest.score_breakdown && (
            <div className="mb-4">
              <ScoreBreakdownPanel breakdown={currentTest.score_breakdown} />
            </div>
          )}

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
                  breakdownSection={currentTest.score_breakdown?.sections.find((s) => s.section_id === section.id)}
                  scorePassFailCriteria={currentTest.template_score_pass_fail_criteria}
                />
              );
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

          {/* Named viewers. Official results only: a practice attempt is the
              candidate's own drill note, discardable by them at will and purged
              after a year, so a durable grant on one would outlive the thing it
              points at. Officers only — the viewer endpoints require
              training.manage, so a member examiner would see a panel whose every
              call 403s. Not on a cancelled test either: it never produced a
              result, so there is nothing for a named viewer to be shown. */}
          {!currentTest.is_practice && isOfficer && currentTest.status !== 'cancelled' && (
            <div className="mt-4">
              <TestViewersPanel
                testId={currentTest.id}
                candidateId={currentTest.candidate_id}
                examinerId={currentTest.examiner_id}
              />
            </div>
          )}

          {/* What the officer can do about this result, last: the decision is
              made after reading the scorecard, and this is where they arrive
              having read it. Officers only — accept, release and void all
              require training.manage, so a member examiner would be shown
              buttons that 403. */}
          {!currentTest.is_practice && isOfficer && (
            <div className="mt-4">
              <SkillTestOfficerActions test={currentTest} />
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
                  onClick={() => setDiscardPrompt(true)}
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
              onClick={() => void navigate(backTarget)}
              className="w-full rounded-xl bg-red-600 py-3 font-medium text-white transition-colors hover:bg-red-700"
            >
              Back to Tests
            </button>
          )}
        </div>

        {discardDialog}
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
              <ChevronLeft className="h-4 w-4 shrink-0" />
              Back to scoring
            </button>
            <div className="min-w-0 flex-1 text-right">
              <p className="text-theme-text-primary truncate text-sm font-bold">{currentTest.candidate_name}</p>
              <p className="text-theme-text-muted text-xs">Check the scorecard</p>
            </div>
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
        <div ref={contentRef} className="flex-1 overflow-y-auto px-4 py-4">
          {/* Last chance to fill in what was missed. The scorer treats an
              unscored critical step as a failure, so this cannot be left as a
              greyed-out count buried in a section header — it needs naming, and
              it needs a way back to the step. */}
          {unscoredSteps > 0 && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {steps(unscoredSteps)} {unscoredSteps === 1 ? 'has' : 'have'} no Pass or Fail yet
              </p>
              {requireAllCritical && criticalUnscored > 0 && (
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                  {criticalUnscored} of {unscoredSteps === 1 ? 'them' : 'those'} {criticalUnscored === 1 ? 'is' : 'are'}{' '}
                  marked Critical, which scores the same as a fail.
                </p>
              )}
              <button
                onClick={goToFirstUnscored}
                className="mt-2 min-h-[44px] rounded-lg bg-amber-600 px-4 text-sm font-medium text-white transition-colors hover:bg-amber-700"
              >
                Go back and score them
              </button>
            </div>
          )}

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
                  scorePassFailCriteria={currentTest.template_score_pass_fail_criteria}
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
                onClick={() => setDiscardPrompt(true)}
                disabled={discarding}
                className="bg-theme-surface border-theme-surface-border text-theme-text-muted flex w-full items-center justify-center gap-2 rounded-xl border-2 py-3 font-medium transition-colors hover:border-red-500 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
                {discarding ? 'Discarding...' : 'Discard & Return'}
              </button>
            </div>
          ) : (
            <button
              onClick={requestSubmit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-4 text-lg font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              <Save className="h-5 w-5" />
              {submitting ? 'Submitting...' : 'Submit Test'}
            </button>
          )}
        </div>

        {discardDialog}
        <ConfirmDialog
          isOpen={submitPrompt}
          onClose={() => setSubmitPrompt(false)}
          onConfirm={() => void handleSubmit()}
          title="Submit this test?"
          message={`This files ${currentTest.candidate_name}'s result. Once submitted, the marks and notes can't be changed.`}
          cancelLabel="Not yet"
          confirmLabel="Submit"
          loading={submitting}
        />
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            onClick={() => void navigate(backTarget)}
            aria-label="Leave this test"
            className="hover:bg-theme-surface-hover mobile-touch-target rounded-lg transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          {/* Who is being tested, on the screen where the marks are made. The
              examiner used to be shown the template name only, so nothing on
              the scoring screen confirmed they had the right candidate open. */}
          <div className="min-w-0 text-center">
            <p className="text-theme-text-primary truncate text-sm font-bold">{currentTest.candidate_name}</p>
            <p className="text-theme-text-muted truncate text-xs">{currentTest.template_name}</p>
          </div>
          <button
            onClick={() => void handleSaveProgress()}
            className="bg-theme-surface border-theme-surface-border mobile-touch-target rounded-lg border px-3 text-xs font-medium"
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

        {/* Section chips. These replaced 10px progress dots that were both
            impossible to hit with a glove on and silent about what was left to
            do — the examiner could only find an unscored step by walking every
            section. A chip shows its own state, so what still needs work is
            readable at a glance and one tap away. */}
        <div className={`flex items-center gap-3 ${sectionProgress.length > 0 ? 'mt-2' : ''}`}>
          <div className="hscroll flex flex-1 gap-2 py-0.5">
            {sectionProgress.map((progress, i) => {
              const complete = progress.total > 0 && progress.scored === progress.total;
              const isCurrent = i === activeSectionIndex;
              return (
                <button
                  key={progress.id}
                  onClick={() => goToSection(i)}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`Section ${i + 1}, ${progress.name}: ${progress.scored} of ${progress.total} steps scored`}
                  className={`mobile-touch-target gap-1 rounded-full border-2 px-3 text-sm font-bold transition-colors ${
                    isCurrent
                      ? 'border-red-600 bg-red-600 text-white'
                      : complete
                        ? 'border-green-500/50 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : 'border-theme-surface-border text-theme-text-muted'
                  }`}
                >
                  {complete && !isCurrent && <Check className="h-4 w-4" aria-hidden="true" />}
                  {i + 1}
                </button>
              );
            })}
          </div>
          {totalSteps > 0 && (
            <div className="shrink-0 text-right leading-tight">
              <p className="text-theme-text-primary text-xs font-bold">
                {scoredSteps}/{totalSteps}
              </p>
              <p className="text-theme-text-muted text-[10px]">{saveStatusLabel}</p>
            </div>
          )}
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

      {/* Concurrent-edit banner. Autosave is suspended while this is up —
          every attempt would 409 against the same stale version — so the
          examiner is told plainly rather than left believing their scoring is
          still being saved. */}
      {conflict && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Someone else changed this test. Your scoring is not being saved.
          </p>
          <button
            onClick={() => void handleReloadAfterConflict()}
            className="mt-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
          >
            Reload current results
          </button>
        </div>
      )}

      {/* Why this test came back. An officer sent it here instead of accepting
          or voiding it, and the examiner opening it needs the request in front
          of them while they correct — not buried in a notification they read
          on the way to the truck. Persists after they resubmit, so the officer
          reviewing the second attempt can check it was addressed. */}
      {(currentTest.resume_count ?? 0) > 0 && isTestLive(currentTest.status) && (
        <div className="border-b border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20">
          <p className="text-sm text-blue-900 dark:text-blue-100">
            <span className="font-medium">Resumed evaluation.</span> The clock carried on from the last save, so the
            recorded time is not an exact stopwatch reading. Note anything the duration needs explained.
          </p>
        </div>
      )}

      {currentTest.returned_at && currentTest.return_reason && (
        <div className="border-b border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-900/20">
          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
            Sent back for correction
            {currentTest.returned_by_name ? ` by ${currentTest.returned_by_name}` : ''}
            {currentTest.return_count && currentTest.return_count > 1 ? ` (${currentTest.return_count} times)` : ''}
          </p>
          <p className="mt-1 text-sm text-blue-800 dark:text-blue-200">{currentTest.return_reason}</p>
        </div>
      )}

      {/* Section Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-4 py-4">
        {currentSection && (
          <SectionView
            section={currentSection}
            sectionNumber={activeSectionIndex + 1}
            sectionCount={templateSections.length}
            sectionResults={currentSectionResults}
            requireAllCritical={requireAllCritical}
            onUpdateCriterion={(criterionId, result, criterionLabel, options) =>
              handleUpdateCriterion(
                currentSection.id,
                criterionId,
                result,
                currentSection.name,
                criterionLabel,
                options
              )
            }
            timerRunning={activeTestRunning}
            onStartTimer={startTimerForStatement}
          />
        )}
        {/* A published template with nothing in it, or a section list the API
            could not return. Better a plain explanation than a blank screen
            under a live timer. */}
        {!currentSection && (
          <div className="py-12 text-center">
            <ClipboardCheck className="text-theme-text-muted mx-auto h-10 w-10" />
            <p className="text-theme-text-primary mt-3 font-medium">Nothing to score on this test</p>
            <p className="text-theme-text-muted mt-1 text-sm">
              This test&apos;s template has no steps in it. Tell a training officer, then finish or leave the test.
            </p>
          </div>
        )}
      </div>

      {/* Bottom Navigation Bar.
          The emphasis used to sit on "Complete Test": the biggest, reddest
          button on every section ended the evaluation, while the action the
          examiner actually wanted next — move on — was a small grey one beside
          it. Now the primary button is whatever comes next, and finishing keeps
          the rightmost slot on every section so it never moves under a thumb
          that has learned where it is. */}
      <div className="bg-theme-surface-modal border-theme-surface-border action-bar-safe sticky bottom-0 border-t px-4">
        <div className="flex gap-3">
          <button
            onClick={() => goToSection(activeSectionIndex - 1)}
            disabled={!canGoBack}
            className="bg-theme-surface border-theme-surface-border flex min-h-[52px] items-center justify-center gap-1 rounded-xl border px-4 font-medium transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="h-5 w-5" />
            Prev
          </button>
          {canGoForward && (
            <button
              onClick={() => goToSection(activeSectionIndex + 1)}
              className="flex min-h-[52px] flex-1 items-center justify-center gap-1 rounded-xl bg-red-600 font-bold text-white transition-colors hover:bg-red-700"
            >
              Next
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={handleFinish}
            className={`flex min-h-[52px] items-center justify-center rounded-xl px-4 font-bold transition-colors ${
              canGoForward
                ? 'bg-theme-surface border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary border font-medium'
                : 'flex-1 bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            {canGoForward ? 'Finish' : 'Finish & Review'}
          </button>
        </div>
      </div>

      {/* Finishing with steps left blank. Naming the count — and what an
          unscored critical step costs — is the whole point: the old native
          confirm said "criteria have not been evaluated" and gave the examiner
          no way to act on it. */}
      <ConfirmDialog
        isOpen={finishPrompt}
        onClose={() => setFinishPrompt(false)}
        onConfirm={() => {
          setFinishPrompt(false);
          void enterReview();
        }}
        title="Some steps have no score"
        message={
          requireAllCritical && criticalUnscored > 0
            ? `${steps(unscoredSteps)} still ${unscoredSteps === 1 ? 'has' : 'have'} no Pass or Fail. ${criticalUnscored} of ${criticalUnscored === 1 ? 'them is' : 'them are'} marked Critical, which scores the same as a fail.`
            : `${steps(unscoredSteps)} still ${unscoredSteps === 1 ? 'has' : 'have'} no Pass or Fail. Sections with a green check are the ones you have finished.`
        }
        cancelLabel="Keep scoring"
        confirmLabel="Review anyway"
        variant="warning"
      />
    </div>
  );
};

export default ActiveSkillTestPage;
