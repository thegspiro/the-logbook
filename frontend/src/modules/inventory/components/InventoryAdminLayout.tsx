/**
 * The header Inventory Administration draws around every one of its pages.
 *
 * Training Administration renders its pages inside one route, so its header is
 * simply the page. Inventory's pages are their own routes and keep their own
 * URLs, so the routes in `INVENTORY_ADMIN_SHELL_PATHS` wrap their element in
 * this instead: the same `AdminHubFrame` header, metrics row and area cards on
 * each, and the page beneath them.
 *
 * It wraps inside each route's `ProtectedRoute`, never around it, so every page
 * keeps exactly the gate it had. A viewer who passes a page's gate but not the
 * hub's own — a checklist reader opening Check Reports, a settings admin
 * opening NFC settings — gets the page with a breadcrumb trail and no header,
 * because the header's Overview would refuse them.
 */

import React, { useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { RefreshCw, UserPlus } from 'lucide-react';
import { AdminHubFrame } from '../../../components/admin';
import type { AdminHubAction } from '../../../components/admin';
import { Breadcrumbs } from '../../../components/ux';
import { MemberPickerModal } from '../../../components/MemberPickerModal';
import { InventoryScanModal } from '../../../components/InventoryScanModal';
import { useAuthStore } from '../../../stores/authStore';
import { useEnabledModules } from '../../../hooks/useEnabledModules';
import { useTimezone } from '../../../hooks/useTimezone';
import { INVENTORY_HUB_CARDS } from '../pages/inventoryHubCards';
import { inventoryAdminAreasFor, resolveInventoryAdminLocation } from '../pages/inventoryAdminAreas';
import type { InventoryAdminAreaId } from '../pages/inventoryAdminAreas';
import { useInventoryAdminData } from '../hooks/useInventoryAdminData';
import { INVENTORY_ADMIN_AREA_ID_PREFIX, InventoryAdminNav } from './InventoryAdminNav';
import { INVENTORY_ADMIN_HUB_PERMISSIONS, InventoryAdminShellContext } from './inventoryAdminShell';
import type { InventoryAdminShell } from './inventoryAdminShell';

export const InventoryAdminLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canManage = checkPermission('inventory.manage');
  // `isLoading` as well as the answer: `isModuleOn` reports every module on
  // while the lookup is in flight. That default is right for a nav bar, which
  // must not flicker its rows, and wrong here -- it puts the store cards on
  // screen for the width of that request and offers links the storefront route
  // refuses.
  const { isModuleOn, isLoading: modulesLoading } = useEnabledModules();
  const tz = useTimezone();
  const { pathname, search } = useLocation();

  const hubAccess = INVENTORY_ADMIN_HUB_PERMISSIONS.some((permission) => checkPermission(permission));

  // Every card resolves its own gate here rather than inheriting the page's.
  // The store and EMS cards are the visible reason — both are separate modules
  // with their own grants — but the checklist cards are the reason it is done
  // for all of them: they refuse `inventory.manage`, which is the grant the
  // hub's primary audience holds.
  const visibleCards = useMemo(
    () =>
      // Nothing until the module flags are known -- see the hook comment above.
      // This also keeps `showsMedical` false for that window, so the EMS
      // request is raised once against the settled answer rather than twice.
      modulesLoading
        ? []
        : INVENTORY_HUB_CARDS.filter((card) => {
            if (card.requiresModule && !isModuleOn(card.requiresModule)) return false;
            if (card.anyPermission) return card.anyPermission.some((permission) => checkPermission(permission));
            return card.permission ? checkPermission(card.permission) : true;
          }),
    [checkPermission, isModuleOn, modulesLoading]
  );

  // A primitive, not the card object: this goes in a dependency array, and
  // `visibleCards` is only as stable as the two callbacks it memoizes on.
  const showsMedical = visibleCards.some((card) => card.id === 'supply-medical');
  const data = useInventoryAdminData({
    canManage,
    showsMedical,
    enabled: !modulesLoading && hubAccess,
    tz,
    refreshKey: pathname,
  });

  // Bumped when the metrics settings save, so the row above reflects the new
  // selection without a page reload.
  const [frameToken, setFrameToken] = useState(0);
  const refreshFrame = () => setFrameToken((token) => token + 1);

  // Quick-assign flow: pick a member, then assign items to them via the scan modal.
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ userId: string; memberName: string } | null>(null);

  const areas = useMemo(() => inventoryAdminAreasFor(visibleCards, canManage), [visibleCards, canManage]);
  const { areaId, destinationId } = resolveInventoryAdminLocation(pathname, search, areas);
  // Follows the URL, and moves off it only when an area with no page inside the
  // header is chosen (see InventoryAdminNav). The choice is recorded against
  // the URL it was made on, so navigating anywhere returns it to the URL's area.
  const locationKey = `${pathname}${search}`;
  const [localChoice, setLocalChoice] = useState<{ at: string; areaId: InventoryAdminAreaId } | null>(null);
  const selectedAreaId = localChoice?.at === locationKey ? localChoice.areaId : areaId;

  const shell: InventoryAdminShell = {
    data,
    visibleCards,
    modulesLoading,
    canManage,
    refreshFrame,
  };

  if (!hubAccess) {
    return (
      <InventoryAdminShellContext.Provider value={shell}>
        <div className="pt-6">
          <Breadcrumbs className="mb-0" />
        </div>
        {children}
      </InventoryAdminShellContext.Provider>
    );
  }

  // Pending work per page, from the figures the Overview already loads. Only a
  // manager's figures are fetched, so for anyone else these are all zero and
  // no badge is drawn.
  const attentionCounts: Record<string, number> = {
    requests: data.pendingRequests,
    returns: data.pendingReturns,
    'write-offs': data.pendingWriteOffs,
    reorder: data.lowStockAlerts.length,
    maintenance: data.summary?.maintenance_due_count ?? 0,
    checkouts: data.summary?.overdue_checkouts ?? 0,
  };

  // The refresh reloads the Overview's own queue, so it is offered there.
  // Every other page carries its own refresh for its own list.
  const actions: AdminHubAction[] =
    areaId === 'overview'
      ? [
          {
            key: 'refresh',
            label: 'Refresh inventory counts',
            icon: RefreshCw,
            busy: data.loading,
            onClick: () => {
              void data.reload();
              refreshFrame();
            },
          },
        ]
      : [];

  return (
    <InventoryAdminShellContext.Provider value={shell}>
      <AdminHubFrame
        moduleKey="inventory"
        summary={canManage}
        title="Inventory Administration"
        description="Gear, uniforms and EMS supplies — stock, issuance, and what needs a decision today"
        actions={actions}
        primaryAction={
          canManage
            ? {
                key: 'assign',
                label: 'Assign to Member',
                icon: UserPlus,
                onClick: () => setMemberPickerOpen(true),
              }
            : undefined
        }
        nav={
          modulesLoading ? undefined : (
            <InventoryAdminNav
              areas={areas}
              activeAreaId={areaId}
              activeDestinationId={destinationId}
              selectedAreaId={selectedAreaId}
              onSelectArea={(chosen) => setLocalChoice({ at: locationKey, areaId: chosen })}
              attentionCounts={attentionCounts}
            />
          )
        }
        refreshToken={frameToken}
        showAttentionQueue={false}
      >
        <div
          id={`${INVENTORY_ADMIN_AREA_ID_PREFIX}-panel-${selectedAreaId}`}
          role="tabpanel"
          aria-labelledby={`${INVENTORY_ADMIN_AREA_ID_PREFIX}-tab-${selectedAreaId}-label`}
          // The frame's header sits in a centred 7xl column and its body does
          // not, so the column is set here. Pages inside align to its left
          // edge and keep their own, narrower, max width.
          className="mx-auto max-w-7xl"
        >
          {children}
        </div>

        {/* Quick-assign: pick a member, then assign items to them */}
        <MemberPickerModal
          isOpen={memberPickerOpen}
          onClose={() => setMemberPickerOpen(false)}
          title="Distribute Items — Select a Member"
          onSelect={(member) => {
            setMemberPickerOpen(false);
            setAssignTarget(member);
          }}
        />
        <InventoryScanModal
          isOpen={assignTarget !== null}
          onClose={() => setAssignTarget(null)}
          mode="distribute"
          userId={assignTarget?.userId ?? ''}
          memberName={assignTarget?.memberName ?? ''}
          onComplete={() => {
            void data.reload();
            refreshFrame();
          }}
        />
      </AdminHubFrame>
    </InventoryAdminShellContext.Provider>
  );
};

export default InventoryAdminLayout;
