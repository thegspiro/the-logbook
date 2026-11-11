import { describe, it, expect } from 'vitest';
import type { TrainingSessionResponse } from '../../services/api';
import type { TrainingCourse } from '../../types/training';
import {
  DEFAULT_TRAINING_DETAILS,
  applyLibraryCourse,
  fromSession,
  scheduledHours,
  strippedForFinalized,
  toAttachPayload,
  toUpdatePayload,
  validateTrainingDetails,
  withCourseChoice,
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
  it('leaves every blank out and credits the scheduled length while the hours follow it', () => {
    expect(toAttachPayload(form(), 2)).toEqual({
      training_type: 'continuing_education',
      credit_hours: 2,
      issues_certification: false,
      counts_toward_certification: true,
      auto_create_records: true,
      require_completion_confirmation: false,
      attendance_requirement_ids: [],
    });
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

  it('reads a library session as one', () => {
    expect(fromSession({ ...SESSION, course_id: 'course-pump', course_name: 'Pump Operations' }, EVENT)).toMatchObject({
      course_mode: 'library',
      course_id: 'course-pump',
      course_name: '',
    });
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
