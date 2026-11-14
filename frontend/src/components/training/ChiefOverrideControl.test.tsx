import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listOverrides = vi.fn();
const grantOverride = vi.fn();
const revokeOverride = vi.fn();
vi.mock('../../services/api', () => ({
  trainingService: {
    listRequirementOverrides: (...args: unknown[]) => listOverrides(...args) as unknown,
    grantRequirementOverride: (...args: unknown[]) => grantOverride(...args) as unknown,
    revokeRequirementOverride: (...args: unknown[]) => revokeOverride(...args) as unknown,
  },
}));
vi.mock('../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import ChiefOverrideControl from './ChiefOverrideControl';

const LIVE = {
  id: 'ov-1',
  requirement_id: 'req-1',
  user_id: 'member-1',
  member_name: 'Devon Boyle',
  start_date: '2026-01-01',
  end_date: '2026-06-30',
  reason: 'Deployed',
  granted_at: '2026-01-02T00:00:00Z',
};

describe('ChiefOverrideControl', () => {
  const onChanged = vi.fn();

  beforeEach(() => {
    listOverrides.mockReset();
    listOverrides.mockResolvedValue([]);
    grantOverride.mockReset();
    grantOverride.mockResolvedValue(LIVE);
    revokeOverride.mockReset();
    revokeOverride.mockResolvedValue({ ...LIVE, revoked_at: '2026-02-01T00:00:00Z' });
    onChanged.mockReset();
  });

  const renderControl = () =>
    render(
      <ChiefOverrideControl
        requirementId="req-1"
        memberId="member-1"
        memberName="Devon Boyle"
        windowStart="2026-01-01"
        windowEnd="2026-12-31"
        onChanged={onChanged}
      />
    );

  it('starts from the requirement period and records the dates and reason given', async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: 'Chief override' }));
    expect(screen.getByLabelText('From')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-12-31');
    expect(screen.getByRole('button', { name: 'Record override' })).toBeDisabled();
    await user.clear(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), '2026-06-30');
    await user.type(screen.getByLabelText('Reason'), '  Deployed  ');
    await user.click(screen.getByRole('button', { name: 'Record override' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(grantOverride).toHaveBeenCalledWith('req-1', {
      user_id: 'member-1',
      start_date: '2026-01-01',
      end_date: '2026-06-30',
      reason: 'Deployed',
    });
  });

  it("lists only this member's live overrides and revokes one", async () => {
    listOverrides.mockResolvedValue([
      LIVE,
      { ...LIVE, id: 'ov-old', revoked_at: '2025-12-01T00:00:00Z' },
      { ...LIVE, id: 'ov-other', user_id: 'member-2' },
    ]);
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: 'Chief override' }));
    const revoke = await screen.findAllByRole('button', { name: 'Revoke' });
    expect(revoke).toHaveLength(1);
    await user.click(revoke[0] ?? screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(revokeOverride).toHaveBeenCalledWith('req-1', 'ov-1'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows why the server refused and leaves the screen as it was', async () => {
    grantOverride.mockRejectedValue(new Error('This member already has an override covering part of those dates'));
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: 'Chief override' }));
    await user.type(screen.getByLabelText('Reason'), 'Medical');
    await user.click(screen.getByRole('button', { name: 'Record override' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already has an override');
    expect(onChanged).not.toHaveBeenCalled();
  });
});
