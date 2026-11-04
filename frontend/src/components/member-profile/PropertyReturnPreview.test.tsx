import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { PropertyReturnReport } from '../../types/user';
import { PropertyReturnPreview } from './PropertyReturnPreview';

const getPropertyReturnPreview = vi.fn<(userId: string) => Promise<PropertyReturnReport>>();
const changeStatus = vi.fn();

vi.mock('../../services/api', () => ({
  memberStatusService: {
    getPropertyReturnPreview: (userId: string) => getPropertyReturnPreview(userId),
    changeStatus: (...args: unknown[]) => changeStatus(...args) as unknown,
  },
}));

const REPORT: PropertyReturnReport = {
  member_name: 'Sam Smith',
  item_count: 3,
  total_value: 515.5,
  html: '<p>letter</p>',
  items: [
    {
      name: 'Helmet',
      serial_number: 'SN-1',
      asset_tag: '-',
      condition: 'good',
      value: 350,
      quantity: 1,
      type: 'assigned',
      assigned_date: '01/02/2026',
    },
    {
      name: 'Radio',
      serial_number: '-',
      asset_tag: 'AT-9',
      condition: 'fair',
      value: 120.5,
      quantity: 1,
      type: 'checked_out',
      assigned_date: '03/04/2026',
    },
    {
      name: 'Gloves (x3)',
      serial_number: '-',
      asset_tag: '-',
      condition: 'good',
      value: 45,
      quantity: 3,
      type: 'issued',
      assigned_date: '05/06/2026',
    },
  ],
};

describe('PropertyReturnPreview', () => {
  beforeEach(() => {
    getPropertyReturnPreview.mockReset();
    getPropertyReturnPreview.mockResolvedValue(structuredClone(REPORT));
    changeStatus.mockReset();
  });

  it('asks for nothing until the officer opens it', () => {
    renderWithRouter(<PropertyReturnPreview userId="u1" memberName="Sam Smith" />);

    expect(screen.getByRole('button', { name: 'Preview property return' })).toBeInTheDocument();
    expect(getPropertyReturnPreview).not.toHaveBeenCalled();
  });

  it('lists each item with its identifier, quantity and value, and the total', async () => {
    const user = userEvent.setup();
    renderWithRouter(<PropertyReturnPreview userId="u1" memberName="Sam Smith" />);

    await user.click(screen.getByRole('button', { name: 'Preview property return' }));

    const dialog = await screen.findByRole('dialog', { name: 'Property return — Sam Smith' });
    expect(getPropertyReturnPreview).toHaveBeenCalledWith('u1');
    const rows = await within(dialog).findAllByRole('row');
    // Header plus one row per item, in the server's order.
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('Helmet');
    expect(rows[1]).toHaveTextContent('S/N SN-1');
    expect(rows[1]).toHaveTextContent('$350.00');
    expect(rows[2]).toHaveTextContent('Tag AT-9');
    expect(rows[2]).toHaveTextContent('Checked out');
    expect(rows[3]).toHaveTextContent('Gloves (x3)');
    expect(rows[3]).toHaveTextContent('Issued');
    expect(within(rows[3] ?? dialog).getByText('3')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('3 items · Total $515.50');
    // A preview: it never drives the drop itself.
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it('says plainly when the member holds nothing', async () => {
    getPropertyReturnPreview.mockResolvedValue({ ...REPORT, items: [], item_count: 0, total_value: 0 });
    const user = userEvent.setup();
    renderWithRouter(<PropertyReturnPreview userId="u1" memberName="Sam Smith" />);

    await user.click(screen.getByRole('button', { name: 'Preview property return' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Nothing to return')).toBeInTheDocument();
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the error when the preview cannot be loaded', async () => {
    getPropertyReturnPreview.mockRejectedValue(new Error('Member not found'));
    const user = userEvent.setup();
    renderWithRouter(<PropertyReturnPreview userId="u1" memberName="Sam Smith" />);

    await user.click(screen.getByRole('button', { name: 'Preview property return' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Member not found');
  });
});
