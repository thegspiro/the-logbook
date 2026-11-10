/**
 * W71b-5 (owner decision 2026-11-06): a new requirement starts recurring
 * every 12 months, with One-time unticked. It used to start ticked, so an
 * annual physical added in a hurry never fell due. An existing requirement
 * keeps whatever it was saved as.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ScreeningRequirementForm } from './ScreeningRequirementForm';
import type { ScreeningRequirement } from '../types';

const oneTime: ScreeningRequirement = {
  id: 'req-1',
  organization_id: 'org-1',
  name: 'Pre-membership Drug Screen',
  screening_type: 'drug_screening',
  frequency_months: undefined,
  is_active: true,
  grace_period_days: 30,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const oneTimeBox = () => screen.getByRole('checkbox', { name: /One-time requirement/ });

describe('ScreeningRequirementForm recurrence default', () => {
  it('starts a new requirement recurring every 12 months', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRequirementForm requirement={null} onSave={onSave} onClose={vi.fn()} />);

    expect(oneTimeBox()).not.toBeChecked();
    await user.type(screen.getByLabelText('Name *'), 'Annual Physical');
    await user.click(screen.getByRole('button', { name: 'Add Requirement' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ frequency_months: 12 }));
  });

  it('keeps an existing one-time requirement one-time', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ScreeningRequirementForm requirement={oneTime} onSave={onSave} onClose={vi.fn()} />);

    expect(oneTimeBox()).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ frequency_months: null }));
  });
});
