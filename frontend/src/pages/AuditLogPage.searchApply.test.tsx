/**
 * The audit log's dropdowns apply on change while the search box waits for
 * Apply. Apply is enabled only while the box differs from the search already
 * shown, and an unapplied term is flagged so it is not mistaken for the
 * results on screen.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockList = vi.fn();
const mockGetStats = vi.fn();

vi.mock('../services/api', () => ({
  auditLogService: {
    list: (...args: unknown[]) => mockList(...args) as unknown,
    getStats: (...args: unknown[]) => mockGetStats(...args) as unknown,
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import AuditLogPage from './AuditLogPage';

describe('AuditLogPage search Apply', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockGetStats.mockReset();
    mockGetStats.mockResolvedValue({ total: 0, by_severity: {}, by_category: {} });
    mockList.mockResolvedValue({ logs: [], total: 0, skip: 0, limit: 25 });
  });

  it('keeps Apply disabled and shows no cue while the box matches the applied search', async () => {
    renderWithRouter(<AuditLogPage />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.queryByText(/Not applied yet/)).not.toBeInTheDocument();
  });

  it('enables Apply and flags the term once it differs, and clears both once applied', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AuditLogPage />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    const box = screen.getByRole('searchbox', { name: 'Search audit log' });
    await user.type(box, 'login');

    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeEnabled();
    expect(screen.getByText(/Not applied yet/)).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-describedby', 'audit-search-unapplied');

    await user.click(apply);

    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'login' })));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.queryByText(/Not applied yet/)).not.toBeInTheDocument();
  });

  it('treats surrounding whitespace as no change', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AuditLogPage />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    await user.type(screen.getByRole('searchbox', { name: 'Search audit log' }), '   ');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });
});
