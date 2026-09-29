/**
 * The Sign-offs page: where the officers a Multi-Signer Approval stage names
 * approve an applicant (workflow review W16-1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { PendingSignOff } from '../types';

const mockListMine = vi.fn();
const mockSign = vi.fn();
vi.mock('../services/api', () => ({
  signOffService: {
    listMine: (...a: unknown[]) => mockListMine(...a) as unknown,
    sign: (...a: unknown[]) => mockSign(...a) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => mockToastSuccess(...a) as unknown,
    error: (...a: unknown[]) => mockToastError(...a) as unknown,
  },
}));

import SignOffsPage from './SignOffsPage';

const waiting: PendingSignOff = {
  prospect_id: 'p1',
  first_name: 'Pat',
  last_name: 'Applicant',
  pipeline_name: 'Volunteer Applicants',
  step_id: 's2',
  step_name: 'Officer Sign-Off',
  step_description: 'Require Chief and President to both approve.',
  roles_to_sign: [{ role: 'chief', label: 'Chief' }],
  required_roles: [
    { role: 'chief', label: 'Chief', signed: false },
    { role: 'president', label: 'President', signed: true },
  ],
};

describe('SignOffsPage', () => {
  beforeEach(() => {
    mockListMine.mockReset();
    mockSign.mockReset();
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    mockListMine.mockResolvedValue([waiting]);
    mockSign.mockResolvedValue({ prospect_id: 'p1', step_id: 's2', step_completed: true });
  });

  it('shows the applicant, the stage and who has signed', async () => {
    renderWithRouter(<SignOffsPage />);

    expect(await screen.findByRole('heading', { name: 'Pat Applicant' })).toBeInTheDocument();
    expect(screen.getByText('Officer Sign-Off · Volunteer Applicants')).toBeInTheDocument();
    const roles = screen.getByRole('list', { name: 'Required approvals' });
    expect(within(roles).getByText('Chief: waiting')).toBeInTheDocument();
    expect(within(roles).getByText('President: signed')).toBeInTheDocument();
  });

  it('signs for the role the member holds, with an optional note, and reloads', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SignOffsPage />);

    await user.click(await screen.findByRole('button', { name: 'Sign as Chief' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Note/), 'Interviewed; recommend.');
    mockListMine.mockResolvedValue([]);
    await user.click(within(dialog).getByRole('button', { name: 'Sign' }));

    await waitFor(() => expect(mockSign).toHaveBeenCalledWith('p1', 's2', 'chief', 'Interviewed; recommend.'));
    expect(mockToastSuccess).toHaveBeenCalledWith('Signed as Chief. Officer Sign-Off is complete for Pat Applicant.');
    expect(await screen.findByText('Nothing is waiting on you')).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    mockListMine.mockResolvedValue([]);
    renderWithRouter(<SignOffsPage />);

    expect(await screen.findByText('Nothing is waiting on you')).toBeInTheDocument();
  });

  it("shows the server's reason when a signature is refused", async () => {
    const user = userEvent.setup();
    mockSign.mockRejectedValue({
      response: { status: 400, data: { detail: 'You may only approve for a role you currently hold' } },
    });
    renderWithRouter(<SignOffsPage />);

    await user.click(await screen.findByRole('button', { name: 'Sign as Chief' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign' }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('You may only approve for a role you currently hold')
    );
  });
});
