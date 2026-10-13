/**
 * The restricted-fund picker on the request forms: what each fund has left,
 * and a warning under the department's rule when the form charges more.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FundSelect } from './FundSelect';
import type { FundOption, FundOverspendMode } from '../types';

const funds: FundOption[] = [
  { campaignId: 'engine', name: 'Engine fund', purpose: 'Replace Engine 2', available: '380.00' },
  { campaignId: 'gear', name: 'Gear fund', purpose: null, available: '0.00' },
];

const showFundSelect = (props: {
  value?: string;
  amount?: number;
  mode?: FundOverspendMode;
  options?: FundOption[];
}) => {
  const onChange = vi.fn();
  render(
    <FundSelect
      id="fund"
      value={props.value ?? ''}
      onChange={onChange}
      amount={props.amount ?? 0}
      funds={props.options ?? funds}
      mode={props.mode ?? 'warn'}
    />
  );
  return onChange;
};

describe('FundSelect', () => {
  it('is not shown while the department has no restricted funds', () => {
    showFundSelect({ options: [] });

    expect(screen.queryByLabelText('Restricted fund')).not.toBeInTheDocument();
  });

  it('lists each fund with what it has left', async () => {
    const user = userEvent.setup();
    const onChange = showFundSelect({});

    expect(screen.getByRole('option', { name: 'Engine fund — $380.00 left' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Restricted fund'), 'gear');

    expect(onChange).toHaveBeenCalledWith('gear');
  });

  it('names what the donors gave for', () => {
    showFundSelect({ value: 'engine', amount: 100 });

    expect(screen.getByText('Donors gave this for: Replace Engine 2')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('warns under "warn" that it goes over, and can still be approved', () => {
    showFundSelect({ value: 'engine', amount: 400 });

    expect(screen.getByRole('status')).toHaveTextContent(
      'This is $20.00 more than the fund has left. It can still be approved'
    );
  });

  it('says under "block" that it cannot be approved', () => {
    showFundSelect({ value: 'engine', amount: 400, mode: 'block' });

    expect(screen.getByRole('status')).toHaveTextContent('cannot be approved until the fund has enough');
  });

  it('says nothing under "off"', () => {
    showFundSelect({ value: 'engine', amount: 400, mode: 'off' });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps a fund that has since closed on a request being edited', () => {
    showFundSelect({ value: 'roof', options: funds });

    expect(screen.getByLabelText('Restricted fund')).toHaveValue('roof');
    expect(screen.getByRole('option', { name: 'A fund that is no longer open' })).toBeInTheDocument();
  });
});
