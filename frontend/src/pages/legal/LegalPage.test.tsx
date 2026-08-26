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
        privacyPolicyLastUpdated: null,
        termsOfServiceLastUpdated: null,
      },
    });
  });

  it('renders the default privacy policy at /privacy', async () => {
    renderAt('/privacy');
    expect(await screen.findByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText(/Information we collect/)).toBeInTheDocument();
    const orgMentions = await screen.findAllByText(/Falls Church VFD/);
    expect(orgMentions.length).toBeGreaterThan(0);
  });

  it('renders the default terms at /terms', async () => {
    renderAt('/terms');
    expect(await screen.findByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.getByText(/Acceptable use/)).toBeInTheDocument();
  });

  it('states on /privacy that the department controls the system and access', async () => {
    renderAt('/privacy');
    expect(
      await screen.findByRole('heading', { name: 'Who controls this system and your access' })
    ).toBeInTheDocument();
    expect(screen.getAllByText(/holds full control of this application/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Access is based on your status within the department/).length).toBeGreaterThan(0);
  });

  it('states on /terms that the department controls the system and access', async () => {
    renderAt('/terms');
    expect(await screen.findByRole('heading', { name: 'Who this system belongs to' })).toBeInTheDocument();
    expect(screen.getAllByText(/holds full control of this application/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Access is based on your status within the department/).length).toBeGreaterThan(0);
  });

  it('shows the built-in revision date when defaults are rendered', async () => {
    renderAt('/privacy');
    expect(await screen.findByText(/^Last updated:/)).toBeInTheDocument();
  });

  it('renders org-configured text instead of defaults when provided', async () => {
    mockGet.mockResolvedValue({
      data: {
        organizationName: 'Falls Church VFD',
        privacyPolicy: 'Our very own policy.\n\nSecond paragraph.',
        termsOfService: null,
        privacyPolicyLastUpdated: 'March 3, 2026',
        termsOfServiceLastUpdated: null,
      },
    });
    renderAt('/privacy');
    expect(await screen.findByText('Our very own policy.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Last updated: March 3, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/Information we collect/)).not.toBeInTheDocument();
  });

  it('omits the revision date on custom text that carries none', async () => {
    mockGet.mockResolvedValue({
      data: {
        organizationName: 'Falls Church VFD',
        privacyPolicy: 'Our very own policy.',
        termsOfService: null,
        privacyPolicyLastUpdated: null,
        termsOfServiceLastUpdated: null,
      },
    });
    renderAt('/privacy');
    expect(await screen.findByText('Our very own policy.')).toBeInTheDocument();
    // The built-in date describes the built-in text; showing it above a
    // department's own wording would misdate that wording.
    expect(screen.queryByText(/^Last updated:/)).not.toBeInTheDocument();
  });

  it('does not misdate terms with the privacy policy date', async () => {
    // Regression for DOC-10 finding #3: the two documents' dates were once
    // one shared settings key, so publishing privacy alone could leak its
    // date onto the terms page.
    mockGet.mockResolvedValue({
      data: {
        organizationName: 'Falls Church VFD',
        privacyPolicy: null,
        termsOfService: 'Our own terms.',
        privacyPolicyLastUpdated: 'March 3, 2026',
        termsOfServiceLastUpdated: null,
      },
    });
    renderAt('/terms');
    expect(await screen.findByText('Our own terms.')).toBeInTheDocument();
    expect(screen.queryByText(/^Last updated:/)).not.toBeInTheDocument();
  });

  it('falls back to defaults when the endpoint fails', async () => {
    mockGet.mockRejectedValue(new Error('network'));
    renderAt('/privacy');
    expect(await screen.findByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText(/Information we collect/)).toBeInTheDocument();
  });

  it('links between privacy and terms', async () => {
    renderAt('/privacy');
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    expect(await screen.findByRole('link', { name: /Back to sign in/ })).toHaveAttribute('href', '/login');
  });
});
