import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockGet = vi.fn();
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    ...actual,
    default: { ...actual.default, get: (...a: unknown[]) => mockGet(...a) as unknown },
  };
});

import PublicMinutesPage from './PublicMinutesPage';

const item = {
  id: 'c1',
  title: 'October meeting',
  meeting_type_display: 'Business',
  meeting_date: '2026-10-01T19:00:00Z',
  meeting_date_display: 'October 1, 2026',
  posted_at: '2026-10-05T12:00:00Z',
  version: 1,
  under_correction: false,
};

const content = {
  location: 'Station 1',
  called_by: null,
  called_to_order: '7:00 PM',
  adjourned: '8:30 PM',
  quorum_display: null,
  attendance: {
    present: 9,
    excused: 1,
    absent: 2,
    guests: 3,
    officers_present: [{ name: 'Pat Chief', role: 'Chief' }],
  },
  sections: [
    { title: 'Old business', content: '<p>Roof repair <strong>approved</strong></p>', format: 'html' },
    { title: 'Training report', content: '', format: 'text', not_taken_up: true },
  ],
  motions: [
    {
      number: 1,
      text: 'Buy a hose',
      status: 'passed',
      moved_by: 'A',
      seconded_by: 'B',
      vote_display: '8 yes · 1 no',
    },
  ],
  action_items: [],
  closed_sessions: [{ reason: 'Personnel', legal_basis: 'Open meetings act', started: '8:00 PM', ended: '8:20 PM' }],
  election_results: [],
  approval: { adopted_on: 'October 8, 2026', as_amended: true, version: 1, signatures: [] },
};

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/public/minutes" element={<PublicMinutesPage />} />
        <Route path="/public/minutes/:copyId" element={<PublicMinutesPage />} />
      </Routes>
    </MemoryRouter>
  );

describe('PublicMinutesPage', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('lists what the department posted, with a link to each', async () => {
    mockGet.mockResolvedValue({
      data: { organization_name: 'Falls Church FD', minutes: [item], total: 1, skip: 0, limit: 50 },
    });
    at('/public/minutes');

    expect(await screen.findByRole('link', { name: 'October meeting' })).toHaveAttribute('href', '/public/minutes/c1');
    expect(screen.getByText('Falls Church FD meeting minutes')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/api/public/v1/minutes');
  });

  it('says so when nothing has been posted', async () => {
    mockGet.mockResolvedValue({ data: { organization_name: 'FD', minutes: [], total: 0, skip: 0, limit: 50 } });
    at('/public/minutes');
    expect(await screen.findByText('No minutes have been posted yet.')).toBeInTheDocument();
  });

  it('treats a 404 as not available rather than an error', async () => {
    mockGet.mockRejectedValue(Object.assign(new Error('nope'), { isAxiosError: true, response: { status: 404 } }));
    at('/public/minutes');
    expect(await screen.findByText('These minutes are not available.')).toBeInTheDocument();
  });

  it('shows a load failure as an alert', async () => {
    mockGet.mockRejectedValue(new Error('network'));
    at('/public/minutes');
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  });

  it('reads one set of minutes in full', async () => {
    mockGet.mockResolvedValue({
      data: { ...item, organization_name: 'Falls Church FD', replaces: null, content },
    });
    at('/public/minutes/c1');

    expect(await screen.findByRole('heading', { name: 'October meeting' })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/api/public/v1/minutes/c1');
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.getByText('Not taken up at this meeting.')).toBeInTheDocument();
    expect(screen.getByText(/Pat Chief \(Chief\)/)).toBeInTheDocument();
    expect(screen.getByText(/Buy a hose/)).toBeInTheDocument();
    expect(screen.getByText('Personnel')).toBeInTheDocument();
    expect(screen.getByText(/Adopted on October 8, 2026 as amended/)).toBeInTheDocument();
  });

  it('notes the version it replaced and when it is being corrected', async () => {
    mockGet.mockResolvedValue({
      data: {
        ...item,
        under_correction: true,
        organization_name: 'FD',
        replaces: { version: 1, posted_on: 'October 5, 2026' },
        content,
      },
    });
    at('/public/minutes/c1');

    expect(await screen.findByText(/This version replaces version 1, posted October 5, 2026/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('being corrected');
  });

  it('shows a withdrawn or unknown set of minutes as not available', async () => {
    mockGet.mockRejectedValue(Object.assign(new Error('gone'), { isAxiosError: true, response: { status: 404 } }));
    at('/public/minutes/zzz');
    expect(await screen.findByText('These minutes are not available.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /All minutes/ })).toHaveAttribute('href', '/public/minutes');
  });

  it('shows only the attendance counts the server sent', async () => {
    mockGet.mockResolvedValue({
      data: {
        ...item,
        organization_name: 'FD',
        replaces: null,
        content: {
          ...content,
          attendance: { present: 9, guests: 3, officers_present: [] },
        },
      },
    });
    at('/public/minutes/c1');

    expect(await screen.findByText('Present')).toBeInTheDocument();
    expect(screen.getByText('Guests')).toBeInTheDocument();
    expect(screen.queryByText('Absent')).not.toBeInTheDocument();
    expect(screen.queryByText('Excused')).not.toBeInTheDocument();
  });
});
