/**
 * Module gating on ProtectedRoute.
 *
 * A module flag hides navigation; without this gate a bookmark or a typed URL
 * still reached the page, which is how a department store got configured that
 * no member could see in their navigation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mockCheckPermission = vi.fn();
vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: 'u1' },
      loadUser: vi.fn(),
      checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean,
      hasRole: () => true,
    };
    return selector ? selector(state) : state;
  },
}));

const mockUseEnabledModules = vi.fn();
vi.mock('../hooks/useEnabledModules', () => ({
  useEnabledModules: () => mockUseEnabledModules() as unknown,
}));

import { ProtectedRoute } from './ProtectedRoute';

const renderGated = () =>
  render(
    <MemoryRouter>
      <ProtectedRoute
        requiredPermission="storefront.manage"
        requiredModule="storefront"
        moduleLabel="The Department Store"
      >
        <div data-testid="page">Store admin</div>
      </ProtectedRoute>
    </MemoryRouter>
  );

describe('ProtectedRoute requiredModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('has_session', '1');
    mockCheckPermission.mockReturnValue(true);
  });

  it('renders the page when the module is on', () => {
    mockUseEnabledModules.mockReturnValue({
      enabledModules: new Set(['storefront']),
      isModuleOn: (k: string) => k === 'storefront',
      isLoading: false,
    });
    renderGated();
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });

  it('refuses the page when the module is off', () => {
    mockUseEnabledModules.mockReturnValue({
      enabledModules: new Set(['inventory']),
      isModuleOn: () => false,
      isLoading: false,
    });
    renderGated();
    expect(screen.queryByTestId('page')).not.toBeInTheDocument();
    expect(screen.getByText('The Department Store is not enabled')).toBeInTheDocument();
  });

  it('points an admin at the module settings that fix it', () => {
    mockUseEnabledModules.mockReturnValue({
      enabledModules: new Set([]),
      isModuleOn: () => false,
      isLoading: false,
    });
    renderGated();
    expect(screen.getByRole('link', { name: 'Open module settings' })).toHaveAttribute('href', '/settings?tab=modules');
  });

  it('sends a member who cannot fix it back to the dashboard', () => {
    mockCheckPermission.mockImplementation((p: unknown) => p !== 'settings.manage');
    mockUseEnabledModules.mockReturnValue({
      enabledModules: new Set([]),
      isModuleOn: () => false,
      isLoading: false,
    });
    renderGated();
    expect(screen.queryByRole('link', { name: 'Open module settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to Dashboard' })).toHaveAttribute('href', '/dashboard');
  });

  // Rendering optimistically would show the page, fire its requests, and then
  // replace it with the refusal.
  it('shows neither the page nor the refusal until the lookup settles', () => {
    mockUseEnabledModules.mockReturnValue({
      enabledModules: null,
      isModuleOn: () => true,
      isLoading: true,
    });
    renderGated();
    expect(screen.queryByTestId('page')).not.toBeInTheDocument();
    expect(screen.queryByText(/is not enabled/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  // A module flag is not an access control, so a failed lookup must not lock
  // the department out of a module it actually has on.
  it('falls through to the page when the lookup failed', () => {
    mockUseEnabledModules.mockReturnValue({
      enabledModules: null,
      isModuleOn: () => true,
      isLoading: false,
    });
    renderGated();
    expect(screen.getByTestId('page')).toBeInTheDocument();
  });

  it('leaves routes without requiredModule alone', () => {
    mockUseEnabledModules.mockReturnValue({
      enabledModules: new Set([]),
      isModuleOn: () => false,
      isLoading: false,
    });
    render(
      <MemoryRouter>
        <ProtectedRoute requiredPermission="events.view">
          <div data-testid="ungated">Events</div>
        </ProtectedRoute>
      </MemoryRouter>
    );
    expect(screen.getByTestId('ungated')).toBeInTheDocument();
  });
});
