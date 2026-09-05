/**
 * What the generated trail says, and — more importantly — what it offers.
 *
 * The component's failure mode is not a missing crumb but a crumb that looks
 * like a way back and is not one: a path no `<Route>` declares lands on the
 * dashboard, and a route the viewer cannot open lands on Access Denied. Both
 * render identically to a working link, so each case is asserted on the
 * rendered element's role rather than on its text.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router';

const mockCheckPermission = vi.fn();
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (...args: unknown[]) => mockCheckPermission(...args) as boolean }),
}));

import { Breadcrumbs } from './Breadcrumbs';

const grant = (...held: string[]) =>
  mockCheckPermission.mockImplementation((permission: unknown) => held.includes(permission as string));

const renderAt = (pathname: string, ui = <Breadcrumbs />) => {
  window.history.replaceState({}, '', pathname);
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};

const trail = () => screen.getByRole('navigation', { name: /breadcrumb/i });

/** Crumbs announced as the page you are on. Exactly one, or none on a trimmed trail. */
const currentCrumbs = () =>
  within(trail()).queryAllByText((_content, node) => node?.getAttribute('aria-current') === 'page');
const crumbLinks = () =>
  within(trail())
    .queryAllByRole('link')
    .map((link) => link.getAttribute('href'))
    // The home icon is chrome, not a crumb.
    .filter((href) => href !== '/dashboard');

describe('Breadcrumbs', () => {
  beforeEach(() => {
    // mockReset, not clearAllMocks: an implementation set by one block outlives
    // clearAllMocks and the next block would run on its grants.
    mockCheckPermission.mockReset();
    grant();
  });

  it('names an administration hub the way the hub names itself', () => {
    grant('scheduling.manage');
    renderAt('/scheduling/admin/templates');

    expect(within(trail()).getByRole('link', { name: 'Scheduling Administration' })).toHaveAttribute(
      'href',
      '/scheduling/admin'
    );
  });

  it('marks the page you are on, and only that one', () => {
    grant('scheduling.manage');
    renderAt('/scheduling/admin/templates');

    expect(currentCrumbs()).toHaveLength(1);
    expect(currentCrumbs()[0]).toHaveTextContent('Templates');
  });

  it('marks the page you are on when the URL ends in a record id', () => {
    // The id is skipped for display, so the crumb before it is the page. Deriving
    // "current" from the loop index left this trail with no current crumb at all
    // and a link to /members/admin/edit, which is not a route.
    grant('members.manage');
    renderAt('/members/admin/edit/8f14e45f-ceea-467a-9f6b-1a2b3c4d5e6f');

    expect(currentCrumbs()).toHaveLength(1);
    expect(currentCrumbs()[0]).toHaveTextContent('Edit');
    expect(crumbLinks()).not.toContain('/members/admin/edit');
  });

  it('does not link a path no route declares', () => {
    // Six section routes live under /scheduling/admin/settings and it is not
    // one of them; App.tsx's catch-all would redirect to the dashboard.
    grant('scheduling.manage');
    renderAt('/scheduling/admin/settings/eligibility');

    expect(within(trail()).getByText('Settings')).not.toHaveAttribute('href');
    expect(crumbLinks()).toEqual(['/scheduling', '/scheduling/admin']);
  });

  it('does not link a route the viewer cannot open', () => {
    // A checklist manager holds inventory.check_manage, which opens
    // /inventory/admin/checklists but neither /inventory (inventory.manage) nor
    // — on its own — the hub. checkPermission is exact match plus module
    // wildcard, so ancestry grants nothing.
    grant('inventory.check_manage');
    renderAt('/inventory/admin/checklists/reports');

    expect(within(trail()).getByText('Inventory')).not.toHaveAttribute('href');
    expect(crumbLinks()).toEqual(['/inventory/admin', '/inventory/admin/checklists']);
  });

  it('links an ancestor once the viewer holds a grant it accepts', () => {
    grant('inventory.manage');
    renderAt('/inventory/admin/checklists/reports');

    expect(crumbLinks()).toContain('/inventory');
  });

  it('leaves an explicit trail to its caller', () => {
    // TrainingProgramsPage resolves its own Admin crumb against the viewer's
    // grants; re-filtering here would drop crumbs the caller meant to show.
    renderAt(
      '/training/programs',
      <Breadcrumbs items={[{ label: 'Training', path: '/training' }, { label: 'Programs' }]} />
    );

    expect(crumbLinks()).toEqual(['/training']);
    expect(within(trail()).getByText('Programs')).toHaveAttribute('aria-current', 'page');
  });

  it('renders nothing for a generated trail of one crumb', () => {
    renderAt('/members');

    expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument();
  });

  describe('omitCurrentPage', () => {
    it('ends the trail at the parent', () => {
      grant('inventory.manage');
      renderAt('/inventory/admin/store', <Breadcrumbs omitCurrentPage />);

      expect(within(trail()).queryByText('Department Store')).not.toBeInTheDocument();
      expect(crumbLinks()).toEqual(['/inventory', '/inventory/admin']);
    });

    it('claims no crumb as the current page, and keeps the last one a link', () => {
      // The last crumb is now the parent, so marking it aria-current would tell
      // a screen reader the viewer is on a page they are not on — and making it
      // a plain span would cost them the step up the trail exists to offer.
      grant('inventory.manage');
      renderAt('/inventory/admin/store', <Breadcrumbs omitCurrentPage />);

      expect(currentCrumbs()).toHaveLength(0);
      expect(within(trail()).getByRole('link', { name: 'Inventory Administration' })).toHaveAttribute(
        'href',
        '/inventory/admin'
      );
    });

    it('still renders when trimming leaves a single parent crumb', () => {
      // The one-crumb suppression exists so a top-level page does not restate
      // its own <h1>. A trimmed crumb is the parent, not a restatement, and
      // suppressing it would leave a hub with no route up at all.
      grant('inventory.manage');
      renderAt('/inventory/admin', <Breadcrumbs omitCurrentPage />);

      expect(crumbLinks()).toEqual(['/inventory']);
      expect(within(trail()).queryByText('Inventory Administration')).not.toBeInTheDocument();
    });

    it('leaves an explicit trail whole', () => {
      // A caller passing items wrote the crumbs it wants shown; deleting the
      // last of them is a different operation from trimming a derived trail.
      renderAt(
        '/training/programs',
        <Breadcrumbs omitCurrentPage items={[{ label: 'Training', path: '/training' }, { label: 'Programs' }]} />
      );

      expect(within(trail()).getByText('Programs')).toHaveAttribute('aria-current', 'page');
    });
  });
});
