import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

// Forms batch 22: the six extended sections share one ResourceSection, so the
// form pattern is checked through two of them and the readings form.

const getUtilityAccounts = vi.fn();
const createUtilityAccount = vi.fn();
const updateUtilityAccount = vi.fn();
const getUtilityReadings = vi.fn();
const createUtilityReading = vi.fn();
const getInsurancePolicies = vi.fn();
const createInsurancePolicy = vi.fn();
const updateInsurancePolicy = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getUtilityAccounts: (...args: unknown[]) => getUtilityAccounts(...args) as unknown,
    createUtilityAccount: (...args: unknown[]) => createUtilityAccount(...args) as unknown,
    updateUtilityAccount: (...args: unknown[]) => updateUtilityAccount(...args) as unknown,
    deleteUtilityAccount: vi.fn(),
    getUtilityReadings: (...args: unknown[]) => getUtilityReadings(...args) as unknown,
    createUtilityReading: (...args: unknown[]) => createUtilityReading(...args) as unknown,
    getInsurancePolicies: (...args: unknown[]) => getInsurancePolicies(...args) as unknown,
    createInsurancePolicy: (...args: unknown[]) => createInsurancePolicy(...args) as unknown,
    updateInsurancePolicy: (...args: unknown[]) => updateInsurancePolicy(...args) as unknown,
    deleteInsurancePolicy: vi.fn(),
  },
}));

const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) as unknown },
}));

import { InsuranceSection, UtilitiesSection } from './ExtendedFacilitySections';

const policy = {
  id: 'policy-1',
  facilityId: 'facility-1',
  policyType: 'property',
  policyNumber: 'P-100',
  carrierName: 'Acme Mutual',
  coverageAmount: 250000,
  expirationDate: '2027-01-01',
};

const unprocessable = (field: string, msg: string) =>
  Object.assign(new Error('Unprocessable'), {
    isAxiosError: true,
    response: { status: 422, data: { detail: [{ loc: ['body', field], msg }] } },
  });

const renderUtilities = () =>
  render(
    <ConfirmProvider>
      <UtilitiesSection facilityId="facility-1" canDelete={false} canCreate canEdit />
    </ConfirmProvider>
  );
const renderInsurance = () =>
  render(
    <ConfirmProvider>
      <InsuranceSection facilityId="facility-1" canDelete={false} canCreate canEdit />
    </ConfirmProvider>
  );

describe('extended facility section forms (batch 22)', () => {
  beforeEach(() => {
    for (const mock of [
      getUtilityAccounts,
      createUtilityAccount,
      updateUtilityAccount,
      getUtilityReadings,
      createUtilityReading,
      getInsurancePolicies,
      createInsurancePolicy,
      updateInsurancePolicy,
      toastError,
    ])
      mock.mockReset();
    getUtilityAccounts.mockResolvedValue([
      { id: 'utility-1', facilityId: 'facility-1', utilityType: 'electric', providerName: 'Municipal Power' },
    ]);
    createUtilityAccount.mockResolvedValue({});
    updateUtilityAccount.mockResolvedValue({});
    getUtilityReadings.mockResolvedValue([]);
    createUtilityReading.mockResolvedValue({});
    getInsurancePolicies.mockResolvedValue([policy]);
    createInsurancePolicy.mockResolvedValue({});
    updateInsurancePolicy.mockResolvedValue({});
  });

  it('names a missing required box on its field when adding, and adds nothing', async () => {
    const user = userEvent.setup();
    renderUtilities();
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const provider = screen.getByRole('textbox', { name: /^Provider/ });
    expect(provider).toHaveAccessibleDescription('Provider is required.');
    expect(screen.getByRole('combobox', { name: /^Utility type/ })).toHaveFocus();
    expect(createUtilityAccount).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('caps a box at the column limit', async () => {
    const user = userEvent.setup();
    renderUtilities();
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    expect(screen.getByRole('textbox', { name: /^Provider/ })).toHaveAttribute('maxlength', '200');
  });

  it('puts a refusal from the server on the box it names when adding', async () => {
    getInsurancePolicies.mockResolvedValue([]);
    createInsurancePolicy.mockRejectedValue(unprocessable('carrier_name', 'Carrier is not on file'));
    const user = userEvent.setup();
    renderInsurance();
    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.selectOptions(screen.getByRole('combobox', { name: /^Policy type/ }), 'property');
    await user.type(screen.getByRole('textbox', { name: /^Carrier/ }), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('textbox', { name: /^Carrier/ })).toHaveAccessibleDescription(
      'Carrier is not on file.'
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('names a negative amount on its field', async () => {
    const user = userEvent.setup();
    renderInsurance();
    await user.click(await screen.findByRole('button', { name: 'Edit insurance policy' }));
    const coverage = screen.getByRole('spinbutton', { name: 'Coverage amount' });
    await user.clear(coverage);
    await user.type(coverage, '-5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(coverage).toHaveAccessibleDescription('Enter 0 or more.');
    await waitFor(() => expect(updateInsurancePolicy).toHaveBeenCalled());
    const body: unknown = updateInsurancePolicy.mock.calls[0]?.[1];
    expect(body).not.toHaveProperty('coverage_amount');
  });

  it('saves the rest of an edit and keeps a refused box flagged', async () => {
    updateInsurancePolicy
      .mockRejectedValueOnce(unprocessable('carrier_name', 'Carrier is not on file'))
      .mockResolvedValue({});
    const user = userEvent.setup();
    renderInsurance();
    await user.click(await screen.findByRole('button', { name: 'Edit insurance policy' }));
    const number = screen.getByRole('textbox', { name: 'Policy number' });
    await user.clear(number);
    await user.type(number, 'P-200');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateInsurancePolicy).toHaveBeenCalledTimes(2));
    const resent: unknown = updateInsurancePolicy.mock.calls[1]?.[1];
    expect(resent).toMatchObject({ policy_number: 'P-200' });
    expect(resent).not.toHaveProperty('carrier_name');
    expect(
      await screen.findByText('Insurance policy saved, except carrier. Fix it and save again.')
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Carrier/ })).toHaveAccessibleDescription('Carrier is not on file.');
  });

  it('keeps a failure no box answers for in the form, not a toast', async () => {
    updateInsurancePolicy.mockRejectedValue(
      Object.assign(new Error('Conflict'), {
        isAxiosError: true,
        response: { status: 409, data: { detail: 'This policy was changed by someone else' } },
      })
    );
    const user = userEvent.setup();
    renderInsurance();
    await user.click(await screen.findByRole('button', { name: 'Edit insurance policy' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This policy was changed by someone else');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('asks before Cancel throws typed changes away', async () => {
    const user = userEvent.setup();
    renderInsurance();
    await user.click(await screen.findByRole('button', { name: 'Edit insurance policy' }));
    await user.type(screen.getByRole('textbox', { name: 'Policy number' }), 'X');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Keep editing' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('textbox', { name: 'Policy number' })).toHaveValue('P-100X');
  });

  it('names a missing reading date on its field and records nothing', async () => {
    const user = userEvent.setup();
    renderUtilities();
    await user.click(await screen.findByRole('button', { name: 'Add reading' }));
    await user.click(screen.getByRole('button', { name: 'Save reading' }));
    const date = screen.getByLabelText(/^Reading date/);
    expect(date).toHaveAccessibleDescription('Reading date is required.');
    expect(date).toHaveFocus();
    expect(createUtilityReading).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});
