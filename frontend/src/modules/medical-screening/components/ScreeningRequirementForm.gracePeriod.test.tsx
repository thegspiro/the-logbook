/**
 * Grace period: an entered 0 saves as 0, and a blank is refused with a
 * visible message rather than silently becoming 30. The payload used
 * `Number(value) || 30`, which turned both into 30.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import userEvent from '@testing-library/user-event';

import { ScreeningRequirementForm } from './ScreeningRequirementForm';
import type { ScreeningRequirement } from '../types';

const requirement: ScreeningRequirement = {
  id: 'req-1',
  organization_id: 'org-1',
  name: 'Annual Physical',
  screening_type: 'physical_exam',
  frequency_months: 12,
  is_active: true,
  grace_period_days: 30,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const graceField = () => screen.getByLabelText('Grace Period (days past expiration) *');

describe('ScreeningRequirementForm grace period', () => {
  it('saves an entered 0 as 0 when editing', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ScreeningRequirementForm requirement={requirement} onSave={onSave} onClose={vi.fn()} />);

    await user.clear(graceField());
    await user.type(graceField(), '0');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ grace_period_days: 0 }));
  });

  it('saves an entered 0 as 0 when creating', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ScreeningRequirementForm requirement={null} onSave={onSave} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Name *'), 'Vision Exam');
    await user.clear(graceField());
    await user.type(graceField(), '0');
    await user.click(screen.getByRole('button', { name: 'Add Requirement' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ grace_period_days: 0 }));
  });

  // Owner rule of 2026-11-05: an edit is a single save, so the rest is
  // written and the stored grace period is kept, flagged until it is fixed.
  it('keeps the stored grace period on edit when it is blanked, saving the rest', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(
      <ScreeningRequirementForm
        requirement={{ ...requirement, grace_period_days: 7 }}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    await user.clear(graceField());
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(graceField()).toHaveAccessibleDescription(/Grace period is required \(enter 0 for none\)/);
    expect(onSave).toHaveBeenCalledTimes(1);
    const [payload, options] = onSave.mock.calls[0] as [Record<string, unknown>, { keepOpen?: boolean }];
    expect('grace_period_days' in payload).toBe(false);
    expect(payload.name).toBe('Annual Physical');
    expect(options).toEqual({ keepOpen: true });
  });

  it('puts a server refusal on the name it names, not the API key', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue({
      response: {
        status: 422,
        data: { detail: [{ field: 'name', message: 'String should have at most 255 characters' }] },
      },
    });
    renderWithRouter(<ScreeningRequirementForm requirement={null} onSave={onSave} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Name *'), 'Vision Exam{Enter}');

    const name = screen.getByLabelText('Name *');
    await vi.waitFor(() => expect(name).toHaveAccessibleDescription('Name is too long — keep it to 255 characters.'));
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('asks before Cancel discards a changed requirement', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithRouter(<ScreeningRequirementForm requirement={requirement} onSave={vi.fn()} onClose={onClose} />);

    await user.type(screen.getByLabelText('Name *'), ' (revised)');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses a blank grace period on create instead of saving 30', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ScreeningRequirementForm requirement={null} onSave={onSave} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Name *'), 'Vision Exam');
    await user.clear(graceField());
    await user.click(screen.getByRole('button', { name: 'Add Requirement' }));

    expect(screen.getByText('Grace period is required (enter 0 for none)')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
