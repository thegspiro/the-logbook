/**
 * Starting an application needs fundraising.manage (the route and the
 * create both require it), so a view-only member is not offered the link.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

let granted = new Set<string>();
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => granted.has(p) }),
}));

const listApplicationsPage = vi.fn();
vi.mock('../services/api', () => ({
  grantsService: {
    listApplicationsPage: (...args: unknown[]) => listApplicationsPage(...args) as unknown,
  },
}));

import GrantApplicationsPage from './GrantApplicationsPage';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/grants/applications']}>
      <GrantApplicationsPage />
    </MemoryRouter>
  );

describe('GrantApplicationsPage New Application link', () => {
  beforeEach(() => {
    listApplicationsPage.mockReset();
    listApplicationsPage.mockResolvedValue({ items: [], total: 0 });
  });

  it('is not offered to a view-only member', async () => {
    granted = new Set(['fundraising.view']);
    renderPage();

    expect(await screen.findByText('No grant applications found')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New Application' })).not.toBeInTheDocument();
  });

  it('is offered to a member who can manage fundraising', async () => {
    granted = new Set(['fundraising.manage']);
    renderPage();

    expect(await screen.findByText('No grant applications found')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'New Application' })).toHaveLength(2);
  });
});
