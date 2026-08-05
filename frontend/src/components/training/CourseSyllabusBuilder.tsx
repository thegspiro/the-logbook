/**
 * Course Syllabus Builder
 *
 * Describes a multi-class course — the fifteen subjects that make up a recruit
 * school, in order, each timed relative to the course start rather than pinned
 * to a calendar date. Nothing here is scheduled; a cohort turns this outline
 * into real dated events.
 *
 * Every class must point at a catalog course (that is what carries credit
 * hours, certification settings, and category tagging), so the builder can
 * create one inline — otherwise an officer would have to leave, create fifteen
 * courses, and come back.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  CalendarRange,
  Clock,
  GraduationCap,
  Pencil,
  Plus,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { courseSyllabusService } from '../../services/trainingServices';
import { trainingService } from '../../services/api';
import { Skeleton } from '../ux/Skeleton';
import { EmptyState } from '../ux/EmptyState';
import { ConfirmDialog } from '../ux/ConfirmDialog';
import { MEETING_WEEKDAYS } from '../../constants/enums';
import { getErrorMessage } from '../../utils/errorHandling';
import type {
  CourseClass,
  CourseClassCreate,
  TrainingCourse,
} from '../../types/training';

interface CourseSyllabusBuilderProps {
  course: TrainingCourse;
  /** Opens the course-create modal; resolves with the new course, or null. */
  onCreateCourse?: () => Promise<TrainingCourse | null>;
  onChange?: (classes: CourseClass[]) => void;
}

const QUARTER_HOURS = ['00', '15', '30', '45'];

/** Options for a plain time select, restricted to quarter hours. */
const TIME_OPTIONS: string[] = Array.from({ length: 24 }, (_, hour) =>
  QUARTER_HOURS.map((m) => `${String(hour).padStart(2, '0')}:${m}`),
).flat();

/** "Day 1", "Day 4" — offsets are zero-based, officers count from one. */
const dayLabel = (offset: number): string => `Day ${offset + 1}`;

/**
 * Human summary of the gap since the previous class, which is how officers
 * actually describe a syllabus ("B is the day after A, C two days later").
 */
const gapLabel = (offset: number, previousOffset: number | null): string => {
  if (previousOffset === null) return 'Course start';
  const gap = offset - previousOffset;
  if (gap === 0) return 'Same day';
  if (gap === 1) return 'Next day';
  if (gap < 0) return `${Math.abs(gap)} days earlier`;
  return `${gap} days later`;
};

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
};

interface ClassRowFormProps {
  courses: TrainingCourse[];
  initial?: CourseClass | undefined;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (data: CourseClassCreate) => void;
  onCreateCourse?: (() => Promise<TrainingCourse | null>) | undefined;
}

const ClassRowForm: React.FC<ClassRowFormProps> = ({
  courses,
  initial,
  submitting,
  onCancel,
  onSubmit,
  onCreateCourse,
}) => {
  const [classCourseId, setClassCourseId] = useState(
    initial?.class_course_id ?? '',
  );
  const [title, setTitle] = useState(initial?.title ?? '');
  const [sectionName, setSectionName] = useState(initial?.section_name ?? '');
  const [dayOffset, setDayOffset] = useState(String(initial?.day_offset ?? 0));
  const [startTime, setStartTime] = useState(initial?.start_time ?? '19:00');
  const [durationMinutes, setDurationMinutes] = useState(
    String(initial?.duration_minutes ?? 180),
  );
  const [creditHours, setCreditHours] = useState(
    initial?.credit_hours != null ? String(initial.credit_hours) : '',
  );
  const [countsTowardCert, setCountsTowardCert] = useState(
    initial?.counts_toward_certification ?? true,
  );

  const selectedCourse = courses.find((c) => c.id === classCourseId);

  const handleCreateCourse = async () => {
    if (!onCreateCourse) return;
    const created = await onCreateCourse();
    if (created) setClassCourseId(created.id);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!classCourseId) {
      toast.error('Pick the course this class teaches');
      return;
    }
    // `||` not `??`: an empty form field must become undefined so the API
    // omits it, rather than being sent as an empty string.
    onSubmit({
      class_course_id: classCourseId,
      title: title.trim() || undefined,
      section_name: sectionName.trim() || undefined,
      day_offset: Number(dayOffset) || 0,
      start_time: startTime || undefined,
      duration_minutes: Number(durationMinutes) || 60,
      credit_hours: creditHours ? Number(creditHours) : undefined,
      counts_toward_certification: countsTowardCert,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="card-secondary space-y-4 border-l-4 border-l-red-500 p-4"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="form-label" htmlFor="class-course">
            Course taught
          </label>
          <div className="flex items-center gap-2">
            <select
              id="class-course"
              value={classCourseId}
              onChange={(e) => setClassCourseId(e.target.value)}
              className="form-input flex-1"
              required
            >
              <option value="">Select a course…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.code ? ` (${c.code})` : ''}
                </option>
              ))}
            </select>
            {onCreateCourse && (
              <button
                type="button"
                onClick={() => void handleCreateCourse()}
                className="btn-icon shrink-0 border border-theme-surface-border"
                aria-label="Create a new course"
                title="Create a new course"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
          {selectedCourse && (
            <p className="mt-1 text-xs text-theme-text-muted">
              {selectedCourse.credit_hours != null
                ? `${selectedCourse.credit_hours} credit hours`
                : 'No credit hours set on this course'}
              {selectedCourse.active === false && ' — archived'}
            </p>
          )}
        </div>

        <div>
          <label className="form-label" htmlFor="class-title">
            Title <span className="text-theme-text-muted">(optional)</span>
          </label>
          <input
            id="class-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={selectedCourse?.name ?? 'Defaults to the course name'}
            className="form-input"
          />
        </div>

        <div>
          <label className="form-label" htmlFor="class-section">
            Section <span className="text-theme-text-muted">(optional)</span>
          </label>
          <input
            id="class-section"
            type="text"
            value={sectionName}
            onChange={(e) => setSectionName(e.target.value)}
            placeholder="e.g. Orientation & Safety"
            className="form-input"
          />
          <p className="mt-1 text-xs text-theme-text-muted">
            Sections become phases when a pipeline is generated.
          </p>
        </div>

        <div>
          <label className="form-label" htmlFor="class-offset">
            Day
          </label>
          <input
            id="class-offset"
            type="number"
            min={0}
            value={dayOffset}
            onChange={(e) => setDayOffset(e.target.value)}
            className="form-input"
          />
          <p className="mt-1 text-xs text-theme-text-muted">
            Days after the course start. 0 is the first day.
          </p>
        </div>

        <div>
          <label className="form-label" htmlFor="class-time">
            Start time
          </label>
          <select
            id="class-time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="form-input"
          >
            {TIME_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="form-label" htmlFor="class-duration">
            Duration (minutes)
          </label>
          <input
            id="class-duration"
            type="number"
            min={15}
            step={15}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
            className="form-input"
          />
        </div>

        <div>
          <label className="form-label" htmlFor="class-credits">
            Credit hours{' '}
            <span className="text-theme-text-muted">(optional)</span>
          </label>
          <input
            id="class-credits"
            type="number"
            min={0}
            step={0.25}
            value={creditHours}
            onChange={(e) => setCreditHours(e.target.value)}
            placeholder={
              selectedCourse?.credit_hours != null
                ? String(selectedCourse.credit_hours)
                : 'From the course'
            }
            className="form-input"
          />
        </div>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={countsTowardCert}
          onChange={(e) => setCountsTowardCert(e.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="font-medium text-theme-text-primary">
            Counts toward certification requirements
          </span>
          <span className="block text-theme-text-muted">
            Leave on for classes delivered the way a certifying body accepts.
            Turn it off for an informal in-house drill: attendance still earns
            hours, but the class won&rsquo;t advance a certificate.
          </span>
        </span>
      </label>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-icon px-4">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Saving…' : initial ? 'Save class' : 'Add class'}
        </button>
      </div>
    </form>
  );
};

export const CourseSyllabusBuilder: React.FC<CourseSyllabusBuilderProps> = ({
  course,
  onCreateCourse,
  onChange,
}) => {
  const [classes, setClasses] = useState<CourseClass[]>([]);
  const [catalog, setCatalog] = useState<TrainingCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseClass | null>(null);
  const [showPattern, setShowPattern] = useState(false);
  const [meetingDays, setMeetingDays] = useState<number[]>([1, 3]);
  const [patternStartWeekday, setPatternStartWeekday] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [syllabus, allCourses] = await Promise.all([
        courseSyllabusService.getClasses(course.id),
        trainingService.getCourses(),
      ]);
      setClasses(syllabus);
      // A course cannot be one of its own classes.
      setCatalog(allCourses.filter((c) => c.id !== course.id));
      onChange?.(syllabus);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load the syllabus'));
    } finally {
      setLoading(false);
    }
  }, [course.id, onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalCreditHours = useMemo(
    () => classes.reduce((sum, c) => sum + (c.credit_hours ?? 0), 0),
    [classes],
  );

  const spanDays = useMemo(() => {
    if (classes.length === 0) return 0;
    return Math.max(...classes.map((c) => c.day_offset)) + 1;
  }, [classes]);

  const handleAdd = async (data: CourseClassCreate) => {
    setSubmitting(true);
    try {
      await courseSyllabusService.addClass(course.id, data);
      toast.success('Class added');
      setAdding(false);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to add the class'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (classId: string, data: CourseClassCreate) => {
    setSubmitting(true);
    try {
      await courseSyllabusService.updateClass(course.id, classId, data);
      toast.success('Class updated');
      setEditingId(null);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update the class'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await courseSyllabusService.deleteClass(course.id, deleteTarget.id);
      toast.success('Class removed');
      setDeleteTarget(null);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove the class'));
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= classes.length) return;

    const reordered = [...classes];
    const moved = reordered[index];
    const swapped = reordered[target];
    if (!moved || !swapped) return;
    reordered[index] = swapped;
    reordered[target] = moved;

    setClasses(reordered); // optimistic: the arrows should feel instant
    try {
      const saved = await courseSyllabusService.reorderClasses(
        course.id,
        reordered.map((c) => c.id),
      );
      setClasses(saved);
      onChange?.(saved);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reorder the syllabus'));
      await load();
    }
  };

  const handleAutofill = async () => {
    if (meetingDays.length === 0) {
      toast.error('Pick at least one meeting day');
      return;
    }
    setSubmitting(true);
    try {
      const saved = await courseSyllabusService.autofillOffsets(course.id, {
        meeting_days: meetingDays,
        start_weekday: patternStartWeekday,
      });
      setClasses(saved);
      onChange?.(saved);
      setShowPattern(false);
      toast.success('Schedule pattern applied');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to apply the pattern'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMeetingDay = (day: number) => {
    setMeetingDays((current) =>
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b),
    );
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-theme-text-primary">
            <GraduationCap className="h-5 w-5 text-red-700 dark:text-red-500" />
            <span>Classes</span>
          </h3>
          <p className="text-sm text-theme-text-muted">
            {classes.length === 0
              ? 'No classes yet — add the subjects this course covers.'
              : `${classes.length} class${classes.length === 1 ? '' : 'es'} over ${spanDays} day${spanDays === 1 ? '' : 's'}` +
                (totalCreditHours > 0
                  ? ` · ${totalCreditHours} credit hours`
                  : '')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {classes.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPattern((s) => !s)}
              className="btn-icon flex items-center gap-2 border border-theme-surface-border px-3"
            >
              <Wand2 className="h-4 w-4" />
              <span className="text-sm">Fill from pattern</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setAdding(true);
            }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span>Add class</span>
          </button>
        </div>
      </div>

      {showPattern && (
        <div className="card-secondary space-y-3 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-medium text-theme-text-primary">
                Fill offsets from a meeting pattern
              </p>
              <p className="text-sm text-theme-text-muted">
                Spaces every class across the days the course meets. Individual
                days stay editable afterwards.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPattern(false)}
              className="btn-icon"
              aria-label="Close the pattern editor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="hscroll flex gap-2">
            {MEETING_WEEKDAYS.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleMeetingDay(day.value)}
                aria-pressed={meetingDays.includes(day.value)}
                className={`mobile-touch-target rounded-lg border px-3 text-sm ${
                  meetingDays.includes(day.value)
                    ? 'border-red-500 bg-red-600/20 text-red-700 dark:text-red-400'
                    : 'border-theme-surface-border bg-theme-surface-secondary text-theme-text-muted'
                }`}
              >
                {day.short}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="form-label" htmlFor="pattern-start">
                Course starts on a
              </label>
              <select
                id="pattern-start"
                value={patternStartWeekday}
                onChange={(e) => setPatternStartWeekday(Number(e.target.value))}
                className="form-input"
              >
                {MEETING_WEEKDAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void handleAutofill()}
              disabled={submitting}
              className="btn-primary"
            >
              Apply to all {classes.length} classes
            </button>
          </div>
        </div>
      )}

      {adding && (
        <ClassRowForm
          courses={catalog}
          submitting={submitting}
          onCancel={() => setAdding(false)}
          onSubmit={(data) => void handleAdd(data)}
          onCreateCourse={onCreateCourse}
        />
      )}

      {classes.length === 0 && !adding ? (
        <EmptyState
          icon={CalendarRange}
          title="No classes on this syllabus"
          description="Add each subject the course covers and say how many days after the start it happens. Generating a cohort turns this outline into real, dated training events."
        />
      ) : (
        <ol className="space-y-2">
          {classes.map((item, index) => {
            const previous = index > 0 ? classes[index - 1] : undefined;
            const previousOffset = previous ? previous.day_offset : null;
            const isEditing = editingId === item.id;

            if (isEditing) {
              return (
                <li key={item.id}>
                  <ClassRowForm
                    courses={catalog}
                    initial={item}
                    submitting={submitting}
                    onCancel={() => setEditingId(null)}
                    onSubmit={(data) => void handleUpdate(item.id, data)}
                    onCreateCourse={onCreateCourse}
                  />
                </li>
              );
            }

            return (
              <li
                key={item.id}
                className="card-secondary flex items-start gap-3 p-3"
              >
                <div className="flex flex-col items-center gap-1 pt-1">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-theme-surface text-xs font-semibold text-theme-text-primary">
                    {item.sequence}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleMove(index, -1)}
                    disabled={index === 0}
                    className="btn-icon h-6 w-6 disabled:opacity-30"
                    aria-label={`Move ${item.title ?? 'class'} earlier`}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleMove(index, 1)}
                    disabled={index === classes.length - 1}
                    className="btn-icon h-6 w-6 disabled:opacity-30"
                    aria-label={`Move ${item.title ?? 'class'} later`}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-theme-text-primary">
                      {item.title || item.class_course_name || 'Class'}
                    </span>
                    {item.section_name && (
                      <span className="badge">{item.section_name}</span>
                    )}
                    {item.class_course_active === false && (
                      <span className="badge bg-red-500/20 text-red-700 dark:text-red-400">
                        Course archived
                      </span>
                    )}
                  </div>

                  {item.class_course_name &&
                    item.title &&
                    item.title !== item.class_course_name && (
                      <p className="text-xs text-theme-text-muted">
                        {item.class_course_name}
                      </p>
                    )}

                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-text-muted">
                    <span className="font-medium text-theme-text-secondary">
                      {dayLabel(item.day_offset)}
                    </span>
                    <span>{gapLabel(item.day_offset, previousOffset)}</span>
                    {item.start_time && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {item.start_time} ·{' '}
                        {formatDuration(item.duration_minutes)}
                      </span>
                    )}
                    {item.credit_hours != null && (
                      <span>{item.credit_hours} credits</span>
                    )}
                    {item.instructor && <span>{item.instructor}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setEditingId(item.id);
                    }}
                    className="btn-icon"
                    aria-label={`Edit ${item.title ?? 'class'}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(item)}
                    className="btn-icon hover:text-red-700 dark:hover:text-red-400"
                    aria-label={`Remove ${item.title ?? 'class'}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Remove this class?"
        message={`"${deleteTarget?.title ?? deleteTarget?.class_course_name ?? 'This class'}" will be removed from the syllabus. Cohorts already generated keep their copy of it.`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default CourseSyllabusBuilder;
