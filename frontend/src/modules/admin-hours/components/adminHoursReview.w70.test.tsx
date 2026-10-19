/**
 * Workflow review W70: clock in and out by QR, manage categories and hours.
 *
 * - The category form's fields had no accessible names; the colour swatches
 *   were nameless buttons; every category row's buttons read "Edit" /
 *   "Deactivate" alike.
 * - Pending Review's Approve / Reject / Edit and checkboxes did not say whose
 *   entry they acted on.
 * - Entry statuses printed their raw code ("pending", "active").
 * - All Entries offered retired categories under the same name as live ones.
 * - The summary read "1 entries", "1 pending entries".
 */

import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import type { AdminHoursCategory, AdminHoursEntry, AdminHoursSummary } from '../types';
import { entryStatusLabel } from '../utils/entryStatus';
import CategoriesTab from './CategoriesTab';
import PendingReviewTab from './PendingReviewTab';
import AllEntriesTab from './AllEntriesTab';
import SummaryTab from './SummaryTab';

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

beforeEach(() => {
  store.current = {
    categories: [category()],
    categoriesLoading: false,
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    allEntries: [entry()],
    allEntriesTotal: 1,
    entriesLoading: false,
    fetchAllEntries: vi.fn(),
    editEntry: vi.fn(),
    reviewEntry: vi.fn(),
    bulkApprove: vi.fn(),
    summary: null,
    fetchSummary: vi.fn(),
  };
});

describe('Categories (W70)', () => {
  it("names each row's buttons after the category", () => {
    renderWithRouter(<CategoriesTab onDataReload={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Edit Station Maintenance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate Station Maintenance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'QR code for Station Maintenance' })).toBeInTheDocument();
  });

  it('labels the form fields and names the colour swatches', () => {
    renderWithRouter(<CategoriesTab onDataReload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Station Maintenance' }));

    expect(screen.getByLabelText('Name *')).toHaveValue('Station Maintenance');
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Max hours per session')).toHaveValue(12);
    const colours = screen.getByRole('group', { name: 'Color' });
    expect(within(colours).getByRole('button', { name: 'Green' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(colours).getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Pending review (W70)', () => {
  it('says whose entry each control acts on', () => {
    renderWithRouter(<PendingReviewTab />);

    const who = "Jordan Avery's Station Maintenance on 10/14/2026";
    expect(screen.getByRole('button', { name: `Approve ${who}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Reject ${who}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Edit ${who}` })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: `Select ${who}` })).toBeInTheDocument();
  });
});

describe('All entries (W70)', () => {
  it('labels the status and marks a retired category in the filter', () => {
    store.current = {
      ...store.current,
      categories: [category(), category({ id: 'cat-2', isActive: false })],
      allEntries: [entry({ status: 'active' })],
    };
    renderWithRouter(<AllEntriesTab />);

    expect(screen.getByText('Clocked in')).toBeInTheDocument();
    const filter = screen.getByRole('combobox', { name: 'Filter entries by category' });
    expect(within(filter).getByRole('option', { name: 'Station Maintenance (inactive)' })).toBeInTheDocument();
  });

  it('reads an unknown status as itself', () => {
    expect(entryStatusLabel('pending')).toBe('Pending review');
    expect(entryStatusLabel('on_hold')).toBe('on hold');
  });
});

describe('Summary (W70)', () => {
  it('counts one entry as one entry', () => {
    const summary: AdminHoursSummary = {
      totalHours: 3,
      totalEntries: 2,
      approvedHours: 2,
      approvedEntries: 1,
      pendingHours: 1,
      pendingEntries: 1,
      periodStart: null,
      periodEnd: null,
      byCategory: [
        {
          categoryId: 'cat-1',
          categoryName: 'Station Maintenance',
          categoryColor: null,
          totalMinutes: 120,
          totalHours: 2,
          entryCount: 1,
        },
      ],
    };
    store.current = { ...store.current, summary };
    renderWithRouter(<SummaryTab />);

    expect(screen.getByText('1 finalized entry')).toBeInTheDocument();
    expect(screen.getByText('1 pending entry')).toBeInTheDocument();
    expect(screen.getByText(/1 entry · 100%/)).toBeInTheDocument();
  });
});
