import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import RanksSettingsSection from './RanksSettingsSection';
import type { OperationalRankResponse } from '../../services/api';
import type { PositionOption } from '../../modules/scheduling/types/shiftSettings';

const rank = (overrides: Partial<OperationalRankResponse> = {}): OperationalRankResponse => ({
  id: 'rank-1',
  organization_id: 'org-1',
  rank_code: 'emt',
  display_name: 'EMT',
  description: null,
  sort_order: 7,
  is_active: true,
  eligible_positions: ['ems'],
  default_permission_count: 17,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const SEATS: PositionOption[] = [
  { value: 'officer', label: 'Officer' },
  { value: 'ems', label: 'EMT' },
  { value: 'rescue_tech', label: 'Rescue Technician' },
];

const renderSection = (
  ranks: OperationalRankResponse[],
  seatOptions: PositionOption[] = SEATS,
  editingPositionsRankId: string | null = null,
  canReorder = true
) =>
  render(
    <RanksSettingsSection
      canReorder={canReorder}
      ranks={ranks}
      ranksLoading={false}
      editingRank={null}
      addingRank={false}
      rankForm={{ rank_code: '', display_name: '' }}
      rankSaving={false}
      deletingRankId={null}
      editingPositionsRankId={editingPositionsRankId}
      rankValidationIssues={[]}
      seatOptions={seatOptions}
      onSetEditingRank={vi.fn()}
      onSetAddingRank={vi.fn()}
      onSetRankForm={vi.fn()}
      onSetEditingPositionsRankId={vi.fn()}
      onAddRank={vi.fn()}
      onUpdateRank={vi.fn()}
      onDeleteRank={vi.fn()}
      onMoveRank={vi.fn()}
      onToggleEligiblePosition={vi.fn()}
    />
  );

const WARNING = /no default permissions/i;

describe('RanksSettingsSection — who is offered the reorder controls', () => {
  // Ordering did not move to `members.manage` with the rest of the ladder: a
  // rank's sort_order is read by the inventory rule as a seniority predicate,
  // so `reorder_ranks` refuses anyone without `settings.manage`. Offering the
  // controls to an officer it refuses meant every click moved the row
  // optimistically, failed, and snapped back.
  it('offers them to an officer who may reorder', () => {
    renderSection([rank({ id: 'a', display_name: 'EMT' }), rank({ id: 'b', display_name: 'Captain' })]);

    expect(screen.getAllByLabelText('Move up')).toHaveLength(2);
    expect(screen.getAllByLabelText('Move down')).toHaveLength(2);
  });

  it('withholds them entirely from an officer who may not', () => {
    renderSection(
      [rank({ id: 'a', display_name: 'EMT' }), rank({ id: 'b', display_name: 'Captain' })],
      SEATS,
      null,
      false
    );

    // Absent, not disabled: a disabled control still says "you could do this",
    // and this officer never will.
    expect(screen.queryByLabelText('Move up')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Move down')).not.toBeInTheDocument();
  });

  it('still shows the ladder itself when reordering is withheld', () => {
    // The carve-out is about ordering alone — adding, renaming, retiring and
    // re-scoping rungs all stayed with the page. A name no seat shares, so the
    // assertion cannot be satisfied by the eligible-seat badge instead.
    renderSection([rank({ id: 'a', display_name: 'Battalion Chief' })], SEATS, null, false);

    expect(screen.getByText('Battalion Chief')).toBeInTheDocument();
  });
});

describe('RanksSettingsSection — the grants-nothing warning', () => {
  it('marks a rank the department invented, which confers nothing', () => {
    // Rank defaults resolve from a code-level registry keyed by rank_code, so
    // a custom rank grants nothing. That is the intended design; discovering
    // it from a member who cannot see anything is not.
    renderSection([
      rank({ rank_code: 'battalion_chief', display_name: 'Battalion Chief', default_permission_count: 0 }),
    ]);

    expect(screen.getByText(WARNING)).toBeInTheDocument();
  });

  it('leaves a seeded rank unmarked', () => {
    renderSection([rank()]);

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it('marks only the rank that grants nothing when both are listed', () => {
    // One badge, not one per row: the warning has to track the count rather
    // than appear wherever a rank is rendered.
    renderSection([
      rank(),
      rank({
        id: 'rank-2',
        rank_code: 'firefighter_ii',
        display_name: 'Firefighter II',
        default_permission_count: 0,
      }),
    ]);

    expect(screen.getAllByText(WARNING)).toHaveLength(1);
  });

  it('stays silent when the count is absent, rather than warning about every rank', () => {
    // A response cached from before the field shipped has no count. `undefined`
    // is falsy but never `=== 0`, so the check must fall through to no badge.
    const stale = rank();
    delete (stale as Partial<OperationalRankResponse>).default_permission_count;

    renderSection([stale]);

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });
});

describe('RanksSettingsSection — the eligible-seat picker', () => {
  it('offers a seat the department defined itself', () => {
    // The picker used to be a fixed list of nine tokens, so a department that
    // added Rescue Technician in Position Names could staff that seat on a
    // template and never make a rank eligible for it.
    renderSection([rank()], SEATS, 'rank-1');

    expect(screen.getByRole('button', { name: 'Rescue Technician' })).toBeInTheDocument();
  });

  it('names each seat the way the department named it, not by its token', () => {
    renderSection([rank()], SEATS, 'rank-1');

    expect(screen.getByRole('button', { name: 'EMT' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ems' })).not.toBeInTheDocument();
  });

  it('still offers a seat this rank holds after the department retired it', () => {
    // Otherwise the badge shows in display mode with no button to clear it, and
    // the rank keeps conferring a seat nobody can see how to take back.
    renderSection([rank({ eligible_positions: ['ems', 'paramedic'] })], SEATS, 'rank-1');

    expect(screen.getByRole('button', { name: 'Paramedic' })).toBeInTheDocument();
  });

  it('does not invent a button for a seat no rank holds and no department offers', () => {
    renderSection([rank({ eligible_positions: ['ems'] })], SEATS, 'rank-1');

    expect(screen.queryByRole('button', { name: 'Paramedic' })).not.toBeInTheDocument();
  });
});
