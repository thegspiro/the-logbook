/**
 * Training UI Components
 *
 * Reusable, color-coded badges, progress bars, timelines, and empty states
 * for the training module.
 */

import React from 'react';
import {
  CheckCircle,
  Circle,
  Clock,
  Award,
  BookOpen,
  ClipboardList,
  GraduationCap,
  ShieldCheck,
  Plus,
} from 'lucide-react';
import { differenceInDays, parseISO } from 'date-fns';
import type {
  TrainingStatus,
  TrainingType,
  EnrollmentStatus,
  ProgramPhase,
} from '../../types/training';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-0.5 text-sm',
} as const;

// ---------------------------------------------------------------------------
// 1. TrainingStatusBadge
// ---------------------------------------------------------------------------

interface TrainingStatusBadgeProps {
  status: TrainingStatus;
  size?: 'sm' | 'md';
}

const trainingStatusConfig: Record<TrainingStatus, { label: string; classes: string }> = {
  scheduled: { label: 'Scheduled', classes: 'bg-blue-100 text-blue-800' },
  in_progress: { label: 'In Progress', classes: 'bg-yellow-100 text-yellow-800' },
  completed: { label: 'Completed', classes: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Cancelled', classes: 'bg-theme-surface-secondary text-theme-text-primary' },
  failed: { label: 'Failed', classes: 'bg-red-100 text-red-800' },
};

export const TrainingStatusBadge: React.FC<TrainingStatusBadgeProps> = ({
  status,
  size = 'md',
}) => {
  const config = trainingStatusConfig[status] ?? trainingStatusConfig.scheduled;
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${config.classes} ${sizeClasses[size]}`}
    >
      {config.label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// 2. RequirementProgressBar
// ---------------------------------------------------------------------------

interface RequirementProgressBarProps {
  percentage: number;
  label?: string;
  showPercentage?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const progressBarHeight = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
} as const;

function getProgressColor(pct: number): string {
  if (pct >= 75) return 'bg-green-500';
  if (pct >= 50) return 'bg-yellow-500';
  if (pct >= 25) return 'bg-orange-500';
  return 'bg-red-500';
}

export const RequirementProgressBar: React.FC<RequirementProgressBarProps> = ({
  percentage,
  label,
  showPercentage = true,
  size = 'md',
}) => {
  const clamped = Math.max(0, Math.min(100, percentage));
  return (
    <div className="w-full">
      {(label || showPercentage) && (
        <div className="mb-1 flex items-center justify-between text-sm">
          {label && <span className="font-medium text-theme-text-primary">{label}</span>}
          {showPercentage && <span className="text-theme-text-muted">{Math.round(clamped)}%</span>}
        </div>
      )}
      <div className={`w-full overflow-hidden rounded-full bg-theme-surface-secondary ${progressBarHeight[size]}`}>
        <div
          className={`${progressBarHeight[size]} rounded-full transition-all duration-300 ${getProgressColor(clamped)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3. CertificationExpiryBadge
// ---------------------------------------------------------------------------

interface CertificationExpiryBadgeProps {
  expirationDate: string;
  showDaysRemaining?: boolean;
}

function getExpiryStyle(daysRemaining: number): { classes: string; label: string } {
  if (daysRemaining < 0) {
    return { classes: 'bg-red-200 text-red-900', label: 'Expired' };
  }
  if (daysRemaining < 30) {
    return { classes: 'bg-red-100 text-red-800', label: 'Expiring Soon' };
  }
  if (daysRemaining <= 90) {
    return { classes: 'bg-yellow-100 text-yellow-800', label: 'Expiring' };
  }
  return { classes: 'bg-green-100 text-green-800', label: 'Valid' };
}

export const CertificationExpiryBadge: React.FC<CertificationExpiryBadgeProps> = ({
  expirationDate,
  showDaysRemaining = true,
}) => {
  const expDate = parseISO(expirationDate);
  const daysRemaining = differenceInDays(expDate, new Date());
  const { classes, label } = getExpiryStyle(daysRemaining);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium ${classes}`}
    >
      <Clock className="h-3.5 w-3.5" />
      <span>{label}</span>
      {showDaysRemaining && (
        <span className="opacity-75">
          {daysRemaining < 0
            ? `(${Math.abs(daysRemaining)}d ago)`
            : `(${daysRemaining}d)`}
        </span>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// 4. TrainingCategoryBadge
// ---------------------------------------------------------------------------

interface TrainingCategoryBadgeProps {
  name: string;
  code?: string;
  color?: string;
  icon?: string;
  size?: 'sm' | 'md';
}

/**
 * Converts a hex colour into Tailwind-compatible rgba values for a tinted
 * background while keeping the text readable.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6 && cleaned.length !== 3) return null;
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  const num = parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export const TrainingCategoryBadge: React.FC<TrainingCategoryBadgeProps> = ({
  name,
  code,
  color,
  size = 'md',
}) => {
  const rgb = color ? hexToRgb(color) : null;

  const style: React.CSSProperties = rgb
    ? {
        backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`,
        color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`,
      }
    : {};

  const fallbackClasses = rgb ? '' : 'bg-theme-surface-secondary text-theme-text-primary';

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${fallbackClasses} ${sizeClasses[size]}`}
      style={style}
    >
      {code ? `${code} - ${name}` : name}
    </span>
  );
};

// ---------------------------------------------------------------------------
// 5. TrainingTypeBadge
// ---------------------------------------------------------------------------

interface TrainingTypeBadgeProps {
  type: TrainingType;
  size?: 'sm' | 'md';
}

const trainingTypeConfig: Record<TrainingType, { label: string; classes: string }> = {
  certification: { label: 'Certification', classes: 'bg-purple-100 text-purple-800' },
  continuing_education: { label: 'CE', classes: 'bg-blue-100 text-blue-800' },
  skills_practice: { label: 'Skills', classes: 'bg-orange-100 text-orange-800' },
  orientation: { label: 'Orientation', classes: 'bg-teal-100 text-teal-800' },
  refresher: { label: 'Refresher', classes: 'bg-cyan-100 text-cyan-800' },
  specialty: { label: 'Specialty', classes: 'bg-indigo-100 text-indigo-800' },
};

export const TrainingTypeBadge: React.FC<TrainingTypeBadgeProps> = ({ type, size = 'md' }) => {
  const config = trainingTypeConfig[type] ?? trainingTypeConfig.certification;
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${config.classes} ${sizeClasses[size]}`}
    >
      {config.label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// 6. EnrollmentStatusBadge
// ---------------------------------------------------------------------------

interface EnrollmentStatusBadgeProps {
  status: EnrollmentStatus;
}

const enrollmentStatusConfig: Record<EnrollmentStatus, { label: string; classes: string }> = {
  active: { label: 'Active', classes: 'bg-blue-100 text-blue-800' },
  completed: { label: 'Completed', classes: 'bg-green-100 text-green-800' },
  on_hold: { label: 'On Hold', classes: 'bg-yellow-100 text-yellow-800' },
  withdrawn: { label: 'Withdrawn', classes: 'bg-theme-surface-secondary text-theme-text-primary' },
  failed: { label: 'Failed', classes: 'bg-red-100 text-red-800' },
};

export const EnrollmentStatusBadge: React.FC<EnrollmentStatusBadgeProps> = ({ status }) => {
  const config = enrollmentStatusConfig[status] ?? enrollmentStatusConfig.active;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${config.classes}`}
    >
      {config.label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// 7. ProgramPhaseTimeline
// ---------------------------------------------------------------------------

interface ProgramPhaseTimelineProps {
  phases: ProgramPhase[];
  currentPhaseId?: string;
  completedPhaseIds?: string[];
}

export const ProgramPhaseTimeline: React.FC<ProgramPhaseTimelineProps> = ({
  phases,
  currentPhaseId,
  completedPhaseIds = [],
}) => {
  const sorted = [...phases].sort((a, b) => a.phase_number - b.phase_number);
  const completedSet = new Set(completedPhaseIds);

  return (
    <div className="flex items-center gap-0">
      {sorted.map((phase, idx) => {
        const isCompleted = completedSet.has(phase.id);
        const isCurrent = phase.id === currentPhaseId;

        return (
          <React.Fragment key={phase.id}>
            {/* Connector line */}
            {idx > 0 && (
              <div
                className={`h-0.5 w-8 flex-shrink-0 ${isCompleted || isCurrent ? 'bg-blue-400' : 'bg-theme-surface-secondary'}`}
              />
            )}

            {/* Phase node */}
            <div className="flex flex-col items-center gap-1">
              <div className="relative flex items-center justify-center">
                {isCompleted ? (
                  <CheckCircle className="h-6 w-6 text-green-700 dark:text-green-500" />
                ) : isCurrent ? (
                  <div className="relative">
                    <Circle className="h-6 w-6 text-blue-700 dark:text-blue-500 fill-blue-500" />
                    <span className="absolute inset-0 animate-ping rounded-full bg-blue-400 opacity-30" />
                  </div>
                ) : (
                  <Circle className="h-6 w-6 text-theme-text-secondary" />
                )}
              </div>
              <span
                className={`max-w-[5rem] truncate text-center text-xs ${
                  isCompleted
                    ? 'font-medium text-green-700'
                    : isCurrent
                      ? 'font-semibold text-blue-700'
                      : 'text-theme-text-muted'
                }`}
                title={phase.name}
              >
                {phase.name}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 8. TrainingHoursDisplay
// ---------------------------------------------------------------------------

interface TrainingHoursDisplayProps {
  completed: number;
  required: number;
  label?: string;
}

export const TrainingHoursDisplay: React.FC<TrainingHoursDisplayProps> = ({
  completed,
  required,
  label,
}) => {
  const pct = required > 0 ? Math.min(100, (completed / required) * 100) : 0;

  return (
    <div className="w-full">
      {label && <span className="mb-0.5 block text-xs font-medium text-theme-text-muted">{label}</span>}
      <span className="text-sm font-semibold text-theme-text-primary">
        {completed} <span className="font-normal text-theme-text-muted">/ {required} hrs</span>
      </span>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-theme-surface-secondary">
        <div
          className={`h-1.5 rounded-full transition-all duration-300 ${getProgressColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 9. EmptyTrainingState
// ---------------------------------------------------------------------------

interface EmptyTrainingStateProps {
  type: 'courses' | 'records' | 'requirements' | 'programs' | 'certifications';
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

const emptyStateConfig: Record<
  EmptyTrainingStateProps['type'],
  { icon: React.ReactNode; defaultMessage: string }
> = {
  courses: {
    icon: <BookOpen className="h-12 w-12 text-theme-text-muted" />,
    defaultMessage: 'No training courses found.',
  },
  records: {
    icon: <ClipboardList className="h-12 w-12 text-theme-text-muted" />,
    defaultMessage: 'No training records yet.',
  },
  requirements: {
    icon: <ShieldCheck className="h-12 w-12 text-theme-text-muted" />,
    defaultMessage: 'No training requirements configured.',
  },
  programs: {
    icon: <GraduationCap className="h-12 w-12 text-theme-text-muted" />,
    defaultMessage: 'No training programs available.',
  },
  certifications: {
    icon: <Award className="h-12 w-12 text-theme-text-muted" />,
    defaultMessage: 'No certifications on file.',
  },
};

export const EmptyTrainingState: React.FC<EmptyTrainingStateProps> = ({
  type,
  message,
  actionLabel,
  onAction,
}) => {
  const config = emptyStateConfig[type];

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {config.icon}
      <p className="mt-4 text-sm text-theme-text-muted">{message ?? config.defaultMessage}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
};
