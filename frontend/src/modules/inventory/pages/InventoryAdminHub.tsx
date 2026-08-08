/**
 * Inventory Admin Hub
 *
 * Central navigation page for inventory administration.
 * Links to separate pages for items, pool items, categories,
 * maintenance, members, checkouts, charges, and return requests.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router';
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
  AlertTriangle,
  Clock,
  BoxSelect,
  Ruler,
  UserPlus,
  SlidersHorizontal,
  Target,
  Store,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { MemberPickerModal } from '../../../components/MemberPickerModal';
import { InventoryScanModal } from '../../../components/InventoryScanModal';
import type { InventorySummary, LowStockAlert, ReturnRequestItem, EquipmentRequestItem } from '../types';
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
    className="card-secondary hover:bg-theme-surface-hover active:bg-theme-surface-hover group flex items-center gap-3 p-3 transition-colors sm:items-start sm:gap-4 sm:p-4"
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

export const InventoryAdminHub: React.FC = () => {
  const canManage = useAuthStore((s) => s.checkPermission)('inventory.manage');
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [loading, setLoading] = useState(true);

  // Quick-assign flow: pick a member, then assign items to them via the scan modal.
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ userId: string; memberName: string } | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryData, lowStock, returns, requests] = await Promise.all([
        inventoryService.getSummary(),
        inventoryService.getLowStockItems().catch(() => [] as LowStockAlert[]),
        inventoryService.getReturnRequests({ status: 'pending' }).catch(() => [] as ReturnRequestItem[]),
        inventoryService
          .getEquipmentRequests({ status: 'pending' })
          .catch(() => ({ requests: [] as EquipmentRequestItem[], total: 0 })),
      ]);
      setSummary(summaryData);
      setLowStockAlerts(lowStock);
      setPendingReturns(Array.isArray(returns) ? returns.length : 0);
      setPendingRequests(requests.total);
    } catch {
      // Non-critical — page still navigable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded-lg bg-blue-600 p-2">
              <Package className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-theme-text-primary truncate text-xl font-bold sm:text-2xl">
                Inventory Administration
              </h1>
              <p className="text-theme-text-muted text-sm">Manage equipment, assignments, and compliance</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
            {canManage && (
              <button
                onClick={() => setMemberPickerOpen(true)}
                className="btn-info btn-md flex items-center gap-2"
                title="Assign items to an individual member"
              >
                <UserPlus className="h-4 w-4" />
                <span className="hidden sm:inline">Assign to Member</span>
                <span className="sm:hidden">Assign</span>
              </button>
            )}
            <button
              onClick={() => {
                void loadSummary();
              }}
              className="btn-secondary btn-md"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Quick stats bar */}
        {summary && (
          <div className="text-theme-text-muted mb-8 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span>
              <span className="font-semibold text-green-600 dark:text-green-400">
                {summary.items_by_status['available'] ?? 0}
              </span>{' '}
              available
            </span>
            <span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">{summary.active_checkouts}</span> checked
              out
            </span>
            {summary.maintenance_due_count > 0 && (
              <span>
                <span className="font-semibold text-orange-600 dark:text-orange-400">
                  {summary.maintenance_due_count}
                </span>{' '}
                maintenance due
              </span>
            )}
          </div>
        )}

        {/* Low stock alerts */}
        {lowStockAlerts.length > 0 && (
          <div className="mb-8 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 sm:p-4">
            <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                <h3 className="text-sm font-semibold text-yellow-700 dark:text-yellow-300">
                  Low Stock Alerts ({lowStockAlerts.length})
                </h3>
              </div>
              <Link
                to="/inventory/admin/reorder"
                className="text-xs font-medium text-yellow-700 hover:underline dark:text-yellow-300"
              >
                Create Reorder Request &rarr;
              </Link>
            </div>
            <div className="space-y-2">
              {lowStockAlerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.category_id}
                  className="flex flex-col justify-between gap-1 rounded bg-yellow-500/5 px-3 py-2 sm:flex-row sm:items-center sm:gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-yellow-700 dark:text-yellow-300">
                        {alert.category_name}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium sm:hidden ${
                          alert.current_stock === 0
                            ? 'bg-red-500/20 text-red-700 dark:text-red-400'
                            : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                        }`}
                      >
                        {alert.current_stock === 0 ? 'Out' : 'Low'}
                      </span>
                    </div>
                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                      {alert.current_stock} in stock &middot; threshold: {alert.threshold}
                      {alert.items && alert.items.length > 0 && (
                        <span className="ml-1 hidden sm:inline">
                          ({alert.items.map((i) => `${i.name}: ${i.quantity}`).join(', ')})
                        </span>
                      )}
                    </p>
                  </div>
                  <span
                    className={`hidden shrink-0 rounded-full px-2 py-0.5 text-xs font-medium sm:inline ${
                      alert.current_stock === 0
                        ? 'bg-red-500/20 text-red-700 dark:text-red-400'
                        : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                    }`}
                  >
                    {alert.current_stock === 0 ? 'Out of stock' : 'Low'}
                  </span>
                </div>
              ))}
              {lowStockAlerts.length > 5 && (
                <p className="text-xs text-yellow-500">
                  ...and {lowStockAlerts.length - 5} more categories below threshold
                </p>
              )}
            </div>
          </div>
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
                title="Equipment Kits"
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
            </div>
          </Section>

          {/* Requests & Workflows */}
          <Section title="Requests & Workflows">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NavCard
                to="/inventory/admin/requests"
                icon={<ClipboardList className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />}
                title="Equipment Requests"
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
        }}
      />
    </div>
  );
};

export default InventoryAdminHub;
