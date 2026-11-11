import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';
import type { AdminHoursCategory } from '../types';
import CategoriesTab from './CategoriesTab';

let categories: AdminHoursCategory[];
const createCategory = vi.fn();
const clearError = vi.fn();

vi.mock('../store/adminHoursStore', () => ({
  useAdminHoursStore: (selector: (state: unknown) => unknown) =>
    selector({
      categories,
      categoriesLoading: false,
      createCategory: (...args: unknown[]) => createCategory(...args) as unknown,
      updateCategory: vi.fn(),
      deleteCategory: vi.fn(),
      clearError,
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

describe('CategoriesTab server refusals', () => {
  beforeEach(() => {
    categories = [baseCategory];
    createCategory.mockReset();
    clearError.mockReset();
  });

  it("puts a new category's refused name under the name, instead of the store's toast", async () => {
    createCategory.mockRejectedValue({
      response: { status: 422, data: { detail: [{ field: 'name', message: 'Value is too long.' }] } },
    });
    renderWithRouter(<CategoriesTab onDataReload={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Category/ }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Grounds' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));

    const name = screen.getByLabelText(/^Name/);
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(name).toHaveAccessibleDescription('Name is too long — keep it to 200 characters.');
    expect(name).toHaveFocus();
    expect(clearError).toHaveBeenCalled();
  });
});
