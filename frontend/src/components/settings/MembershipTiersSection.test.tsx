/**
 * What the tier editor says about settings it cannot make true.
 *
 * Two of this screen's controls are honest about a gap rather than pretending
 * there is none, and one line of its copy describes a schedule it does not
 * control. All three were review findings, and all three are the same failure:
 * a screen that states something the system does not do.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MembershipTiersSection from './MembershipTiersSection';
import type { MembershipTier } from '../../types/user';

const tier = (overrides: Partial<MembershipTier> = {}): MembershipTier => ({
  id: 'active',
  name: 'Active Member',
  years_required: 1,
  sort_order: 0,
  benefits: {},
  ...overrides,
});

const renderSection = (tiers: MembershipTier[]) =>
  render(
    <MembershipTiersSection
      tiers={tiers}
      autoAdvance
      loading={false}
      saving={false}
      dirty={false}
      memberCount={() => 0}
      onSetAutoAdvance={vi.fn()}
      onUpdateTier={vi.fn()}
      onUpdateBenefits={vi.fn()}
      onAddTier={vi.fn()}
      onRemoveTier={vi.fn()}
      onMoveTier={vi.fn()}
      onSave={vi.fn()}
      onReset={vi.fn()}
    />
  );

/** Open one tier's rights panel, where the benefit controls live. */
const openRights = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Rights' }));
};

describe('the advancement cadence', () => {
  it('describes the monthly schedule the task actually runs on', async () => {
    // `membership_tier_advance` is registered with cron `0 8 1 * *`. Saying
    // "nightly" would leave a member on the wrong tier — and so with the wrong
    // voting and training treatment — for up to a month after their
    // anniversary, with the screen insisting it had already happened.
    renderSection([tier()]);

    expect(screen.getByText(/on the first of each month/i)).toBeInTheDocument();
    expect(screen.queryByText(/nightly/i)).not.toBeInTheDocument();
  });
});

describe('office eligibility', () => {
  it('says on the control that elections do not check it', async () => {
    // No nomination or candidate path reads `can_hold_office`, so clearing it
    // does not stop a member being nominated. CLAUDE.md pitfall #19 allows a
    // reader or a disclosure; this is the disclosure.
    const user = userEvent.setup();
    renderSection([tier()]);
    await openRights(user);

    expect(screen.getByText(/not yet enforced/i)).toBeInTheDocument();
    expect(screen.getByText(/screen candidates by hand/i)).toBeInTheDocument();
  });

  it('still lets the value be recorded', async () => {
    const user = userEvent.setup();
    renderSection([tier()]);
    await openRights(user);

    expect(screen.getByRole('checkbox', { name: /can hold elected office/i })).toBeEnabled();
  });
});

describe('selective training exemptions', () => {
  it('names the requirement types a partly-exempt tier still skips', async () => {
    // `TrainingService.get_training_report` honours `training_exempt_types` on
    // its own, so a tier with `training_exempt: false` and a non-empty list is
    // not fully graded — while the checkbox above reads unchecked.
    const user = userEvent.setup();
    renderSection([
      tier({
        benefits: { training_exempt: false, training_exempt_types: ['continuing_education'] },
      }),
    ]);
    await openRights(user);

    expect(screen.getByText(/still counted as met for this tier/i)).toBeInTheDocument();
    expect(screen.getByText('continuing_education')).toBeInTheDocument();
  });

  it('says nothing when the tier has no selective exemptions', async () => {
    const user = userEvent.setup();
    renderSection([tier({ benefits: { training_exempt: false, training_exempt_types: [] } })]);
    await openRights(user);

    expect(screen.queryByText(/still counted as met for this tier/i)).not.toBeInTheDocument();
  });

  it('says nothing when the tier is fully exempt, which the checkbox already shows', async () => {
    const user = userEvent.setup();
    renderSection([
      tier({
        benefits: { training_exempt: true, training_exempt_types: ['continuing_education'] },
      }),
    ]);
    await openRights(user);

    expect(screen.queryByText(/still counted as met for this tier/i)).not.toBeInTheDocument();
  });
});
