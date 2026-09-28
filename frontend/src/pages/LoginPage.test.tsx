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
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    login: vi.fn(),
    completeMfaLogin: vi.fn(),
    cancelMfa: vi.fn(),
    mfaRequired: mockMfaRequired,
    isLoading: false,
    isAuthenticated: false,
    error: null,
    clearError: vi.fn(),
    lockedUntil: null,
  }),
}));

// authService stub (OAuth URL helpers)
vi.mock('../services/api', () => ({
  authService: {
    getGoogleOAuthUrl: () => '/api/v1/auth/google',
    getMicrosoftOAuthUrl: () => '/api/v1/auth/microsoft',
  },
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
