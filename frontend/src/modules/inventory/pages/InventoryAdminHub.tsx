/**
 * Inventory Admin Hub
 *
 * Central navigation page for inventory administration.
 * Links to separate pages for items, pool items, categories,
 * maintenance, members, checkouts, charges, and return requests.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
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
  BoxSelect,
  Ruler,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventorySummary, LowStockAlert, ReturnRequestItem } from '../types';
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
    className="card-secondary p-3 sm:p-4 hover:bg-theme-surface-hover active:bg-theme-surface-hover transition-colors group flex items-center sm:items-start gap-3 sm:gap-4"
  >
    <div className={`shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center transition-colors ${iconBg ?? 'bg-theme-surface-secondary text-theme-text-muted group-hover:text-theme-text-primary'}`}>
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-theme-text-primary group-hover:text-theme-text-primary">{title}</h3>
        {badge != null && badge > 0 && (
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${badgeColor ?? 'bg-blue-500/10 text-blue-700 dark:text-blue-400'}`}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-theme-text-muted mt-0.5 hidden sm:block">{description}</p>
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
    className="card-secondary p-4 sm:p-5 hover:bg-theme-surface-hover active:bg-theme-surface-hover transition-all group flex flex-col gap-3"
  >
    <div className="flex items-center justify-between">
      <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center ${iconBg}`}>
        {icon}
      </div>
      {stat != null && (
        <div className="text-right">
          <p className="text-xl sm:text-2xl font-bold text-theme-text-primary">{stat}</p>
          {statLabel && <p className="text-[11px] text-theme-text-muted">{statLabel}</p>}
        </div>
      )}
    </div>
    <div>
      <h3 className="text-sm font-semibold text-theme-text-primary">{title}</h3>
      <p className="text-xs text-theme-text-muted mt-0.5">{description}</p>
    </div>
  </Link>
);

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <div>
    <h2 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-3">{title}</h2>
    {children}
  </div>
);

export const InventoryAdminHub: React.FC = () => {
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryData, lowStock, returns, requests] = await Promise.all([
        inventoryService.getSummary(),
        inventoryService.getLowStockItems().catch(() => [] as LowStockAlert[]),
        inventoryService.getReturnRequests({ status: 'pending' }).catch(() => [] as ReturnRequestItem[]),
        inventoryService.getEquipmentRequests({ status: 'pending' }).catch(() => ({ requests: [] as unknown[], total: 0 })),
      ]);
      setSummary(summaryData);
      setLowStockAlerts(lowStock);
      setPendingReturns(Array.isArray(returns) ? returns.length : 0);
      const reqResult = requests as { requests: unknown[]; total: number };
      setPendingRequests(reqResult.total ?? 0);
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3 min-w-0">
            <div className="bg-blue-600 rounded-lg p-2 shrink-0">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-theme-text-primary truncate">Inventory Administration</h1>
              <p className="text-sm text-theme-text-muted">Manage equipment, assignments, and compliance</p>
            </div>
          </div>
          <button
            onClick={() => { void loadSummary(); }}
            className="btn-secondary btn-md shrink-0 self-start sm:self-auto"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Quick stats bar */}
        {summary && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-8 text-sm text-theme-text-muted">
            <span><span className="font-semibold text-green-600 dark:text-green-400">{summary.items_by_status['available'] ?? 0}</span> available</span>
            <span><span className="font-semibold text-blue-600 dark:text-blue-400">{summary.active_checkouts}</span> checked out</span>
            {summary.maintenance_due_count > 0 && (
              <span><span className="font-semibold text-orange-600 dark:text-orange-400">{summary.maintenance_due_count}</span> maintenance due</span>
            )}
          </div>
        )}

        {/* Low stock alerts */}
        {lowStockAlerts.length > 0 && (
          <div className="mb-8 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
                <h3 className="text-sm font-semibold text-yellow-700 dark:text-yellow-300">
                  Low Stock Alerts ({lowStockAlerts.length})
                </h3>
              </div>
              <Link
                to="/inventory/admin/reorder"
                className="text-xs font-medium text-yellow-700 dark:text-yellow-300 hover:underline"
              >
                Create Reorder Request &rarr;
              </Link>
            </div>
            <div className="space-y-2">
              {lowStockAlerts.slice(0, 5).map((alert) => (
                <div key={alert.category_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 bg-yellow-500/5 rounded px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300 truncate">{alert.category_name}</p>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full shrink-0 sm:hidden ${
                        alert.current_stock === 0
                          ? 'bg-red-500/20 text-red-700 dark:text-red-400'
                          : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                      }`}>
                        {alert.current_stock === 0 ? 'Out' : 'Low'}
                      </span>
                    </div>
                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                      {alert.current_stock} in stock &middot; threshold: {alert.threshold}
                      {alert.items && alert.items.length > 0 && (
                        <span className="hidden sm:inline ml-1">
                          ({alert.items.map((i) => `${i.name}: ${i.quantity}`).join(', ')})
                        </span>
                      )}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full shrink-0 hidden sm:inline ${
                    alert.current_stock === 0
                      ? 'bg-red-500/20 text-red-700 dark:text-red-400'
                      : 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400'
                  }`}>
                    {alert.current_stock === 0 ? 'Out of stock' : 'Low'}
                  </span>
                </div>
              ))}
              {lowStockAlerts.length > 5 && (
                <p className="text-xs text-yellow-500">...and {lowStockAlerts.length - 5} more categories below threshold</p>
              )}
            </div>
          </div>
        )}

        {/* Prominent top cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          <ProminentCard
            to="/inventory/admin/items"
            icon={<Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
            title="Items"
            description="Browse, add, edit, and manage individual equipment"
            stat={summary?.total_items}
            statLabel="total"
            iconBg="bg-blue-500/10"
          />
          <ProminentCard
            to="/inventory/admin/members"
            icon={<Users className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
            title="Members"
            description="View and manage per-member equipment assignments"
            iconBg="bg-emerald-500/10"
          />
          <ProminentCard
            to="/inventory/checkouts"
            icon={<ArrowDownToLine className="w-5 h-5 text-amber-600 dark:text-amber-400" />}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NavCard
                to="/inventory/admin/pool"
                icon={<Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                title="Pool Items"
                description="Manage quantity-tracked items, issue to members"
                iconBg="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              />
              <NavCard
                to="/inventory/admin/categories"
                icon={<Tag className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                title="Categories"
                description="Organize items by type with tracking settings"
                iconBg="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              />
              <NavCard
                to="/inventory/admin/kits"
                icon={<BoxSelect className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
                title="Equipment Kits"
                description="Create and manage kit templates for multi-item issuance"
                iconBg="bg-purple-500/10 text-purple-600 dark:text-purple-400"
              />
              <NavCard
                to="/inventory/admin/variant-groups"
                icon={<Ruler className="w-5 h-5 text-purple-600 dark:text-purple-400" />}
                title="Variant Groups"
                description="Group pool item variants by size, style, and color"
                iconBg="bg-purple-500/10 text-purple-600 dark:text-purple-400"
              />
              <NavCard
                to="/inventory/admin/maintenance"
                icon={<Wrench className="w-5 h-5 text-orange-600 dark:text-orange-400" />}
                title="Maintenance"
                description="Track inspections, repairs, and compliance"
                badge={summary?.maintenance_due_count}
                badgeColor="bg-orange-500/10 text-orange-700 dark:text-orange-400"
                iconBg="bg-orange-500/10 text-orange-600 dark:text-orange-400"
              />
              <NavCard
                to="/inventory/storage-areas"
                icon={<MapPin className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />}
                title="Storage Areas"
                description="Manage storage locations within facilities"
                iconBg="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
              />
            </div>
          </Section>

          {/* Requests & Workflows */}
          <Section title="Requests & Workflows">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NavCard
                to="/inventory/admin/requests"
                icon={<ClipboardList className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />}
                title="Equipment Requests"
                description="Review member requests for equipment"
                badge={pendingRequests > 0 ? pendingRequests : undefined}
                badgeColor="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                iconBg="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
              />
              <NavCard
                to="/inventory/admin/returns"
                icon={<CornerDownLeft className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />}
                title="Return Requests"
                description="Review and process member return requests"
                badge={pendingReturns > 0 ? pendingReturns : undefined}
                badgeColor="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                iconBg="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
              />
              <NavCard
                to="/inventory/admin/charges"
                icon={<DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />}
                title="Charges"
                description="Cost recovery for lost or damaged items"
                iconBg="bg-green-500/10 text-green-600 dark:text-green-400"
              />
              <NavCard
                to="/inventory/admin/write-offs"
                icon={<FileX className="w-5 h-5 text-red-600 dark:text-red-400" />}
                title="Write-Offs"
                description="Process loss and damage write-off requests"
                iconBg="bg-red-500/10 text-red-600 dark:text-red-400"
              />
              <NavCard
                to="/inventory/admin/reorder"
                icon={<Truck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />}
                title="Reorder Requests"
                description="Track and manage supply reorder requests"
                badge={lowStockAlerts.length > 0 ? lowStockAlerts.length : undefined}
                badgeColor="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                iconBg="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
              />
            </div>
          </Section>

          {/* Tools */}
          <Section title="Tools">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <NavCard
                to="/inventory/import"
                icon={<Upload className="w-5 h-5 text-theme-text-muted group-hover:text-theme-text-primary" />}
                title="Import / Export"
                description="Bulk import from CSV or export inventory data"
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};

export default InventoryAdminHub;
