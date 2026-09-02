/**
 * The admin hub advertises three sibling screens, and each one is gated
 * differently from the page itself.
 *
 * This page runs on `inventory.check_manage`. None of the three cards is
 * opened by that grant alone, which is the whole point: authoring a checklist,
 * reading its results, managing stock and editing department settings are
 * separate permissions. Two of the cards used to declare no requirement at all
 * and were shown to everyone who reached the page — including the seeded
 * President position, which holds `check_manage` without `check_view` and got
 * a refusal on Check reports.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

const mockCheckPermission = vi.fn();
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: () => ({
    checkPermission: (...a: unknown[]) => mockCheckPermission(...a) as boolean,
  }),
}));

// The template list does its own fetching; this suite is about the nav row.
vi.mock('../components/EquipmentCheckTemplateList', () => ({
  EquipmentCheckTemplateList: () => <div data-testid="template-list" />,
}));

import { ChecklistsAdminPage } from './ChecklistsAdminPage';

/** Grant exactly `held`, and nothing else. */
const grant = (...held: string[]) => {
  mockCheckPermission.mockImplementation((p: unknown) => held.includes(p as string));
};

// mockReset before installing a default, so one test's grant set cannot leak
// into the next block (CLAUDE.md pitfall #28).
beforeEach(() => {
  mockCheckPermission.mockReset();
  grant();
});

describe('ChecklistsAdminPage related links', () => {
  it('hides every card when the viewer holds only this page’s own grant', () => {
    grant('inventory.check_manage');
    renderWithRouter(<ChecklistsAdminPage />);

    expect(screen.queryByRole('link', { name: /Check reports/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Expiring on apparatus/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Checklist settings/i })).toBeNull();
    // The page itself still renders — only the shortcuts are gated.
    expect(screen.getByTestId('template-list')).toBeInTheDocument();
  });

  it('shows Check reports only to a holder of inventory.check_view', () => {
    grant('inventory.check_manage', 'inventory.check_view');
    renderWithRouter(<ChecklistsAdminPage />);

    expect(screen.getByRole('link', { name: /Check reports/i })).toHaveAttribute(
      'href',
      '/inventory/admin/checklists/reports'
    );
  });

  it('opens Expiring on apparatus for any one of its three grants', () => {
    // inventory.manage alone — neither check_view nor scheduling.manage.
    grant('inventory.check_manage', 'inventory.manage');
    renderWithRouter(<ChecklistsAdminPage />);

    expect(screen.getByRole('link', { name: /Expiring on apparatus/i })).toBeInTheDocument();
    // ...and that grant does not open the reports page.
    expect(screen.queryByRole('link', { name: /Check reports/i })).toBeNull();
  });

  it('shows Checklist settings to a department-settings holder', () => {
    grant('inventory.check_manage', 'organization.update_settings');
    renderWithRouter(<ChecklistsAdminPage />);

    expect(screen.getByRole('link', { name: /Checklist settings/i })).toBeInTheDocument();
  });

  it('is the President case: check_manage without check_view hides reports', () => {
    // The seeded President position, which is what made this a real defect
    // rather than a hypothetical one.
    grant('inventory.check_manage', 'inventory.manage', 'scheduling.manage');
    renderWithRouter(<ChecklistsAdminPage />);

    expect(screen.queryByRole('link', { name: /Check reports/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Expiring on apparatus/i })).toBeInTheDocument();
  });
});
