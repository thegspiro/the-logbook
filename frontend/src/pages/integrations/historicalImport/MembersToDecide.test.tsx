import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { AdminMember } from '../../../modules/integrations/types/historicalImport';
import MembersToDecide from './MembersToDecide';

const member = (overrides: Partial<AdminMember>): AdminMember => ({
  key: 'number:1',
  display_name: 'Someone',
  membership_number: '1',
  status: 'unmatched',
  reason: '',
  candidate_ids: [],
  new_first_name: '',
  new_last_name: '',
  row_count: 2,
  ...overrides,
});

const options = [{ id: 'u-1', name: 'Alice Ng', membership_number: '101', status: 'active' }];

const members: AdminMember[] = [
  member({ key: 'number:999', display_name: 'Zed Quinn', membership_number: '999' }),
  member({
    key: 'number:1005',
    display_name: 'Pat Doe',
    membership_number: '1005',
    status: 'create',
    new_first_name: 'Pat',
    new_last_name: 'Doe',
  }),
  member({ key: 'number:1006', display_name: 'Lee Roe', membership_number: '1006', status: 'create' }),
];

describe('MembersToDecide', () => {
  const onDecide = vi.fn();

  beforeEach(() => {
    onDecide.mockReset();
  });

  it('folds the members already set to be created away from those still to decide', () => {
    renderWithRouter(
      <MembersToDecide members={members} options={options} busy={false} idPrefix="t" onDecide={onDecide} />
    );
    expect(screen.getByText('Members (1 to decide)')).toBeInTheDocument();
    expect(screen.getByLabelText('Who is Zed Quinn?')).toBeVisible();
    expect(screen.getByText('2 members will be created as archived former members')).toBeVisible();
    expect(screen.getByLabelText('Who is Pat Doe?')).not.toBeVisible();
  });

  it('keeps a folded member editable once opened', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <MembersToDecide members={members} options={options} busy={false} idPrefix="t" onDecide={onDecide} />
    );
    await user.click(screen.getByText('2 members will be created as archived former members'));
    const select = screen.getByLabelText('Who is Pat Doe?');
    expect(select).toBeVisible();
    expect(screen.getByText(/will be created as Pat Doe/)).toBeInTheDocument();
    await user.selectOptions(select, 'u-1');
    expect(onDecide).toHaveBeenCalledWith({ 'number:1005': { action: 'map', user_id: 'u-1' } });
  });

  it('says a single folded member in the singular', () => {
    renderWithRouter(
      <MembersToDecide
        members={[members[1] ?? member({})]}
        options={options}
        busy={false}
        idPrefix="t"
        onDecide={onDecide}
      />
    );
    expect(screen.getByText('Members (0 to decide)')).toBeInTheDocument();
    expect(screen.getByText('1 member will be created as an archived former member')).toBeInTheDocument();
  });
});
