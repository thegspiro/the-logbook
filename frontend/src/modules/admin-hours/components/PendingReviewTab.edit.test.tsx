/**
 * An officer correcting a pending entry sends its category only when it was
 * changed. Re-sending an unchanged category the department has since retired
 * was refused ("Category is no longer active"), so such an entry could not be
 * corrected at all; members' own edit form already behaves this way.
 */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import type { AdminHoursCategory, AdminHoursEntry } from '../types';
import PendingReviewTab from './PendingReviewTab';

const { store } = vi.hoisted(() => {
  const state: { current: Record<string, unknown> } = { current: {} };
  return { store: state };
});

vi.mock('../store/adminHoursStore', () => ({
  useAdminHoursStore: (selector: (state: unknown) => unknown) => selector(store.current),
}));
vi.mock('../services/api', () => ({
  adminHoursEntryService: { exportCsv: vi.fn() },
  adminHoursSeedService: { seedDefaults: vi.fn() },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

const category = (overrides: Partial<AdminHoursCategory> = {}): AdminHoursCategory => ({
  id: 'cat-1',
  organizationId: 'org-1',
  name: 'Station Maintenance',
  description: null,
  color: '#10B981',
  requireApproval: true,
  autoApproveUnderHours: null,
  maxHoursPerSession: 12,
  isActive: true,
  sortOrder: 0,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...overrides,
});

const entry = (overrides: Partial<AdminHoursEntry> = {}): AdminHoursEntry => ({
  id: 'e-1',
  organizationId: 'org-1',
  userId: 'u-1',
  categoryId: 'cat-1',
  clockInAt: '2026-10-14T23:30:00Z',
  clockOutAt: '2026-10-15T01:30:00Z',
  durationMinutes: 120,
  description: null,
  entryMethod: 'manual',
  status: 'pending',
  approvedBy: null,
  approvedAt: null,
  rejectionReason: null,
  sourceEventId: null,
  sourceRsvpId: null,
  createdAt: '2026-10-15T00:00:00Z',
  updatedAt: '2026-10-15T00:00:00Z',
  categoryName: 'Station Maintenance',
  categoryColor: null,
  userName: 'Jordan Avery',
  approverName: null,
  sourceEventName: null,
  ...overrides,
});

const editEntry = vi.fn();

beforeEach(() => {
  editEntry.mockReset();
  editEntry.mockResolvedValue(undefined);
  store.current = {
    // The entry's category has since been retired.
    categories: [category({ isActive: false }), category({ id: 'cat-2', name: 'Fundraising' })],
    allEntries: [entry()],
    allEntriesTotal: 1,
    entriesLoading: false,
    fetchAllEntries: vi.fn(),
    editEntry,
    reviewEntry: vi.fn(),
    bulkApprove: vi.fn(),
  };
});

const who = "Jordan Avery's Station Maintenance on 10/14/2026";

describe('Pending review edit', () => {
  it('does not re-send an unchanged category, which the server refuses once it is retired', async () => {
    renderWithRouter(<PendingReviewTab />);

    fireEvent.click(screen.getByRole('button', { name: `Edit ${who}` }));
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));

    await waitFor(() => expect(editEntry).toHaveBeenCalledTimes(1));
    const payload = editEntry.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('category_id');
    expect(payload).toHaveProperty('clock_in_at');
  });
});
