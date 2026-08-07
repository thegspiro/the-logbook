import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

import { CourseLibraryPicker } from './CourseLibraryPicker';
import type { TrainingCourse } from '../../types/training';

const course = (overrides: Partial<TrainingCourse> & { id: string; name: string }): TrainingCourse => ({
  organization_id: 'org-1',
  training_type: 'continuing_education',
  active: true,
  created_at: '',
  updated_at: '',
  ...overrides,
});

const COURSES: TrainingCourse[] = [
  course({ id: 'c1', name: 'CPR / BLS', code: 'CPR', training_type: 'certification' }),
  course({ id: 'c2', name: 'Ladders 1', code: 'LAD1' }),
  course({ id: 'c3', name: 'Retired Pump Ops', active: false }),
];

const renderPicker = (props: Partial<React.ComponentProps<typeof CourseLibraryPicker>> = {}) => {
  const onChange = vi.fn();
  render(
    <MemoryRouter>
      <CourseLibraryPicker idPrefix="test" courses={COURSES} selectedIds={[]} onChange={onChange} {...props} />
    </MemoryRouter>
  );
  return { onChange };
};

describe('CourseLibraryPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists active library courses to choose from', () => {
    renderPicker();

    expect(screen.getByText('CPR / BLS', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Ladders 1', { exact: false })).toBeInTheDocument();
  });

  it('hides archived courses that are not linked', () => {
    renderPicker();

    expect(screen.queryByText('Retired Pump Ops', { exact: false })).not.toBeInTheDocument();
  });

  it('keeps an archived course visible while it is still linked', () => {
    renderPicker({ selectedIds: ['c3'] });

    expect(screen.getAllByText('Retired Pump Ops', { exact: false }).length).toBeGreaterThan(0);
  });

  it('adds a course id on selection', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();

    await user.click(screen.getByRole('checkbox', { name: /Ladders 1/ }));

    expect(onChange).toHaveBeenCalledWith(['c2']);
  });

  it('removes an already-linked course on deselection', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ selectedIds: ['c1', 'c2'] });

    await user.click(screen.getByRole('button', { name: 'Remove CPR / BLS' }));

    expect(onChange).toHaveBeenCalledWith(['c2']);
  });

  it('filters the list by search term', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.type(screen.getByLabelText('Courses to complete'), 'ladder');

    expect(screen.queryByRole('checkbox', { name: /CPR/ })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Ladders 1/ })).toBeInTheDocument();
  });

  it('defaults the certification variant to certification-type courses', () => {
    renderPicker({ variant: 'certification' });

    expect(screen.getByRole('checkbox', { name: /CPR/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Ladders 1/ })).not.toBeInTheDocument();
  });

  it('warns when a courses requirement has nothing linked', () => {
    renderPicker();

    expect(screen.getByText(/Members can't earn credit for this requirement/)).toBeInTheDocument();
  });

  it('points at the course library when the catalog is empty', () => {
    renderPicker({ courses: [] });

    expect(screen.getByRole('link', { name: /Add one in the Course Library/ })).toBeInTheDocument();
  });

  it('flags a linked course that is no longer in the library', () => {
    renderPicker({ selectedIds: ['gone'] });

    expect(screen.getByText('Course no longer in the library')).toBeInTheDocument();
  });
});
