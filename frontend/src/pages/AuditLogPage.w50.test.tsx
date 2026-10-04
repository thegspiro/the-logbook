/**
 * The Audit Log page attributed every event to "system" because the API
 * never filled `username` (W50-45). It now resolves the actor server-side and
 * sends null only when there was no acting user; the page must show the name
 * it is given and say "system" only for that null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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

const entry = (id: number, event_type: string, user_id: string | null, username: string | null) => ({
  id,
  timestamp: '2026-09-30T07:07:00Z',
  event_type,
  event_category: 'election',
  severity: 'info',
  user_id,
  username,
  ip_address: null,
  event_data: {},
});

describe('AuditLogPage actor column (W50-45)', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockGetStats.mockReset();
    mockGetStats.mockResolvedValue({ total: 2, by_severity: {}, by_category: {} });
    mockList.mockResolvedValue({
      logs: [entry(1, 'vote_cast', 'u1', 'jordan.avery'), entry(2, 'election_closed', null, null)],
      total: 2,
      skip: 0,
      limit: 25,
    });
  });

  it('shows the actor on a row with a username and "system" only on a row without one', async () => {
    renderWithRouter(<AuditLogPage />);
    // The card and table layouts both render every row, so each actor string
    // appears once per layout; the counts match only when the named row is
    // never shown as "system" and the actor-less row always is.
    const names = await screen.findAllByText(/jordan\.avery/);
    expect(names).not.toHaveLength(0);
    const systems = screen.getAllByText(/\bsystem\b/);
    expect(systems).toHaveLength(names.length);
    for (const el of systems) expect(el).not.toHaveTextContent('jordan.avery');
  });
});
