import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { BottomNavigation, OPEN_MOBILE_NAV_EVENT } from './BottomNavigation';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockEnabled: Set<string> | null = null;
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: mockEnabled,
    isModuleOn: (k: string) => mockEnabled === null || mockEnabled.has(k),
  }),
}));

vi.mock('../../utils/routePrefetch', () => ({ prefetchRoute: vi.fn() }));

function renderBar(props: { hidden?: boolean } = {}, initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <BottomNavigation {...props} />
    </MemoryRouter>
  );
}

describe('BottomNavigation', () => {
  beforeEach(() => {
    mockEnabled = null;
    vi.clearAllMocks();
  });

  it('shows four destinations plus More when all modules are on', () => {
    renderBar();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('Training')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
  });

  it('promotes the next candidate when a module is disabled', () => {
    // Scheduling off — Members should move up into the freed slot rather than
    // leaving a gap or shrinking the bar.
    mockEnabled = new Set(['training', 'members', 'events']);
    renderBar();
    expect(screen.queryByText('Schedule')).not.toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
  });

  it('never renders more than five slots', () => {
    mockEnabled = null;
    renderBar();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('navigates on tap', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByText('Events'));
    expect(mockNavigate).toHaveBeenCalledWith('/events');
  });

  it('marks the active route with aria-current', () => {
    renderBar({}, '/events');
    expect(screen.getByRole('button', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('treats nested routes as active', () => {
    renderBar({}, '/events/abc123');
    expect(screen.getByRole('button', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
  });

  it('asks the drawer to open instead of navigating when More is tapped', async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener(OPEN_MOBILE_NAV_EVENT, listener);
    renderBar();

    await user.click(screen.getByText('More'));

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: OPEN_MOBILE_NAV_EVENT }));
    expect(mockNavigate).not.toHaveBeenCalled();
    window.removeEventListener(OPEN_MOBILE_NAV_EVENT, listener);
  });

  it('renders nothing while the on-screen keyboard is up', () => {
    renderBar({ hidden: true });
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
  });
});
