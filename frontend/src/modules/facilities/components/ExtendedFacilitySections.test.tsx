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
        <UtilitiesSection facilityId="facility-1" canDelete={false} canCreate={false} canEdit={false} />
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
        <UtilitiesSection facilityId="facility-1" canDelete canCreate canEdit />
      </ConfirmProvider>
    );

    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
  });

  it('gives facilities.delete holders only the destructive control', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canDelete canCreate={false} canEdit={false} />
      </ConfirmProvider>
    );

    expect(await screen.findByRole('button', { name: /Delete/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
  });

  it('gives facilities.edit holders create/update controls but no delete (matches backend gates)', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canDelete={false} canCreate canEdit />
      </ConfirmProvider>
    );

    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
  });

  it('gives facilities.create holders add controls without edit or delete controls', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canDelete={false} canCreate canEdit={false} />
      </ConfirmProvider>
    );

    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
  });

  it('fetches once per facility instead of refetching after every completed request', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canDelete={false} canCreate={false} canEdit={false} />
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

  it('renders loaded readings with date, usage and cost, newest first', async () => {
    getUtilityReadings.mockResolvedValue([
      {
        id: 'reading-june',
        utilityAccountId: 'utility-1',
        readingDate: '2026-06-01',
        amount: 120.5,
        usageQuantity: 900,
        usageUnit: 'kWh',
        createdAt: '2026-06-02T00:00:00Z',
      },
      {
        id: 'reading-july',
        utilityAccountId: 'utility-1',
        readingDate: '2026-07-01',
        amount: 132,
        usageQuantity: 1050,
        usageUnit: 'kWh',
        createdAt: '2026-07-02T00:00:00Z',
      },
    ]);

    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canDelete={false} canCreate={false} canEdit={false} />
      </ConfirmProvider>
    );

    expect(await screen.findByText('2 recent readings')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Jul 1, 2026');
    expect(rows[0]).toHaveTextContent('1,050 kWh');
    expect(rows[0]).toHaveTextContent('$132.00');
    expect(rows[1]).toHaveTextContent('Jun 1, 2026');
    expect(rows[1]).toHaveTextContent('900 kWh');
    expect(rows[1]).toHaveTextContent('$120.50');
  });

  it('ignores a second click while a reading save is in flight', async () => {
    let resolveCreate: (value: unknown) => void = () => {};
    createUtilityReading.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        })
    );

    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canDelete={false} canCreate canEdit />
      </ConfirmProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add reading' }));
    fireEvent.change(screen.getByLabelText('Reading date'), { target: { value: '2026-08-01' } });
    const saveButton = screen.getByRole('button', { name: 'Save reading' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(saveButton).toBeDisabled();
    expect(createUtilityReading).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreate({});
    });
    expect(createUtilityReading).toHaveBeenCalledTimes(1);
  });

  it('sends the account id in the reading payload (backend schema requires it)', async () => {
    render(
      <ConfirmProvider>
        <UtilitiesSection facilityId="facility-1" canDelete={false} canCreate canEdit />
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
        <CapitalProjectsSection facilityId="facility-1" canDelete={false} canCreate canEdit />
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
        <InsuranceSection facilityId="facility-1" canDelete={false} canCreate canEdit />
      </ConfirmProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(screen.getByRole('option', { name: 'Equipment' })).toBeInTheDocument();
  });
});
