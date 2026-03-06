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
  AlertTriangle,
  ClipboardList,
  DollarSign,
  CornerDownLeft,
  Upload,
  MapPin,
  Barcode,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { InventorySummary, LowStockAlert } from '../types';
interface NavCardProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: number | undefined;
  badgeColor?: string | undefined;
}

const NavCard: React.FC<NavCardProps> = ({ to, icon, title, description, badge, badgeColor }) => (
  <Link
    to={to}
    className="card-secondary p-4 hover:bg-theme-surface-hover transition-colors group flex items-start gap-4"
  >
    <div className="shrink-0 w-10 h-10 rounded-lg bg-theme-surface-secondary flex items-center justify-center text-theme-text-muted group-hover:text-theme-text-primary transition-colors">
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
      <p className="text-xs text-theme-text-muted mt-0.5">{description}</p>
    </div>
  </Link>
);

export const InventoryAdminHub: React.FC = () => {
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryData, lowStock] = await Promise.all([
        inventoryService.getSummary(),
        inventoryService.getLowStockItems().catch(() => [] as LowStockAlert[]),
      ]);
      setSummary(summaryData);
      setLowStockAlerts(lowStock);
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
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 rounded-lg p-2">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-theme-text-primary">Inventory Administration</h1>
              <p className="text-sm text-theme-text-muted">Manage equipment, assignments, and compliance</p>
            </div>
          </div>
          <button
            onClick={() => { void loadSummary(); }}
            className="flex items-center gap-2 px-3 py-2 border border-theme-surface-border rounded-lg text-sm text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Summary stats */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            <div className="card-secondary p-3 text-center">
              <p className="text-2xl font-bold text-theme-text-primary">{summary.total_items}</p>
              <p className="text-xs text-theme-text-muted">Total Items</p>
            </div>
            <div className="card-secondary p-3 text-center">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{summary.items_by_status['available'] ?? 0}</p>
              <p className="text-xs text-theme-text-muted">Available</p>
            </div>
            <div className="card-secondary p-3 text-center">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{summary.active_checkouts}</p>
              <p className="text-xs text-theme-text-muted">Checked Out</p>
            </div>
            <div className="card-secondary p-3 text-center">
              <p className={`text-2xl font-bold ${summary.overdue_checkouts > 0 ? 'text-red-600 dark:text-red-400' : 'text-theme-text-primary'}`}>
                {summary.overdue_checkouts}
              </p>
              <p className="text-xs text-theme-text-muted">Overdue</p>
            </div>
          </div>
        )}

        {/* Low stock alerts */}
        {lowStockAlerts.length > 0 && (
          <div className="mb-8 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
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
                <div key={alert.category_id} className="flex items-center justify-between bg-yellow-500/5 rounded px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-yellow-700 dark:text-yellow-300">{alert.category_name}</p>
                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                      {alert.current_stock} in stock &middot; threshold: {alert.threshold}
                      {alert.items && alert.items.length > 0 && (
                        <span className="ml-1">
                          ({alert.items.map((i) => `${i.name}: ${i.quantity}`).join(', ')})
                        </span>
                      )}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
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

        {/* Navigation grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NavCard
            to="/inventory/admin/items"
            icon={<Package className="w-5 h-5" />}
            title="Items"
            description="Browse, add, edit, and manage individual equipment"
            badge={summary?.total_items}
          />
          <NavCard
            to="/inventory/admin/pool"
            icon={<Layers className="w-5 h-5" />}
            title="Pool Items"
            description="Manage quantity-tracked items, issue to members"
          />
          <NavCard
            to="/inventory/admin/categories"
            icon={<Tag className="w-5 h-5" />}
            title="Categories"
            description="Organize items by type with tracking settings"
          />
          <NavCard
            to="/inventory/admin/members"
            icon={<Users className="w-5 h-5" />}
            title="Members"
            description="View and manage per-member equipment assignments"
          />
          <NavCard
            to="/inventory/admin/maintenance"
            icon={<Wrench className="w-5 h-5" />}
            title="Maintenance"
            description="Track inspections, repairs, and compliance"
            badge={summary?.maintenance_due_count}
            badgeColor="bg-orange-500/10 text-orange-700 dark:text-orange-400"
          />
          <NavCard
            to="/inventory/checkouts"
            icon={<ArrowDownToLine className="w-5 h-5" />}
            title="Checkouts"
            description="Manage active and overdue equipment checkouts"
            badge={summary?.overdue_checkouts}
            badgeColor="bg-red-500/10 text-red-700 dark:text-red-400"
          />
          <NavCard
            to="/inventory/admin/charges"
            icon={<DollarSign className="w-5 h-5" />}
            title="Charges"
            description="Cost recovery for lost or damaged items"
          />
          <NavCard
            to="/inventory/admin/returns"
            icon={<CornerDownLeft className="w-5 h-5" />}
            title="Return Requests"
            description="Review and process member return requests"
          />
          <NavCard
            to="/inventory/storage-areas"
            icon={<MapPin className="w-5 h-5" />}
            title="Storage Areas"
            description="Manage storage locations within facilities"
          />
          <NavCard
            to="/inventory/import"
            icon={<Upload className="w-5 h-5" />}
            title="Import / Export"
            description="Bulk import from CSV or export inventory data"
          />
          <NavCard
            to="/inventory/admin/requests"
            icon={<ClipboardList className="w-5 h-5" />}
            title="Equipment Requests"
            description="Review member requests for equipment"
          />
          <NavCard
            to="/inventory/admin/write-offs"
            icon={<Barcode className="w-5 h-5" />}
            title="Write-Offs"
            description="Process loss and damage write-off requests"
          />
          <NavCard
            to="/inventory/admin/reorder"
            icon={<AlertTriangle className="w-5 h-5" />}
            title="Reorder Requests"
            description="Track and manage supply reorder requests"
            badge={lowStockAlerts.length > 0 ? lowStockAlerts.length : undefined}
            badgeColor="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
          />
        </div>
      </div>
    </div>
  );
};

export default InventoryAdminHub;
