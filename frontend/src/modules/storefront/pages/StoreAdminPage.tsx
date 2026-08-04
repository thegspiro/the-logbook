/**
 * Store Admin Page
 *
 * Quartermaster view of the department store, tabbed: overview, order windows,
 * catalog, orders, and settings.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, CalendarClock, Loader2, Package, Settings, ShoppingBag, Store } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/dateFormatting';
import { StoreCatalogTab } from '../components/StoreCatalogTab';
import { StoreOrdersTab } from '../components/StoreOrdersTab';
import { StoreSettingsTab } from '../components/StoreSettingsTab';
import { StoreWindowsTab } from '../components/StoreWindowsTab';
import { storefrontService } from '../services/api';
import { StorePaymentStatus, type StoreDashboard } from '../types';

type TabId = 'overview' | 'windows' | 'catalog' | 'orders' | 'settings';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <Store className="h-4 w-4" /> },
  {
    id: 'windows',
    label: 'Order Windows',
    icon: <CalendarClock className="h-4 w-4" />,
  },
  { id: 'catalog', label: 'Catalog', icon: <Package className="h-4 w-4" /> },
  { id: 'orders', label: 'Orders', icon: <ShoppingBag className="h-4 w-4" /> },
  {
    id: 'settings',
    label: 'Settings',
    icon: <Settings className="h-4 w-4" />,
  },
];

const StatTile: React.FC<{
  label: string;
  value: string | number;
  tone?: string;
  onClick?: (() => void) | undefined;
}> = ({ label, value, tone, onClick }) => {
  const body = (
    <>
      <p className="text-theme-text-muted text-xs tracking-wide uppercase">{label}</p>
      <p className={`text-2xl font-bold ${tone ?? 'text-theme-text-primary'} mt-1`}>{value}</p>
    </>
  );
  // Counters that name a queue of work are the natural way into that queue.
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="stat-card hover:bg-theme-surface-hover text-left transition-colors"
    >
      {body}
    </button>
  ) : (
    <div className="stat-card">{body}</div>
  );
};

const StoreAdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [ordersPaymentFilter, setOrdersPaymentFilter] = useState('');

  const openOrders = (paymentFilter: string) => {
    setOrdersPaymentFilter(paymentFilter);
    setActiveTab('orders');
  };
  const [dashboard, setDashboard] = useState<StoreDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      setDashboard(await storefrontService.getDashboard());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load the store dashboard'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          to="/inventory/admin"
          className="text-theme-text-muted hover:text-theme-text-secondary mb-6 flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Logistics Admin
        </Link>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-600 p-2">
              <Store className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl font-bold">Department Store</h1>
              <p className="text-theme-text-muted text-sm">
                Order windows, catalog, orders, and payment reconciliation
              </p>
            </div>
          </div>
          {dashboard && !dashboard.isEnabled && (
            <span className="badge border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              Store is offline
            </span>
          )}
        </div>

        <div className="tab-scroll mb-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-theme-text-primary border-blue-600'
                  : 'text-theme-text-muted hover:text-theme-text-secondary border-transparent'
              }`}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' &&
          (loading ? (
            <div className="flex justify-center py-12" role="status" aria-live="polite">
              <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
            </div>
          ) : dashboard ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Open orders" value={dashboard.openOrderCount} />
                <StatTile
                  label="Awaiting payment"
                  value={dashboard.awaitingPaymentCount}
                  tone="text-amber-600 dark:text-amber-400"
                  onClick={() => openOrders(StorePaymentStatus.UNPAID)}
                />
                <StatTile
                  label="To verify"
                  value={dashboard.pendingVerificationCount}
                  tone="text-amber-600 dark:text-amber-400"
                  onClick={() => openOrders(StorePaymentStatus.PENDING_VERIFICATION)}
                />
                <StatTile label="Ready for pickup" value={dashboard.readyForPickupCount} />
                <StatTile label="Outstanding balance" value={formatCurrency(Number(dashboard.outstandingBalance))} />
                <StatTile
                  label="Collected (open window)"
                  value={formatCurrency(Number(dashboard.collectedThisWindow))}
                  tone="text-green-600 dark:text-green-400"
                />
                <StatTile label="Active items" value={dashboard.activeProductCount} />
                <StatTile label="Open window" value={dashboard.activeWindow?.name ?? 'None'} />
              </div>

              {dashboard.recentOrders.length > 0 && (
                <section>
                  <h2 className="text-theme-text-primary mb-3 text-sm font-semibold">Recent orders</h2>
                  <ul className="space-y-2">
                    {dashboard.recentOrders.map((order) => (
                      <li
                        key={order.id}
                        className="card-secondary flex flex-wrap items-center justify-between gap-2 p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-theme-text-primary text-sm">
                            {order.orderNumber} — {order.customerName}
                          </p>
                          <p className="text-theme-text-muted text-xs">
                            {order.items.length} item(s) · {formatCurrency(Number(order.total))}
                          </p>
                        </div>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setActiveTab('orders')}>
                          Manage
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          ) : null)}

        {activeTab === 'windows' && <StoreWindowsTab onChanged={() => void loadDashboard()} />}
        {activeTab === 'catalog' && <StoreCatalogTab />}
        {activeTab === 'orders' && (
          <StoreOrdersTab
            key={ordersPaymentFilter}
            onChanged={() => void loadDashboard()}
            initialPaymentFilter={ordersPaymentFilter}
          />
        )}
        {activeTab === 'settings' && <StoreSettingsTab onChanged={() => void loadDashboard()} />}
      </div>
    </div>
  );
};

export default StoreAdminPage;
