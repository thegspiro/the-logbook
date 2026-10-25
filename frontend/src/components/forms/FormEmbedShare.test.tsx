import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { FormDef } from '../../services/api';

const mockGetSettings = vi.fn();
vi.mock('../../services/api', () => ({
  organizationService: {
    getSettings: (...a: unknown[]) => mockGetSettings(...a) as unknown,
  },
}));

import { FormEmbedShare } from './FormEmbedShare';

const baseForm: FormDef = {
  id: 'form-1',
  organization_id: 'org-1',
  name: 'Volunteer Interest',
  category: 'administration',
  status: 'published',
  allow_multiple_submissions: true,
  require_authentication: false,
  notify_on_submission: false,
  is_public: true,
  allow_embed: true,
  public_slug: 'abc123def456',
  version: 1,
  is_template: false,
  created_at: '2026-10-25T00:00:00Z',
  updated_at: '2026-10-25T00:00:00Z',
};

describe('FormEmbedShare', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetSettings.mockResolvedValue({
      contact_info_visibility: {},
      forms: { embed_allowed_origins: ['https://www.oakvillefire.org'] },
    });
  });

  it('turns embedding on and off through the form', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderWithRouter(<FormEmbedShare form={{ ...baseForm, allow_embed: false }} onToggleEmbed={onToggle} />);

    const toggle = screen.getByLabelText(/allow embedding on your website/i);
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'form-1', allow_embed: false }));
    expect(screen.queryByLabelText(/embed code/i)).not.toBeInTheDocument();
  });

  it('gives the embed code and the sites it works on', async () => {
    renderWithRouter(<FormEmbedShare form={baseForm} onToggleEmbed={vi.fn()} />);

    const code = await screen.findByLabelText(/embed code/i);
    expect((code as HTMLTextAreaElement).value).toContain(`${window.location.origin}/embed/f/abc123def456`);
    expect(screen.getByText('Works on: https://www.oakvillefire.org')).toBeInTheDocument();
  });

  it('says the department has listed no website instead of giving code that shows nothing', async () => {
    mockGetSettings.mockResolvedValue({ contact_info_visibility: {}, forms: { embed_allowed_origins: [] } });
    renderWithRouter(<FormEmbedShare form={baseForm} onToggleEmbed={vi.fn()} />);

    expect(await screen.findByRole('note')).toHaveTextContent('has not listed its website');
    expect(screen.getByRole('link', { name: /organization settings/i })).toHaveAttribute('href', '/settings?tab=forms');
    expect(screen.queryByLabelText(/embed code/i)).not.toBeInTheDocument();
  });

  it('warns that a sign-in form cannot be submitted inside the website', async () => {
    renderWithRouter(<FormEmbedShare form={{ ...baseForm, require_authentication: true }} onToggleEmbed={vi.fn()} />);

    expect(await screen.findByText(/must sign in to submit this form/i)).toBeInTheDocument();
  });
});
