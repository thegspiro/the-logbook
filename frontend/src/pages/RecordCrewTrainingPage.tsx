/**
 * Record Crew Training
 *
 * A shift officer records a drill once for everyone who was there. Each member
 * present gets a pending entry in the training officer's review queue; nobody
 * is credited until it is approved. Open to any member who can serve as a
 * shift officer — the backend decides who that is and reports it through
 * `getCrewRecordingContext`.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { CheckCircle2, Search, Users } from 'lucide-react';
import { EmptyState } from '../components/ux';
import { TrainingPageHeader } from '../components/training/TrainingPageHeader';
import { trainingProgramService, trainingService, trainingSubmissionService } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { useAuthStore } from '../stores/authStore';
import { formatTime, getTodayLocalDate } from '../utils/dateFormatting';
import { formatHours } from '../utils/hoursFormatting';
import { getErrorDetail } from '../utils/errorHandling';
import { TRAINING_TYPE_LABELS } from '../constants/enums';
import type {
  CrewMemberOption,
  CrewShiftOption,
  SelfReportConfig,
  TrainingCategory,
  TrainingType,
} from '../types/training';

const CREW_TRAINING_TYPES: TrainingType[] = [
  'skills_practice',
  'continuing_education',
  'refresher',
  'orientation',
  'specialty',
];

const DEFAULT_MINUTES = 60;

const inputClass = 'form-input';
const labelClass = 'form-label';

const RecordCrewTrainingPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const currentUserId = useAuthStore((state) => state.user?.id);

  const [loading, setLoading] = useState(true);
  const [canRecord, setCanRecord] = useState(false);
  const [members, setMembers] = useState<CrewMemberOption[]>([]);
  const [config, setConfig] = useState<SelfReportConfig | null>(null);
  const [categories, setCategories] = useState<TrainingCategory[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const [courseName, setCourseName] = useState('');
  const [trainingType, setTrainingType] = useState<TrainingType>('skills_practice');
  const [completionDate, setCompletionDate] = useState(() => getTodayLocalDate(tz));
  const [startTime, setStartTime] = useState('');
  const [minutes, setMinutes] = useState<string>(String(DEFAULT_MINUTES));
  const [instructor, setInstructor] = useState('');
  const [location, setLocation] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');

  const [shifts, setShifts] = useState<CrewShiftOption[]>([]);
  const [shiftId, setShiftId] = useState('');
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [memberFilter, setMemberFilter] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [recordedCount, setRecordedCount] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const context = await trainingSubmissionService.getCrewRecordingContext();
        setCanRecord(context.can_record);
        setMembers(context.members);
        if (!context.can_record) return;
        // The recorder usually took part; they can uncheck themselves.
        if (currentUserId) setPresent(new Set([currentUserId]));

        const [configData, categoryData, requirementData, courseData] = await Promise.all([
          trainingSubmissionService.getConfig(),
          trainingService.getCategories().catch(() => []),
          // Suggestions only help consistency; failing to load them never blocks recording.
          trainingProgramService.getRequirementsEnhanced().catch(() => []),
          trainingService.getCourses().catch(() => []),
        ]);
        setConfig(configData);
        setCategories(categoryData);
        const names = [
          ...requirementData.filter((r) => r.active).map((r) => r.name),
          ...courseData.filter((c) => c.active).map((c) => c.name),
        ];
        setSuggestions([...new Set(names)].sort((a, b) => a.localeCompare(b)));
      } catch {
        setError('Could not load the crew training form. Try again.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [currentUserId]);

  useEffect(() => {
    if (!canRecord || !completionDate) return;
    setShiftId('');
    trainingSubmissionService
      .getCrewShiftOptions(completionDate)
      .then(setShifts)
      .catch(() => setShifts([]));
  }, [canRecord, completionDate]);

  const allowedTypes = useMemo(() => {
    const allowed = config?.allowed_training_types;
    return allowed && allowed.length > 0 ? CREW_TRAINING_TYPES.filter((t) => allowed.includes(t)) : CREW_TRAINING_TYPES;
  }, [config]);

  useEffect(() => {
    const first = allowedTypes[0];
    if (first && !allowedTypes.includes(trainingType)) setTrainingType(first);
  }, [allowedTypes, trainingType]);

  const filteredMembers = useMemo(() => {
    const term = memberFilter.trim().toLowerCase();
    return term ? members.filter((m) => m.name.toLowerCase().includes(term)) : members;
  }, [members, memberFilter]);

  const parentCategories = useMemo(() => categories.filter((c) => !c.parent_category_id), [categories]);
  const hours = Number(minutes) / 60;

  const toggleMember = (id: string) => {
    setPresent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chooseShift = (id: string) => {
    setShiftId(id);
    const shift = shifts.find((s) => s.id === id);
    if (!shift) return;
    setPresent((prev) => new Set([...prev, ...shift.member_ids]));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!courseName.trim()) {
      setError('Enter what the training covered.');
      return;
    }
    if (!completionDate) {
      setError('Enter the date the training took place.');
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      setError('Enter how long the training ran.');
      return;
    }
    if (present.size === 0) {
      setError('Select at least one member who was present.');
      return;
    }
    setSaving(true);
    try {
      const result = await trainingSubmissionService.recordCrewTraining({
        course_name: courseName.trim(),
        training_type: trainingType,
        completion_date: completionDate,
        start_time: startTime || undefined,
        hours_completed: Math.round(hours * 100) / 100,
        instructor: instructor.trim() || undefined,
        location: location.trim() || undefined,
        category_id: categoryId || undefined,
        description: description.trim() || undefined,
        shift_id: shiftId || undefined,
        member_ids: [...present],
      });
      setRecordedCount(result.submissions.length);
      toast.success('Crew training sent for review');
    } catch (err: unknown) {
      setError(getErrorDetail(err) || 'Failed to record crew training');
    } finally {
      setSaving(false);
    }
  };

  // Part of Submit Training: a shift officer reaches it from that page, and
  // the URL does not sit under it.
  const header = (
    <TrainingPageHeader
      icon={Users}
      title="Record Crew Training"
      subtitle="Record a drill once for everyone who was there. The training officer reviews it before anyone is credited."
      section="/training/submit"
    />
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {header}
        <div className="mx-auto max-w-3xl">
          <p className="text-theme-text-muted py-12 text-center">Loading…</p>
        </div>
      </div>
    );
  }

  if (!canRecord) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {header}
        <div className="mx-auto max-w-3xl">
          <div className="card">
            <EmptyState
              icon={Users}
              title="Shift officers only"
              description={
                error ||
                'Crew training is recorded by members who can serve as a shift officer. Log your own training instead.'
              }
              actions={[{ label: 'Log my training', onClick: () => void navigate('/training/submit') }]}
            />
          </div>
        </div>
      </div>
    );
  }

  if (recordedCount !== null) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {header}
        <div className="mx-auto max-w-3xl">
          <div className="card p-6 text-center" role="status">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-700 dark:text-green-400" />
            <h2 className="text-theme-text-primary text-lg font-semibold">Sent for review</h2>
            <p className="text-theme-text-muted mt-1 text-sm">
              {courseName.trim()} ({formatHours(hours)}h) was recorded for {recordedCount}{' '}
              {recordedCount === 1 ? 'member' : 'members'}. It will count once the training officer approves it.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link to="/training/submit" className="btn-secondary touch:min-h-11 text-sm">
                Done
              </Link>
              <button
                type="button"
                className="btn-primary touch:min-h-11 text-sm"
                onClick={() => {
                  setRecordedCount(null);
                  setCourseName('');
                  setDescription('');
                  setShiftId('');
                  setPresent(new Set(currentUserId ? [currentUserId] : []));
                }}
              >
                Record another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-page-main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {header}
      {/* The form keeps its reading width under the full-width strip. */}
      <div className="mx-auto max-w-3xl">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6" noValidate>
          <section className="card space-y-4 p-4">
            <h2 className="text-theme-text-primary font-semibold">What was the training?</h2>
            <div>
              <label htmlFor="crew-course" className={labelClass}>
                Topic <span aria-hidden="true">*</span>
              </label>
              <input
                id="crew-course"
                className={inputClass}
                list="crew-course-suggestions"
                value={courseName}
                maxLength={255}
                required
                placeholder="Start typing — suggestions appear"
                onChange={(e) => setCourseName(e.target.value)}
              />
              <datalist id="crew-course-suggestions">
                {suggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <p className="text-theme-text-muted mt-1 text-xs">
                Pick a suggestion when one fits, so the same drill is named the same way every time.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="crew-type" className={labelClass}>
                  Training type
                </label>
                <select
                  id="crew-type"
                  className={inputClass}
                  value={trainingType}
                  onChange={(e) => setTrainingType(e.target.value as TrainingType)}
                >
                  {allowedTypes.map((type) => (
                    <option key={type} value={type}>
                      {TRAINING_TYPE_LABELS[type] || type}
                    </option>
                  ))}
                </select>
              </div>
              {parentCategories.length > 0 && (
                <div>
                  <label htmlFor="crew-category" className={labelClass}>
                    Category (optional)
                  </label>
                  <select
                    id="crew-category"
                    className={inputClass}
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">No category</option>
                    {parentCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="crew-description" className={labelClass}>
                What it covered (optional)
              </label>
              <textarea
                id="crew-description"
                className={inputClass}
                rows={2}
                maxLength={5000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </section>

          <section className="card space-y-4 p-4">
            <h2 className="text-theme-text-primary font-semibold">When and how long?</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="crew-date" className={labelClass}>
                  Date <span aria-hidden="true">*</span>
                </label>
                <input
                  id="crew-date"
                  type="date"
                  className={inputClass}
                  value={completionDate}
                  required
                  max={getTodayLocalDate(tz)}
                  onChange={(e) => setCompletionDate(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="crew-start" className={labelClass}>
                  Start time (optional)
                </label>
                <input
                  id="crew-start"
                  type="time"
                  className={inputClass}
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="crew-minutes" className={labelClass}>
                  Length (minutes)
                </label>
                <input
                  id="crew-minutes"
                  type="number"
                  inputMode="numeric"
                  min={5}
                  step={5}
                  className={inputClass}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
                {hours > 0 && <p className="text-theme-text-muted mt-1 text-xs">{formatHours(hours)} hours</p>}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="crew-instructor" className={labelClass}>
                  Instructor (optional)
                </label>
                <input
                  id="crew-instructor"
                  className={inputClass}
                  maxLength={255}
                  value={instructor}
                  onChange={(e) => setInstructor(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="crew-location" className={labelClass}>
                  Location (optional)
                </label>
                <input
                  id="crew-location"
                  className={inputClass}
                  maxLength={255}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="card space-y-4 p-4">
            <h2 className="text-theme-text-primary font-semibold">Who was there?</h2>
            {shifts.length > 0 && (
              <div>
                <label htmlFor="crew-shift" className={labelClass}>
                  Shift (optional)
                </label>
                <select
                  id="crew-shift"
                  className={inputClass}
                  value={shiftId}
                  onChange={(e) => chooseShift(e.target.value)}
                >
                  <option value="">Not tied to a shift</option>
                  {shifts.map((shift) => (
                    <option key={shift.id} value={shift.id}>
                      {[
                        `${formatTime(shift.start_time, tz)}${shift.end_time ? `–${formatTime(shift.end_time, tz)}` : ''}`,
                        shift.platoon ? `Platoon ${shift.platoon}` : null,
                        shift.shift_officer_name ? `Officer: ${shift.shift_officer_name}` : null,
                        `${shift.member_ids.length} on shift`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </option>
                  ))}
                </select>
                <p className="text-theme-text-muted mt-1 text-xs">
                  Choosing a shift checks everyone on it. Uncheck anyone who missed the drill.
                </p>
              </div>
            )}
            <div className="relative">
              <Search className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Find a member"
                placeholder="Find a member"
                className={`${inputClass} pl-9`}
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
              />
            </div>
            <p className="text-theme-text-secondary text-sm" aria-live="polite">
              {present.size} {present.size === 1 ? 'member' : 'members'} selected
            </p>
            <ul className="border-theme-surface-border max-h-80 divide-y overflow-y-auto rounded-lg border">
              {filteredMembers.map((member) => (
                <li key={member.id}>
                  <label className="hover:bg-theme-surface-hover touch:min-h-11 flex cursor-pointer items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={present.has(member.id)}
                      onChange={() => toggleMember(member.id)}
                    />
                    <span className="text-theme-text-primary text-sm">
                      {member.name}
                      {member.id === currentUserId ? ' (you)' : ''}
                    </span>
                  </label>
                </li>
              ))}
              {filteredMembers.length === 0 && (
                <li className="text-theme-text-muted px-3 py-4 text-center text-sm">No members match.</li>
              )}
            </ul>
          </section>

          {error && (
            <div className="alert-error" role="alert">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" className="btn-primary touch:min-h-11" disabled={saving}>
              {saving ? 'Sending…' : 'Send for review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RecordCrewTrainingPage;
