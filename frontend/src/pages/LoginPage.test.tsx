import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Mock navigation so we can assert redirects
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Auth store stub — unauthenticated, no lockout. `mockMfaRequired` switches the
// page to its second-factor step.
let mockMfaRequired = false;
let mockMfaToken: string | null = null;
const mockCompleteMfaLogin = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    login: vi.fn(),
    completeMfaLogin: (...a: unknown[]) => mockCompleteMfaLogin(...a) as unknown,
    cancelMfa: vi.fn(),
    mfaRequired: mockMfaRequired,
    mfaToken: mockMfaToken,
    isLoading: false,
    isAuthenticated: false,
    error: null,
    clearError: vi.fn(),
    lockedUntil: null,
  }),
}));

// authService stub (OAuth URL helpers, and the second-factor options)
const mockMfaChallenge = vi.fn();
vi.mock('../services/api', () => ({
  authService: {
    mfaChallenge: (...a: unknown[]) => mockMfaChallenge(...a) as unknown,
    getGoogleOAuthUrl: () => '/api/v1/auth/google',
    getMicrosoftOAuthUrl: () => '/api/v1/auth/microsoft',
    getAuthentikOAuthUrl: () => '/api/v1/auth/oauth/authentik',
  },
}));

const mockAssertion = vi.fn();
vi.mock('../utils/passkeys', () => ({
  passkeysSupported: () => true,
  getPasskeyAssertion: (options: unknown) => mockAssertion(options) as unknown,
  passkeyPromptError: () => 'The passkey request was cancelled or timed out. Try again.',
}));

const mockGet = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => mockGet(...args) as unknown },
}));

// Import AFTER mocks are registered
import { LoginPage } from './LoginPage';

const renderLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <LoginPage />
    </MemoryRouter>
  );

describe('LoginPage onboarding guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Branding / oauth-config calls are optional; default them to reject
    mockGet.mockRejectedValue(new Error('not mocked'));
  });

  it('redirects to /onboarding when the app has not been configured', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/v1/onboarding/status') {
        return Promise.resolve({ data: { needs_onboarding: true } });
      }
      return Promise.reject(new Error('not mocked'));
    });

    renderLogin();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding', { replace: true });
    });
    // The login form must not render for an unconfigured install
    expect(screen.queryByText(/Sign in to your account/i)).not.toBeInTheDocument();
  });

  it('renders the login form when onboarding is already complete', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/v1/onboarding/status') {
        return Promise.resolve({ data: { needs_onboarding: false } });
      }
      // branding + oauth-config: return empty/disabled
      if (url === '/api/v1/auth/branding') {
        return Promise.resolve({ data: { name: null, logo: null } });
      }
      return Promise.resolve({ data: { googleEnabled: false, microsoftEnabled: false } });
    });

    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/Sign in to your account/i)).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('/onboarding', { replace: true });
  });

  it('falls back to the login form when the status check fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/v1/onboarding/status') {
        return Promise.reject(new Error('network error'));
      }
      if (url === '/api/v1/auth/branding') {
        return Promise.resolve({ data: { name: null, logo: null } });
      }
      return Promise.resolve({ data: { googleEnabled: false, microsoftEnabled: false } });
    });

    renderLogin();

    await waitFor(() => {
      expect(screen.getByText(/Sign in to your account/i)).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('/onboarding', { replace: true });
  });
});

describe('LoginPage arrival notices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((url: string) =>
      url === '/api/v1/onboarding/status'
        ? Promise.resolve({ data: { needs_onboarding: false } })
        : Promise.resolve({ data: { name: null, logo: null, googleEnabled: false, microsoftEnabled: false } })
    );
  });

  it('says a password change signed the member out', async () => {
    // W04-1: after a change the member arrived here with no explanation.
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { reason: 'password_changed' } }]}>
        <LoginPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/your password was changed/i)).toBeInTheDocument();
  });

  it('says nothing about a password change on an ordinary visit', async () => {
    renderLogin();

    expect(await screen.findByText(/Sign in to your account/i)).toBeInTheDocument();
    expect(screen.queryByText(/your password was changed/i)).not.toBeInTheDocument();
  });
});

describe('LoginPage second-factor step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockGet.mockImplementation((url: string) =>
      url === '/api/v1/onboarding/status'
        ? Promise.resolve({ data: { needs_onboarding: false } })
        : Promise.reject(new Error('not mocked'))
    );
    mockMfaRequired = true;
  });

  afterEach(() => {
    mockMfaRequired = false;
  });

  // Recovery codes are four groups of five (mfa_service.generate_recovery_codes).
  // The placeholder showed two, and a member copying that shape entered half a
  // code (workflow review W04).
  it('shows the full recovery-code shape as the placeholder', async () => {
    renderLogin();
    fireEvent.click(await screen.findByRole('button', { name: 'Use a recovery code' }));
    expect(screen.getByLabelText('Recovery code')).toHaveAttribute('placeholder', 'xxxxx-xxxxx-xxxxx-xxxxx');
  });
});

describe('LoginPage passkey second factor', () => {
  const options = { challenge: 'c-1', allowCredentials: [{ id: 'cred-1', type: 'public-key' }] };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
    mockGet.mockImplementation((url: string) =>
      url === '/api/v1/onboarding/status'
        ? Promise.resolve({ data: { needs_onboarding: false } })
        : Promise.reject(new Error('not mocked'))
    );
    mockMfaChallenge.mockReset();
    mockAssertion.mockReset();
    mockAssertion.mockResolvedValue({ id: 'cred-1', response: {} });
    mockCompleteMfaLogin.mockReset();
    mockCompleteMfaLogin.mockResolvedValue(undefined);
    mockMfaRequired = true;
    mockMfaToken = 'pending-token';
  });

  afterEach(() => {
    mockMfaRequired = false;
    mockMfaToken = null;
  });

  it('offers only the passkey to a member without an authenticator app', async () => {
    mockMfaChallenge.mockResolvedValue({ totp: false, passkey_options: options });
    renderLogin();

    expect(await screen.findByRole('button', { name: 'Use your passkey' })).toBeInTheDocument();
    expect(mockMfaChallenge).toHaveBeenCalledWith('pending-token');
    expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use a recovery code' })).toBeInTheDocument();
  });

  it('signs in with the passkey answer', async () => {
    mockMfaChallenge.mockResolvedValue({ totp: false, passkey_options: options });
    renderLogin();

    fireEvent.click(await screen.findByRole('button', { name: 'Use your passkey' }));

    await waitFor(() =>
      expect(mockCompleteMfaLogin).toHaveBeenCalledWith(undefined, undefined, { id: 'cred-1', response: {} })
    );
    expect(mockAssertion).toHaveBeenCalledWith(options);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
  });

  it('offers the passkey and the code to a member with both', async () => {
    mockMfaChallenge.mockResolvedValue({ totp: true, passkey_options: options });
    renderLogin();

    expect(await screen.findByRole('button', { name: 'Use your passkey' })).toBeInTheDocument();
    expect(screen.getByLabelText('Authenticator code')).toBeInTheDocument();
  });

  it('keeps the code form when the member has no passkey', async () => {
    mockMfaChallenge.mockResolvedValue({ totp: true, passkey_options: null });
    renderLogin();

    expect(await screen.findByLabelText('Authenticator code')).toBeInTheDocument();
    await waitFor(() => expect(mockMfaChallenge).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Use your passkey' })).not.toBeInTheDocument();
  });

  it('explains a cancelled prompt and fetches a fresh challenge', async () => {
    mockMfaChallenge.mockResolvedValue({ totp: false, passkey_options: options });
    mockAssertion.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));
    renderLogin();

    fireEvent.click(await screen.findByRole('button', { name: 'Use your passkey' }));

    expect(await screen.findByText(/cancelled or timed out/)).toBeInTheDocument();
    expect(mockCompleteMfaLogin).not.toHaveBeenCalled();
    await waitFor(() => expect(mockMfaChallenge).toHaveBeenCalledTimes(2));
  });
});

describe('LoginPage single sign-on (W01-11)', () => {
  const answer = (oauth: Record<string, boolean>) => (url: string) =>
    url === '/api/v1/onboarding/status'
      ? Promise.resolve({ data: { needs_onboarding: false } })
      : url === '/api/v1/auth/branding'
        ? Promise.resolve({ data: { name: null, logo: null } })
        : Promise.resolve({ data: oauth });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReset();
  });

  it('offers Authentik when the server has it set up', async () => {
    mockGet.mockImplementation(answer({ googleEnabled: false, microsoftEnabled: false, authentikEnabled: true }));
    renderLogin();

    expect(await screen.findByRole('button', { name: /authentik sso/i })).toBeInTheDocument();
  });

  it('offers no Authentik button otherwise, including from an older server', async () => {
    mockGet.mockImplementation(answer({ googleEnabled: false, microsoftEnabled: false }));
    renderLogin();

    expect(await screen.findByText(/Sign in to your account/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /authentik sso/i })).not.toBeInTheDocument();
  });

  it('explains a provider that could not be reached', async () => {
    mockGet.mockImplementation(answer({ googleEnabled: false, microsoftEnabled: false, authentikEnabled: true }));
    render(
      <MemoryRouter initialEntries={['/login?error=provider_unavailable']}>
        <LoginPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/sign-in service could not be reached/i)).toBeInTheDocument();
  });
});
