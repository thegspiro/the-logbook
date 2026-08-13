import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

const getUtilityAccounts = vi.fn();
const getUtilityReadings = vi.fn();
const createUtilityReading = vi.fn();
const getCapitalProjects = vi.fn();
const updateCapitalProject = vi.fn();
const getInsurancePolicies = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getUtilityAccounts: (...args: unknown[]) => getUtilityAccounts(...args) as unknown,
    getUtilityReadings: (...args: unknown[]) => getUtilityReadings(...args) as unknown,
    createUtilityReading: (...args: unknown[]) => createUtilityReading(...args) as unknown,
    createUtilityAccount: vi.fn(),
    deleteUtilityAccount: vi.fn(),
    getCapitalProjects: (...args: unknown[]) => getCapitalProjects(...args) as unknown,
    updateCapitalProject: (...args: unknown[]) => updateCapitalProject(...args) as unknown,
    getInsurancePolicies: (...args: unknown[]) => getInsurancePolicies(...args) as unknown,
  },
}));

import { CapitalProjectsSection, InsuranceSection, UtilitiesSection } from './ExtendedFacilitySections';

describe('extended facility sections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUtilityAccounts.mockResolvedValue([
      {
        id: 'utility-1',
        facilityId: 'facility-1',
        utilityType: 'electric',
        providerName: 'Municipal Power',
        accountNumber: 'ACCT-100',
      },
    ]);
    getUtilityReadings.mockResolvedValue([]);
    createUtilityReading.mockResolvedValue({});
    getCapitalProjects.mockResolvedValue([]);
    updateCapitalProject.mockResolvedValue({});
    getInsurancePolicies.mockResolvedValue([]);
  });

  it('loads facility-scoped utility records for viewers without mutation controls', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canManage={false} canEdit={false} />
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
        <UtilitiesSection facilityId="facility-1" canManage canEdit />
      </ConfirmProvider>
    );

    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
  });

  it('gives facilities.edit holders create/update controls but no delete (matches backend gates)', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canManage={false} canEdit />
      </ConfirmProvider>
    );

    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
  });

  it('fetches once per facility instead of refetching after every completed request', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canManage={false} canEdit={false} />
      </ConfirmProvider>
    );

    await screen.findByText('Municipal Power · Account ACCT-100');
    // Flush any follow-up effects the resolved fetch could have queued — the
    // regression re-created the loader every render, refetching forever.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getUtilityAccounts).toHaveBeenCalledTimes(1);
  });

  it('sends the account id in the reading payload (backend schema requires it)', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canManage={false} canEdit />
      </ConfirmProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add reading' }));
    fireEvent.change(screen.getByLabelText('Reading date'), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reading' }));

    await waitFor(() =>
      expect(createUtilityReading).toHaveBeenCalledWith('utility-1', {
        utility_account_id: 'utility-1',
        reading_date: '2026-08-01',
      })
    );
  });

  it('sends explicit nulls for cleared capital-project fields so the clear persists', async () => {
    getCapitalProjects.mockResolvedValue([
      {
        id: 'project-1',
        facilityId: 'facility-1',
        projectName: 'Roof Replacement',
        projectType: 'repair',
        projectStatus: 'planning',
        estimatedCost: 5000,
        startDate: '2026-01-01',
      },
    ]);

    render(
      <ConfirmProvider>
        <CapitalProjectsSection facilityId="facility-1" canManage={false} canEdit />
      </ConfirmProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit capital project' }));
    fireEvent.change(screen.getByDisplayValue('5000'), { target: { value: '' } });
    fireEvent.change(screen.getByDisplayValue('2026-01-01'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateCapitalProject).toHaveBeenCalledWith('project-1', {
        project_name: 'Roof Replacement',
        project_type: 'repair',
        project_status: 'planning',
        estimated_cost: null,
        start_date: null,
      })
    );
  });

  it('offers the equipment policy type the backend enum supports', async () => {
    render(
      <ConfirmProvider>
        <InsuranceSection facilityId="facility-1" canManage={false} canEdit />
      </ConfirmProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(screen.getByRole('option', { name: 'Equipment' })).toBeInTheDocument();
  });
});
