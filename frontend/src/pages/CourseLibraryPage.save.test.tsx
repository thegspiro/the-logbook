/**
 * Training forms batch E: the course dialog follows the owner's form rule
 * (2026-11-05, docs/KNOWN_LIMITATIONS.md "Forms — Save With an Error").
 *
 * A new course is created only once every field is fixed, each refusal shown
 * on its field. An edit saves the rest and leaves a refused field out of the
 * update, so its stored value is kept and the field stays flagged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import type { TrainingCourse } from '../types/training';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p: string) => p === 'training.manage' }),
}));

const mockGetCourses = vi.fn();
const mockUpdateCourse = vi.fn();
const mockCreateCourse = vi.fn();

vi.mock('../services/api', () => ({
  trainingService: {
    getCourses: (...args: unknown[]) => mockGetCourses(...args) as unknown,
    getCategories: () => Promise.resolve([]),
    updateCourse: (...args: unknown[]) => mockUpdateCourse(...args) as unknown,
    createCourse: (...args: unknown[]) => mockCreateCourse(...args) as unknown,
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
  instructor: 'Capt. Lee',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const unprocessable = (field: string, msg: string) =>
  Object.assign(new Error('422'), {
    isAxiosError: true,
    response: { status: 422, data: { detail: [{ loc: ['body', field], msg, type: 'value_error' }] } },
  });

const openPage = async () => {
  renderWithRouter(<CourseLibraryPage />);
  expect(await screen.findByText('Fire Officer I')).toBeInTheDocument();
};

describe('CourseLibraryPage course dialog saves with an error (batch E)', () => {
  beforeEach(() => {
    mockGetCourses.mockReset();
    mockGetCourses.mockResolvedValue([course]);
    mockUpdateCourse.mockReset();
    mockUpdateCourse.mockResolvedValue(course);
    mockCreateCourse.mockReset();
    mockCreateCourse.mockResolvedValue(course);
  });

  it('creates nothing with a blank name, and says so on the name field', async () => {
    const user = userEvent.setup();
    await openPage();
    await user.click(screen.getByRole('button', { name: /add course/i }));

    const create = screen.getByRole('button', { name: 'Create Course' });
    expect(create).toBeEnabled();
    await user.click(create);

    const name = screen.getByLabelText(/^Course Name/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Give the course a name.');
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it('saves the rest of an edit with a blank name, and keeps the name flagged', async () => {
    const user = userEvent.setup();
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Edit Fire Officer I' }));

    await user.clear(screen.getByLabelText(/^Course Name/));
    await user.clear(screen.getByLabelText('Instructor'));
    await user.type(screen.getByLabelText('Instructor'), 'Lt. Park');
    await user.click(screen.getByRole('button', { name: 'Update Course' }));

    await waitFor(() => expect(mockUpdateCourse).toHaveBeenCalledTimes(1));
    const [id, body] = mockUpdateCourse.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('course-1');
    expect(body).not.toHaveProperty('name');
    expect(body).toMatchObject({ instructor: 'Lt. Park', code: 'FO-1' });

    const name = await screen.findByLabelText(/^Course Name/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Course saved, except course name/)).toBeInTheDocument();
  });

  it('resends an edit without a field the server refuses, and flags that field', async () => {
    const user = userEvent.setup();
    mockUpdateCourse.mockRejectedValueOnce(unprocessable('code', 'String should have at most 50 characters'));
    await openPage();
    await user.click(screen.getByRole('button', { name: 'Edit Fire Officer I' }));

    await user.clear(screen.getByLabelText('Instructor'));
    await user.type(screen.getByLabelText('Instructor'), 'Lt. Park');
    await user.click(screen.getByRole('button', { name: 'Update Course' }));

    await waitFor(() => expect(mockUpdateCourse).toHaveBeenCalledTimes(2));
    const [, second] = mockUpdateCourse.mock.calls[1] as [string, Record<string, unknown>];
    expect(second).not.toHaveProperty('code');
    expect(second).toMatchObject({ instructor: 'Lt. Park' });
    expect(await screen.findByLabelText(/^Course Code/)).toHaveAccessibleDescription(
      'String should have at most 50 characters.'
    );
  });

  it('puts a create refusal on its field rather than in a banner', async () => {
    const user = userEvent.setup();
    mockCreateCourse.mockRejectedValueOnce(unprocessable('instructor', 'String should have at most 255 characters'));
    await openPage();
    await user.click(screen.getByRole('button', { name: /add course/i }));

    await user.type(screen.getByLabelText(/^Course Name/), 'Hazmat Ops');
    await user.type(screen.getByLabelText('Instructor'), 'Someone');
    await user.click(screen.getByRole('button', { name: 'Create Course' }));

    await waitFor(() => expect(mockCreateCourse).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText('Instructor')).toHaveAttribute('aria-invalid', 'true');
  });
});
