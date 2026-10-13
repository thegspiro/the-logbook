/**
 * Marking a fundraising campaign as a restricted fund, with what its donors
 * gave for, and making it unrestricted again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdate = vi.fn();
vi.mock('../services/api', () => ({
  fundraisingService: { updateCampaign: (...args: unknown[]) => mockUpdate(...args) as unknown },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

import { renderWithRouter } from '@/test/utils';
import { CampaignRestrictionControl } from './CampaignRestrictionControl';
import type { FundraisingCampaign } from '../types';

const campaign = (extra: Partial<FundraisingCampaign> = {}): FundraisingCampaign =>
  ({
    id: 'c-1',
    name: 'Engine drive',
    isRestricted: false,
    restrictionPurpose: null,
    ...extra,
  }) as FundraisingCampaign;

const onChanged = vi.fn();

beforeEach(() => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue({});
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  onChanged.mockReset();
});

describe('CampaignRestrictionControl', () => {
  it('marks a campaign restricted with what the donors gave for', async () => {
    const user = userEvent.setup();
    renderWithRouter(<CampaignRestrictionControl campaign={campaign()} canManage onChanged={onChanged} />);

    await user.click(screen.getByRole('button', { name: 'Mark as restricted fund' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/What the donors gave for/), 'Replacing Engine 2');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as restricted' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('c-1', { isRestricted: true, restrictionPurpose: 'Replacing Engine 2' })
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows a restricted fund and its purpose', () => {
    renderWithRouter(
      <CampaignRestrictionControl
        campaign={campaign({ isRestricted: true, restrictionPurpose: 'Turnout gear' })}
        canManage={false}
        onChanged={onChanged}
      />
    );

    expect(screen.getByText('Restricted fund')).toBeInTheDocument();
    expect(screen.getByText('For: Turnout gear')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('confirms before making it unrestricted, and shows the refusal', async () => {
    mockUpdate.mockRejectedValue(new Error('Payments are charged to this restricted fund'));
    const user = userEvent.setup();
    renderWithRouter(
      <CampaignRestrictionControl
        campaign={campaign({ isRestricted: true, restrictionPurpose: 'Turnout gear' })}
        canManage
        onChanged={onChanged}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Make unrestricted' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Make unrestricted' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Payments are charged to this restricted fund'));
    expect(mockUpdate).toHaveBeenCalledWith('c-1', { isRestricted: false });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('keeps it restricted when the officer backs out', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <CampaignRestrictionControl
        campaign={campaign({ isRestricted: true, restrictionPurpose: 'Turnout gear' })}
        canManage
        onChanged={onChanged}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Make unrestricted' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it restricted' }));

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
