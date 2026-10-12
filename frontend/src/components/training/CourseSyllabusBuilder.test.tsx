/**
 * Tests for the course syllabus builder.
 *
 * The behaviour worth protecting is the relative-timing story: the builder must
 * show an officer how the classes space out ("next day", "3 days later") and
 * must reorder through the API rather than only in local state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetClasses = vi.fn();
const mockAddClass = vi.fn();
const mockDeleteClass = vi.fn();
const mockReorderClasses = vi.fn();
const mockAutofillOffsets = vi.fn();
const mockGetCourses = vi.fn();
const mockUpdateClass = vi.fn();
const mockGetLocations = vi.fn();

vi.mock('../../services/trainingServices', () => ({
  courseSyllabusService: {
    getClasses: (...args: unknown[]) => mockGetClasses(...args) as unknown,
    addClass: (...args: unknown[]) => mockAddClass(...args) as unknown,
    deleteClass: (...args: unknown[]) => mockDeleteClass(...args) as unknown,
    reorderClasses: (...args: unknown[]) => mockReorderClasses(...args) as unknown,
    autofillOffsets: (...args: unknown[]) => mockAutofillOffsets(...args) as unknown,
    updateClass: (...args: unknown[]) => mockUpdateClass(...args) as unknown,
  },
}));

vi.mock('../../services/api', () => ({
  trainingService: {
    getCourses: (...args: unknown[]) => mockGetCourses(...args) as unknown,
  },
  locationsService: {
    getLocations: (...args: unknown[]) => mockGetLocations(...args) as unknown,
  },
}));

import { CourseSyllabusBuilder } from './CourseSyllabusBuilder';
import type { CourseClass, TrainingCourse } from '../../types/training';

const course: TrainingCourse = {
  id: 'course-1',
  organization_id: 'org-1',
  name: 'Recruit School',
  training_type: 'orientation',
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const makeClass = (id: string, sequence: number, dayOffset: number, title: string): CourseClass => ({
  id,
  organization_id: 'org-1',
  course_id: 'course-1',
  class_course_id: `catalog-${id}`,
  sequence,
  title,
  day_offset: dayOffset,
  duration_minutes: 180,
  start_time: '19:00',
  is_required: true,
  counts_toward_certification: true,
  active: true,
  created_at: '2026-01-01T00:00:00Z',
});

// The officer's own description: A, then B the next day, then C two days later.
const syllabus = [
  makeClass('a', 1, 0, 'Orientation'),
  makeClass('b', 2, 1, 'SCBA Operations'),
  makeClass('c', 3, 3, 'Ladders'),
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLocations.mockReset();
  mockGetLocations.mockResolvedValue([{ id: 'loc-tower', name: 'Burn Tower' }]);
  mockUpdateClass.mockReset();
  mockUpdateClass.mockResolvedValue({});
  mockAddClass.mockReset();
  mockAddClass.mockResolvedValue({});
  mockGetClasses.mockResolvedValue(syllabus);
  mockGetCourses.mockResolvedValue([{ ...course, id: 'catalog-a', name: 'Orientation' }]);
});

describe('CourseSyllabusBuilder', () => {
  it('renders each class with its day and the gap since the previous one', async () => {
    render(<CourseSyllabusBuilder course={course} />);

    await waitFor(() => {
      expect(screen.getByText('Orientation')).toBeInTheDocument();
    });

    expect(screen.getByText('SCBA Operations')).toBeInTheDocument();
    expect(screen.getByText('Ladders')).toBeInTheDocument();

    // Offsets are zero-based; officers count days from one.
    expect(screen.getByText('Day 1')).toBeInTheDocument();
    expect(screen.getByText('Day 2')).toBeInTheDocument();
    expect(screen.getByText('Day 4')).toBeInTheDocument();

    expect(screen.getByText('Course start')).toBeInTheDocument();
    expect(screen.getByText('Next day')).toBeInTheDocument();
    expect(screen.getByText('2 days later')).toBeInTheDocument();
  });

  it('summarises the syllabus length and span', async () => {
    render(<CourseSyllabusBuilder course={course} />);

    await waitFor(() => {
      expect(screen.getByText(/3 classes over 4 days/)).toBeInTheDocument();
    });
  });

  it('persists a reorder through the API', async () => {
    mockReorderClasses.mockResolvedValue([
      makeClass('b', 1, 1, 'SCBA Operations'),
      makeClass('a', 2, 0, 'Orientation'),
      makeClass('c', 3, 3, 'Ladders'),
    ]);
    const user = userEvent.setup();
    render(<CourseSyllabusBuilder course={course} />);

    await waitFor(() => {
      expect(screen.getByText('SCBA Operations')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Move SCBA Operations earlier/i }));

    await waitFor(() => {
      expect(mockReorderClasses).toHaveBeenCalledWith('course-1', ['b', 'a', 'c']);
    });
  });

  it('cannot move the first class earlier or the last one later', async () => {
    render(<CourseSyllabusBuilder course={course} />);

    await waitFor(() => {
      expect(screen.getByText('Orientation')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Move Orientation earlier/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Move Ladders later/i })).toBeDisabled();
  });

  it('applies a meeting pattern to every class', async () => {
    mockAutofillOffsets.mockResolvedValue(syllabus);
    const user = userEvent.setup();
    render(<CourseSyllabusBuilder course={course} />);

    await waitFor(() => {
      expect(screen.getByText('Orientation')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Fill from pattern/i }));
    await user.click(screen.getByRole('button', { name: /Apply to all/i }));

    await waitFor(() => {
      expect(mockAutofillOffsets).toHaveBeenCalledWith('course-1', {
        meeting_days: [1, 3],
        start_weekday: 0,
      });
    });
  });

  it('shows an empty state before any class is added', async () => {
    mockGetClasses.mockResolvedValue([]);
    render(<CourseSyllabusBuilder course={course} />);

    await waitFor(() => {
      expect(screen.getByText('No classes on this syllabus')).toBeInTheDocument();
    });
  });

  it('flags a class whose catalog course has been archived', async () => {
    mockGetClasses.mockResolvedValue([{ ...makeClass('a', 1, 0, 'Orientation'), class_course_active: false }]);
    render(<CourseSyllabusBuilder course={course} />);

    await waitFor(() => {
      expect(screen.getByText('Course archived')).toBeInTheDocument();
    });
  });

  it('offers inline course creation so the builder is usable from empty', async () => {
    const onCreateCourse = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup();
    render(<CourseSyllabusBuilder course={course} onCreateCourse={onCreateCourse} />);

    await waitFor(() => {
      expect(screen.getByText('Orientation')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Add class/i }));
    await user.click(screen.getByRole('button', { name: /Create a new course/i }));

    expect(onCreateCourse).toHaveBeenCalledTimes(1);
  });

  it('selects a course created from the form, and lists it', async () => {
    const created = { ...course, id: 'new-course', name: 'Vehicle Familiarization' };
    const onCreateCourse = vi.fn().mockResolvedValue(created);
    const user = userEvent.setup();
    render(<CourseSyllabusBuilder course={course} onCreateCourse={onCreateCourse} />);

    await waitFor(() => {
      expect(screen.getByText('Orientation')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Add class/i }));
    await user.click(screen.getByRole('button', { name: /Create a new course/i }));

    const select = screen.getByLabelText('Course taught');
    await waitFor(() => expect(select).toHaveValue('new-course'));
    expect(within(select).getByRole('option', { name: /Vehicle Familiarization/ })).toBeInTheDocument();
  });

  it('excludes the course itself from the class-course picker', async () => {
    // A recruit school must not be able to contain itself as one of its classes.
    mockGetCourses.mockResolvedValue([course, { ...course, id: 'catalog-a', name: 'Orientation' }]);
    const user = userEvent.setup();
    render(<CourseSyllabusBuilder course={course} />);

    await waitFor(() => {
      expect(screen.getByText('SCBA Operations')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Add class/i }));

    const select = screen.getByLabelText('Course taught');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).not.toContain('Recruit School');
    expect(options).toContain('Orientation');
  });
});

describe('CourseSyllabusBuilder rooms', () => {
  it('saves a room of its own on a new class', async () => {
    const user = userEvent.setup();
    render(<CourseSyllabusBuilder course={course} />);
    await screen.findByText('Orientation');

    await user.click(screen.getByRole('button', { name: /Add class/i }));
    await user.selectOptions(screen.getByLabelText('Course taught'), 'catalog-a');
    await user.selectOptions(screen.getByLabelText(/^Room/), 'loc-tower');
    const submit = screen
      .getAllByRole('button', { name: 'Add class' })
      .find((b) => b.getAttribute('type') === 'submit');
    await user.click(submit as HTMLElement);

    await waitFor(() => expect(mockAddClass).toHaveBeenCalledTimes(1));
    expect(mockAddClass).toHaveBeenCalledWith(
      'course-1',
      expect.objectContaining({ class_course_id: 'catalog-a', location_id: 'loc-tower' })
    );
  });

  it('shows the room on the row and clears it with an explicit null', async () => {
    mockGetClasses.mockResolvedValue([{ ...syllabus[0], location_id: 'loc-tower', title: 'Live Fire' }]);
    const user = userEvent.setup();
    render(<CourseSyllabusBuilder course={course} />);

    expect(await screen.findByText('Burn Tower')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit Live Fire' }));
    await user.selectOptions(screen.getByLabelText(/^Room/), '');
    await user.clear(screen.getByLabelText(/^Title/));
    await user.click(screen.getByRole('button', { name: 'Save class' }));

    await waitFor(() => expect(mockUpdateClass).toHaveBeenCalledTimes(1));
    // An omitted key would leave the old room and title in place.
    expect(mockUpdateClass).toHaveBeenCalledWith(
      'course-1',
      'a',
      expect.objectContaining({ location_id: null, title: null })
    );
  });
});
