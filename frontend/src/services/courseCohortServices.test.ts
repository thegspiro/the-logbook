/**
 * Tests for the syllabus and cohort service layers.
 *
 * These assert the exact URL and payload each method sends, because the whole
 * feature is a thin client over a backend that does the scheduling — a wrong
 * path or a dropped field is the realistic failure here, not bad logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
    defaults: { baseURL: '/api/v1' },
  },
}));

// Import after the mock is in place
import {
  courseCohortService,
  courseSyllabusService,
} from './trainingServices';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('courseSyllabusService', () => {
  it('gets a course syllabus in order', async () => {
    const classes = [{ id: 'cc1', sequence: 1, title: 'SCBA' }];
    mockGet.mockResolvedValueOnce({ data: classes });

    const result = await courseSyllabusService.getClasses('course-1');

    expect(mockGet).toHaveBeenCalledWith('/training/courses/course-1/classes');
    expect(result).toEqual(classes);
  });

  it('adds a class with its relative timing', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'cc2' } });

    await courseSyllabusService.addClass('course-1', {
      class_course_id: 'catalog-9',
      day_offset: 2,
      start_time: '19:00',
      duration_minutes: 180,
    });

    expect(mockPost).toHaveBeenCalledWith('/training/courses/course-1/classes', {
      class_course_id: 'catalog-9',
      day_offset: 2,
      start_time: '19:00',
      duration_minutes: 180,
    });
  });

  it('patches a single class', async () => {
    mockPatch.mockResolvedValueOnce({ data: { id: 'cc2' } });

    await courseSyllabusService.updateClass('course-1', 'cc2', {
      day_offset: 5,
    });

    expect(mockPatch).toHaveBeenCalledWith(
      '/training/courses/course-1/classes/cc2',
      { day_offset: 5 },
    );
  });

  it('deletes a class', async () => {
    mockDelete.mockResolvedValueOnce({ data: null });

    await courseSyllabusService.deleteClass('course-1', 'cc2');

    expect(mockDelete).toHaveBeenCalledWith(
      '/training/courses/course-1/classes/cc2',
    );
  });

  it('sends the full ordering when reordering', async () => {
    mockPost.mockResolvedValueOnce({ data: [] });

    await courseSyllabusService.reorderClasses('course-1', ['c', 'a', 'b']);

    expect(mockPost).toHaveBeenCalledWith(
      '/training/courses/course-1/classes/reorder',
      { class_ids: ['c', 'a', 'b'] },
    );
  });

  it('autofills offsets from a meeting pattern', async () => {
    mockPost.mockResolvedValueOnce({ data: [] });

    await courseSyllabusService.autofillOffsets('course-1', {
      meeting_days: [1, 3],
      start_weekday: 0,
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/training/courses/course-1/classes/autofill',
      { meeting_days: [1, 3], start_weekday: 0 },
    );
  });
});

describe('courseCohortService', () => {
  it('previews a schedule without creating anything', async () => {
    const preview = { course_id: 'course-1', classes: [] };
    mockPost.mockResolvedValueOnce({ data: preview });

    const result = await courseCohortService.previewSchedule({
      course_id: 'course-1',
      start_date: '2026-09-08',
      date_roll_policy: 'next_business_day',
    });

    expect(mockPost).toHaveBeenCalledWith('/training/cohorts/preview', {
      course_id: 'course-1',
      start_date: '2026-09-08',
      date_roll_policy: 'next_business_day',
    });
    expect(result).toEqual(preview);
  });

  it('lists cohorts, passing filters through as params', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });

    await courseCohortService.getCohorts({ course_id: 'course-1' });

    expect(mockGet).toHaveBeenCalledWith('/training/cohorts', {
      params: { course_id: 'course-1' },
    });
  });

  it('lists cohorts with no filters', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });

    await courseCohortService.getCohorts();

    expect(mockGet).toHaveBeenCalledWith('/training/cohorts', {
      params: undefined,
    });
  });

  it("gets the member's own cohorts", async () => {
    mockGet.mockResolvedValueOnce({ data: [] });

    await courseCohortService.getMyCohorts();

    expect(mockGet).toHaveBeenCalledWith('/training/cohorts/mine');
  });

  it('gets one cohort with its classes and roster', async () => {
    const detail = { id: 'co1', classes: [], members: [] };
    mockGet.mockResolvedValueOnce({ data: detail });

    const result = await courseCohortService.getCohort('co1');

    expect(mockGet).toHaveBeenCalledWith('/training/cohorts/co1');
    expect(result).toEqual(detail);
  });

  it('creates a cohort with overrides and a roster', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'co1', classes: [] } });

    await courseCohortService.createCohort({
      course_id: 'course-1',
      name: 'Recruit School — Fall 2026',
      start_date: '2026-09-08',
      generate_program: true,
      classes: [{ course_class_id: 'cc1', skip: true }],
      member_user_ids: ['u1', 'u2'],
    });

    expect(mockPost).toHaveBeenCalledWith('/training/cohorts', {
      course_id: 'course-1',
      name: 'Recruit School — Fall 2026',
      start_date: '2026-09-08',
      generate_program: true,
      classes: [{ course_class_id: 'cc1', skip: true }],
      member_user_ids: ['u1', 'u2'],
    });
  });

  it('regenerates missing events', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success_count: 2, errors: [], warnings: [] },
    });

    const result = await courseCohortService.regenerate('co1');

    expect(mockPost).toHaveBeenCalledWith('/training/cohorts/co1/regenerate');
    expect(result.success_count).toBe(2);
  });

  it('shifts upcoming classes', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success_count: 4, errors: [], warnings: [] },
    });

    await courseCohortService.shiftClasses('co1', { days: -3 });

    expect(mockPost).toHaveBeenCalledWith('/training/cohorts/co1/shift', {
      days: -3,
    });
  });

  it('reschedules one class', async () => {
    mockPatch.mockResolvedValueOnce({ data: { id: 'cx1' } });

    await courseCohortService.rescheduleClass('co1', 'cx1', {
      scheduled_start: '2026-10-05T23:00:00.000Z',
      scheduled_end: '2026-10-06T02:00:00.000Z',
    });

    expect(mockPatch).toHaveBeenCalledWith(
      '/training/cohorts/co1/classes/cx1',
      {
        scheduled_start: '2026-10-05T23:00:00.000Z',
        scheduled_end: '2026-10-06T02:00:00.000Z',
      },
    );
  });

  it('cancels one class with a reason', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'cx1' } });

    await courseCohortService.cancelClass('co1', 'cx1', 'Instructor ill');

    expect(mockPost).toHaveBeenCalledWith(
      '/training/cohorts/co1/classes/cx1/cancel',
      { reason: 'Instructor ill' },
    );
  });

  it('adds an ad-hoc class', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'cx9' } });

    await courseCohortService.addClass('co1', {
      title: 'Make-up SCBA',
      class_course_id: 'catalog-3',
      scheduled_start: '2026-11-02T23:00:00.000Z',
      scheduled_end: '2026-11-03T01:00:00.000Z',
    });

    expect(mockPost).toHaveBeenCalledWith('/training/cohorts/co1/classes', {
      title: 'Make-up SCBA',
      class_course_id: 'catalog-3',
      scheduled_start: '2026-11-02T23:00:00.000Z',
      scheduled_end: '2026-11-03T01:00:00.000Z',
    });
  });

  it('adds roster members', async () => {
    mockPost.mockResolvedValueOnce({
      data: { success_count: 2, errors: [], warnings: [] },
    });

    await courseCohortService.addMembers('co1', {
      user_ids: ['u1', 'u2'],
      enroll_in_program: true,
    });

    expect(mockPost).toHaveBeenCalledWith('/training/cohorts/co1/members', {
      user_ids: ['u1', 'u2'],
      enroll_in_program: true,
    });
  });

  it('removes a roster member', async () => {
    mockDelete.mockResolvedValueOnce({ data: null });

    await courseCohortService.removeMember('co1', 'u1');

    expect(mockDelete).toHaveBeenCalledWith('/training/cohorts/co1/members/u1');
  });

  it('cancels a whole cohort', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'co1' } });

    await courseCohortService.cancelCohort('co1', 'Class did not fill');

    expect(mockPost).toHaveBeenCalledWith('/training/cohorts/co1/cancel', {
      reason: 'Class did not fill',
    });
  });
});
