/**
 * A payment's expense classification on its detail page: shown to the finance
 * office, changeable by finance.manage, hidden from members raising requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

import { renderWithRouter } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { FunctionalClassControl } from './FunctionalClassControl';

const signIn = (permissions: string[]) => {
  useAuthStore.setState({ user: { id: 'u-1', permissions } as never });
};

const onChange = vi.fn();

beforeEach(() => {
  onChange.mockReset();
  onChange.mockResolvedValue(undefined);
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
});

describe('FunctionalClassControl', () => {
  it('shows a finance viewer the class it takes from its category', () => {
    signIn(['finance.view']);
    renderWithRouter(<FunctionalClassControl effective="program" subject="PR-1" onChange={onChange} />);

    expect(screen.getByText('Program services')).toBeInTheDocument();
    expect(screen.getByText('(from its budget category)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('says when nothing classifies it', () => {
    signIn(['finance.view']);
    renderWithRouter(<FunctionalClassControl effective={null} subject="PR-1" onChange={onChange} />);

    expect(screen.getByText('Not classified')).toBeInTheDocument();
  });

  it('shows a member raising requests nothing', () => {
    signIn(['finance.request']);
    renderWithRouter(<FunctionalClassControl effective="program" subject="PR-1" onChange={onChange} />);

    expect(screen.queryByText('Expense classification')).not.toBeInTheDocument();
  });

  it('lets the finance office override it, naming the category default', async () => {
    signIn(['finance.view', 'finance.manage']);
    const user = userEvent.setup();
    renderWithRouter(<FunctionalClassControl effective="program" subject="PR-1" onChange={onChange} />);

    const select = screen.getByRole('combobox', { name: 'Expense classification for PR-1' });
    expect(screen.getByRole('option', { name: "Category's class (Program services)" })).toBeInTheDocument();
    await user.selectOptions(select, 'fundraising');

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('fundraising'));
    expect(mockToastSuccess).toHaveBeenCalledWith('Classification saved');
  });

  it('clears an override back to the category', async () => {
    signIn(['finance.manage']);
    const user = userEvent.setup();
    renderWithRouter(
      <FunctionalClassControl value="fundraising" effective="fundraising" subject="PR-1" onChange={onChange} />
    );

    await user.selectOptions(screen.getByRole('combobox'), "Use the category's class");

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  it("shows the API's refusal", async () => {
    signIn(['finance.manage']);
    onChange.mockRejectedValueOnce(new Error('Purchase request not found'));
    const user = userEvent.setup();
    renderWithRouter(<FunctionalClassControl effective={null} subject="PR-1" onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox'), 'program');

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Purchase request not found'));
  });
});
