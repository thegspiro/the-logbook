/**
 * LOC-37 (owner decision 2026-11-01): both check-in landing pages require
 * sign-in and return the member to the same URL after it.
 *
 * `/locations/:locationId/check-in` is where a room's NFC tag lands a phone,
 * and `/events/:id/check-in` is where it forwards to; both are reached cold,
 * often with no session. The gate is authentication alone — a room tag must
 * work in Locations mode as well as Facilities mode, and any member may check
 * in — so a member with no permissions and every module off still gets in.
 *
 * The routes are rendered from the modules' own route functions, without the
 * App layout around them, so the sign-in each promises is the route's own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const auth = { isAuthenticated: false };
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      isAuthenticated: auth.isAuthenticated,
      isLoading: false,
      user: auth.isAuthenticated ? { id: 'member-1' } : null,
      loadUser: vi.fn(),
      // A member with no grants at all: the check-in pages must not need one.
      checkPermission: () => false,
      hasRole: () => false,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ enabledModules: new Set(), isModuleOn: () => false, isLoading: false }),
}));

vi.mock('../../pages/RoomCheckInPage', () => ({
  default: () => <div data-testid="page">Room check-in</div>,
}));
vi.mock('../../pages/EventSelfCheckInPage', () => ({
  default: () => <div data-testid="page">Event check-in</div>,
}));

import { getFacilitiesRoutes } from './routes';
import { getEventsRoutes } from '../events/routes';
import { postLoginRedirect } from '../../utils/postLoginRedirect';

/** Stands in for LoginPage: shows where sign-in would send the member. */
const LoginProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="login">{postLoginRedirect(location.state, location.search)}</div>;
};

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        {getFacilitiesRoutes()}
        {getEventsRoutes()}
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>
  );

const CHECK_IN_URLS = ['/locations/room-7/check-in?tag=door#top', '/events/evt-1/check-in?token=abc'];

describe('check-in landing pages', () => {
  beforeEach(() => {
    localStorage.removeItem('has_session');
    auth.isAuthenticated = false;
  });

  it.each(CHECK_IN_URLS)('sends a signed-out visitor at %s to sign in, and back again', async (url) => {
    renderAt(url);

    expect(await screen.findByTestId('login')).toHaveTextContent(url);
    expect(screen.queryByTestId('page')).not.toBeInTheDocument();
  });

  it.each(CHECK_IN_URLS)('opens %s for any signed-in member, whatever their grants', async (url) => {
    auth.isAuthenticated = true;
    renderAt(url);

    expect(await screen.findByTestId('page')).toBeInTheDocument();
    expect(screen.queryByTestId('login')).not.toBeInTheDocument();
  });
});
