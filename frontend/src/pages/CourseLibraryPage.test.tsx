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
import userEvent from '@testing-library/user-event';
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

vi.mock('../services/trainingServices', () => ({
  courseSyllabusService: { getClasses: () => Promise.resolve([]) },
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
      expect(screen.queryByRole('button', { name: 'Deactivate Fire Officer I' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Manage classes for Fire Officer I' })).not.toBeInTheDocument();
    });

    it('explains the empty catalog without the call to action', async () => {
      mockGetCourses.mockResolvedValue([]);
      renderWithRouter(<CourseLibraryPage />);
      expect(await screen.findByText('Your department has not added any courses yet')).toBeInTheDocument();
      expect(screen.getByText(/Once a training officer adds them/)).toBeInTheDocument();
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
      expect(screen.getByRole('button', { name: 'Deactivate Fire Officer I' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Manage classes for Fire Officer I' })).toBeInTheDocument();
    });

    it('shows the empty-state call to action when the catalog is empty', async () => {
      mockGetCourses.mockResolvedValue([]);
      renderWithRouter(<CourseLibraryPage />);
      expect(await screen.findByRole('button', { name: /add your first course/i })).toBeInTheDocument();
    });

    // W25-4: a deactivated course left the library with no way back.
    it('lists inactive courses on request and reactivates one', async () => {
      const user = userEvent.setup();
      const inactive: TrainingCourse = { ...course, id: 'course-2', name: 'Hazmat Ops', code: 'HM-1', active: false };
      await renderPage();
      expect(mockGetCourses).toHaveBeenLastCalledWith(true);

      mockGetCourses.mockResolvedValue([course, inactive]);
      await user.click(screen.getByRole('button', { name: /filters/i }));
      await user.click(screen.getByRole('checkbox', { name: 'Show inactive courses' }));

      await waitFor(() => expect(mockGetCourses).toHaveBeenLastCalledWith(false));
      expect(await screen.findByText('Hazmat Ops')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Deactivate Hazmat Ops' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Reactivate Hazmat Ops' }));
      expect(mockUpdateCourse).toHaveBeenCalledWith('course-2', { active: true });
    });
  });

  describe('inactive courses without training.manage', () => {
    it('are not offered', async () => {
      const user = userEvent.setup();
      hasManagePermission = false;
      await renderPage();
      await user.click(screen.getByRole('button', { name: /filters/i }));
      expect(screen.queryByRole('checkbox', { name: 'Show inactive courses' })).not.toBeInTheDocument();
      expect(mockGetCourses).toHaveBeenCalledWith(true);
    });
  });
});

describe('CourseLibraryPage course form', () => {
  beforeEach(() => {
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([
      { ...course, instructor: 'Capt. Lee', expiration_months: 24, category_ids: ['cat-1'] },
    ]);
    mockGetCategories.mockReset();
    mockGetCategories.mockResolvedValue([]);
    mockUpdateCourse.mockReset();
    mockUpdateCourse.mockResolvedValue(course);
    hasManagePermission = true;
  });

  it('names every field by its label', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit Fire Officer I' }));

    for (const label of [
      /^Course Name/,
      /^Course Code$/,
      /^Description$/,
      /^Training Type \*$/,
      /^Duration \(hours\)$/,
      /^Credit Hours$/,
      /^Instructor$/,
      /^Max Participants$/,
      /^Expires After \(months\)$/,
      /^Materials Required/,
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('sends a cleared field as null on an edit, so the clear is saved', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit Fire Officer I' }));

    await user.clear(screen.getByLabelText('Instructor'));
    await user.clear(screen.getByLabelText('Expires After (months)'));
    await user.click(screen.getByRole('button', { name: 'Update Course' }));

    await waitFor(() => expect(mockUpdateCourse).toHaveBeenCalled());
    expect(mockUpdateCourse).toHaveBeenCalledWith(
      'course-1',
      expect.objectContaining({ instructor: null, expiration_months: null, code: 'FO-1', category_ids: ['cat-1'] })
    );
  });
});

describe('CourseLibraryPage syllabus builder', () => {
  beforeEach(() => {
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([course]);
    mockGetCategories.mockReset();
    mockGetCategories.mockResolvedValue([]);
    hasManagePermission = true;
  });

  it('opens "Create a new course" above the syllabus, where it can be used', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Manage classes for Fire Officer I' }));
    await user.click(await screen.findByRole('button', { name: 'Add class' }));
    await user.click(await screen.findByRole('button', { name: 'Create a new course' }));

    // Both overlays share one z-index, so the one later in the document is
    // the one on top and the one that receives clicks.
    const dialogs = await screen.findAllByRole('dialog');
    expect(dialogs[dialogs.length - 1]).toHaveTextContent('Add New Course');
  });
});
