/**
 * A member's own entries stay theirs to correct until an officer credits them:
 * pending entries can be edited or withdrawn, and a rejected entry — how an
 * officer sends hours back — can be edited and resubmitted. The "Awaiting
 * review" card points at the entries it counts.
 */

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import type { AdminHoursEntry, AdminHoursEntryEdit, AdminHoursSummary } from '../types';
import AdminHoursPage from './AdminHoursPage';

interface EntryParams {
  status?: string;
  skip?: number;
}

const fetchMySummary = vi.fn<(params: { userId: string }) => Promise<void>>();
const fetchMyEntries = vi.fn<(params?: EntryParams) => Promise<void>>();
const editMine = vi.fn<(id: string, data: AdminHoursEntryEdit) => Promise<AdminHoursEntry>>();
const withdrawMine = vi.fn<(id: string) => Promise<AdminHoursEntry>>();

let myEntries: AdminHoursEntry[] = [];

const summary: AdminHoursSummary = {
  totalHours: 4,
  totalEntries: 2,
  approvedHours: 2,
  approvedEntries: 1,
  pendingHours: 2,
  pendingEntries: 1,
  periodStart: null,
  periodEnd: null,
  byCategory: [],
};

const storeState = () => ({
  categories: [
    { id: 'category-1', name: 'Administration', maxHoursPerSession: null },
    { id: 'category-2', name: 'Community outreach', maxHoursPerSession: null },
  ],
  myEntries,
  myEntriesTotal: myEntries.length,
  entriesLoading: false,
  activeSession: null,
  activeSessionLoading: false,
  mySummary: summary,
  mySummaryLoading: false,
  error: null,
  fetchCategories: vi.fn(),
  fetchMyEntries,
  fetchActiveSession: vi.fn(),
  clockOut: vi.fn(),
  fetchMySummary,
  clearError: vi.fn(),
});

vi.mock('../store/adminHoursStore', () => ({
  useAdminHoursStore: () => storeState(),
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: { id: 'member-1' } }),
}));

vi.mock('../../../hooks/useTimezone', () => ({
  useTimezone: () => 'America/New_York',
}));

vi.mock('../services/api', () => ({
  adminHoursEntryService: {
    createManual: vi.fn(),
    editMine: (id: string, data: AdminHoursEntryEdit) => editMine(id, data),
    withdrawMine: (id: string) => withdrawMine(id),
  },
  adminHoursComplianceService: { getUserCompliance: () => Promise.resolve([]) },
}));

const makeEntry = (overrides: Partial<AdminHoursEntry>): AdminHoursEntry => ({
  id: 'entry-1',
  organizationId: 'org-1',
  userId: 'member-1',
  categoryId: 'category-1',
  clockInAt: '2026-09-20T13:00:00Z',
  clockOutAt: '2026-09-20T15:00:00Z',
  durationMinutes: 120,
  description: 'Filing',
  entryMethod: 'manual',
  status: 'pending',
  approvedBy: null,
  approvedAt: null,
  rejectionReason: null,
  sourceEventId: null,
  sourceRsvpId: null,
  createdAt: '2026-09-20T15:00:00Z',
  updatedAt: '2026-09-20T15:00:00Z',
  categoryName: 'Administration',
  categoryColor: '#2563eb',
  userName: null,
  approverName: null,
  sourceEventName: null,
  ...overrides,
});

const rowFor = (text: string): HTMLElement => {
  const row = screen.getAllByRole('listitem').find((item) => within(item).queryByText(text));
  if (!row) throw new Error(`No entry row for ${text}`);
  return row;
};

describe('AdminHoursPage — member entry actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editMine.mockReset();
    withdrawMine.mockReset();
    editMine.mockResolvedValue(makeEntry({}));
    withdrawMine.mockResolvedValue(makeEntry({ status: 'withdrawn' }));
    myEntries = [
      makeEntry({ id: 'pending-1', description: 'Pending filing' }),
      makeEntry({
        id: 'rejected-1',
        status: 'rejected',
        description: 'Rejected filing',
        rejectionReason: 'Wrong day',
        approverName: 'Chief',
      }),
      makeEntry({ id: 'approved-1', status: 'approved', description: 'Approved filing' }),
      makeEntry({ id: 'withdrawn-1', status: 'withdrawn', description: 'Withdrawn filing' }),
      makeEntry({
        id: 'event-1',
        entryMethod: 'event_attendance',
        description: 'Event attendance: Drill',
      }),
    ];
  });

  it('offers edit and withdraw only on entries nobody has credited', () => {
    renderWithRouter(<AdminHoursPage />);

    const pending = within(rowFor('Pending filing'));
    expect(pending.getByRole('button', { name: /^Edit / })).toBeInTheDocument();
    expect(pending.getByRole('button', { name: /^Withdraw / })).toBeInTheDocument();

    const rejected = within(rowFor('Rejected filing'));
    expect(rejected.getByText('Edit & resubmit')).toBeInTheDocument();
    expect(rejected.getByRole('button', { name: /^Withdraw / })).toBeInTheDocument();

    for (const text of ['Approved filing', 'Withdrawn filing']) {
      expect(within(rowFor(text)).queryByRole('button')).not.toBeInTheDocument();
    }
  });

  it('lets an event-attendance entry be withdrawn but not edited', () => {
    renderWithRouter(<AdminHoursPage />);

    const event = within(rowFor('Event attendance: Drill'));
    expect(event.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(event.getByRole('button', { name: /^Withdraw / })).toBeInTheDocument();
  });

  it('withdraws only after the member confirms', async () => {
    renderWithRouter(<AdminHoursPage />);

    fireEvent.click(within(rowFor('Pending filing')).getByRole('button', { name: /^Withdraw / }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(withdrawMine).not.toHaveBeenCalled();

    fetchMyEntries.mockClear();
    fireEvent.click(within(rowFor('Pending filing')).getByRole('button', { name: /^Withdraw / }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Withdraw' }));

    await waitFor(() => expect(withdrawMine).toHaveBeenCalledWith('pending-1'));
    await waitFor(() => expect(fetchMyEntries).toHaveBeenCalled());
  });

  it('resubmits a rejected entry through the member edit endpoint', async () => {
    renderWithRouter(<AdminHoursPage />);

    fireEvent.click(within(rowFor('Rejected filing')).getByRole('button', { name: /^Edit / }));
    const form = screen.getByRole('form', { name: 'Edit entry' });
    expect(within(form).getByText('Wrong day')).toBeInTheDocument();

    fireEvent.change(within(form).getByLabelText('Description'), { target: { value: 'Filing, corrected day' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Resubmit' }));

    await waitFor(() => expect(editMine).toHaveBeenCalled());
    const [entryId, payload] = editMine.mock.calls[0] ?? [];
    expect(entryId).toBe('rejected-1');
    expect(payload?.description).toBe('Filing, corrected day');
    // An unchanged category is not re-sent, so a retired one cannot block the
    // correction.
    expect(payload).not.toHaveProperty('category_id');
    expect(payload?.clock_in_at).toMatch(/^2026-09-20T13:00/);
    expect(payload?.clock_out_at).toMatch(/^2026-09-20T15:00/);
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit entry' })).not.toBeInTheDocument());
  });

  it('sends a changed category', async () => {
    renderWithRouter(<AdminHoursPage />);

    fireEvent.click(within(rowFor('Pending filing')).getByRole('button', { name: /^Edit / }));
    const form = screen.getByRole('form', { name: 'Edit entry' });
    fireEvent.change(within(form).getByLabelText('Category'), { target: { value: 'category-2' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(editMine).toHaveBeenCalled());
    expect(editMine.mock.calls[0]?.[1]?.category_id).toBe('category-2');
  });
});

describe('AdminHoursPage — awaiting review card', () => {
  // jsdom does not implement scrollIntoView; install a stub for this block and
  // put back whatever was there so it cannot leak into other files.
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    myEntries = [];
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('filters the list to pending entries and brings it into view', async () => {
    renderWithRouter(<AdminHoursPage />);
    await waitFor(() => expect(fetchMyEntries).toHaveBeenCalled());
    fetchMyEntries.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Awaiting review/ }));

    await waitFor(() => expect(fetchMyEntries).toHaveBeenCalled());
    expect(fetchMyEntries.mock.lastCall?.[0]).toMatchObject({ status: 'pending', skip: 0 });
    expect(screen.getByLabelText('Filter entries by status')).toHaveValue('pending');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'My Hours' })).toHaveFocus();
  });
});
