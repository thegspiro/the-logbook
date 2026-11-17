/**
 * Forms review: the cash advance accounts card names a refusal on the field it
 * belongs to (F-2), and says one no field answers for inside the card (F-3).
 * The PUT replaces both accounts, so a refused one saves neither.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSetAdvanceAccounts = vi.fn();
vi.mock('../services/api', () => ({
  exportMappingService: {
    setAdvanceAccounts: (...args: unknown[]) => mockSetAdvanceAccounts(...args) as unknown,
  },
}));
const mockToastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => mockToastSuccess(...args) as unknown, error: vi.fn() },
}));

import { AdvanceExportSection } from './AdvanceExportSection';
import { AdvanceExportStatus, type AdvanceExportReadiness } from '../types';

const advances: AdvanceExportReadiness = {
  status: AdvanceExportStatus.NO_CASH_ACCOUNT,
  advancesAccount: 'Employee Advances',
  cashAccount: null,
};
const refusal = (field: string, message: string) => ({
  response: { status: 422, data: { detail: [{ field, message }] } },
});

const onSaved = vi.fn();
const renderCard = () => render(<AdvanceExportSection advances={advances} onSaved={onSaved} />);

beforeEach(() => {
  mockSetAdvanceAccounts.mockReset();
  mockSetAdvanceAccounts.mockResolvedValue(advances);
  mockToastSuccess.mockReset();
  onSaved.mockReset();
});

describe('AdvanceExportSection', () => {
  it('submits on Enter and sends both accounts', async () => {
    renderCard();
    await userEvent.type(screen.getByLabelText('Paid from and returned to'), 'Operating Checking{Enter}');

    await waitFor(() =>
      expect(mockSetAdvanceAccounts).toHaveBeenCalledWith({
        advancesAccount: 'Employee Advances',
        cashAccount: 'Operating Checking',
      })
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Cash advance accounts saved');
  });

  it('names an over-long account on its field and sends nothing', async () => {
    renderCard();
    const cash = screen.getByLabelText('Paid from and returned to');
    // The input's maxLength stops typing; a pasted or scripted value is what this check is for.
    fireEvent.change(cash, { target: { value: 'x'.repeat(201) } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(cash).toHaveAttribute('aria-invalid', 'true');
    expect(cash).toHaveAccessibleDescription('Keep the account name to 200 characters.');
    expect(cash).toHaveFocus();
    expect(mockSetAdvanceAccounts).not.toHaveBeenCalled();
  });

  it('puts a 422 on the account it names', async () => {
    mockSetAdvanceAccounts.mockRejectedValue(refusal('advances_account', 'String should have at most 200 characters'));
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const account = screen.getByLabelText('Advances account');
    await waitFor(() => expect(account).toHaveAttribute('aria-invalid', 'true'));
    expect(account).toHaveAccessibleDescription('Advances account is too long — keep it to 200 characters.');
    expect(account).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing was saved');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('says a refusal no field answers for inside the card', async () => {
    mockSetAdvanceAccounts.mockRejectedValue(new Error("Accounts Payable and Accounts Receivable can't be used"));
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("can't be used");
    expect(screen.getByLabelText('Advances account')).not.toHaveAttribute('aria-invalid');
  });
});
