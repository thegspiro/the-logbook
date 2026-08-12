import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

const getUtilityAccounts = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getUtilityAccounts: (...args: unknown[]) => getUtilityAccounts(...args) as unknown,
    createUtilityAccount: vi.fn(),
    deleteUtilityAccount: vi.fn(),
  },
}));

import { UtilitiesSection } from './ExtendedFacilitySections';

describe('extended facility sections', () => {
  beforeEach(() => {
    getUtilityAccounts.mockResolvedValue([
      {
        id: 'utility-1',
        facilityId: 'facility-1',
        utilityType: 'electric',
        providerName: 'Municipal Power',
        accountNumber: 'ACCT-100',
      },
    ]);
  });

  it('loads facility-scoped utility records for viewers without mutation controls', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canManage={false} />
      </ConfirmProvider>
    );

    expect(await screen.findByText('Municipal Power · Account ACCT-100')).toBeInTheDocument();
    expect(getUtilityAccounts).toHaveBeenCalledWith({ facility_id: 'facility-1' });
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
  });

  it('shows add controls to managers', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canManage />
      </ConfirmProvider>
    );

    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});
