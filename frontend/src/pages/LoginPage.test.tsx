import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock navigation so we can assert redirects
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Auth store stub — unauthenticated, no lockout
vi.mock('../stores/authStore', () => ({
  useAuthStore: () => ({
    login: vi.fn(),
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
