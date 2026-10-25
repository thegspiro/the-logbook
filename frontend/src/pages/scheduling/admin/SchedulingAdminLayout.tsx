/**
 * The header Scheduling Administration draws around every one of its pages.
 *
 * The same shape Inventory Administration uses (`InventoryAdminLayout`): the
 * pages are their own routes and keep their own URLs, so the routes in
 * `SCHEDULING_ADMIN_SHELL_PATHS` wrap their element in this — the shared
 * `AdminHubFrame` header, metrics row and area cards on each, and the page
 * beneath them.
 *
 * It wraps inside each route's `ProtectedRoute`, never around it, so every page
 * keeps exactly the gate it had. Every wrapped route is gated on
 * `scheduling.manage`, which is also the hub's own gate, so unlike Inventory
 * there is no viewer who passes a page's gate and fails the header's.
 */

import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Plus, RefreshCw } from 'lucide-react';
import { AdminHubFrame } from '../../../components/admin';
import type { AdminHubAction } from '../../../components/admin';
import { useAuthStore } from '../../../stores/authStore';
import { useEnabledModules } from '../../../hooks/useEnabledModules';
import { SCHEDULING_HUB_CARDS } from './schedulingHubCards';
import { CREATE_SHIFT_PATH, resolveSchedulingAdminLocation, schedulingAdminAreasFor } from './schedulingAdminAreas';
import type { SchedulingAdminAreaId } from './schedulingAdminAreas';
import { SCHEDULING_ADMIN_AREA_ID_PREFIX, SchedulingAdminNav } from './SchedulingAdminNav';
import { SchedulingAdminShellContext } from './schedulingAdminShell';

export const SchedulingAdminLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canManage = checkPermission('scheduling.manage');
  // `isLoading` as well as the answer: `isModuleOn` reports every module on
  // while the lookup is in flight, which would put the Inventory checklist
  // pages in the strip for the width of that request.
  const { isModuleOn, isLoading: modulesLoading } = useEnabledModules();
  const { pathname, search } = useLocation();

  // Every card resolves its own gate here rather than inheriting the page's.
  // Two cards point into Inventory, whose grants `scheduling.manage` does not
  // imply — `checkPermission` is exact match plus module wildcard — so a card
  // nobody filtered is a link to Access Denied for the officer this page is
  // built for.
  const visibleCards = useMemo(
    () =>
      modulesLoading
        ? []
        : SCHEDULING_HUB_CARDS.filter((card) => {
            if (card.requiresModule && !isModuleOn(card.requiresModule)) return false;
            if (card.anyPermission) return card.anyPermission.some((permission) => checkPermission(permission));
            return card.permission ? checkPermission(card.permission) : true;
          }),
    [checkPermission, isModuleOn, modulesLoading]
  );

  // Bumped by the refresh action and when the metrics settings save, so the
  // row above reflects the change without a page reload.
  const [frameToken, setFrameToken] = useState(0);
  const refreshFrame = () => setFrameToken((token) => token + 1);

  const areas = useMemo(() => schedulingAdminAreasFor(visibleCards, canManage), [visibleCards, canManage]);
  const { areaId, destinationId } = resolveSchedulingAdminLocation(pathname, search, areas);
  // Follows the URL, and moves off it only when an area with no page inside the
  // header is chosen (see SchedulingAdminNav). The choice is recorded against
  // the URL it was made on, so navigating anywhere returns it to the URL's area.
  const locationKey = `${pathname}${search}`;
  const [localChoice, setLocalChoice] = useState<{ at: string; areaId: SchedulingAdminAreaId } | null>(null);
  const selectedAreaId = localChoice?.at === locationKey ? localChoice.areaId : areaId;

  // The refresh reloads the frame's own figures, so it is offered on the
  // Overview. Every other page carries its own refresh for its own list.
  const actions: AdminHubAction[] =
    areaId === 'overview'
      ? [{ key: 'refresh', label: 'Refresh scheduling figures', icon: RefreshCw, onClick: refreshFrame }]
      : [];

  return (
    <SchedulingAdminShellContext.Provider value={{ canManage, refreshFrame }}>
      <AdminHubFrame
        moduleKey="scheduling"
        // `/admin-hub/scheduling/summary` resolves the module to
        // `scheduling.manage`, and so does every wrapped route, so today every
        // viewer who reaches here holds it. Kept as a guard rather than dropped:
        // the frame's own docstring is that a hub admitting more than one kind
        // of administrator must not make this request for the others.
        summary={canManage}
        title="Scheduling Administration"
        description="Shifts, the crews that fill them, and what needs a decision today"
        actions={actions}
        primaryAction={
          canManage
            ? {
                key: 'create-shift',
                label: 'Create Shift',
                icon: Plus,
                onClick: () => void navigate(CREATE_SHIFT_PATH),
              }
            : undefined
        }
        nav={
          modulesLoading ? undefined : (
            <SchedulingAdminNav
              areas={areas}
              activeAreaId={areaId}
              activeDestinationId={destinationId}
              selectedAreaId={selectedAreaId}
              onSelectArea={(chosen) => setLocalChoice({ at: locationKey, areaId: chosen })}
            />
          )
        }
        refreshToken={frameToken}
      >
        <div
          id={`${SCHEDULING_ADMIN_AREA_ID_PREFIX}-panel-${selectedAreaId}`}
          role="tabpanel"
          aria-labelledby={`${SCHEDULING_ADMIN_AREA_ID_PREFIX}-tab-${selectedAreaId}-label`}
          // The frame's header sits in a centred 7xl column and its body does
          // not, so the column is set here. Pages inside align to its left
          // edge and keep their own, narrower, max width.
          className="mx-auto max-w-7xl"
        >
          {children}
        </div>
      </AdminHubFrame>
    </SchedulingAdminShellContext.Provider>
  );
};

export default SchedulingAdminLayout;
