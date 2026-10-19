/**
 * Workflow review W71: a record saved without an expiration date grades as
 * compliant indefinitely, so an annual physical recorded without one never
 * fell due. The form now fills in the date the linked requirement's
 * frequency implies, and leaves a date the officer typed alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ScreeningRequirement, ScreeningSubjects } from '../types';

const listSubjects = vi.fn<() => Promise<ScreeningSubjects>>();
vi.mock('../services/api', () => ({
  medicalScreeningService: {
    listSubjects: () => listSubjects(),
  },
}));

import { ScreeningRecordForm } from './ScreeningRecordForm';

const requirement = (overrides: Partial<ScreeningRequirement>): ScreeningRequirement => ({
  id: 'req-annual',
  organization_id: 'org-1',
  name: 'Annual Physical',
  screening_type: 'physical_exam',
  frequency_months: 12,
  is_active: true,
  grace_period_days: 30,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const REQUIREMENTS = [
  requirement({}),
  requirement({ id: 'req-once', name: 'Drug Screen', screening_type: 'drug_screening', frequency_months: undefined }),
];

const renderForm = () =>
  render(<ScreeningRecordForm record={null} requirements={REQUIREMENTS} onSave={vi.fn()} onClose={vi.fn()} />);

describe('ScreeningRecordForm — suggested expiration (W71)', () => {
  beforeEach(() => {
    listSubjects.mockReset();
    listSubjects.mockResolvedValue({ members: [], prospects: [] });
  });

  it("fills in the expiration from the requirement's frequency, and says so", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByLabelText('Linked Requirement (optional)'), 'req-annual');
    await user.type(screen.getByLabelText('Completed Date'), '2025-11-30');

    const expiration = screen.getByLabelText('Expiration Date');
    expect(expiration).toHaveValue('2026-11-30');
    expect(expiration).toHaveAccessibleDescription(/12-month frequency/);
  });

  it('follows a corrected completed date while the date is still its suggestion', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByLabelText('Linked Requirement (optional)'), 'req-annual');
    await user.type(screen.getByLabelText('Completed Date'), '2025-11-30');
    await user.clear(screen.getByLabelText('Completed Date'));
    await user.type(screen.getByLabelText('Completed Date'), '2025-11-10');

    expect(screen.getByLabelText('Expiration Date')).toHaveValue('2026-11-10');
  });

  it('leaves a date the officer typed alone', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByLabelText('Linked Requirement (optional)'), 'req-annual');
    await user.type(screen.getByLabelText('Expiration Date'), '2026-11-01');
    await user.type(screen.getByLabelText('Completed Date'), '2025-11-12');

    expect(screen.getByLabelText('Expiration Date')).toHaveValue('2026-11-01');
  });

  it('suggests nothing for a one-time requirement', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByLabelText('Linked Requirement (optional)'), 'req-once');
    await user.type(screen.getByLabelText('Completed Date'), '2025-11-12');

    expect(screen.getByLabelText('Expiration Date')).toHaveValue('');
  });
});
