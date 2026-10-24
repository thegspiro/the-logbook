import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Truck } from 'lucide-react';

const mockCheckPermission = vi.fn<(permission: string) => boolean>();
let mockMembershipType: string | undefined;
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      checkPermission: (permission: string) => mockCheckPermission(permission),
      user: { membership_type: mockMembershipType },
    }),
}));

vi.mock('../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({ enabledModules: null, isLoading: false, isModuleOn: () => true }),
}));

import { OperationsPageHeader } from './OperationsPageHeader';

const renderAt = (path: string, ui: React.ReactElement) =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

const grant = (...permissions: string[]) =>
  mockCheckPermission.mockImplementation((permission) => permissions.includes(permission));

describe('OperationsPageHeader', () => {
  beforeEach(() => {
    mockCheckPermission.mockReset();
    mockCheckPermission.mockReturnValue(false);
    mockMembershipType = undefined;
  });

  describe('section strip', () => {
    it('offers only the sections the viewer can open and marks the one open', () => {
      grant('inventory.check_submit');
      renderAt('/inventory/checklists/my', <OperationsPageHeader icon={Truck} title="My Equipment Checklists" />);

      const strip = screen.getByRole('navigation', { name: 'Operations sections' });
      const links = within(strip).getAllByRole('link');
      // Apparatus is missing too: with the module on, its row needs
      // apparatus.view, which the crew grant does not carry.
      expect(links.map((link) => link.textContent)).toEqual(['My Issued Gear', 'My Checklists', 'Apparatus Inventory']);
      expect(within(strip).getByRole('link', { name: 'My Checklists' })).toHaveAttribute('aria-current', 'page');
      expect(within(strip).queryByRole('link', { name: 'Inventory' })).not.toBeInTheDocument();
    });

    it('picks the longest matching section, so a checklist page is not Inventory', () => {
      grant('inventory.manage', 'inventory.check_view');
      renderAt('/inventory/checklists/log', <OperationsPageHeader icon={Truck} title="Check log" />);

      const strip = screen.getByRole('navigation', { name: 'Operations sections' });
      expect(within(strip).getByRole('link', { name: 'Fleet Readiness' })).toHaveAttribute('aria-current', 'page');
      expect(within(strip).getByRole('link', { name: 'Inventory' })).not.toHaveAttribute('aria-current');
    });
  });

  describe('trail', () => {
    it('draws none on a section’s own page, where the strip already says where you are', () => {
      grant('inventory.check_view');
      renderAt('/inventory/checklists', <OperationsPageHeader icon={Truck} title="Fleet Readiness" />);

      expect(screen.queryByRole('navigation', { name: /breadcrumb/i })).not.toBeInTheDocument();
    });

    it('names the section, then the parents, then the page below it', () => {
      grant('apparatus.view');
      renderAt(
        '/apparatus/a-1/edit',
        <OperationsPageHeader
          icon={Truck}
          title="Edit E-1"
          breadcrumbLabel="Edit"
          parentCrumbs={[{ label: 'E-1', path: '/apparatus/a-1' }]}
        />
      );

      const trail = screen.getByRole('navigation', { name: /breadcrumb/i });
      expect(within(trail).getByRole('link', { name: 'Apparatus' })).toHaveAttribute('href', '/apparatus');
      expect(within(trail).getByRole('link', { name: 'E-1' })).toHaveAttribute('href', '/apparatus/a-1');
      expect(trail).toHaveTextContent('Edit');
    });

    it('puts the administration hub after the section for a hub card outside its URL space', () => {
      grant('inventory.manage');
      renderAt(
        '/inventory/storage-areas',
        <OperationsPageHeader icon={Truck} title="Storage Areas" underHub="/inventory/admin" />
      );

      const crumbs = within(screen.getByRole('navigation', { name: /breadcrumb/i })).getAllByRole('link');
      // After, not before: Inventory Administration sits inside Inventory.
      expect(crumbs.map((crumb) => crumb.textContent).filter(Boolean)).toEqual([
        'Inventory',
        'Inventory Administration',
      ]);
      const hub = crumbs.find((crumb) => crumb.textContent === 'Inventory Administration');
      expect(hub).toHaveAttribute('href', '/inventory/admin');
    });

    it('keeps the hub crumb for an officer who opens the hub but not the section', () => {
      // storefront.manage opens Inventory Administration but not the Inventory
      // section, which is gated on inventory.manage; the hub is their way back.
      grant('storefront.manage');
      renderAt(
        '/inventory/storage-areas',
        <OperationsPageHeader icon={Truck} title="Storage Areas" underHub="/inventory/admin" />
      );

      const trail = screen.getByRole('navigation', { name: /breadcrumb/i });
      expect(within(trail).getByRole('link', { name: 'Inventory Administration' })).toBeInTheDocument();
      expect(within(trail).queryByRole('link', { name: 'Inventory' })).not.toBeInTheDocument();
    });

    it('leaves the hub out for a viewer whose grants do not open it', () => {
      grant('inventory.view');
      renderAt(
        '/inventory/storage-areas',
        <OperationsPageHeader icon={Truck} title="Storage Areas" underHub="/inventory/admin" />
      );

      expect(screen.queryByRole('link', { name: 'Inventory Administration' })).not.toBeInTheDocument();
    });
  });

  it('draws the title, subtitle and actions', () => {
    renderAt(
      '/facilities',
      <OperationsPageHeader
        icon={Truck}
        title="Facilities"
        subtitle="Stations and buildings"
        actions={<button type="button">Add Facility</button>}
      />
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Facilities' })).toBeInTheDocument();
    expect(screen.getByText('Stations and buildings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Facility' })).toBeInTheDocument();
  });
});
