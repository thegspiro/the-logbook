import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import type { HistoricalMemberFullView, HistoricalMemberMemberView } from '../types';

const mockGetPerson = vi.fn();
const mockListTitles = vi.fn();
const mockListRevisions = vi.fn();

vi.mock('../services/api', () => ({
  historyService: {
    getPerson: (...args: unknown[]) => mockGetPerson(...args) as unknown,
    listTitles: (...args: unknown[]) => mockListTitles(...args) as unknown,
    listRevisions: (...args: unknown[]) => mockListRevisions(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/New_York' }));

import HistoryPersonPage from './HistoryPersonPage';

const base = {
  id: 'p1',
  display_name: 'John Smith',
  first_name: 'John',
  middle_name: null,
  last_name: 'Smith',
  suffix: null,
  nickname: null,
  badge_number: '12',
  biography_html: '<p>Served on Engine 3.</p>',
  is_memorial: true,
  is_line_of_duty_death: true,
  service_periods: [
    {
      id: 'sp1',
      start_date: '1951-01-01',
      start_precision: 'year' as const,
      start_circa: false,
      end_date: '1962-01-01',
      end_precision: 'year' as const,
      end_circa: false,
      is_ongoing: false,
      notes: null,
      titles: [{ id: 't1', name: 'Foreman' }],
    },
  ],
  relations: [],
};

const memberView = (): HistoricalMemberMemberView => ({
  ...base,
  view: 'member',
  publication_level: 'members',
  death_date: '1962-07-14',
  death_date_precision: 'day',
  death_date_circa: false,
});

const fullView = (overrides: Partial<HistoricalMemberFullView> = {}): HistoricalMemberFullView => ({
  ...base,
  view: 'full',
  publication_level: 'members',
  user_id: null,
  linked_member_name: null,
  birth_date: '1920-03-04',
  birth_date_precision: 'day',
  birth_date_circa: false,
  biography: 'Served on Engine 3.',
  addresses: '12 Main St',
  verification_sources: null,
  research_notes: null,
  death_date: '1962-07-14',
  death_date_precision: 'day',
  death_date_circa: false,
  death_date_visibility: 'members',
  death_circumstances: null,
  death_circumstances_visibility: 'historian',
  burial_location: null,
  burial_location_visibility: 'historian',
  published_at: null,
  revision_number: 2,
  public_revision_number: null,
  public_changes_pending: false,
  clearance_required: true,
  cleared_for_public: false,
  clearance: null,
  can_edit: true,
  can_publish: true,
  created_at: '2026-11-01T12:00:00Z',
  updated_at: '2026-11-01T12:00:00Z',
  ...overrides,
});

const renderPage = () =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={['/history/people/p1']}>
        <Routes>
          <Route path="/history/people/:personId" element={<HistoryPersonPage />} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

describe('HistoryPersonPage', () => {
  beforeEach(() => {
    mockGetPerson.mockReset();
    mockListTitles.mockReset();
    mockListTitles.mockResolvedValue([]);
    mockListRevisions.mockReset();
    mockListRevisions.mockResolvedValue([]);
  });

  it('shows a member the published record and nothing of the Historian’s', async () => {
    mockGetPerson.mockResolvedValue(memberView());
    renderPage();

    expect(await screen.findByRole('heading', { name: 'John Smith' })).toBeInTheDocument();
    expect(screen.getByText('Died in the line of duty')).toBeInTheDocument();
    expect(screen.getByText('Foreman', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Historian only')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Edit/ })).not.toBeInTheDocument();
    expect(mockListTitles).not.toHaveBeenCalled();
  });

  it('shows the Historian the research fields', async () => {
    mockGetPerson.mockResolvedValue(fullView());
    renderPage();

    expect(await screen.findByText('Historian only')).toBeInTheDocument();
    expect(screen.getByText('12 Main St')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Edit/ })).toBeInTheDocument();
  });

  it('holds public publishing until the server says the record is cleared', async () => {
    mockGetPerson.mockResolvedValue(fullView());
    renderPage();

    const publish = await screen.findByRole('button', { name: 'Publish to the public' });
    expect(publish).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit for public clearance' })).toBeInTheDocument();
  });

  it('lets a cleared record go public', async () => {
    mockGetPerson.mockResolvedValue(fullView({ cleared_for_public: true }));
    renderPage();

    expect(await screen.findByRole('button', { name: 'Publish to the public' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Submit for public clearance' })).not.toBeInTheDocument();
  });

  it('offers deleting only a draft', async () => {
    mockGetPerson.mockResolvedValue(fullView({ publication_level: 'draft' }));
    renderPage();
    expect(await screen.findByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('offers the Historian a merge', async () => {
    mockGetPerson.mockResolvedValue(fullView());
    renderPage();
    expect(await screen.findByRole('link', { name: /Merge with/ })).toHaveAttribute('href', '/history/people/p1/merge');
  });

  it('moves to the kept record when the address was forwarded by a merge', async () => {
    mockGetPerson.mockImplementation((id: string) =>
      Promise.resolve(id === 'p1' ? fullView({ id: 'p2', redirected_from: 'p1' }) : fullView({ id: 'p2' }))
    );
    renderPage();
    expect(await screen.findByRole('heading', { name: 'John Smith' })).toBeInTheDocument();
    expect(mockGetPerson).toHaveBeenLastCalledWith('p2');
  });

  it('says plainly when a record cannot be read', async () => {
    mockGetPerson.mockRejectedValue(Object.assign(new Error('nope'), { response: { status: 404 } }));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Person not found' })).toBeInTheDocument();
  });
});
