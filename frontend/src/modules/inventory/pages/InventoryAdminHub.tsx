/**
 * Inventory Admin Hub
 *
 * Central navigation page for inventory administration.
 * Links to separate pages for items, pool items, categories,
 * maintenance, members, checkouts, charges, and return requests.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Package,
  Tag,
  Users,
  Wrench,
  ArrowDownToLine,
  Layers,
  RefreshCw,
  ClipboardList,
  DollarSign,
  CornerDownLeft,
  Upload,
  MapPin,
  FileX,
  Truck,
  Clock,
  BoxSelect,
  Ruler,
  UserPlus,
  SlidersHorizontal,
  Target,
  Store,
  Sparkles,
  ArrowRight,
  Building2,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { AdminHubFrame, AdminMetricsSettings } from '../../../components/admin';
import type { AdminHubAction, AdminHubTab } from '../../../components/admin';
import { useAuthStore } from '../../../stores/authStore';
import { MemberPickerModal } from '../../../components/MemberPickerModal';
import { InventoryScanModal } from '../../../components/InventoryScanModal';
import type {
  InventorySummary,
  InventorySetupStatus,
  LowStockAlert,
  ReturnRequestItem,
  EquipmentRequestItem,
} from '../types';
interface NavCardProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: number | undefined;
  badgeColor?: string | undefined;
  iconBg?: string | undefined;
}

const NavCard: React.FC<NavCardProps> = ({ to, icon, title, description, badge, badgeColor, iconBg }) => (
  <Link
    to={to}
    className="card-secondary hover:bg-theme-surface-hover active:bg-theme-surface-hover group flex items-center gap-3 p-3 sm:items-start sm:gap-4 sm:p-4"
  >
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors sm:h-10 sm:w-10 ${iconBg ?? 'bg-theme-surface-secondary text-theme-text-muted group-hover:text-theme-text-primary'}`}
    >
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <h3 className="text-theme-text-primary group-hover:text-theme-text-primary text-sm font-semibold">{title}</h3>
        {badge != null && badge > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor ?? 'bg-blue-500/10 text-blue-700 dark:text-blue-400'}`}
          >
            {badge}
          </span>
        )}
      </div>
      <p className="text-theme-text-muted mt-0.5 hidden text-xs sm:block">{description}</p>
    </div>
  </Link>
);

interface ProminentCardProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  stat?: string | number | undefined;
  statLabel?: string | undefined;
  iconBg: string;
}

const ProminentCard: React.FC<ProminentCardProps> = ({ to, icon, title, description, stat, statLabel, iconBg }) => (
  <Link
    to={to}
    className="card-secondary hover:bg-theme-surface-hover active:bg-theme-surface-hover group flex flex-col gap-3 p-4 transition-all sm:p-5"
  >
    <div className="flex items-center justify-between">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl sm:h-11 sm:w-11 ${iconBg}`}>{icon}</div>
      {stat != null && (
        <div className="text-right">
          <p className="text-theme-text-primary text-xl font-bold sm:text-2xl">{stat}</p>
          {statLabel && <p className="text-theme-text-muted text-[11px]">{statLabel}</p>}
        </div>
      )}
    </div>
    <div>
      <h3 className="text-theme-text-primary text-sm font-semibold">{title}</h3>
      <p className="text-theme-text-muted mt-0.5 text-xs">{description}</p>
    </div>
  </Link>
);

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <div>
    <h2 className="text-theme-text-muted mb-3 text-xs font-semibold tracking-wider uppercase">{title}</h2>
    {children}
  </div>
);

type AdminTab = 'overview' | 'settings';

/** Settings is always last — the frame's rule, on every module. */
const TABS: AdminHubTab<AdminTab>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'settings', label: 'Settings' },
];

export const InventoryAdminHub: React.FC = () => {
  const canManage = useAuthStore((s) => s.checkPermission)('inventory.manage');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as AdminTab | null;
  const activeTab: AdminTab = tabParam === 'settings' ? 'settings' : 'overview';
  // Bumped when the settings tab saves, so the metrics row above it reflects
  // the new selection without a page reload.
  const [frameToken, setFrameToken] = useState(0);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [setupStatus, setSetupStatus] = useState<InventorySetupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Quick-assign flow: pick a member, then assign items to them via the scan modal.
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ userId: string; memberName: string } | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryData, lowStock, returns, requests, setup] = await Promise.all([
        inventoryService.getSummary(),
        inventoryService.getLowStockItems().catch(() => [] as LowStockAlert[]),
        inventoryService.getReturnRequests({ status: 'pending' }).catch(() => [] as ReturnRequestItem[]),
        inventoryService
          .getEquipmentRequests({ status: 'pending' })
          .catch(() => ({ requests: [] as EquipmentRequestItem[], total: 0 })),
        inventoryService.getSetupStatus().catch(() => null),
      ]);
      setSummary(summaryData);
      setLowStockAlerts(lowStock);
      setPendingReturns(Array.isArray(returns) ? returns.length : 0);
      setPendingRequests(requests.total);
      setSetupStatus(setup);
    } catch {
      // Non-critical — page still navigable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const actions: AdminHubAction[] = [
    {
      key: 'refresh',
      label: 'Refresh inventory counts',
      icon: RefreshCw,
      busy: loading,
      onClick: () => {
        void loadSummary();
        setFrameToken((token) => token + 1);
      },
    },
  ];

  return (
    <AdminHubFrame<AdminTab>
      moduleKey="inventory"
      title="Gear & Uniforms Administration"
      description="Manage equipment, assignments, and compliance"
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
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(tab) => setSearchParams(tab === 'overview' ? {} : { tab })}
      refreshToken={frameToken}
    >
      {activeTab === 'settings' ? (
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <AdminMetricsSettings
            moduleKey="inventory"
            moduleLabel="Gear & Uniforms"
            permission="inventory.manage"
            onSaved={() => setFrameToken((token) => token + 1)}
          />
        </div>
      ) : (
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          {/* Setup prompt — shown until rooms, storage, categories, and items all exist.
            Without it a new quartermaster meets the item form first and fills in
            three dropdowns that have nothing in them. */}
          {setupStatus && !setupStatus.is_complete && (
            <Link
              to="/inventory/admin/setup"
              className="mb-8 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 transition-colors hover:bg-blue-500/15 sm:p-4"
            >
              <div className="shrink-0 rounded-lg bg-blue-600 p-2">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-300">Finish inventory setup</h3>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  Still to set up:{' '}
                  {[
                    setupStatus.rooms === 0 ? 'rooms' : null,
                    setupStatus.storage_areas === 0 ? 'storage areas' : null,
                    setupStatus.categories === 0 ? 'categories' : null,
                    setupStatus.items === 0 ? 'items' : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  . The guide walks through them in order.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            </Link>
          )}

          {/* Prominent top cards */}
          <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ProminentCard
              to="/inventory/admin/items"
              icon={<Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
              title="Items"
              description="Browse, add, edit, and manage individual equipment"
              stat={summary?.total_items}
              statLabel="total"
              iconBg="bg-blue-500/10"
            />
            <ProminentCard
              to="/inventory/admin/members"
              icon={<Users className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
              title="Members"
              description="View and manage per-member equipment assignments"
              iconBg="bg-emerald-500/10"
            />
            <ProminentCard
              to="/inventory/checkouts"
              icon={<ArrowDownToLine className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
              title="Checkouts"
              description="Manage active and overdue equipment checkouts"
              stat={summary?.overdue_checkouts}
              statLabel="overdue"
              iconBg="bg-amber-500/10"
            />
          </div>

          {/* Inventory Management */}
          <div className="space-y-8">
            <Section title="Inventory Management">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NavCard
                  to="/inventory/admin/pool"
                  icon={<Layers className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
                  title="Pool Items"
                  description="Manage quantity-tracked items, issue to members"
                  iconBg="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                />
                <NavCard
                  to="/inventory/admin/categories"
                  icon={<Tag className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
                  title="Categories"
                  description="Organize items by type with tracking settings"
                  iconBg="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                />
                <NavCard
                  to="/inventory/admin/kits"
                  icon={<BoxSelect className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
                  title="Gear Kits"
                  description="Create and manage kit templates for multi-item issuance"
                  iconBg="bg-purple-500/10 text-purple-600 dark:text-purple-400"
                />
                <NavCard
                  to="/inventory/admin/variant-groups"
                  icon={<Ruler className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
                  title="Variant Groups"
                  description="Group pool item variants by size, style, and color"
                  iconBg="bg-purple-500/10 text-purple-600 dark:text-purple-400"
                />
                <NavCard
                  to="/inventory/admin/allowances"
                  icon={<SlidersHorizontal className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
                  title="Issuance Allowances"
                  description="Cap how many units per category a member can be issued"
                  iconBg="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                />
                <NavCard
                  to="/inventory/admin/impact-planner"
                  icon={<Target className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
                  title="Impact Planner"
                  description="Plan a new issue: who's impacted, sizes needed, who to contact"
                  iconBg="bg-purple-500/10 text-purple-600 dark:text-purple-400"
                />
                <NavCard
                  to="/inventory/admin/maintenance"
                  icon={<Wrench className="h-5 w-5 text-orange-600 dark:text-orange-400" />}
                  title="Maintenance"
                  description="Track inspections, repairs, and compliance"
                  badge={summary?.maintenance_due_count}
                  badgeColor="bg-orange-500/10 text-orange-700 dark:text-orange-400"
                  iconBg="bg-orange-500/10 text-orange-600 dark:text-orange-400"
                />
                <NavCard
                  to="/inventory/storage-areas"
                  icon={<MapPin className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
                  title="Storage Areas"
                  description="Manage storage locations within facilities"
                  iconBg="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                />
                <NavCard
                  to="/inventory/admin/vendors"
                  icon={<Building2 className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />}
                  title="Vendors"
                  description="Suppliers, their contacts, and what we buy from them"
                  iconBg="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                />
              </div>
            </Section>

            {/* Requests & Workflows */}
            <Section title="Requests & Workflows">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NavCard
                  to="/inventory/admin/requests"
                  icon={<ClipboardList className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />}
                  title="Gear Requests"
                  description="Review member requests for equipment"
                  badge={pendingRequests > 0 ? pendingRequests : undefined}
                  badgeColor="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                  iconBg="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                />
                <NavCard
                  to="/inventory/admin/returns"
                  icon={<CornerDownLeft className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />}
                  title="Return Requests"
                  description="Review and process member return requests"
                  badge={pendingReturns > 0 ? pendingReturns : undefined}
                  badgeColor="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                  iconBg="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                />
                <NavCard
                  to="/inventory/admin/charges"
                  icon={<DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />}
                  title="Charges"
                  description="Cost recovery for lost or damaged items"
                  iconBg="bg-green-500/10 text-green-600 dark:text-green-400"
                />
                <NavCard
                  to="/inventory/admin/write-offs"
                  icon={<FileX className="h-5 w-5 text-red-600 dark:text-red-400" />}
                  title="Write-Offs"
                  description="Process loss and damage write-off requests"
                  iconBg="bg-red-500/10 text-red-600 dark:text-red-400"
                />
                <NavCard
                  to="/inventory/admin/reorder"
                  icon={<Truck className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
                  title="Reorder Requests"
                  description="Track and manage supply reorder requests"
                  badge={lowStockAlerts.length > 0 ? lowStockAlerts.length : undefined}
                  badgeColor="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                  iconBg="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                />
                <NavCard
                  to="/scheduling/supply/expiring"
                  icon={<Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
                  title="Expiring on Apparatus"
                  description="Items expiring on the trucks and ready replacement stock"
                  iconBg="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                />
              </div>
            </Section>

            {/* Tools */}
            <Section title="Tools">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NavCard
                  to="/inventory/admin/setup"
                  icon={<Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
                  title="Setup Guide"
                  description="Rooms, storage, categories, and first items in order"
                  iconBg="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                />
                <NavCard
                  to="/inventory/import"
                  icon={<Upload className="text-theme-text-muted group-hover:text-theme-text-primary h-5 w-5" />}
                  title="Import / Export"
                  description="Bulk import from CSV or export inventory data"
                />
                <NavCard
                  to="/store/admin"
                  icon={<Store className="text-theme-text-muted group-hover:text-theme-text-primary h-5 w-5" />}
                  title="Department Store"
                  description="Order windows, catalog, and member order payments"
                />
              </div>
            </Section>
          </div>
        </div>
      )}

      {/* Quick-assign: pick a member, then assign items to them */}
      <MemberPickerModal
        isOpen={memberPickerOpen}
        onClose={() => setMemberPickerOpen(false)}
        title="Assign Items — Select a Member"
        onSelect={(member) => {
          setMemberPickerOpen(false);
          setAssignTarget(member);
        }}
      />
      <InventoryScanModal
        isOpen={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        mode="checkout"
        userId={assignTarget?.userId ?? ''}
        memberName={assignTarget?.memberName ?? ''}
        onComplete={() => {
          void loadSummary();
          setFrameToken((token) => token + 1);
        }}
      />
    </AdminHubFrame>
  );
};

export default InventoryAdminHub;
