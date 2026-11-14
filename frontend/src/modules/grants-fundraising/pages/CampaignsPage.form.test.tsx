/**
 * The inline New / Edit Campaign form: each refusal on its field, the
 * single-save rule on edit, and Cancel asking before typed changes are lost.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockListCampaigns = vi.fn();
const mockCreateCampaign = vi.fn();
const mockUpdateCampaign = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('../../../stores/authStore', () => {
  const state = { checkPermission: (_permission: string) => true };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => mockToastSuccess(...a) as unknown, error: vi.fn() },
}));
vi.mock('../services/api', () => ({
  fundraisingService: {
    listCampaigns: (...args: unknown[]) => mockListCampaigns(...args) as unknown,
    createCampaign: (...args: unknown[]) => mockCreateCampaign(...args) as unknown,
    updateCampaign: (...args: unknown[]) => mockUpdateCampaign(...args) as unknown,
  },
}));

import CampaignsPage from './CampaignsPage';

const CAMPAIGN = {
  id: 'c1',
  organizationId: 'o1',
  name: 'Engine Fund',
  description: null,
  campaignType: 'equipment',
  goalAmount: 50000,
  currentAmount: 1000,
  startDate: '2026-09-01',
  endDate: null,
  status: 'active',
  isPublic: false,
  isRestricted: false,
  restrictionPurpose: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

describe('CampaignsPage form', () => {
  beforeEach(() => {
    mockListCampaigns.mockReset();
    mockListCampaigns.mockResolvedValue([CAMPAIGN]);
    mockCreateCampaign.mockReset();
    mockCreateCampaign.mockResolvedValue({});
    mockUpdateCampaign.mockReset();
    mockUpdateCampaign.mockResolvedValue({});
    mockToastSuccess.mockReset();
  });

  const openNew = async () => {
    const user = userEvent.setup();
    renderWithRouter(<CampaignsPage />);
    await screen.findByText('Engine Fund');
    await user.click(screen.getByRole('button', { name: /New Campaign/ }));
    return user;
  };

  it('names every missing answer on its field and creates nothing', async () => {
    const user = await openNew();
    await user.click(screen.getByRole('button', { name: 'Create Campaign' }));

    expect(screen.getByLabelText(/^Name/)).toHaveAccessibleDescription('Enter a campaign name.');
    expect(screen.getByLabelText(/^Goal Amount/)).toHaveAccessibleDescription('Enter a goal greater than zero.');
    expect(screen.getByLabelText(/^Start Date/)).toHaveAccessibleDescription('Choose a start date.');
    expect(mockCreateCampaign).not.toHaveBeenCalled();
  });

  it('puts a refused goal on its field, announced', async () => {
    mockCreateCampaign.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { detail: [{ field: 'goal_amount', message: 'Input should be less than or equal to 9999999999.99' }] },
      },
    });
    const user = await openNew();
    await user.type(screen.getByLabelText(/^Name/), 'Ladder Fund');
    await user.type(screen.getByLabelText(/^Goal Amount/), '5000');
    await user.type(screen.getByLabelText(/^Start Date/), '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Create Campaign' }));

    await waitFor(() =>
      expect(screen.getByLabelText(/^Goal Amount/)).toHaveAccessibleDescription(
        'Input should be less than or equal to 9999999999.99'
      )
    );
  });

  it('saves the rest of an edit and keeps a refused field flagged', async () => {
    mockUpdateCampaign
      .mockRejectedValueOnce({
        response: { status: 422, data: { detail: [{ field: 'end_date', message: 'Invalid date format' }] } },
      })
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    renderWithRouter(<CampaignsPage />);
    await screen.findByText('Engine Fund');
    await user.click(screen.getByRole('button', { name: 'Edit Engine Fund' }));
    await user.type(screen.getByLabelText('Description'), 'New engine');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(mockUpdateCampaign).toHaveBeenCalledTimes(2));
    expect(mockUpdateCampaign.mock.calls[1]?.[1]).not.toHaveProperty('endDate');
    expect(mockUpdateCampaign.mock.calls[1]?.[1]).toMatchObject({ description: 'New engine' });
    expect(screen.getByRole('alert')).toHaveTextContent('Campaign saved, except end date.');
    expect(screen.getByLabelText('End Date')).toHaveAccessibleDescription('End date needs a valid date.');
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('asks before Cancel throws typed changes away', async () => {
    const user = await openNew();
    await user.type(screen.getByLabelText(/^Name/), 'Ladder Fund');
    const [, formCancel] = screen.getAllByRole('button', { name: /Cancel/ });
    await user.click(formCancel as HTMLElement);
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Ladder Fund');
  });
});
