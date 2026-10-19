/**
 * Workflow review W55: every row's actions were announced as "Edit message",
 * "Delete message" and "View acknowledgments", so a screen-reader user could
 * not tell which message a button acted on; and one recipient read "1 members".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import type { DepartmentMessageRecord } from '../../../services/adminServices';

const mockGetMessages = vi.fn();
const mockGetRoles = vi.fn();

vi.mock('../../../services/api', () => ({
  messagesService: {
    getMessages: (...args: unknown[]) => mockGetMessages(...args) as unknown,
    getAvailableRoles: (...args: unknown[]) => mockGetRoles(...args) as unknown,
    deleteMessage: vi.fn(),
    getAcknowledgmentReport: vi.fn(),
  },
  userService: { getUsers: vi.fn() },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import MessagesAdminPage from './MessagesAdminPage';

const message = (overrides: Partial<DepartmentMessageRecord>): DepartmentMessageRecord =>
  ({
    id: 'm1',
    title: 'Hose test Saturday',
    body: 'Station 1, 0800.',
    priority: 'important',
    target_type: 'members',
    target_member_ids: ['u1'],
    is_pinned: false,
    is_persistent: false,
    requires_acknowledgment: true,
    is_active: true,
    created_at: '2026-10-05T21:42:00Z',
    ...overrides,
  }) as DepartmentMessageRecord;

describe('MessagesAdminPage rows (W55)', () => {
  beforeEach(() => {
    mockGetRoles.mockReset();
    mockGetRoles.mockResolvedValue([]);
    mockGetMessages.mockReset();
    mockGetMessages.mockResolvedValue({
      messages: [message({}), message({ id: 'm2', title: 'Officers meeting', target_type: 'all' })],
      total: 2,
    });
  });

  it("names each row's actions after its message", async () => {
    renderWithRouter(<MessagesAdminPage />);

    expect(await screen.findByRole('button', { name: 'Edit Hose test Saturday' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Officers meeting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View acknowledgments for Hose test Saturday' })).toBeInTheDocument();
  });

  it('counts a single recipient as one member', async () => {
    renderWithRouter(<MessagesAdminPage />);

    expect(await screen.findByText(/^1 member ·/)).toBeInTheDocument();
  });
});
