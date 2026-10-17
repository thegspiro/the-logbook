/**
 * Grace period: an entered 0 saves as 0, and a blank is refused with a
 * visible message rather than silently becoming 30. The payload used
 * `Number(value) || 30`, which turned both into 30.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    render(<ScreeningRequirementForm requirement={requirement} onSave={onSave} onClose={vi.fn()} />);

    await user.clear(graceField());
    await user.type(graceField(), '0');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ grace_period_days: 0 }));
  });

  it('saves an entered 0 as 0 when creating', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRequirementForm requirement={null} onSave={onSave} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Name *'), 'Vision Exam');
    await user.clear(graceField());
    await user.type(graceField(), '0');
    await user.click(screen.getByRole('button', { name: 'Add Requirement' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ grace_period_days: 0 }));
  });

  it('refuses a blank grace period on edit instead of saving 30', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ScreeningRequirementForm
        requirement={{ ...requirement, grace_period_days: 7 }}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    await user.clear(graceField());
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(screen.getByText('Grace period is required (enter 0 for none)')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses a blank grace period on create instead of saving 30', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRequirementForm requirement={null} onSave={onSave} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Name *'), 'Vision Exam');
    await user.clear(graceField());
    await user.click(screen.getByRole('button', { name: 'Add Requirement' }));

    expect(screen.getByText('Grace period is required (enter 0 for none)')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
