import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { CourseLinksView } from '../../types/training';

const mockGet = vi.fn();
const mockLink = vi.fn();
const mockLinkSuggested = vi.fn();

vi.mock('../../services/api', () => ({
  trainingService: {
    getCourseLinks: (...a: unknown[]) => mockGet(...a) as unknown,
    linkCourseName: (...a: unknown[]) => mockLink(...a) as unknown,
    linkSuggestedCourseNames: (...a: unknown[]) => mockLinkSuggested(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import CourseLinksPanel from './CourseLinksPanel';

const COURSES = [
  { id: 'c-cpr', name: 'CPR Refresher', code: null },
  { id: 'c-ladders', name: 'Ladder Operations', code: 'LAD-1' },
];

const VIEW: CourseLinksView = {
  items: [
    {
      key: 'cprrefresher',
      label: 'CPR Refresher',
      spellings: [
        { name: 'CPR Refresher', records: 9 },
        { name: 'C.P.R. refresher', records: 3 },
      ],
      records: 12,
      members: 7,
      first_date: '2015-03-01',
      last_date: '2024-06-01',
      suggested_course: COURSES[0] ?? null,
    },
    {
      key: 'ladderraises',
      label: 'Ladder raises',
      spellings: [{ name: 'Ladder raises', records: 4 }],
      records: 4,
      members: 1,
      first_date: '2019-01-01',
      last_date: '2019-01-01',
      suggested_course: null,
    },
  ],
  total: 2,
  offset: 0,
  limit: 25,
  suggested_names: 1,
  suggested_records: 12,
  courses: COURSES,
};

describe('CourseLinksPanel', () => {
  beforeEach(() => {
    for (const mock of [mockGet, mockLink, mockLinkSuggested]) mock.mockReset();
    mockGet.mockResolvedValue(VIEW);
    mockLink.mockResolvedValue({ names: 1, records: 4 });
    mockLinkSuggested.mockResolvedValue({ names: 1, records: 12 });
  });

  it('lists each name with its spellings and suggested course', async () => {
    renderWithRouter(<CourseLinksPanel />);

    const cpr = (await screen.findAllByRole('listitem'))[0] as HTMLElement;
    expect(cpr).toHaveTextContent('12 records · 7 members');
    expect(cpr).toHaveTextContent('Also spelled C.P.R. refresher');
    expect(within(cpr).getByLabelText('Library course for CPR Refresher')).toHaveValue('c-cpr');
    expect(screen.getByLabelText('Library course for Ladder raises')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Link Ladder raises' })).toBeDisabled();
    expect(mockGet).toHaveBeenCalledWith({ search: undefined, offset: 0, limit: 25 });
  });

  it('links a name to the chosen course only after confirmation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CourseLinksPanel />);
    await user.selectOptions(await screen.findByLabelText('Library course for Ladder raises'), 'c-ladders');
    await user.click(screen.getByRole('button', { name: 'Link Ladder raises' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('4 records for 1 member take this course');
    await user.click(within(dialog).getByRole('button', { name: 'Link records' }));

    await waitFor(() => expect(mockLink).toHaveBeenCalledWith('ladderraises', 'c-ladders'));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });

  it('links every suggested course after confirmation', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CourseLinksPanel />);
    await user.click(await screen.findByRole('button', { name: 'Link all suggested (1)' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('1 name (12 records)');
    await user.click(within(dialog).getByRole('button', { name: 'Link all suggested' }));

    await waitFor(() => expect(mockLinkSuggested).toHaveBeenCalled());
  });

  it('says there is nothing to link when every record names a course', async () => {
    mockGet.mockResolvedValue({ ...VIEW, items: [], total: 0, suggested_names: 0, suggested_records: 0 });
    renderWithRouter(<CourseLinksPanel />);

    expect(await screen.findByText('Every training record names a library course')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Link all suggested/ })).not.toBeInTheDocument();
  });
});
