/**
 * An override row names the member, not their UUID (W50-51).
 *
 * `GET /elections/{id}/voter-overrides` returns `VoterOverrideRecord`, whose
 * name field is `member_name`. The row used to read a `user_name` the API
 * never sends, so every headline fell back to the user's UUID.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { VoterOverride } from '../types/election';

const getVoterOverrides = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getVoterOverrides: (...args: unknown[]) => getVoterOverrides(...args) as unknown,
    addVoterOverride: vi.fn(),
    removeVoterOverride: vi.fn(),
  },
}));

vi.mock('../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { VoterOverrideManagement } from './VoterOverrideManagement';

const named: VoterOverride = {
  user_id: '775e5445-0000-4000-8000-000000000001',
  member_name: 'Tess Park',
  reason: 'Missed the March meeting while on duty',
  overridden_by: 'sec-1',
  overridden_by_name: 'Sam Secretary',
  overridden_at: '2026-09-20T14:00:00Z',
};

describe('VoterOverrideManagement row headline (W50-51)', () => {
  beforeEach(() => {
    getVoterOverrides.mockReset();
  });

  it('shows member_name as the headline and the id as the small aside', async () => {
    getVoterOverrides.mockResolvedValue([named]);
    render(<VoterOverrideManagement electionId="elec-1" canManage />);

    const headline = await screen.findByText('Tess Park');
    expect(headline).toHaveClass('font-medium');
    expect(screen.getByText(named.user_id)).toHaveClass('text-xs');
    expect(screen.getByRole('button', { name: 'Remove override for Tess Park' })).toBeInTheDocument();
  });

  it('falls back to the id only when the API sends no member_name', async () => {
    getVoterOverrides.mockResolvedValue([{ ...named, member_name: null }]);
    render(<VoterOverrideManagement electionId="elec-1" canManage />);

    await waitFor(() => {
      expect(screen.getByText(named.user_id)).toHaveClass('font-medium');
    });
    expect(screen.queryByText('Tess Park')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Remove override for ${named.user_id}` })).toBeInTheDocument();
  });
});
