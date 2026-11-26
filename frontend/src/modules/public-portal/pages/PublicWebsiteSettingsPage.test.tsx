import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import { createMockApiError } from '../../../test/utils';
import type { PublicSiteSettings } from '../types/publicSite';

const mockGet = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../services/publicSiteApi', () => ({
  getPublicSiteSettings: (...args: unknown[]) => mockGet(...args) as unknown,
  updatePublicSiteSettings: (...args: unknown[]) => mockUpdate(...args) as unknown,
}));

import PublicWebsiteSettingsPage from './PublicWebsiteSettingsPage';

const saved: PublicSiteSettings = {
  enabled: false,
  theme: 'classic',
  tagline: 'Since 1947',
  welcome_text: null,
  about_text: 'Our story.',
  emergency_notice: null,
  show_about: true,
  show_contact: false,
  show_phone: false,
  show_email: false,
  show_address: false,
  show_member_login: false,
  themes: [
    { value: 'classic', label: 'Classic', description: 'White pages under a deep red header.' },
    { value: 'modern', label: 'Modern', description: 'Cool greys under a navy header.' },
    { value: 'heritage', label: 'Heritage', description: 'Cream pages and serif headings.' },
  ],
  contact_on_record: { phone: '(540) 555-0142', email: null, address_lines: ['214 Station Road', 'Cedar Hollow, VA'] },
  servable: true,
};

const everyFieldOf = (settings: PublicSiteSettings) => ({
  enabled: settings.enabled,
  show_about: settings.show_about,
  show_contact: settings.show_contact,
  show_phone: settings.show_phone,
  show_email: settings.show_email,
  show_address: settings.show_address,
  show_member_login: settings.show_member_login,
  theme: settings.theme,
  tagline: settings.tagline,
  welcome_text: settings.welcome_text,
  about_text: settings.about_text,
  emergency_notice: settings.emergency_notice,
});

const renderPage = async () => {
  renderWithRouter(<PublicWebsiteSettingsPage />);
  await screen.findByRole('button', { name: 'Save changes' });
};

describe('PublicWebsiteSettingsPage', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue(structuredClone(saved));
    mockUpdate.mockReset();
    mockUpdate.mockImplementation((values: Record<string, unknown>) =>
      Promise.resolve({ ...structuredClone(saved), ...values })
    );
  });

  it('shows what is saved and nothing to save until something changes', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { name: 'The website is set to not published' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Tagline/)).toHaveValue('Since 1947');
    expect(screen.getByRole('radio', { name: /Classic/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Show the About page' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('shows each contact detail the record holds, and says when it holds none', async () => {
    await renderPage();

    const phone = screen.getByRole('checkbox', { name: /Phone number/ });
    expect(phone).not.toBeChecked();
    expect(screen.getByText('(540) 555-0142')).toBeInTheDocument();
    expect(screen.getByText('214 Station Road, Cedar Hollow, VA')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Email address/ })).toHaveAccessibleName(
      /Nothing on record, so nothing is shown/
    );
  });

  it('sends every field on a save, with an emptied box as null', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.clear(screen.getByLabelText(/^Tagline/));
    await user.click(screen.getByRole('radio', { name: /Heritage/ }));
    await user.click(screen.getByRole('checkbox', { name: /Phone number/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({
      ...everyFieldOf(saved),
      tagline: null,
      theme: 'heritage',
      show_phone: true,
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled());
  });

  it('asks before publishing, and publishes nothing when the answer is not yet', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('switch', { name: 'Publish the website' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Publish the website?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Not yet' }));

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('publishes once the question is answered', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('switch', { name: 'Publish the website' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ ...everyFieldOf(saved), enabled: true }));
    expect(await screen.findByRole('heading', { name: 'The website is set to published' })).toBeInTheDocument();
  });

  it('asks before taking a published website down', async () => {
    mockGet.mockResolvedValue({ ...structuredClone(saved), enabled: true });
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole('switch', { name: 'Publish the website' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Take the website down?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Keep it published' }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('keeps what was typed and says why when a save is refused', async () => {
    mockUpdate.mockRejectedValue(createMockApiError('The server is unavailable', 503));
    const user = userEvent.setup();
    await renderPage();

    await user.type(screen.getByLabelText(/^Welcome text/), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('The server is unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Welcome text/)).toHaveValue('Hello');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('warns that nothing is served where there is more than one department', async () => {
    mockGet.mockResolvedValue({ ...structuredClone(saved), servable: false });
    await renderPage();

    expect(screen.getByText(/holds more than one department/)).toBeInTheDocument();
  });

  it('says so when the settings cannot be loaded', async () => {
    mockGet.mockRejectedValue(createMockApiError('No access', 403));
    renderWithRouter(<PublicWebsiteSettingsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('No access');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });
});
