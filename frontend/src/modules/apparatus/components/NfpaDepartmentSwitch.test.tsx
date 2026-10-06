import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUpdateSettings = vi.fn();

vi.mock('../../../services/api', () => ({
  organizationService: {
    updateSettings: (...args: unknown[]) => mockUpdateSettings(...args) as unknown,
  },
}));

import { NfpaDepartmentSwitch } from './NfpaDepartmentSwitch';

describe('NfpaDepartmentSwitch', () => {
  beforeEach(() => {
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockResolvedValue({});
  });

  it('says when the organization-type default is in force', () => {
    render(
      <NfpaDepartmentSwitch
        settings={{ enabled: false, defaultForOrganizationType: false, explicitChoice: null }}
        onChanged={() => Promise.resolve()}
      />
    );
    expect(screen.getByText(/default for your organization type \(off\)/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'NFPA Compliance' })).not.toBeChecked();
  });

  it('stores the opposite of the current state and reloads', async () => {
    const onChanged = vi.fn(() => Promise.resolve());
    render(
      <NfpaDepartmentSwitch
        settings={{ enabled: true, defaultForOrganizationType: true, explicitChoice: null }}
        onChanged={onChanged}
      />
    );

    await userEvent.click(screen.getByRole('switch', { name: 'NFPA Compliance' }));

    expect(mockUpdateSettings).toHaveBeenCalledWith({ apparatus: { nfpa_compliance_enabled: false } });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('leaves the state alone when the save fails', async () => {
    mockUpdateSettings.mockRejectedValue(new Error('nope'));
    const onChanged = vi.fn(() => Promise.resolve());
    render(
      <NfpaDepartmentSwitch
        settings={{ enabled: true, defaultForOrganizationType: true, explicitChoice: true }}
        onChanged={onChanged}
      />
    );

    await userEvent.click(screen.getByRole('switch', { name: 'NFPA Compliance' }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText('Set by an administrator.', { exact: false })).toBeInTheDocument();
  });
});
