import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSettings = vi.fn();
const mockUpdateFormsSettings = vi.fn();
vi.mock('../../services/api', () => ({
  organizationService: {
    getSettings: (...a: unknown[]) => mockGetSettings(...a) as unknown,
    updateFormsSettings: (...a: unknown[]) => mockUpdateFormsSettings(...a) as unknown,
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

import FormsEmbedSection from './FormsEmbedSection';

describe('FormsEmbedSection', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetSettings.mockResolvedValue({
      contact_info_visibility: {},
      forms: { embed_allowed_origins: ['https://www.oakvillefire.org'] },
    });
    mockUpdateFormsSettings.mockReset();
    mockUpdateFormsSettings.mockImplementation((s: { embed_allowed_origins: string[] }) => Promise.resolve(s));
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
  });

  const field = () => screen.getByLabelText(/websites allowed to embed forms/i);

  it('shows the saved websites, one per line', async () => {
    render(<FormsEmbedSection />);
    await waitFor(() => expect(field()).toHaveValue('https://www.oakvillefire.org'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves the list normalised and without repeats', async () => {
    const user = userEvent.setup();
    render(<FormsEmbedSection />);
    await waitFor(() => expect(field()).toHaveValue('https://www.oakvillefire.org'));

    await user.type(field(), '{enter}HTTPS://Join.OakvilleFire.org/{enter}https://www.oakvillefire.org');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateFormsSettings).toHaveBeenCalledWith({
        embed_allowed_origins: ['https://www.oakvillefire.org', 'https://join.oakvillefire.org'],
      })
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Forms settings saved');
  });

  it('names a line that is not an exact https origin and will not save it', async () => {
    const user = userEvent.setup();
    render(<FormsEmbedSection />);
    await waitFor(() => expect(field()).toHaveValue('https://www.oakvillefire.org'));

    await user.type(field(), '{enter}https://www.oakvillefire.org/apply');

    expect(screen.getByText(/not a website address/i)).toHaveTextContent('https://www.oakvillefire.org/apply');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('can clear the list to allow no site', async () => {
    const user = userEvent.setup();
    render(<FormsEmbedSection />);
    await waitFor(() => expect(field()).toHaveValue('https://www.oakvillefire.org'));

    await user.clear(field());
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdateFormsSettings).toHaveBeenCalledWith({ embed_allowed_origins: [] }));
  });

  it('offers a retry when the settings do not load', async () => {
    mockGetSettings.mockRejectedValue(new Error('down'));
    render(<FormsEmbedSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('did not load');
  });
});
