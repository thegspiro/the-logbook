import { describe, it, expect } from 'vitest';
import type { TrainingSessionResponse } from '../../services/api';
import type { TrainingCourse } from '../../types/training';
import {
  DEFAULT_TRAINING_DETAILS,
  applyLibraryCourse,
  TEMPLATE_CATEGORY_GONE_NOTE,
  TEMPLATE_COURSE_GONE_NOTE,
  TEMPLATE_PHASE_GONE_NOTE,
  TEMPLATE_PROGRAM_GONE_NOTE,
  TEMPLATE_REQUIREMENT_GONE_NOTE,
  templateAttendanceGoneNote,
  TEMPLATE_INSTRUCTOR_GONE_NOTE,
  fromSession,
  fromTemplateTrainingDetails,
  hasSettingCopies,
  reconcileTemplateTraining,
  scheduledHours,
  strippedForFinalized,
  toAttachPayload,
  toTemplateTrainingDetails,
  toUpdatePayload,
  validateTrainingDetails,
  withCourseChoice,
  withLoadedCourseHours,
  type TrainingDetailsForm,
} from './trainingDetailsModel';

const form = (patch: Partial<TrainingDetailsForm> = {}): TrainingDetailsForm => ({
  ...DEFAULT_TRAINING_DETAILS,
  ...patch,
});

const COURSE: TrainingCourse = {
  id: 'course-pump',
  organization_id: 'org',
  name: 'Pump Operations',
  code: 'PUMP',
  training_type: 'skills_practice',
  credit_hours: 2,
  expiration_months: 24,
  instructor: 'Capt. Owen Kittredge',
  max_participants: 40,
  category_ids: ['cat-app'],
  program_id: 'prog-dop',
  active: true,
  created_at: '',
  updated_at: '',
};

const SESSION: TrainingSessionResponse = {
  id: 'session-1',
  organization_id: 'org',
  event_id: 'event-1',
  course_name: 'Monday Night Drill',
  training_type: 'continuing_education',
  credit_hours: 2,
  issues_certification: false,
  counts_toward_certification: true,
  auto_create_records: true,
  require_completion_confirmation: false,
  approval_deadline_days: 7,
  is_finalized: false,
  created_at: '',
  updated_at: '',
};

const EVENT = {
  title: 'Monday Night Drill',
  start_datetime: '2026-11-16T19:00:00Z',
  end_datetime: '2026-11-16T21:00:00Z',
};

describe('scheduledHours', () => {
  it('reads the local wall-clock pair in the department timezone', () => {
    expect(scheduledHours('2026-11-16T19:00', '2026-11-16T20:30', 'America/New_York')).toBe(1.5);
  });

  it('has no length until both ends are set and the end is after the start', () => {
    expect(scheduledHours('2026-11-16T19:00', '', 'UTC')).toBeNull();
    expect(scheduledHours('2026-11-16T19:00', '2026-11-16T18:00', 'UTC')).toBeNull();
  });
});

describe('toAttachPayload', () => {
  // Omitted hours are each event's own scheduled length to the backend, so a
  // series' occurrences each get theirs, as null does on an edit.
  it('leaves every blank out, and the hours while they follow the length', () => {
    expect(toAttachPayload(form(), 2)).toEqual({
      training_type: 'continuing_education',
      issues_certification: false,
      counts_toward_certification: true,
      auto_create_records: true,
      require_completion_confirmation: false,
      attendance_requirement_ids: [],
    });
  });

  it("sends hours that do not follow the event's length as a figure", () => {
    expect(toAttachPayload(form({ credit_hours_source: 'manual', credit_hours: '1.5' }), 2)).toMatchObject({
      credit_hours: 1.5,
    });
    expect(
      toAttachPayload(
        form({ course_mode: 'library', course_id: 'course-pump', credit_hours_source: 'course', credit_hours: '4' }),
        2
      )
    ).toMatchObject({ credit_hours: 4 });
  });

  // The backend refuses a library course together with a one-off name.
  it('sends only the chosen course mode', () => {
    const value = form({ course_id: 'course-pump', course_name: 'Stale', course_code: 'X' });
    expect(toAttachPayload({ ...value, course_mode: 'library' }, 2)).toMatchObject({ course_id: 'course-pump' });
    expect(toAttachPayload({ ...value, course_mode: 'library' }, 2).course_name).toBeUndefined();
    const oneOff = toAttachPayload({ ...value, course_mode: 'oneoff' }, 2);
    expect(oneOff).toMatchObject({ course_name: 'Stale', course_code: 'X' });
    expect(oneOff.course_id).toBeUndefined();
    const none = toAttachPayload({ ...value, course_mode: 'none' }, 2);
    expect([none.course_id, none.course_name, none.course_code]).toEqual([undefined, undefined, undefined]);
  });

  it('sends certification fields only while a certification is issued', () => {
    const value = form({ issuing_agency: 'AHA', certification_number_prefix: 'AHA-', expiration_months: '24' });
    expect(toAttachPayload(value, 2).expiration_months).toBeUndefined();
    expect(toAttachPayload({ ...value, issues_certification: true }, 2)).toMatchObject({
      issues_certification: true,
      issuing_agency: 'AHA',
      certification_number_prefix: 'AHA-',
      expiration_months: 24,
    });
  });

  it('sends the approval deadline only with sign-off', () => {
    expect(toAttachPayload(form({ approval_deadline_days: '10' }), 2).approval_deadline_days).toBeUndefined();
    expect(
      toAttachPayload(form({ require_completion_confirmation: true, approval_deadline_days: '10' }), 2)
    ).toMatchObject({ require_completion_confirmation: true, approval_deadline_days: 10 });
  });
});

describe('toUpdatePayload', () => {
  // An omitted key means "leave it alone" on the update path, so a cleared box
  // must travel as null or the old value survives (pitfall #1).
  it('sends every field the form owns, a blank as null', () => {
    expect(toUpdatePayload(form({ credit_hours_source: 'manual', credit_hours: '' }), 2)).toEqual({
      course_id: null,
      course_name: null,
      course_code: null,
      category_id: null,
      program_id: null,
      phase_id: null,
      requirement_id: null,
      training_type: 'continuing_education',
      credit_hours: null,
      instructor: null,
      instructor_id: null,
      issues_certification: false,
      certification_number_prefix: null,
      issuing_agency: null,
      expiration_months: null,
      counts_toward_certification: true,
      auto_create_records: true,
      require_completion_confirmation: false,
      attendance_requirement_ids: [],
    });
  });

  // A deadline is checked only while sign-off is ticked, and its box is hidden
  // otherwise: one left behind an unticked box came back as a 422 on a field
  // nobody could see.
  it('leaves out the approval deadline while sign-off is off', () => {
    const payload = toUpdatePayload(form({ require_completion_confirmation: false, approval_deadline_days: '45' }), 2);
    expect(payload).not.toHaveProperty('approval_deadline_days');
    expect(
      toUpdatePayload(form({ require_completion_confirmation: true, approval_deadline_days: '10' }), 2)
    ).toMatchObject({ approval_deadline_days: 10 });
  });

  // Null is each event's own length to the backend; this occurrence's figure
  // was written to every later one on "This and all future events".
  it("sends hours that follow the event's length as null, and a figure otherwise", () => {
    expect(toUpdatePayload(form({ credit_hours_source: 'duration' }), 3)).toMatchObject({ credit_hours: null });
    expect(toUpdatePayload(form({ credit_hours_source: 'manual', credit_hours: '1.5' }), 3)).toMatchObject({
      credit_hours: 1.5,
    });
    expect(
      toUpdatePayload(
        form({ course_mode: 'library', course_id: 'course-pump', credit_hours_source: 'course', credit_hours: '2' }),
        3
      )
    ).toMatchObject({ credit_hours: 2 });
  });

  // A Requirement nobody touched is left out, so "This and all future events"
  // leaves each later occurrence's own: a legacy session-attendance link
  // re-sent was refused against every occurrence that stored another, or
  // none, for an edit that never went near Requirement.
  it('leaves out a Requirement the officer did not change', () => {
    const stored = form({ requirement_id: 'req-att' });
    expect(toUpdatePayload(stored, 2, stored)).not.toHaveProperty('requirement_id');
    expect(toUpdatePayload(form(), 2, form())).not.toHaveProperty('requirement_id');
  });

  it('sends a changed Requirement, and a cleared one as null', () => {
    const stored = form({ requirement_id: 'req-att' });
    expect(toUpdatePayload(form({ requirement_id: 'req-hours' }), 2, stored)).toMatchObject({
      requirement_id: 'req-hours',
    });
    expect(toUpdatePayload(form({ requirement_id: '' }), 2, stored)).toMatchObject({ requirement_id: null });
  });

  it('clears the fields of the course modes not chosen', () => {
    const payload = toUpdatePayload(
      form({ course_mode: 'library', course_id: 'course-pump', course_name: 'Old one-off' }),
      2
    );
    expect(payload).toMatchObject({ course_id: 'course-pump', course_name: null, course_code: null });
  });
});

describe('withCourseChoice', () => {
  // Library → No course yet → Library kept the course picked while its hours
  // had gone back to following the length, and nothing re-applied them.
  it("puts a held course's hours back on returning to the library", () => {
    const picked = applyLibraryCourse(form(), COURSE, []);
    const away = withCourseChoice({ ...picked, course_mode: 'none' }, undefined);
    expect(away).toMatchObject({ course_id: 'course-pump', credit_hours_source: 'duration' });

    expect(withCourseChoice({ ...away, course_mode: 'library' }, COURSE)).toMatchObject({
      course_mode: 'library',
      credit_hours: '2',
      credit_hours_source: 'course',
    });
  });

  it('leaves hours the officer typed alone', () => {
    const typed = form({
      course_mode: 'library',
      course_id: 'course-pump',
      credit_hours_source: 'manual',
      credit_hours: '5',
    });
    expect(withCourseChoice(typed, COURSE)).toBe(typed);
  });
});

describe('withCourseChoice on an edit', () => {
  // fromSession reads a library session's stored hours as typed ('manual'):
  // only the course list can tell they are the course's figure. Leaving the
  // library kept them as typed, so the course-less session was saved with
  // the old course's hours instead of its own length, where a create goes
  // back to following the length.
  const LIBRARY_SESSION = { ...SESSION, course_id: 'course-pump', course_name: 'Pump Operations', credit_hours: 2 };
  const THREE_HOURS = { ...EVENT, end_datetime: '2026-11-16T22:00:00Z' };

  it.each([['none' as const], ['oneoff' as const]])(
    "follows the event's length again when hours from the course are left for %s",
    (mode) => {
      const loaded = fromSession(LIBRARY_SESSION, THREE_HOURS);
      expect(loaded).toMatchObject({ course_mode: 'library', credit_hours_source: 'manual' });

      const away = withCourseChoice({ ...loaded, course_mode: mode }, COURSE, { value: loaded, course: COURSE });
      expect(away.credit_hours_source).toBe('duration');
      expect(toUpdatePayload(away, 3).credit_hours).toBeNull();
    }
  );

  it('follows the length again when the course itself is cleared', () => {
    const loaded = fromSession(LIBRARY_SESSION, THREE_HOURS);
    const cleared = withCourseChoice({ ...loaded, course_id: '' }, undefined, { value: loaded, course: COURSE });
    expect(cleared.credit_hours_source).toBe('duration');
  });

  it('keeps hours unlike the course, which the officer typed', () => {
    const loaded = fromSession({ ...LIBRARY_SESSION, credit_hours: 5 }, THREE_HOURS);
    const away = withCourseChoice({ ...loaded, course_mode: 'none' }, COURSE, { value: loaded, course: COURSE });
    expect(away).toMatchObject({ credit_hours: '5', credit_hours_source: 'manual' });
    expect(toUpdatePayload(away, 3).credit_hours).toBe(5);
  });

  // Only the move away from the library resets them: hours typed later,
  // equal to a course still remembered from an earlier pick, stay typed.
  it('leaves typed hours alone on a change that is not a move away from the library', () => {
    const typed = form({
      course_mode: 'none',
      course_id: 'course-pump',
      credit_hours_source: 'manual',
      credit_hours: '2',
    });
    const next = { ...typed, instructor: 'Someone' };
    expect(withCourseChoice(next, COURSE, { value: typed, course: COURSE })).toBe(next);
  });
});

describe('strippedForFinalized', () => {
  // A finalized event refuses (409) every changed training field but its links.
  it('keeps only the attendance links', () => {
    expect(strippedForFinalized(toUpdatePayload(form({ attendance_requirement_ids: ['req-1'] }), 2))).toEqual({
      attendance_requirement_ids: ['req-1'],
    });
  });
});

describe('applyLibraryCourse', () => {
  const members = [{ id: 'm-owen', name: 'Capt. Owen Kittredge', label: 'Capt. Owen Kittredge (Captain)' }];

  it('fills type, hours, instructor and expiry, and ticks certification for a course that expires', () => {
    expect(applyLibraryCourse(form(), COURSE, members)).toMatchObject({
      course_mode: 'library',
      course_id: 'course-pump',
      training_type: 'skills_practice',
      credit_hours: '2',
      credit_hours_source: 'course',
      instructor_id: 'm-owen',
      instructor: 'Capt. Owen Kittredge',
      expiration_months: '24',
      issues_certification: true,
      category_id: 'cat-app',
      program_id: 'prog-dop',
    });
  });

  it('keeps links the officer chose already', () => {
    const filled = applyLibraryCourse(
      form({ category_id: 'cat-mine', program_id: 'prog-mine', phase_id: 'ph-1' }),
      COURSE,
      []
    );
    expect(filled).toMatchObject({ category_id: 'cat-mine', program_id: 'prog-mine', phase_id: 'ph-1' });
  });

  it('keeps an instructor no member is named as text, with no member picked', () => {
    expect(applyLibraryCourse(form({ instructor_id: 'm-old' }), COURSE, [])).toMatchObject({
      instructor_id: '',
      instructor: 'Capt. Owen Kittredge',
    });
  });

  describe('switching to a course that lacks what the first one carried', () => {
    const {
      credit_hours: _hours,
      duration_hours: _duration,
      expiration_months: _expiry,
      program_id: _program,
      ...rest
    } = COURSE;
    const BARE: TrainingCourse = { ...rest, id: 'course-bare', name: 'Hose Rolling', instructor: '', category_ids: [] };

    it("drops the first course's hours, instructor and expiry rather than filing them under the second", () => {
      const first = applyLibraryCourse(form(), COURSE, members);
      const second = applyLibraryCourse(first, BARE, members, undefined, COURSE);
      expect(second).toMatchObject({
        course_id: 'course-bare',
        credit_hours_source: 'duration',
        instructor_id: '',
        instructor: '',
        expiration_months: '',
        issues_certification: false,
      });
      const payload = toAttachPayload(second, 1.5);
      expect(payload).toMatchObject({ course_id: 'course-bare', issues_certification: false });
      expect(payload.credit_hours).toBeUndefined();
      expect(payload.instructor).toBeUndefined();
      expect(payload.instructor_id).toBeUndefined();
      expect(payload.expiration_months).toBeUndefined();
    });

    it('keeps what the officer changed after the first course filled it', () => {
      const first = {
        ...applyLibraryCourse(form(), COURSE, members),
        credit_hours: '5',
        credit_hours_source: 'manual' as const,
        instructor_id: 'm-other',
        instructor: 'Lt. Dana Price',
        expiration_months: '12',
      };
      expect(applyLibraryCourse(first, BARE, members, undefined, COURSE)).toMatchObject({
        credit_hours: '5',
        credit_hours_source: 'manual',
        instructor_id: 'm-other',
        instructor: 'Lt. Dana Price',
        expiration_months: '12',
        issues_certification: true,
      });
    });

    it("on an edit, sends hours stored equal to the session's course back to the length", () => {
      const loaded = form({
        course_mode: 'library',
        course_id: 'course-pump',
        credit_hours: '2',
        credit_hours_source: 'manual',
      });
      expect(applyLibraryCourse(loaded, BARE, members, undefined, COURSE)).toMatchObject({
        credit_hours_source: 'duration',
      });
    });
  });
});

describe('fromSession', () => {
  it('reads a course-less session filed under the title as No course yet, following the length', () => {
    expect(fromSession(SESSION, EVENT)).toMatchObject({
      course_mode: 'none',
      course_name: '',
      credit_hours: '2',
      credit_hours_source: 'duration',
    });
  });

  it('reads a session named otherwise as a one-off, and hours unlike the length as typed', () => {
    expect(fromSession({ ...SESSION, course_name: 'Ladder Ops', credit_hours: 3 }, EVENT)).toMatchObject({
      course_mode: 'oneoff',
      course_name: 'Ladder Ops',
      credit_hours_source: 'manual',
    });
  });

  it('reads a session filed under the title but carrying a code as a one-off, and keeps the code on save', () => {
    const coded = { ...SESSION, course_code: 'X1' };
    const loaded = fromSession(coded, EVENT);
    expect(loaded).toMatchObject({ course_mode: 'oneoff', course_name: 'Monday Night Drill', course_code: 'X1' });
    expect(toUpdatePayload(loaded, 2, loaded)).toMatchObject({
      course_name: 'Monday Night Drill',
      course_code: 'X1',
    });
  });

  it('reads a library session as one', () => {
    expect(fromSession({ ...SESSION, course_id: 'course-pump', course_name: 'Pump Operations' }, EVENT)).toMatchObject({
      course_mode: 'library',
      course_id: 'course-pump',
      course_name: '',
    });
  });
});

describe('withLoadedCourseHours', () => {
  // Neither credit hours nor a duration: create credits the event's length.
  const { credit_hours: _hours, ...withoutHours } = COURSE;
  const NO_HOURS: TrainingCourse = { ...withoutHours, id: 'course-ladder' };
  const loaded = (courseId: string, creditHours: number) =>
    fromSession({ ...SESSION, course_id: courseId, credit_hours: creditHours }, EVENT);

  it('reads hours equal to the length as the length under a course that has none, as create credited them', () => {
    expect(withLoadedCourseHours(loaded('course-ladder', 2), [NO_HOURS, COURSE], 2)).toMatchObject({
      credit_hours: '2',
      credit_hours_source: 'duration',
    });
  });

  it('leaves the hours of a course that has hours as stored', () => {
    const value = loaded('course-pump', 2);
    expect(withLoadedCourseHours(value, [NO_HOURS, COURSE], 2)).toBe(value);
  });

  it('leaves hours unlike the length, and a course the list no longer holds, as stored', () => {
    const unlike = loaded('course-ladder', 3);
    expect(withLoadedCourseHours(unlike, [NO_HOURS], 2)).toBe(unlike);
    const gone = loaded('course-ladder', 2);
    expect(withLoadedCourseHours(gone, [COURSE], 2)).toBe(gone);
  });
});

describe('hasSettingCopies', () => {
  it('finds a copy the old Events form wrote, a false or a number included', () => {
    expect(hasSettingCopies({ instructor: 'Owen Kittredge' })).toBe(true);
    expect(hasSettingCopies({ issues_certification: false })).toBe(true);
    expect(hasSettingCopies({ expiration_months: 24 })).toBe(true);
  });

  it('finds none in other fields, blanks, or no custom_fields at all', () => {
    expect(hasSettingCopies({ uniform: 'Class B', instructor: '  ', issuing_agency: null })).toBe(false);
    expect(hasSettingCopies({})).toBe(false);
    expect(hasSettingCopies(null)).toBe(false);
  });
});

describe('validateTrainingDetails', () => {
  it('asks for the course a mode needs', () => {
    expect(validateTrainingDetails(form({ course_mode: 'library' }), 2)).toEqual({
      course_id: 'Choose a course from the Course Library.',
    });
    expect(validateTrainingDetails(form({ course_mode: 'oneoff' }), 2)).toEqual({
      course_name: 'Enter a course name.',
    });
  });

  it('needs hours, and a length to follow when they have not been typed', () => {
    expect(validateTrainingDetails(form(), null).credit_hours).toBe(
      "Set the event's start and end, or enter the credit hours."
    );
    expect(validateTrainingDetails(form({ credit_hours_source: 'manual', credit_hours: '-1' }), 2).credit_hours).toBe(
      'Credit hours must be 0 or more.'
    );
  });

  it('checks the sign-off deadline only with sign-off', () => {
    expect(validateTrainingDetails(form({ approval_deadline_days: '99' }), 2)).toEqual({});
    expect(
      validateTrainingDetails(form({ require_completion_confirmation: true, approval_deadline_days: '99' }), 2)
    ).toEqual({ approval_deadline_days: 'Enter between 1 and 30 days.' });
  });
});

describe('template training details', () => {
  const library = form({
    course_mode: 'library',
    course_id: COURSE.id,
    training_type: 'skills_practice',
    credit_hours: '2',
    credit_hours_source: 'course',
    instructor_id: 'm-1',
    instructor: 'Owen Kittredge',
    issues_certification: true,
    certification_number_prefix: 'PUMP-',
    issuing_agency: 'State Academy',
    expiration_months: '24',
    // Carried since the owner decision of 2026-11-23.
    category_id: 'cat-app',
    program_id: 'prog-dop',
    phase_id: 'phase-1',
    requirement_id: 'req-1',
    attendance_requirement_ids: ['att-1', 'att-2'],
    counts_toward_certification: false,
    auto_create_records: false,
    require_completion_confirmation: true,
    approval_deadline_days: '14',
  });
  const members = [
    { id: 'm-1', name: 'Owen Kittredge', label: 'Capt. Owen Kittredge' },
    { id: 'm-2', name: 'Jo Former', label: 'Jo Former', former: true },
  ];

  it("saves only the owner's list, in the canonical shape", () => {
    expect(toTemplateTrainingDetails(library)).toEqual({
      course_mode: 'library',
      course_id: COURSE.id,
      course_name: null,
      course_code: null,
      training_type: 'skills_practice',
      credit_hours: 2,
      credit_hours_source: 'course',
      instructor_id: 'm-1',
      instructor: 'Owen Kittredge',
      issues_certification: true,
      certification_number_prefix: 'PUMP-',
      issuing_agency: 'State Academy',
      expiration_months: 24,
      category_id: 'cat-app',
      program_id: 'prog-dop',
      phase_id: 'phase-1',
      requirement_id: 'req-1',
      attendance_requirement_ids: ['att-1', 'att-2'],
      counts_toward_certification: false,
      auto_create_records: false,
      require_completion_confirmation: true,
      approval_deadline_days: 14,
    });
  });

  it('saves the default deadline without sign-off, and blank links as null', () => {
    const out = toTemplateTrainingDetails(
      form({ approval_deadline_days: '21', require_completion_confirmation: false })
    );
    expect(out.approval_deadline_days).toBe(7);
    expect(out.category_id).toBeNull();
    expect(out.phase_id).toBeNull();
    expect(out.attendance_requirement_ids).toEqual([]);
  });

  it('drops hours that follow the length and certification settings not issued', () => {
    const out = toTemplateTrainingDetails(
      form({ credit_hours: '5', issuing_agency: 'Kept nowhere', course_mode: 'oneoff', course_name: ' Ropes ' })
    );
    expect(out.credit_hours).toBeNull();
    expect(out.issuing_agency).toBeNull();
    expect(out.course_name).toBe('Ropes');
    expect(out.course_id).toBeNull();
  });

  it('reads back to the form it was saved from', () => {
    expect(fromTemplateTrainingDetails(toTemplateTrainingDetails(library))).toEqual(library);
  });

  it('reads a template saved before the links were kept as the session defaults', () => {
    const {
      category_id: _c,
      program_id: _p,
      phase_id: _ph,
      requirement_id: _r,
      attendance_requirement_ids: _a,
      counts_toward_certification: _ct,
      auto_create_records: _ac,
      require_completion_confirmation: _rc,
      approval_deadline_days: _d,
      ...older
    } = toTemplateTrainingDetails(library);
    const back = fromTemplateTrainingDetails(older);
    expect(back.category_id).toBe('');
    expect(back.attendance_requirement_ids).toEqual([]);
    expect(back.counts_toward_certification).toBe(true);
    expect(back.auto_create_records).toBe(true);
    expect(back.require_completion_confirmation).toBe(false);
    expect(back.approval_deadline_days).toBe('7');
  });

  it('reads a value it cannot hold as the default rather than failing', () => {
    const back = fromTemplateTrainingDetails({
      ...toTemplateTrainingDetails(DEFAULT_TRAINING_DETAILS),
      training_type: 'juggling',
      course_mode: 'sideways' as 'none',
    });
    expect(back.training_type).toBe('continuing_education');
    expect(back.course_mode).toBe('none');
  });

  describe('reconcileTemplateTraining', () => {
    const seeded = fromTemplateTrainingDetails(toTemplateTrainingDetails(library));

    it('starts on No course yet, with a note, when the course is no longer listed', () => {
      const { value, notes } = reconcileTemplateTraining(seeded, seeded, [], members);
      expect(value.course_mode).toBe('none');
      expect(value.course_id).toBe('');
      expect(value.credit_hours_source).toBe('duration');
      expect(notes).toEqual([TEMPLATE_COURSE_GONE_NOTE]);
    });

    it("refreshes course hours to the course's current figure", () => {
      const { value, notes } = reconcileTemplateTraining(seeded, seeded, [{ ...COURSE, credit_hours: 3.5 }], members);
      expect(value.credit_hours).toBe('3.5');
      expect(value.credit_hours_source).toBe('course');
      expect(notes).toEqual([]);
    });

    it('follows the length when the course has no hours any more', () => {
      const { credit_hours: _hours, duration_hours: _duration, ...bare } = COURSE;
      const { value } = reconcileTemplateTraining(seeded, seeded, [bare], members);
      expect(value.credit_hours_source).toBe('duration');
    });

    it('clears a former or unknown instructor, with a note', () => {
      for (const id of ['m-2', 'm-gone']) {
        const s = { ...seeded, instructor_id: id, instructor: 'Someone' };
        const { value, notes } = reconcileTemplateTraining(s, s, [COURSE], members);
        expect(value.instructor_id).toBe('');
        expect(value.instructor).toBe('');
        expect(notes).toEqual([TEMPLATE_INSTRUCTOR_GONE_NOTE]);
      }
    });

    it("refreshes a current instructor's name and keeps a free-text one", () => {
      const renamed = { ...seeded, instructor: 'O. Kittredge' };
      expect(reconcileTemplateTraining(renamed, renamed, [COURSE], members).value.instructor).toBe('Owen Kittredge');
      const text = { ...seeded, instructor_id: '', instructor: 'Visiting Lt. Ames' };
      const { value, notes } = reconcileTemplateTraining(text, text, [COURSE], members);
      expect(value.instructor).toBe('Visiting Lt. Ames');
      expect(notes).toEqual([]);
    });

    it('leaves alone what the officer changed before the lists loaded', () => {
      const typed = { ...seeded, course_id: 'course-other', instructor_id: 'm-2', instructor: 'Jo Former' };
      const { value, notes } = reconcileTemplateTraining(typed, seeded, [], members);
      expect(value).toEqual(typed);
      expect(notes).toEqual([]);
    });

    it('skips a list that failed to load', () => {
      const withFormer = { ...seeded, instructor_id: 'm-2', instructor: 'Jo Former' };
      const { value, notes } = reconcileTemplateTraining(withFormer, withFormer, undefined, undefined);
      expect(value).toEqual(withFormer);
      expect(notes).toEqual([]);
    });

    describe('the links, against what is still offered', () => {
      const offered = {
        categories: [{ id: 'cat-app' }],
        programs: [{ id: 'prog-dop' }],
        phases: [{ id: 'phase-1' }],
        requirements: [{ id: 'req-1' }, { id: 'att-1' }, { id: 'att-2' }],
      };

      it('keeps every link still offered, without a note', () => {
        const { value, notes } = reconcileTemplateTraining(seeded, seeded, [COURSE], members, offered);
        expect(value).toEqual(reconcileTemplateTraining(seeded, seeded, [COURSE], members).value);
        expect(value.phase_id).toBe('phase-1');
        expect(notes).toEqual([]);
      });

      it('drops each link no longer offered, with a note for each', () => {
        const { value, notes } = reconcileTemplateTraining(seeded, seeded, [COURSE], members, {
          categories: [],
          programs: [{ id: 'prog-dop' }],
          phases: [],
          requirements: [{ id: 'att-2' }],
        });
        expect(value.category_id).toBe('');
        expect(value.program_id).toBe('prog-dop');
        expect(value.phase_id).toBe('');
        expect(value.requirement_id).toBe('');
        expect(value.attendance_requirement_ids).toEqual(['att-2']);
        expect(notes).toEqual([
          TEMPLATE_CATEGORY_GONE_NOTE,
          TEMPLATE_PHASE_GONE_NOTE,
          TEMPLATE_REQUIREMENT_GONE_NOTE,
          templateAttendanceGoneNote(1),
        ]);
      });

      it('drops the phase with a program no longer active', () => {
        const { value, notes } = reconcileTemplateTraining(seeded, seeded, [COURSE], members, {
          ...offered,
          programs: [],
        });
        expect(value.program_id).toBe('');
        expect(value.phase_id).toBe('');
        expect(notes).toEqual([TEMPLATE_PROGRAM_GONE_NOTE]);
      });

      it('skips a list that failed to load', () => {
        const { value, notes } = reconcileTemplateTraining(seeded, seeded, [COURSE], members, {});
        expect(value.category_id).toBe('cat-app');
        expect(value.requirement_id).toBe('req-1');
        expect(value.attendance_requirement_ids).toEqual(['att-1', 'att-2']);
        expect(notes).toEqual([]);
      });

      it('leaves alone a link the officer changed before the lists loaded', () => {
        const typed = { ...seeded, category_id: 'cat-other', attendance_requirement_ids: ['att-9'] };
        const { value } = reconcileTemplateTraining(typed, seeded, [COURSE], members, {
          ...offered,
          categories: [],
          requirements: [],
        });
        expect(value.category_id).toBe('cat-other');
        expect(value.attendance_requirement_ids).toEqual(['att-9']);
      });
    });

    it('keeps course hours saveable while the Course Library is unavailable', () => {
      const { value } = reconcileTemplateTraining(seeded, seeded, undefined, members);
      expect(validateTrainingDetails(value, null).credit_hours).toBeUndefined();
    });
  });
});
