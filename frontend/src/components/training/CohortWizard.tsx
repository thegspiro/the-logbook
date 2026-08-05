/**
 * Cohort Wizard
 *
 * Turns a course syllabus into a running class schedule: pick the course, set a
 * start date and meeting rules, review (and edit) every computed date, choose
 * the roster, and generate.
 *
 * The preview step is the point of the whole wizard. Generating a recruit
 * school drops fifteen events onto the department calendar and RSVPs the whole
 * roster to each; the officer sees exactly what will happen — including dates
 * that had to move around a weekend or holiday, and any room double-booking —
 * before anything is created.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Search,
  Users,
} from 'lucide-react';
import { ProgressSteps } from '../ux/ProgressSteps';
import { Skeleton } from '../ux/Skeleton';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import {
  courseCohortService,
  trainingService,
  userService,
} from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import {
  formatDate,
  formatForDateTimeInput,
  formatShortDateTime,
  getTodayLocalDate,
  localToUTC,
} from '../../utils/dateFormatting';
import { DateRollPolicy, MEETING_WEEKDAYS } from '../../constants/enums';
import { getErrorMessage } from '../../utils/errorHandling';
import type {
  CohortClassOverride,
  CohortSchedulePreviewResponse,
  CourseCohortDetail,
  PreviewClass,
  TrainingCourse,
} from '../../types/training';
import type { User } from '../../types/user';

interface CohortWizardProps {
  onComplete: (cohort: CourseCohortDetail) => void;
  onCancel: () => void;
  /** Pre-select a course (e.g. launched from the course library). */
  initialCourseId?: string;
}

const STEPS = [
  { label: 'Course', description: 'Which program' },
  { label: 'Schedule', description: 'Start date & pattern' },
  { label: 'Preview', description: 'Check the dates' },
  { label: 'Roster', description: 'Who attends' },
  { label: 'Generate', description: 'Confirm' },
];

/** Per-class edits keyed by syllabus class id. */
type Overrides = Record<string, { start?: string; end?: string; skip?: boolean }>;

export const CohortWizard: React.FC<CohortWizardProps> = ({
  onComplete,
  onCancel,
  initialCourseId,
}) => {
  const tz = useTimezone();

  const [step, setStep] = useState(0);
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Step 1 — course
  const [courseId, setCourseId] = useState(initialCourseId ?? '');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  // Step 2 — schedule
  const [startDate, setStartDate] = useState(getTodayLocalDate(tz));
  const [meetingDays, setMeetingDays] = useState<number[]>([]);
  const [defaultStartTime, setDefaultStartTime] = useState('');
  const [rollPolicy, setRollPolicy] = useState<DateRollPolicy>(
    DateRollPolicy.NONE,
  );
  const [blackoutDates, setBlackoutDates] = useState<string[]>([]);

  // Step 3 — preview
  const [preview, setPreview] = useState<CohortSchedulePreviewResponse | null>(
    null,
  );
  const [overrides, setOverrides] = useState<Overrides>({});

  // Step 4 — roster
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  // Step 5 — pipeline
  const [generateProgram, setGenerateProgram] = useState(true);

  const selectedCourse = courses.find((c) => c.id === courseId);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [courseList, memberList] = await Promise.all([
          trainingService.getCourses(),
          userService.getUsers(),
        ]);
        setCourses(courseList);
        setMembers(memberList);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load courses'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  // Default the cohort name off the course, e.g. "Recruit School — Fall 2026".
  useEffect(() => {
    if (selectedCourse && !name) {
      setName(`${selectedCourse.name} — ${new Date().getFullYear()}`);
    }
    // Only seed the name when the course changes; never fight the officer's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const runPreview = useCallback(async () => {
    if (!courseId) return;
    setPreviewing(true);
    try {
      const result = await courseCohortService.previewSchedule({
        course_id: courseId,
        start_date: startDate,
        meeting_days: meetingDays.length > 0 ? meetingDays : undefined,
        default_start_time: defaultStartTime || undefined,
        date_roll_policy: rollPolicy,
        blackout_dates: blackoutDates.length > 0 ? blackoutDates : undefined,
      });
      setPreview(result);
      setOverrides({});
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not build the schedule'));
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [courseId, startDate, meetingDays, defaultStartTime, rollPolicy, blackoutDates]);

  const suggestedBlackouts = preview?.suggested_blackout_dates ?? [];

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return members;
    return members.filter((m) =>
      `${m.first_name ?? ''} ${m.last_name ?? ''} ${m.email ?? ''}`
        .toLowerCase()
        .includes(query),
    );
  }, [members, memberSearch]);

  const includedClasses = useMemo(
    () =>
      (preview?.classes ?? []).filter(
        (c) => !overrides[c.course_class_id]?.skip,
      ),
    [preview, overrides],
  );

  const effectiveStart = (item: PreviewClass): string =>
    overrides[item.course_class_id]?.start ?? item.scheduled_start;

  const handleAdvance = async () => {
    if (step === 0) {
      if (!courseId) {
        toast.error('Pick a course');
        return;
      }
      if (!name.trim()) {
        toast.error('Give this cohort a name');
        return;
      }
    }
    if (step === 1) {
      if (!startDate) {
        toast.error('Pick a start date');
        return;
      }
      await runPreview();
    }
    if (step === 2 && includedClasses.length === 0) {
      toast.error('At least one class must be included');
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleGenerate = async () => {
    if (!preview) return;
    setGenerating(true);
    try {
      const classOverrides: CohortClassOverride[] = Object.entries(overrides)
        .filter(([, value]) => value.skip || value.start)
        .map(([classId, value]) => ({
          course_class_id: classId,
          skip: value.skip ?? false,
          scheduled_start: value.start || undefined,
          scheduled_end: value.end || undefined,
        }));

      const cohort = await courseCohortService.createCohort({
        course_id: courseId,
        name: name.trim(),
        code: code.trim() || undefined,
        start_date: startDate,
        meeting_days: meetingDays.length > 0 ? meetingDays : undefined,
        default_start_time: defaultStartTime || undefined,
        date_roll_policy: rollPolicy,
        blackout_dates: blackoutDates.length > 0 ? blackoutDates : undefined,
        generate_program: generateProgram && !selectedCourse?.program_id,
        program_id: selectedCourse?.program_id || undefined,
        classes: classOverrides.length > 0 ? classOverrides : undefined,
        member_user_ids:
          selectedMembers.length > 0 ? selectedMembers : undefined,
      });

      toast.success(`Generated ${cohort.classes.length} classes`);
      onComplete(cohort);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not generate the cohort'));
    } finally {
      setGenerating(false);
    }
  };

  const toggleMeetingDay = (day: number) => {
    setMeetingDays((current) =>
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort((a, b) => a - b),
    );
  };

  const toggleMember = (userId: string) => {
    setSelectedMembers((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  };

  const toggleBlackout = (day: string) => {
    setBlackoutDates((current) =>
      current.includes(day)
        ? current.filter((d) => d !== day)
        : [...current, day].sort(),
    );
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProgressSteps steps={STEPS} currentStep={step} />

      {/* ── Step 1: course ─────────────────────────────────────── */}
      {step === 0 && (
        <div className="card space-y-4 p-5">
          <div>
            <label className="form-label" htmlFor="cohort-course">
              Course
            </label>
            <select
              id="cohort-course"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="form-input"
            >
              <option value="">Select a course…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.code ? ` (${c.code})` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-theme-text-muted">
              The course must already have classes on its syllabus.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="form-label" htmlFor="cohort-name">
                Cohort name
              </label>
              <input
                id="cohort-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Recruit School — Fall 2026"
                className="form-input"
              />
            </div>
            <div>
              <label className="form-label" htmlFor="cohort-code">
                Code <span className="text-theme-text-muted">(optional)</span>
              </label>
              <input
                id="cohort-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="RS-2026-F"
                className="form-input"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: schedule ───────────────────────────────────── */}
      {step === 1 && (
        <div className="card space-y-5 p-5">
          <div>
            <label className="form-label" htmlFor="cohort-start">
              Start date
            </label>
            <input
              id="cohort-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="form-input md:max-w-xs"
            />
            <p className="mt-1 text-xs text-theme-text-muted">
              Every class is scheduled relative to this date.
            </p>
          </div>

          <div>
            <span className="form-label">
              Meeting days{' '}
              <span className="text-theme-text-muted">(optional)</span>
            </span>
            <div className="hscroll mt-1 flex gap-2">
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
            <p className="mt-1 text-xs text-theme-text-muted">
              Used by the &ldquo;next meeting day&rdquo; rule below.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="form-label" htmlFor="cohort-policy">
                When a class lands on a skipped day
              </label>
              <select
                id="cohort-policy"
                value={rollPolicy}
                onChange={(e) =>
                  setRollPolicy(e.target.value as DateRollPolicy)
                }
                className="form-input"
              >
                <option value={DateRollPolicy.NONE}>
                  Keep the computed date
                </option>
                <option value={DateRollPolicy.NEXT_BUSINESS_DAY}>
                  Move weekends to the next weekday
                </option>
                <option value={DateRollPolicy.NEXT_MEETING_DAY}>
                  Move to the next meeting day
                </option>
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="cohort-time">
                Default start time{' '}
                <span className="text-theme-text-muted">(optional)</span>
              </label>
              <input
                id="cohort-time"
                type="time"
                step={900}
                value={defaultStartTime}
                onChange={(e) => setDefaultStartTime(e.target.value)}
                className="form-input"
              />
              <p className="mt-1 text-xs text-theme-text-muted">
                Only used for classes with no time of their own.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3: preview ────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {previewing ? (
            <Skeleton className="h-64 w-full" />
          ) : !preview ? (
            <div className="alert-warning">
              Could not build a schedule. Go back and check the course has
              classes on its syllabus.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-theme-text-muted">
                  {includedClasses.length} class
                  {includedClasses.length === 1 ? '' : 'es'} from{' '}
                  {formatDate(preview.classes[0]?.scheduled_start, tz)} — times
                  shown in {preview.timezone}
                </p>
                <button
                  type="button"
                  onClick={() => void runPreview()}
                  className="btn-icon border border-theme-surface-border px-3 text-sm"
                >
                  Recalculate
                </button>
              </div>

              {suggestedBlackouts.length > 0 && (
                <div className="card-secondary space-y-2 p-4">
                  <p className="text-sm font-medium text-theme-text-primary">
                    Holidays in this range
                  </p>
                  <p className="text-xs text-theme-text-muted">
                    Select any the department does not train on, then
                    recalculate.
                  </p>
                  <div className="hscroll flex gap-2">
                    {suggestedBlackouts.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleBlackout(day)}
                        aria-pressed={blackoutDates.includes(day)}
                        className={`mobile-touch-target whitespace-nowrap rounded-lg border px-3 text-xs ${
                          blackoutDates.includes(day)
                            ? 'border-red-500 bg-red-600/20 text-red-700 dark:text-red-400'
                            : 'border-theme-surface-border bg-theme-surface-secondary text-theme-text-muted'
                        }`}
                      >
                        {formatDate(day, tz)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <ul className="space-y-2">
                {preview.classes.map((item) => {
                  const override = overrides[item.course_class_id];
                  const skipped = override?.skip ?? false;
                  return (
                    <li
                      key={item.course_class_id}
                      className={`card-secondary p-3 ${skipped ? 'opacity-50' : ''}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-theme-surface text-xs font-semibold">
                              {item.sequence}
                            </span>
                            <span className="font-medium text-theme-text-primary">
                              {item.title}
                            </span>
                            {item.section_name && (
                              <span className="badge">{item.section_name}</span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-theme-text-secondary">
                            {formatShortDateTime(effectiveStart(item), tz)}
                          </p>
                          {item.warnings.map((warning) => (
                            <p
                              key={warning}
                              className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400"
                            >
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                              <span>{warning}</span>
                            </p>
                          ))}
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <DateTimeQuarterHour
                            value={formatForDateTimeInput(
                              effectiveStart(item),
                              tz,
                            )}
                            onChange={(value: string) => {
                              const utcStart = localToUTC(value, tz);
                              const durationMs =
                                new Date(item.scheduled_end).getTime() -
                                new Date(item.scheduled_start).getTime();
                              setOverrides((current) => ({
                                ...current,
                                [item.course_class_id]: {
                                  ...current[item.course_class_id],
                                  start: utcStart,
                                  end: new Date(
                                    new Date(utcStart).getTime() + durationMs,
                                  ).toISOString(),
                                },
                              }));
                            }}
                          />
                          <label className="flex items-center gap-2 text-xs text-theme-text-muted">
                            <input
                              type="checkbox"
                              checked={skipped}
                              onChange={() =>
                                setOverrides((current) => ({
                                  ...current,
                                  [item.course_class_id]: {
                                    ...current[item.course_class_id],
                                    skip: !skipped,
                                  },
                                }))
                              }
                            />
                            <span>Skip this class</span>
                          </label>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {/* ── Step 4: roster ─────────────────────────────────────── */}
      {step === 3 && (
        <div className="card space-y-4 p-5">
          <div>
            <p className="font-medium text-theme-text-primary">
              Who is taking this course?
            </p>
            <p className="text-sm text-theme-text-muted">
              Selected members are enrolled in the pipeline and added to every
              class on their calendar. You can add more later.
            </p>
          </div>

          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-text-muted"
              aria-hidden="true"
            />
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search members…"
              aria-label="Search members"
              className="form-input pl-10"
            />
          </div>

          <div className="max-h-80 space-y-1 overflow-y-auto">
            {filteredMembers.map((member) => (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-theme-surface-hover"
              >
                <input
                  type="checkbox"
                  checked={selectedMembers.includes(member.id)}
                  onChange={() => toggleMember(member.id)}
                />
                <span className="text-sm text-theme-text-primary">
                  {member.first_name} {member.last_name}
                </span>
                <span className="text-xs text-theme-text-muted">
                  {member.email}
                </span>
              </label>
            ))}
            {filteredMembers.length === 0 && (
              <p className="p-3 text-sm text-theme-text-muted">
                No members match that search.
              </p>
            )}
          </div>

          <p className="flex items-center gap-2 text-sm text-theme-text-secondary">
            <Users className="h-4 w-4" />
            {selectedMembers.length} selected
          </p>
        </div>
      )}

      {/* ── Step 5: confirm ────────────────────────────────────── */}
      {step === 4 && (
        <div className="card space-y-4 p-5">
          <h3 className="font-semibold text-theme-text-primary">
            Ready to generate
          </h3>

          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-theme-text-muted">Course</dt>
              <dd className="text-theme-text-primary">
                {selectedCourse?.name}
              </dd>
            </div>
            <div>
              <dt className="text-theme-text-muted">Cohort</dt>
              <dd className="text-theme-text-primary">{name}</dd>
            </div>
            <div>
              <dt className="text-theme-text-muted">Classes</dt>
              <dd className="text-theme-text-primary">
                {includedClasses.length}
              </dd>
            </div>
            <div>
              <dt className="text-theme-text-muted">Members</dt>
              <dd className="text-theme-text-primary">
                {selectedMembers.length}
              </dd>
            </div>
            <div>
              <dt className="text-theme-text-muted">First class</dt>
              <dd className="text-theme-text-primary">
                {includedClasses[0]
                  ? formatShortDateTime(effectiveStart(includedClasses[0]), tz)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-theme-text-muted">Last class</dt>
              <dd className="text-theme-text-primary">
                {includedClasses.length > 0
                  ? formatShortDateTime(
                      effectiveStart(
                        includedClasses[includedClasses.length - 1] as PreviewClass,
                      ),
                      tz,
                    )
                  : '—'}
              </dd>
            </div>
          </dl>

          {selectedCourse?.program_id ? (
            <p className="alert-info text-sm">
              Members will be enrolled in this course&rsquo;s existing pipeline.
            </p>
          ) : (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={generateProgram}
                onChange={(e) => setGenerateProgram(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-theme-text-primary">
                  Build a matching pipeline
                </span>
                <span className="block text-theme-text-muted">
                  Creates a program whose phases mirror the syllabus sections,
                  so attendance progresses each member automatically.
                </span>
              </span>
            </label>
          )}

          <p className="text-sm text-theme-text-muted">
            This creates {includedClasses.length} training event
            {includedClasses.length === 1 ? '' : 's'} on the department
            calendar.
          </p>
        </div>
      )}

      {/* ── Navigation ─────────────────────────────────────────── */}
      <div className="action-bar-safe flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={step === 0 ? onCancel : () => setStep((s) => s - 1)}
          className="btn-icon flex items-center gap-1 border border-theme-surface-border px-4"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>{step === 0 ? 'Cancel' : 'Back'}</span>
        </button>

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => void handleAdvance()}
            disabled={previewing}
            className="btn-primary flex items-center gap-1"
          >
            <span>{previewing ? 'Calculating…' : 'Next'}</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="btn-primary flex items-center gap-2"
          >
            {generating ? (
              <span>Generating…</span>
            ) : (
              <>
                <CalendarPlus className="h-4 w-4" />
                <span>Generate {includedClasses.length} classes</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};

export default CohortWizard;
