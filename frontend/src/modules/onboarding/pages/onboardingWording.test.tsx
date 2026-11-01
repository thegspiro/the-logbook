/**
 * Wording that described something other than what the step does. Each was
 * found driving a fresh install as an IT manager (workflow review W01,
 * 2026-10-31) and checked against the code behind it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../services/api-client', () => ({
  apiClient: {
    getStatus: vi.fn(() => Promise.resolve({ data: null })),
    createSystemOwner: vi.fn(),
    saveITTeam: vi.fn(),
    saveAuthPlatform: vi.fn(),
    saveEmailPlatform: vi.fn(),
  },
}));
vi.mock('../../../hooks/useRanks', () => ({
  useRanks: () => ({
    ranks: [],
    rankOptions: [],
    loading: false,
    failed: false,
    refetch: vi.fn(),
    formatRank: (r: string) => r,
  }),
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import ITTeamBackupAccess from './ITTeamBackupAccess';
import AdminUserCreation from './AdminUserCreation';
import AuthenticationChoice from './AuthenticationChoice';
import EmailPlatformChoice from './EmailPlatformChoice';
import { useOnboardingStore } from '../store';
import { ThemeProvider } from '../../../contexts/ThemeContext';

const renderPage = (ui: React.ReactElement) =>
  render(
    <ThemeProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </ThemeProvider>
  );

beforeEach(() => {
  useOnboardingStore.setState({ departmentName: 'Falls Church VFD', emailPlatform: 'selfhosted' });
});

describe('IT & Backup Contacts', () => {
  // The step said contacts "get an account when setup finishes". The account
  // gets a random password nobody is told and only the Member position.
  it('says how a new contact signs in, and that the account carries no admin access', () => {
    renderPage(<ITTeamBackupAccess />);

    expect(screen.getByText(/no\s+password is sent/i)).toBeInTheDocument();
    expect(screen.getByText(/Forgot your password\?/)).toBeInTheDocument();
    expect(screen.getByText(/if they need administrative access/i)).toBeInTheDocument();
  });
});

describe('Administrator Account', () => {
  // Left blank, the owner's number was assigned from the sequence set one step
  // earlier (RVF-0100 on the drive), and nothing said so.
  it('says what a blank membership number means', () => {
    renderPage(<AdminUserCreation />);

    expect(screen.getByLabelText(/Membership Number/)).toHaveAccessibleDescription(
      /first number in your department's sequence/i
    );
  });
});

describe('Sign-In Method', () => {
  it('tells Google and Microsoft where the credentials go and that passwords work until then', () => {
    renderPage(<AuthenticationChoice />);

    expect(screen.getByText(/GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in this server's \.env/)).toBeInTheDocument();
    expect(
      screen.getByText(/AZURE_AD_CLIENT_ID and AZURE_AD_CLIENT_SECRET in this server's \.env/)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Until then members sign in with passwords/)).toHaveLength(3);
    expect(screen.queryByText(/No password management needed/)).not.toBeInTheDocument();
  });
});

describe('Email Platform', () => {
  // These are separate integrations under the Integrations module, available
  // or not whatever sends the email; a quoted vendor price goes stale.
  it('claims only what the email choice itself provides', () => {
    renderPage(<EmailPlatformChoice />);

    expect(screen.queryByText('Calendar sync available')).not.toBeInTheDocument();
    expect(screen.queryByText('Teams integration')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    expect(screen.getByText(/Entra ID app registration \(recommended\) or an App Password/)).toBeInTheDocument();
  });
});
