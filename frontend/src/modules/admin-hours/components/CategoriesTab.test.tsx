import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import type { AdminHoursCategory } from '../types';
import CategoriesTab from './CategoriesTab';

let categories: AdminHoursCategory[];

vi.mock('../store/adminHoursStore', () => ({
  useAdminHoursStore: (selector: (state: unknown) => unknown) =>
    selector({
      categories,
      categoriesLoading: false,
      createCategory: vi.fn(),
      updateCategory: vi.fn(),
      deleteCategory: vi.fn(),
    }),
}));

vi.mock('../services/api', () => ({
  adminHoursEntryService: { exportCsv: vi.fn() },
  adminHoursSeedService: { seedDefaults: vi.fn() },
}));

const baseCategory: AdminHoursCategory = {
  id: 'category-1',
  organizationId: 'org-1',
  name: 'Building Maintenance',
  description: null,
  color: '#3B82F6',
  requireApproval: false,
  autoApproveUnderHours: null,
  maxHoursPerSession: 12,
  isActive: true,
  sortOrder: 0,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

describe('CategoriesTab approval labels', () => {
  beforeEach(() => {
    categories = [baseCategory];
  });

  it('scopes auto-approval to clocked sessions and says manual entries are reviewed', () => {
    renderWithRouter(<CategoriesTab onDataReload={vi.fn()} />);

    expect(screen.getByText('Approval: Not required')).toBeInTheDocument();
    expect(screen.getByText('Manual entries: always reviewed')).toBeInTheDocument();
  });

  it('shows the under-hours threshold only where approval is otherwise required', () => {
    categories = [
      { ...baseCategory, id: 'required', name: 'Required', requireApproval: true, autoApproveUnderHours: 4 },
      { ...baseCategory, id: 'open', name: 'Open', requireApproval: false, autoApproveUnderHours: 2 },
    ];
    renderWithRouter(<CategoriesTab onDataReload={vi.fn()} />);

    expect(screen.getByText('Auto-approved under 4h')).toBeInTheDocument();
    // With approval off every clocked session is approved, so a threshold is noise.
    expect(screen.queryByText(/under 2h/)).not.toBeInTheDocument();
  });

  it('does not render a stray 0 for a zero threshold', () => {
    categories = [{ ...baseCategory, requireApproval: true, autoApproveUnderHours: 0 }];
    renderWithRouter(<CategoriesTab onDataReload={vi.fn()} />);

    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('explains in the form which entries the approval settings govern', () => {
    renderWithRouter(<CategoriesTab onDataReload={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Edit'));

    expect(screen.getByRole('checkbox', { name: /require approval/i })).toHaveAccessibleDescription(
      /hours a member logs manually always go to an officer for review/i
    );
  });
});
