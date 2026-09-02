import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QuickAddSheet } from './QuickAddSheet';
import { QUICK_ADD_ACTIONS, availableQuickAddActions } from './quickAddActions';

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockEnabled: Set<string> | null = null;
vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: mockEnabled,
    isModuleOn: (key: string) => mockEnabled === null || mockEnabled.has(key),
    isLoading: false,
  }),
}));

vi.mock('../../utils/routePrefetch', () => ({ prefetchRoute: vi.fn() }));

let mockPermissions = new Set<string>();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (permission: string) => boolean }) => unknown) =>
    selector({ checkPermission: (permission) => mockPermissions.has(permission) }),
}));

const onClose = vi.fn();
const onSelected = vi.fn();

function renderSheet() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <QuickAddSheet isOpen onClose={onClose} onSelected={onSelected} />
    </MemoryRouter>
  );
}

describe('QuickAddSheet', () => {
  beforeEach(() => {
    mockEnabled = null;
    mockPermissions = new Set();
    mockNavigate.mockReset();
    onClose.mockReset();
    onSelected.mockReset();
  });

  it('offers the ungated member actions with no permissions at all', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /Log training hours/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clock in/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add an action item/ })).toBeInTheDocument();
  });

  it('withholds an action whose module the organization has switched off', () => {
    mockEnabled = new Set(['inventory', 'scheduling']);
    renderSheet();
    expect(screen.queryByRole('button', { name: /Log training hours/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start a rig check/ })).toBeInTheDocument();
  });

  it('withholds an action whose permission the member lacks', () => {
    renderSheet();
    expect(screen.queryByRole('button', { name: /Create an event/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a member/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request equipment/ })).not.toBeInTheDocument();
  });

  it('offers a manage action once the member holds its permission', () => {
    mockPermissions = new Set(['events.manage']);
    renderSheet();
    expect(screen.getByRole('button', { name: /Create an event/ })).toBeInTheDocument();
  });

  // anyPermission is OR logic, mirroring requiredAnyPermission on /members/scan.
  it.each(['users.view', 'members.manage'])('offers the scanner on %s alone', (permission) => {
    mockPermissions = new Set([permission]);
    renderSheet();
    expect(screen.getByRole('button', { name: /Scan a member ID/ })).toBeInTheDocument();
  });

  // Choosing and dismissing are reported separately so the bar can decide
  // where focus belongs — back on the Add tab, or on the page just opened.
  it('reports a chosen row as a selection, not a dismissal', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole('button', { name: /Log training hours/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/training/submit');
    expect(onSelected).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports Escape as a dismissal, not a selection', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(onSelected).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // The bottom bar hides the Add tab when this selector comes back empty, so
  // what keeps the tab from ever being a dead button is that the registry
  // always carries rows no gate can take away. Assert that directly: it is the
  // reason the sheet's own empty branch is unreachable in practice.
  it('always leaves the ungated rows standing, however hostile the gates', () => {
    const survivors = availableQuickAddActions(
      () => false,
      () => false
    );
    expect(survivors.map((action) => action.id)).toEqual(
      QUICK_ADD_ACTIONS.filter((action) => !action.requiresModule && !action.permission && !action.anyPermission).map(
        (action) => action.id
      )
    );
    expect(survivors.length).toBeGreaterThan(0);
  });

  it('groups rows under the section headers in registry order', () => {
    mockPermissions = new Set(['events.manage']);
    renderSheet();
    const headers = screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent);
    expect(headers).toEqual(['Log something', 'Check in', 'Department']);
  });
});
