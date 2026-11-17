/**
 * Forms review: the dues default accounts card names a refusal on the field it
 * belongs to (F-2), and says one no field answers for inside the card (F-3).
 * The PUT replaces both accounts, so a refused one saves neither.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSetDuesDefaults = vi.fn();
vi.mock('../services/api', () => ({
  exportMappingService: {
    setDuesDefaults: (...args: unknown[]) => mockSetDuesDefaults(...args) as unknown,
  },
}));
const mockToastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => mockToastSuccess(...args) as unknown, error: vi.fn() },
}));

import { renderWithRouter } from '@/test/utils';
import { DuesExportSection } from './DuesExportSection';
import type { DuesExportReadiness } from '../types';

const dues: DuesExportReadiness = { enabled: true, defaultIncomeAccount: 'Dues Income', schedules: [] };
const refusal = (field: string, message: string) => ({
  response: { status: 422, data: { detail: [{ field, message }] } },
});

const onSaved = vi.fn();
const renderCard = () => renderWithRouter(<DuesExportSection dues={dues} onSaved={onSaved} />);

beforeEach(() => {
  mockSetDuesDefaults.mockReset();
  mockSetDuesDefaults.mockResolvedValue(dues);
  mockToastSuccess.mockReset();
  onSaved.mockReset();
});

describe('DuesExportSection', () => {
  it('submits on Enter and sends both accounts, a blank one as null', async () => {
    renderCard();
    await userEvent.type(screen.getByLabelText('Default deposited to'), ' Operating Checking {Enter}');

    await waitFor(() =>
      expect(mockSetDuesDefaults).toHaveBeenCalledWith({
        incomeAccount: 'Dues Income',
        depositAccount: 'Operating Checking',
      })
    );
    expect(onSaved).toHaveBeenCalledWith(dues);
    expect(mockToastSuccess).toHaveBeenCalledWith('Dues accounts saved');
  });

  it('names an over-long account on its field and sends nothing', async () => {
    renderCard();
    const deposit = screen.getByLabelText('Default deposited to');
    // The input's maxLength stops typing; a pasted or scripted value is what this check is for.
    fireEvent.change(deposit, { target: { value: 'x'.repeat(201) } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(deposit).toHaveAttribute('aria-invalid', 'true');
    expect(deposit).toHaveAccessibleDescription('Keep the account name to 200 characters.');
    expect(deposit).toHaveFocus();
    expect(mockSetDuesDefaults).not.toHaveBeenCalled();
  });

  it('puts a 422 on the account it names', async () => {
    mockSetDuesDefaults.mockRejectedValue(refusal('income_account', 'String should have at most 200 characters'));
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const income = screen.getByLabelText('Default income account');
    await waitFor(() => expect(income).toHaveAttribute('aria-invalid', 'true'));
    expect(income).toHaveAccessibleDescription('Default income account is too long — keep it to 200 characters.');
    expect(income).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing was saved');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('says a refusal no field answers for inside the card', async () => {
    mockSetDuesDefaults.mockRejectedValue(new Error("Accounts Payable and Accounts Receivable can't be used"));
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("can't be used");
    expect(screen.getByLabelText('Default income account')).not.toHaveAttribute('aria-invalid');
  });
});
