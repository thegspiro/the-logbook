/**
 * Store Admin Page
 *
 * Quartermaster view of the department store, tabbed: overview, order windows,
 * catalog, orders, inbound payments, and settings.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  CalendarClock,
  Clock3,
  Loader2,
  Package,
  RefreshCw,
  Settings,
  ShoppingBag,
  Store,
  Wallet,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency, formatDateTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { StoreCatalogTab } from '../components/StoreCatalogTab';
import { StoreOrdersTab } from '../components/StoreOrdersTab';
import { StorePaymentsTab } from '../components/StorePaymentsTab';
import { StoreSettingsTab } from '../components/StoreSettingsTab';
import { StoreWindowsTab } from '../components/StoreWindowsTab';
import { storefrontService } from '../services/api';
import {
  ORDER_STATUS_BADGES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_BADGES,
  PAYMENT_STATUS_LABELS,
  StoreOrderStatus,
  StorePaymentStatus,
  type StoreDashboard,
} from '../types';

type TabId = 'overview' | 'windows' | 'catalog' | 'orders' | 'payments' | 'settings';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <Store className="h-4 w-4" /> },
  {
    id: 'windows',
    label: 'Order Windows',
    icon: <CalendarClock className="h-4 w-4" />,
  },
  { id: 'catalog', label: 'Catalog', icon: <Package className="h-4 w-4" /> },
  { id: 'orders', label: 'Orders', icon: <ShoppingBag className="h-4 w-4" /> },
  { id: 'payments', label: 'Payments', icon: <Wallet className="h-4 w-4" /> },
  {
    id: 'settings',
    label: 'Settings',
    icon: <Settings className="h-4 w-4" />,
  },
];

const activityDescription = (activity: StoreDashboard['recentActivity'][number]) => {
  if (activity.message) return activity.message;
  if (activity.toStatus) {
    return `Status changed to ${ORDER_STATUS_LABELS[activity.toStatus] ?? activity.toStatus}`;
  }
  const labels: Record<string, string> = {
    created: 'Order placed',
    payment_reported: 'Payment reported',
    payment_recorded: 'Payment recorded',
    refunded: 'Refund recorded',
    cancelled: 'Order cancelled',
    note: 'Internal note added',
    message: 'Order message added',
  };
  return labels[activity.eventType] ?? 'Order activity recorded';
};

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
  const tz = useTimezone();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [ordersPaymentFilter, setOrdersPaymentFilter] = useState('');
  const [ordersStatusFilter, setOrdersStatusFilter] = useState('');
  const [ordersDetailId, setOrdersDetailId] = useState('');
  const [ordersRecentHours, setOrdersRecentHours] = useState<number | undefined>();
  const [ordersOpenOnly, setOrdersOpenOnly] = useState(false);

  const openOrders = (
    filters: { payment?: string; status?: string; orderId?: string; recentHours?: number; openOnly?: boolean } = {}
  ) => {
    setOrdersStatusFilter(filters.status ?? '');
    setOrdersPaymentFilter(filters.payment ?? '');
    setOrdersDetailId(filters.orderId ?? '');
    setOrdersRecentHours(filters.recentHours);
    setOrdersOpenOnly(filters.openOnly ?? false);
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
          Back to Inventory Admin
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
                <StatTile
                  label="Open orders"
                  value={dashboard.openOrderCount}
                  onClick={() => openOrders({ openOnly: true })}
                />
                <StatTile
                  label="New (24 hours)"
                  value={dashboard.newOrderCount}
                  tone="text-blue-600 dark:text-blue-400"
                  onClick={() => openOrders({ recentHours: 24 })}
                />
                <StatTile
                  label="Awaiting payment"
                  value={dashboard.awaitingPaymentCount}
                  tone="text-amber-600 dark:text-amber-400"
                  onClick={() => openOrders({ payment: StorePaymentStatus.UNPAID })}
                />
                <StatTile
                  label="To verify"
                  value={dashboard.pendingVerificationCount}
                  tone="text-amber-600 dark:text-amber-400"
                  onClick={() => openOrders({ payment: StorePaymentStatus.PENDING_VERIFICATION })}
                />
                <StatTile
                  label="Ready for pickup"
                  value={dashboard.readyForPickupCount}
                  onClick={() => openOrders({ status: StoreOrderStatus.READY_FOR_PICKUP })}
                />
                <StatTile label="Outstanding balance" value={formatCurrency(Number(dashboard.outstandingBalance))} />
                <StatTile
                  label="Collected (open window)"
                  value={formatCurrency(Number(dashboard.collectedThisWindow))}
                  tone="text-green-600 dark:text-green-400"
                />
                <StatTile label="Active items" value={dashboard.activeProductCount} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="card-secondary p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-theme-text-primary font-semibold">Order workflow</h2>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => openOrders()}>
                      View all
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {Object.entries(ORDER_STATUS_LABELS).map(([status, label]) => (
                      <button
                        type="button"
                        key={status}
                        onClick={() => openOrders({ status })}
                        className="border-theme-surface-border hover:bg-theme-surface-hover rounded-lg border p-3 text-left"
                      >
                        <span className="text-theme-text-muted block text-xs">{label}</span>
                        <span className="text-theme-text-primary text-xl font-bold">
                          {dashboard.statusCounts[status] ?? 0}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="card-secondary p-4">
                  <h2 className="text-theme-text-primary mb-3 font-semibold">Current order window</h2>
                  {dashboard.activeWindow ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-theme-text-primary font-medium">{dashboard.activeWindow.name}</p>
                        <p className="text-theme-text-muted mt-1 text-sm">
                          {dashboard.activeWindow.description || 'This window is currently accepting orders.'}
                        </p>
                      </div>
                      <dl className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <dt className="text-theme-text-muted">Orders</dt>
                          <dd className="text-theme-text-primary font-semibold">{dashboard.activeWindow.orderCount}</dd>
                        </div>
                        <div>
                          <dt className="text-theme-text-muted">Sales</dt>
                          <dd className="text-theme-text-primary font-semibold">
                            {formatCurrency(Number(dashboard.activeWindow.totalSales))}
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-theme-text-muted">Closes</dt>
                          <dd className="text-theme-text-primary">
                            {dashboard.activeWindow.closesAt
                              ? formatDateTime(dashboard.activeWindow.closesAt, tz)
                              : 'No closing time set'}
                          </dd>
                        </div>
                      </dl>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setActiveTab('windows')}>
                        Manage window
                      </button>
                    </div>
                  ) : (
                    <div className="py-5 text-center">
                      <CalendarClock className="text-theme-text-muted mx-auto mb-2 h-7 w-7" />
                      <p className="text-theme-text-secondary text-sm">No order window is currently open.</p>
                      <button
                        type="button"
                        className="btn-secondary btn-sm mt-3"
                        onClick={() => setActiveTab('windows')}
                      >
                        Manage windows
                      </button>
                    </div>
                  )}
                </section>
              </div>

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-theme-text-primary text-sm font-semibold">Updates from the last 7 days</h2>
                    <p className="text-theme-text-muted text-xs">Most recent updates are shown first.</p>
                  </div>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => openOrders()}>
                    View orders
                  </button>
                </div>
                {dashboard.recentActivity.length > 0 ? (
                  <ol className="card-secondary divide-theme-surface-border divide-y">
                    {dashboard.recentActivity.map((activity) => (
                      <li key={activity.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="text-theme-text-primary text-sm font-medium">
                            {activity.orderNumber} — {activity.customerName}
                          </p>
                          <p className="text-theme-text-secondary text-sm">{activityDescription(activity)}</p>
                          <p className="text-theme-text-muted mt-1 text-xs">
                            {formatDateTime(activity.createdAt, tz)}
                            {activity.authorName ? ` · ${activity.authorName}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {activity.toStatus && (
                            <span className={`badge ${ORDER_STATUS_BADGES[activity.toStatus] ?? ''}`}>
                              {ORDER_STATUS_LABELS[activity.toStatus] ?? activity.toStatus}
                            </span>
                          )}
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => openOrders({ orderId: activity.orderId })}
                          >
                            Open order
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="card-secondary text-theme-text-muted py-8 text-center text-sm">
                    No order updates were recorded in the last 7 days.
                  </div>
                )}
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-theme-text-primary text-sm font-semibold">Recent orders</h2>
                  <button
                    type="button"
                    className="btn-ghost btn-sm flex items-center gap-1"
                    onClick={() => void loadDashboard()}
                    disabled={loading}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </button>
                </div>
                {dashboard.recentOrders.length > 0 ? (
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
                            {order.windowName ?? 'No order window'} · {formatDateTime(order.submittedAt, tz)} ·{' '}
                            {order.items.length} item(s) · {formatCurrency(Number(order.total))}
                          </p>
                          {order.events.length > 0 && (
                            <p className="text-theme-text-secondary mt-1 flex items-center gap-1 text-xs">
                              <Clock3 className="h-3 w-3 shrink-0" />
                              Latest update:{' '}
                              {order.events[order.events.length - 1]?.message ||
                                (order.events[order.events.length - 1]?.toStatus
                                  ? `Status changed to ${
                                      ORDER_STATUS_LABELS[order.events[order.events.length - 1]?.toStatus ?? ''] ??
                                      order.events[order.events.length - 1]?.toStatus
                                    }`
                                  : 'Order activity recorded')}
                              {order.events[order.events.length - 1]?.createdAt
                                ? ` · ${formatDateTime(order.events[order.events.length - 1]?.createdAt, tz)}`
                                : ''}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`badge ${ORDER_STATUS_BADGES[order.status] ?? ''}`}>
                            {ORDER_STATUS_LABELS[order.status] ?? order.status}
                          </span>
                          <span className={`badge ${PAYMENT_STATUS_BADGES[order.paymentStatus] ?? ''}`}>
                            {PAYMENT_STATUS_LABELS[order.paymentStatus] ?? order.paymentStatus}
                          </span>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => openOrders({ status: order.status })}
                          >
                            Manage
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="card-secondary text-theme-text-muted py-8 text-center text-sm">
                    New orders and their status updates will appear here.
                  </div>
                )}
              </section>
            </div>
          ) : null)}

        {activeTab === 'windows' && <StoreWindowsTab onChanged={() => void loadDashboard()} />}
        {activeTab === 'catalog' && <StoreCatalogTab />}
        {activeTab === 'orders' && (
          <StoreOrdersTab
            key={`${ordersStatusFilter}:${ordersPaymentFilter}:${ordersDetailId}:${ordersRecentHours ?? ''}:${ordersOpenOnly}`}
            onChanged={() => void loadDashboard()}
            initialStatusFilter={ordersStatusFilter}
            initialPaymentFilter={ordersPaymentFilter}
            initialOrderId={ordersDetailId}
            initialSubmittedWithinHours={ordersRecentHours}
            initialOpenOnly={ordersOpenOnly}
          />
        )}
        {activeTab === 'payments' && <StorePaymentsTab onChanged={() => void loadDashboard()} />}
        {activeTab === 'settings' && <StoreSettingsTab onChanged={() => void loadDashboard()} />}
      </div>
    </div>
  );
};

export default StoreAdminPage;
