/**
 * Workflow review W75: the desktop audit table opened a row's details only on
 * a click on the `<tr>`, which a keyboard cannot reach. The event name is now
 * a button that says whether the details are open and points at them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
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

describe('AuditLogPage row details (W75)', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockGetStats.mockReset();
    mockGetStats.mockResolvedValue({ total: 1, by_severity: {}, by_category: {} });
    mockList.mockResolvedValue({
      logs: [
        {
          id: 7,
          timestamp: '2026-10-16T00:30:00Z',
          event_type: 'ip_exception_approved',
          event_category: 'security',
          severity: 'info',
          user_id: 'u1',
          username: 'riley.owner',
          ip_address: '203.0.113.9',
          event_data: { country: 'CA' },
        },
      ],
      total: 1,
      skip: 0,
      limit: 25,
    });
  });

  it('opens the details from a keyboard-reachable button in the table', async () => {
    const user = userEvent.setup();
    renderWithRouter(<AuditLogPage />);

    const table = await screen.findByRole('table');
    const toggle = within(table).getByRole('button', { name: 'ip_exception_approved' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'audit-entry-7');

    toggle.focus();
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(table).getByText(/"country": "CA"/)).toBeInTheDocument();
  });
});
