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

import { trainingService } from './trainingServices';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('trainingService', () => {
  // ── Courses ──────────────────────────────────────────────────────────

  describe('getCourses', () => {
    it('should GET /training/courses with default active_only=true', async () => {
      const courses = [{ id: 'c1', name: 'Hazmat Ops' }];
      mockGet.mockResolvedValueOnce({ data: courses });

      const result = await trainingService.getCourses();

      expect(mockGet).toHaveBeenCalledWith('/training/courses', {
        params: { active_only: true },
      });
      expect(result).toEqual(courses);
    });

    it('should pass activeOnly=false when requested', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await trainingService.getCourses(false);

      expect(mockGet).toHaveBeenCalledWith('/training/courses', {
        params: { active_only: false },
      });
    });
  });

  describe('getCourse', () => {
    it('should GET a specific course by id', async () => {
      const course = { id: 'c1', name: 'Hazmat Ops' };
      mockGet.mockResolvedValueOnce({ data: course });

      const result = await trainingService.getCourse('c1');

      expect(mockGet).toHaveBeenCalledWith('/training/courses/c1');
      expect(result).toEqual(course);
    });
  });

  describe('createCourse', () => {
    it('should POST to /training/courses', async () => {
      const courseData = { name: 'New Course', training_type: 'certification' };
      const created = { id: 'c2', ...courseData };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await trainingService.createCourse(courseData as never);

      expect(mockPost).toHaveBeenCalledWith('/training/courses', courseData);
      expect(result).toEqual(created);
    });
  });

  describe('updateCourse', () => {
    it('should PATCH /training/courses/:id', async () => {
      const updates = { name: 'Updated Course' };
      const updated = { id: 'c1', name: 'Updated Course' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await trainingService.updateCourse('c1', updates as never);

      expect(mockPatch).toHaveBeenCalledWith('/training/courses/c1', updates);
      expect(result).toEqual(updated);
    });
  });

  // ── Records ──────────────────────────────────────────────────────────

  describe('getRecords', () => {
    it('should GET /training/records without params', async () => {
      const records = [{ id: 'r1', course_name: 'CPR' }];
      mockGet.mockResolvedValueOnce({ data: records });

      const result = await trainingService.getRecords();

      expect(mockGet).toHaveBeenCalledWith('/training/records', { params: undefined });
      expect(result).toEqual(records);
    });

    it('should pass filter params', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });
      const params = { user_id: 'u1', status: 'completed' };

      await trainingService.getRecords(params);

      expect(mockGet).toHaveBeenCalledWith('/training/records', { params });
    });
  });

  describe('createRecord', () => {
    it('should POST to /training/records', async () => {
      const recordData = { course_name: 'CPR', user_id: 'u1', hours_completed: 4 };
      const created = { id: 'r1', ...recordData };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await trainingService.createRecord(recordData as never);

      expect(mockPost).toHaveBeenCalledWith('/training/records', recordData);
      expect(result).toEqual(created);
    });
  });

  describe('createRecordsBulk', () => {
    it('should POST to /training/records/bulk', async () => {
      const payload = { records: [{ user_id: 'u1', course_name: 'CPR' }] };
      const result = { success: 1, failed: 0 };
      mockPost.mockResolvedValueOnce({ data: result });

      const response = await trainingService.createRecordsBulk(payload as never);

      expect(mockPost).toHaveBeenCalledWith('/training/records/bulk', payload);
      expect(response).toEqual(result);
    });
  });

  describe('updateRecord', () => {
    it('should PATCH /training/records/:id', async () => {
      const updates = { hours_completed: 8 };
      const updated = { id: 'r1', hours_completed: 8 };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await trainingService.updateRecord('r1', updates as never);

      expect(mockPatch).toHaveBeenCalledWith('/training/records/r1', updates);
      expect(result).toEqual(updated);
    });
  });

  // ── Requirements ─────────────────────────────────────────────────────

  describe('getRequirements', () => {
    it('should GET /training/requirements without params', async () => {
      const requirements = [{ id: 'req1', name: 'Annual Hours' }];
      mockGet.mockResolvedValueOnce({ data: requirements });

      const result = await trainingService.getRequirements();

      expect(mockGet).toHaveBeenCalledWith('/training/requirements', { params: undefined });
      expect(result).toEqual(requirements);
    });

    it('should pass year and active_only params', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });
      const params = { year: 2026, active_only: true };

      await trainingService.getRequirements(params);

      expect(mockGet).toHaveBeenCalledWith('/training/requirements', { params });
    });
  });

  describe('createRequirement', () => {
    it('should POST to /training/requirements', async () => {
      const reqData = { name: 'Annual Hours', requirement_type: 'hours', required_hours: 24 };
      const created = { id: 'req1', ...reqData };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await trainingService.createRequirement(reqData as never);

      expect(mockPost).toHaveBeenCalledWith('/training/requirements', reqData);
      expect(result).toEqual(created);
    });
  });

  describe('deleteRequirement', () => {
    it('should DELETE /training/requirements/:id', async () => {
      mockDelete.mockResolvedValueOnce({ data: undefined });

      await trainingService.deleteRequirement('req1');

      expect(mockDelete).toHaveBeenCalledWith('/training/requirements/req1');
    });
  });

  // ── Categories ───────────────────────────────────────────────────────

  describe('getCategories', () => {
    it('should GET /training/categories with default active_only=true', async () => {
      const categories = [{ id: 'cat1', name: 'Fire Suppression' }];
      mockGet.mockResolvedValueOnce({ data: categories });

      const result = await trainingService.getCategories();

      expect(mockGet).toHaveBeenCalledWith('/training/categories', {
        params: { active_only: true },
      });
      expect(result).toEqual(categories);
    });
  });

  // ── Compliance / Stats ───────────────────────────────────────────────

  describe('getUserStats', () => {
    it('should GET /training/users/:id/stats', async () => {
      const stats = { total_hours: 48, hours_this_year: 24, completed_courses: 12 };
      mockGet.mockResolvedValueOnce({ data: stats });

      const result = await trainingService.getUserStats('u1');

      expect(mockGet).toHaveBeenCalledWith('/training/users/u1/stats');
      expect(result).toEqual(stats);
    });
  });

  describe('getComplianceSummary', () => {
    it('should GET /training/users/:id/compliance', async () => {
      const summary = { overall_status: 'compliant', requirements_met: 5 };
      mockGet.mockResolvedValueOnce({ data: summary });

      const result = await trainingService.getComplianceSummary('u1');

      expect(mockGet).toHaveBeenCalledWith('/training/users/u1/compliance');
      expect(result).toEqual(summary);
    });
  });

  describe('getRequirementProgress', () => {
    it('should GET /training/users/:id/requirement-progress', async () => {
      const progress = [{ requirement_id: 'req1', is_complete: true }];
      mockGet.mockResolvedValueOnce({ data: progress });

      const result = await trainingService.getRequirementProgress('u1');

      expect(mockGet).toHaveBeenCalledWith('/training/users/u1/requirement-progress', {
        params: { year: undefined },
      });
      expect(result).toEqual(progress);
    });

    it('should pass year parameter', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await trainingService.getRequirementProgress('u1', 2026);

      expect(mockGet).toHaveBeenCalledWith('/training/users/u1/requirement-progress', {
        params: { year: 2026 },
      });
    });
  });

  describe('getExpiringCertifications', () => {
    it('should GET /training/certifications/expiring with default days', async () => {
      const certs = [{ id: 'r1', course_name: 'EMT', expiration_date: '2026-06-01' }];
      mockGet.mockResolvedValueOnce({ data: certs });

      const result = await trainingService.getExpiringCertifications();

      expect(mockGet).toHaveBeenCalledWith('/training/certifications/expiring', {
        params: { days_ahead: undefined },
      });
      expect(result).toEqual(certs);
    });

    it('should pass custom days_ahead', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await trainingService.getExpiringCertifications(30);

      expect(mockGet).toHaveBeenCalledWith('/training/certifications/expiring', {
        params: { days_ahead: 30 },
      });
    });
  });

  describe('getComplianceMatrix', () => {
    it('should GET /training/compliance-matrix', async () => {
      const matrix = { users: [], requirements: [] };
      mockGet.mockResolvedValueOnce({ data: matrix });

      const result = await trainingService.getComplianceMatrix();

      expect(mockGet).toHaveBeenCalledWith('/training/compliance-matrix');
      expect(result).toEqual(matrix);
    });
  });

  // ── Error propagation ────────────────────────────────────────────────

  describe('error propagation', () => {
    it('should propagate errors from getCourses', async () => {
      mockGet.mockRejectedValueOnce(new Error('Network error'));

      await expect(trainingService.getCourses()).rejects.toThrow('Network error');
    });

    it('should propagate errors from createRecord', async () => {
      mockPost.mockRejectedValueOnce(new Error('Validation error'));

      await expect(
        trainingService.createRecord({ course_name: 'Test' } as never),
      ).rejects.toThrow('Validation error');
    });

    it('should propagate errors from deleteRequirement', async () => {
      mockDelete.mockRejectedValueOnce(new Error('Not found'));

      await expect(
        trainingService.deleteRequirement('nonexistent'),
      ).rejects.toThrow('Not found');
    });
  });
});
