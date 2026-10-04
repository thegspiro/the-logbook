/**
 * W50-50 — the Security section reports what GET /elections/settings says in
 * `security`, and says plainly when the vote signing key is not configured,
 * instead of printing "HMAC-SHA256" as a guarantee from static markup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const mockGetSettings = vi.fn();
const mockGetElections = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getSettings: (...a: unknown[]) => mockGetSettings(...a) as unknown,
    getElections: (...a: unknown[]) => mockGetElections(...a) as unknown,
    updateSettings: (...a: unknown[]) => mockUpdateSettings(...a) as unknown,
    sendTestBallot: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ElectionsSettingsPage } from './ElectionsSettingsPage';

const renderSecurity = () => {
  window.history.pushState({}, '', '/elections/settings?tab=security');
  renderWithRouter(<ElectionsSettingsPage />);
};

describe('ElectionsSettingsPage — Security section reads settings.security (W50-50)', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetElections.mockReset();
    mockUpdateSettings.mockReset();
    mockGetElections.mockResolvedValue([]);
    mockUpdateSettings.mockImplementation((data: unknown) => Promise.resolve(data));
  });

  it('says the signing key is not configured when the API reports it false', async () => {
    mockGetSettings.mockResolvedValue({
      proxy_voting_enabled: false,
      security: {
        vote_signing_key_configured: false,
        anonymity_salt_auto_destroy: true,
        vote_chain_hashing: true,
      },
    });
    renderSecurity();

    expect(await screen.findByTestId('security-vote-signatures')).toHaveTextContent(
      'HMAC-SHA256, signing key not configured'
    );
    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent('VOTE_SIGNING_KEY is not set on this server');
    expect(warning).toHaveTextContent('fall back to SECRET_KEY');
    expect(screen.queryByText('HMAC-SHA256, dedicated signing key')).not.toBeInTheDocument();
    // The rows the server did vouch for still read as in force.
    expect(screen.getByTestId('security-salt-rotation')).toHaveTextContent('Auto-destroyed on close');
    expect(screen.getByTestId('security-chain-hashing')).toHaveTextContent('Enabled');
  });

  it('reports a dedicated signing key with no warning when the API reports it true', async () => {
    mockGetSettings.mockResolvedValue({
      proxy_voting_enabled: false,
      security: {
        vote_signing_key_configured: true,
        anonymity_salt_auto_destroy: true,
        vote_chain_hashing: true,
      },
    });
    renderSecurity();

    expect(await screen.findByTestId('security-vote-signatures')).toHaveTextContent(
      'HMAC-SHA256, dedicated signing key'
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/VOTE_SIGNING_KEY is not set/)).not.toBeInTheDocument();
  });

  it('prints Off for a measure the server reports as disabled', async () => {
    mockGetSettings.mockResolvedValue({
      proxy_voting_enabled: false,
      security: {
        vote_signing_key_configured: true,
        anonymity_salt_auto_destroy: false,
        vote_chain_hashing: false,
      },
    });
    renderSecurity();

    expect(await screen.findByTestId('security-salt-rotation')).toHaveTextContent('Off');
    expect(screen.getByTestId('security-chain-hashing')).toHaveTextContent('Off');
  });

  it('does not claim any guarantee when the API returns no security object', async () => {
    mockGetSettings.mockResolvedValue({ proxy_voting_enabled: false });
    renderSecurity();

    expect(await screen.findByTestId('security-vote-signatures')).toHaveTextContent('Not reported');
    expect(screen.getByTestId('security-salt-rotation')).toHaveTextContent('Not reported');
    expect(screen.getByTestId('security-chain-hashing')).toHaveTextContent('Not reported');
    expect(screen.queryByText(/HMAC-SHA256/)).not.toBeInTheDocument();
  });
});
