/**
 * The Course Library is readable by anyone with the training module, but every
 * write behind it — create, update (which is how "Deactivate" is implemented)
 * and the syllabus builder — requires `training.manage` on the backend. The
 * page used to render Add / Manage classes / Edit / Delete unconditionally, so
 * a regular member saw four controls that could only ever answer 403.
 *
 * `/training/courses` sends a training officer to the admin hub instead
 * (CourseLibraryRoute), so the standalone page is precisely the read-only
 * audience — but the same component is also mounted `embedded` inside
 * TrainingAdminPage, where the officer does hold the permission, so the gate
 * lives on the component rather than on the route.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import type { TrainingCourse } from '../types/training';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

let hasManagePermission = false;

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => (p === 'training.manage' ? hasManagePermission : false) }),
}));

const mockGetCourses = vi.fn();
const mockGetCategories = vi.fn();
const mockUpdateCourse = vi.fn();

vi.mock('../services/api', () => ({
  trainingService: {
    getCourses: (...args: unknown[]) => mockGetCourses(...args) as unknown,
    getCategories: (...args: unknown[]) => mockGetCategories(...args) as unknown,
    updateCourse: (...args: unknown[]) => mockUpdateCourse(...args) as unknown,
    createCourse: vi.fn(),
  },
}));

import CourseLibraryPage from './CourseLibraryPage';

const course: TrainingCourse = {
  id: 'course-1',
  organization_id: 'org-1',
  name: 'Fire Officer I',
  code: 'FO-1',
  description: 'Company officer fundamentals',
  training_type: 'certification',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const renderPage = async () => {
  renderWithRouter(<CourseLibraryPage />);
  expect(await screen.findByText('Fire Officer I')).toBeInTheDocument();
};

describe('CourseLibraryPage management controls', () => {
  beforeEach(() => {
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([course]);
    mockGetCategories.mockReset();
    mockGetCategories.mockResolvedValue([]);
    mockUpdateCourse.mockReset();
    mockUpdateCourse.mockResolvedValue(course);
    hasManagePermission = false;
  });

  describe('without training.manage', () => {
    beforeEach(() => {
      hasManagePermission = false;
    });

    it('still lists the catalog', async () => {
      await renderPage();
      expect(screen.getByText('FO-1')).toBeInTheDocument();
    });

    it('hides Add Course', async () => {
      await renderPage();
      expect(screen.queryByRole('button', { name: /add course/i })).not.toBeInTheDocument();
    });

    it('hides the per-course edit, delete and manage-classes actions', async () => {
      await renderPage();
      expect(screen.queryByRole('button', { name: 'Edit Fire Officer I' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete Fire Officer I' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Manage classes for Fire Officer I' })).not.toBeInTheDocument();
    });

    it('hides the empty-state call to action when the catalog is empty', async () => {
      mockGetCourses.mockResolvedValue([]);
      renderWithRouter(<CourseLibraryPage />);
      expect(await screen.findByText('No courses in your library yet')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /add your first course/i })).not.toBeInTheDocument();
    });

    it('never reaches the write endpoint', async () => {
      await renderPage();
      await waitFor(() => {
        expect(mockGetCourses).toHaveBeenCalled();
      });
      expect(mockUpdateCourse).not.toHaveBeenCalled();
    });
  });

  describe('with training.manage', () => {
    beforeEach(() => {
      hasManagePermission = true;
    });

    it('shows Add Course and the per-course actions', async () => {
      await renderPage();
      expect(screen.getByRole('button', { name: /add course/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit Fire Officer I' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete Fire Officer I' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Manage classes for Fire Officer I' })).toBeInTheDocument();
    });

    it('shows the empty-state call to action when the catalog is empty', async () => {
      mockGetCourses.mockResolvedValue([]);
      renderWithRouter(<CourseLibraryPage />);
      expect(await screen.findByRole('button', { name: /add your first course/i })).toBeInTheDocument();
    });
  });
});
