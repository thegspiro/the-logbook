import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) as unknown },
}));

import LegalPage from './LegalPage';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <LegalPage />
    </MemoryRouter>
  );

describe('LegalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      data: {
        organizationName: 'Falls Church VFD',
        privacyPolicy: null,
        termsOfService: null,
      },
    });
  });

  it('renders the default privacy policy at /privacy', async () => {
    renderAt('/privacy');
    expect(
      await screen.findByRole('heading', { name: 'Privacy Policy' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Information we collect/)).toBeInTheDocument();
    const orgMentions = await screen.findAllByText(/Falls Church VFD/);
    expect(orgMentions.length).toBeGreaterThan(0);
  });

  it('renders the default terms at /terms', async () => {
    renderAt('/terms');
    expect(
      await screen.findByRole('heading', { name: 'Terms of Service' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Acceptable use/)).toBeInTheDocument();
  });

  it('renders org-configured text instead of defaults when provided', async () => {
    mockGet.mockResolvedValue({
      data: {
        organizationName: 'Falls Church VFD',
        privacyPolicy: 'Our very own policy.\n\nSecond paragraph.',
        termsOfService: null,
      },
    });
    renderAt('/privacy');
    expect(await screen.findByText('Our very own policy.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
    expect(screen.queryByText(/Information we collect/)).not.toBeInTheDocument();
  });

  it('falls back to defaults when the endpoint fails', async () => {
    mockGet.mockRejectedValue(new Error('network'));
    renderAt('/privacy');
    expect(
      await screen.findByRole('heading', { name: 'Privacy Policy' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Information we collect/)).toBeInTheDocument();
  });

  it('links between privacy and terms', async () => {
    renderAt('/privacy');
    expect(
      screen.getByRole('link', { name: 'Terms of Service' })
    ).toHaveAttribute('href', '/terms');
    expect(await screen.findByRole('link', { name: /Back to sign in/ })).toHaveAttribute(
      'href',
      '/login'
    );
  });
});
