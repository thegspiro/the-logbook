import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import { organizationService } from '../services/api';

vi.mock('../services/api', () => ({
  organizationService: {
    getSettings: vi.fn(),
    getEnabledModules: vi.fn(),
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    testEmailSettings: vi.fn(),
  },
}));

import { SettingsPage } from './SettingsPage';

const profile = {
  name: 'Review Valley Fire Department',
  timezone: 'America/Chicago',
  phone: '',
  email: '',
  website: '',
  county: '',
  founded_year: null,
  logo: null as string | null,
  mailing_address: { line1: '', line2: '', city: '', state: '', zip: '' },
  physical_address_same: true,
  physical_address: { line1: '', line2: '', city: '', state: '', zip: '' },
};

function startAt(url: string): void {
  window.history.pushState({}, '', url);
}

describe('SettingsPage — department profile (workflow review W06)', () => {
  beforeEach(() => {
    vi.mocked(organizationService.getSettings).mockReset();
    vi.mocked(organizationService.getSettings).mockResolvedValue({} as never);
    vi.mocked(organizationService.getEnabledModules).mockReset();
    vi.mocked(organizationService.getEnabledModules).mockResolvedValue({ module_settings: {} } as never);
    vi.mocked(organizationService.getProfile).mockReset();
    vi.mocked(organizationService.getProfile).mockResolvedValue(structuredClone(profile));
    vi.mocked(organizationService.updateProfile).mockReset();
    vi.mocked(organizationService.updateProfile).mockImplementation((next: unknown) => Promise.resolve(next as never));
  });

  // Saving a blank name got "name: Value is too short" from the server, and
  // because the profile is saved whole, every other field failed with it.
  it('keeps a blank name as an unsaved draft and still saves the other fields', async () => {
    const user = userEvent.setup();
    startAt('/settings');
    renderWithRouter(<SettingsPage />);

    const name = await screen.findByLabelText('Department Name');
    await user.clear(name);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The department needs a name. It is still saved as “Review Valley Fire Department”.'
    );
    expect(name).toHaveAttribute('aria-invalid', 'true');

    await user.selectOptions(screen.getByLabelText('Timezone'), 'America/Denver');

    await waitFor(() => expect(organizationService.updateProfile).toHaveBeenCalled());
    for (const [sent] of vi.mocked(organizationService.updateProfile).mock.calls) {
      expect(sent).toMatchObject({ name: 'Review Valley Fire Department', timezone: 'America/Denver' });
    }
  });

  it('names every contact and address field', async () => {
    startAt('/settings?page=contact');
    const { unmount } = renderWithRouter(<SettingsPage />);
    for (const label of ['Phone', 'Email', 'Website', 'County']) {
      expect(await screen.findByLabelText(label)).toBeInTheDocument();
    }
    unmount();

    startAt('/settings?page=addresses');
    renderWithRouter(<SettingsPage />);
    for (const part of ['line 1', 'line 2', 'city', 'state', 'ZIP']) {
      expect(await screen.findByLabelText(`Mailing address ${part}`)).toBeInTheDocument();
    }
  });

  it('removes an uploaded logo', async () => {
    const user = userEvent.setup();
    vi.mocked(organizationService.getProfile).mockResolvedValue({
      ...structuredClone(profile),
      logo: 'data:image/png;base64,AAAA',
    });
    startAt('/settings');
    renderWithRouter(<SettingsPage />);

    await user.click(await screen.findByRole('button', { name: 'Remove logo' }));

    await waitFor(() =>
      expect(organizationService.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ logo: null }))
    );
    expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument();
  });
});
