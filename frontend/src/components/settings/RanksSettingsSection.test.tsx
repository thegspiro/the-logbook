import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import RanksSettingsSection from './RanksSettingsSection';
import type { OperationalRankResponse } from '../../services/api';

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

const renderSection = (ranks: OperationalRankResponse[]) =>
  render(
    <RanksSettingsSection
      ranks={ranks}
      ranksLoading={false}
      editingRank={null}
      addingRank={false}
      rankForm={{ rank_code: '', display_name: '' }}
      rankSaving={false}
      deletingRankId={null}
      editingPositionsRankId={null}
      rankValidationIssues={[]}
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
