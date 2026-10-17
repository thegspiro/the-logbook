/**
 * My IP Exceptions — a refused request keeps what the member typed.
 *
 * The page caught the store's rethrow and returned normally, so the form could
 * not tell a refusal from a success and cleared every field either way: the
 * member read the error toast and found nothing left to correct.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IPException } from '../types';

const mockGetMyExceptions = vi.fn();
const mockRequestException = vi.fn();

vi.mock('../services/api', () => ({
  ipSecurityService: {
    getMyExceptions: (...a: unknown[]) => mockGetMyExceptions(...a) as unknown,
    requestException: (...a: unknown[]) => mockRequestException(...a) as unknown,
  },
}));

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
  },
}));

// Import AFTER the mocks are in place.
import MyIPExceptionsPage from './MyIPExceptionsPage';
import { useIPSecurityStore } from '../store/ipSecurityStore';

const created: IPException = {
  id: 'ex-1',
  ipAddress: '203.0.113.50',
  exceptionType: 'country_block',
  reason: 'Deployed overseas',
  userId: 'u-1',
  organizationId: 'org-1',
  requestedDurationDays: 7,
  validUntil: '2026-10-24T00:00:00Z',
  approvalStatus: 'pending',
  requestedBy: 'u-1',
};

const fillAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'New Request' }));
  await user.type(screen.getByLabelText('IP Address'), '203.0.113.50');
  await user.selectOptions(screen.getByLabelText('Use Case'), 'travel');
  await user.type(screen.getByLabelText('Justification'), 'Deployed overseas');
  await user.click(screen.getByRole('button', { name: 'Submit Request' }));
};

describe('MyIPExceptionsPage request form', () => {
  beforeEach(() => {
    mockGetMyExceptions.mockReset();
    mockRequestException.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    mockGetMyExceptions.mockResolvedValue([]);
    useIPSecurityStore.setState({ myExceptions: [], isLoading: false, isSaving: false, error: null });
  });

  it('keeps the typed request after the server refuses it, and says why', async () => {
    mockRequestException.mockRejectedValue(new Error('That address is already covered'));
    const user = userEvent.setup();
    render(<MyIPExceptionsPage />);

    await fillAndSubmit(user);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockRequestException).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('IP Address')).toHaveValue('203.0.113.50');
    expect(screen.getByLabelText('Use Case')).toHaveValue('travel');
    expect(screen.getByLabelText('Justification')).toHaveValue('Deployed overseas');
  });

  it('closes the form after an accepted request', async () => {
    mockRequestException.mockResolvedValue(created);
    const user = userEvent.setup();
    render(<MyIPExceptionsPage />);

    await fillAndSubmit(user);

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('IP exception request submitted'));
    expect(screen.queryByLabelText('IP Address')).not.toBeInTheDocument();
  });
});
