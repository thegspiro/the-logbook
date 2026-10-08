/**
 * The Equipment tab records what a rig carries; the equipment checklists crews
 * walk at shift start are a separate record built under Inventory. Nothing on
 * the tab said so, and a newcomer reasonably expected one to feed the other.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';

let grantedPermissions = new Set<string>();

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { checkPermission: (permission: string) => boolean }) => unknown) =>
    selector({ checkPermission: (permission) => grantedPermissions.has(permission) }),
}));

vi.mock('../services/api', () => ({
  apparatusEquipmentService: { deleteEquipment: vi.fn() },
}));

import { EquipmentTab } from './EquipmentTab';

const renderTab = () =>
  renderWithRouter(<EquipmentTab equipment={[]} loadingTab={false} apparatusId="a-1" onRefresh={vi.fn()} />);

describe('EquipmentTab checklist guidance', () => {
  beforeEach(() => {
    grantedPermissions = new Set();
  });

  it('explains that crew checks come from a separately built checklist', () => {
    renderTab();
    expect(screen.getByText(/equipment checklist, which is built separately/)).toBeInTheDocument();
  });

  it('links to the checklist builder for someone who can build checklists', () => {
    grantedPermissions = new Set(['inventory.check_manage']);
    renderTab();
    expect(screen.getByRole('link', { name: /Build equipment checklists/ })).toHaveAttribute(
      'href',
      '/inventory/admin/checklists'
    );
  });

  it('offers no link to someone the checklist builder would refuse', () => {
    grantedPermissions = new Set(['apparatus.edit']);
    renderTab();
    expect(screen.queryByRole('link', { name: /Build equipment checklists/ })).not.toBeInTheDocument();
  });
});
