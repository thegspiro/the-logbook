/**
 * The election detail page offers a way back in every state, including the two
 * that previously offered none.
 *
 * `/elections/:electionId` is why this needs explicit `items`. The generated
 * trail skips the id, leaving a single "Elections" crumb, and a one-crumb
 * generated trail renders nothing at all — so the page had no trail, and its
 * loading and not-found branches had no "Back to Elections" link either. A
 * member who followed a stale link landed on an error with no way out but the
 * browser's back button.
 *
 * The not-found branch is the one asserted hardest: it is the state a wrong or
 * deleted id produces, and the state in which navigation matters most.
 *
 * The LOADED branch is deliberately not rendered here. It mounts the results,
 * ballot, candidate and package panels, which would need a screen of mocks to
 * reach one crumb — and it is the one branch that was never missing a way back,
 * since it has carried a "Back to Elections" link all along. All three branches
 * render the same `trail` const, and `breadcrumbs.test.tsx` in the finance
 * pages directory is the pattern for asserting per-branch presence from source
 * where rendering is too costly; that check does not extend here, so the loaded
 * branch rests on review.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../test/utils';

const getElection = vi.fn();
vi.mock('../services/api', () => ({
  electionService: { getElection: (...a: unknown[]) => getElection(...a) as unknown },
  eventService: { getEvents: vi.fn().mockResolvedValue([]) },
  meetingsService: { getMeetings: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../modules/prospective-members/services/api', () => ({
  electionPackageService: { getPackages: vi.fn().mockResolvedValue([]) },
  applicantService: { getApplicants: vi.fn().mockResolvedValue([]) },
}));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ electionId: 'e-1' }) };
});

const checkPermission = vi.fn();
// Both call shapes: this page destructures `useAuthStore()` bare, while
// Breadcrumbs selects a slice. A selector-only stub crashes the page.
vi.mock('../stores/authStore', () => {
  const state = {
    checkPermission: (...a: unknown[]) => checkPermission(...a) as boolean,
    user: { id: 'u-1' },
  };
  return { useAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state) };
});

import ElectionDetailPage from './ElectionDetailPage';

const renderAt = () => {
  window.history.replaceState({}, '', '/elections/e-1');
  // renderWithRouter, not a bare BrowserRouter: this page calls useConfirm(),
  // which throws without ConfirmProvider (CLAUDE.md pitfall #16).
  return renderWithRouter(<ElectionDetailPage />);
};

const trail = () => screen.getByRole('navigation', { name: /breadcrumb/i });

describe('ElectionDetailPage breadcrumbs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset implementations, not just calls (CLAUDE.md pitfall #28).
    getElection.mockReset();
    checkPermission.mockReset();
    checkPermission.mockReturnValue(true);
  });

  it('offers a route back to Elections when the election cannot be loaded', async () => {
    getElection.mockRejectedValue(new Error('nope'));
    renderAt();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(within(trail()).getByRole('link', { name: 'Elections' })).toHaveAttribute('href', '/elections');
  });

  it('falls back to a generic name rather than an empty crumb before the title is known', async () => {
    // The loading branch renders before any title exists. An empty last crumb
    // would read as a trail that lost its destination.
    getElection.mockReturnValue(new Promise(() => undefined));
    renderAt();

    expect(within(trail()).getByText('Election')).toBeInTheDocument();
    expect(within(trail()).getByRole('link', { name: 'Elections' })).toBeInTheDocument();
  });
});
