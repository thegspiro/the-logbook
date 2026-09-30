/**
 * Waiver Management loads every leave, not just the endpoint's first page.
 *
 * A leave's auto-created training waiver is shown with the leave rather than
 * as a standalone waiver, and the page decides which waivers are linked from
 * the leave list. When that list stopped at the first page, the oldest leaves
 * — often permanent ones still in force — vanished, and their waivers
 * reappeared as "Training Only" rows whose Deactivate deleted the waiver and
 * left the hidden leave active.
 *
 * Runs the real memberStatusService against a mocked axios instance, so the
 * paging is exercised end to end rather than stubbed out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';
import { LIST_ALL_PAGE_SIZE } from '../services/adminServices';

const mockGet = vi.fn();

vi.mock('../services/apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../hooks/useRanks', () => ({
  useRanks: () => ({ formatRank: (code: string | null | undefined) => code ?? '' }),
}));

import { WaiverManagementPage } from './WaiverManagementPage';

const chief = { id: 'u1', username: 'cmorgan', full_name: 'Casey Morgan', rank: 'fire_chief', status: 'active' };

const leaveRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  user_id: 'u1',
  leave_type: 'medical',
  reason: null,
  start_date: '2024-01-01',
  end_date: '2024-02-01',
  granted_by: null,
  granted_at: null,
  active: false,
  exempt_from_training_waiver: false,
  linked_training_waiver_id: null,
  ...overrides,
});

// A full first page of ended leaves, then — on the second page — the oldest
// one: a permanent leave still in force, with its linked training waiver.
const firstPage = Array.from({ length: LIST_ALL_PAGE_SIZE }, (_, i) => leaveRow(`old-${i}`));
const permanentLeave = leaveRow('loa-permanent', {
  start_date: '2020-01-01',
  end_date: null,
  active: true,
  linked_training_waiver_id: 'tw-linked',
});
const linkedWaiver = {
  id: 'tw-linked',
  user_id: 'u1',
  waiver_type: 'medical',
  reason: null,
  start_date: '2020-01-01',
  end_date: null,
  requirement_ids: null,
  granted_by: null,
  granted_at: null,
  active: true,
};

describe('WaiverManagementPage — more leaves than one page', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockImplementation((url: string, config?: { params?: { skip?: number } }) => {
      const skip = config?.params?.skip ?? 0;
      if (url === '/users/leaves-of-absence') {
        return Promise.resolve({ data: skip === 0 ? firstPage : [permanentLeave] });
      }
      if (url === '/training/waivers') {
        return Promise.resolve({ data: skip === 0 ? [linkedWaiver] : [] });
      }
      if (url === '/users') {
        return Promise.resolve({ data: [chief] });
      }
      return Promise.resolve({ data: [] });
    });
    window.history.replaceState({}, '', '/members/admin/waivers?tab=active');
  });

  it('still recognises a waiver linked to a leave beyond the first page', async () => {
    renderWithRouter(<WaiverManagementPage />);

    await screen.findByText('Training, Meetings, Shifts');
    const row = screen.getByRole('row', { name: /Casey Morgan/ });
    expect(within(row).getByText('Training, Meetings, Shifts')).toBeInTheDocument();
    expect(screen.queryByText('Training Only')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Deactivate' })).toHaveLength(1);
  });
});
