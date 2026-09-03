/**
 * Store Admin Page
 *
 * The department store, run from inside Inventory Administration — it sells the
 * uniforms the inventory module tracks, so it lives at
 * /inventory/admin/store rather than beside it. Tabbed: overview, order
 * windows, catalog, orders, inbound payments, and settings.
 *
 * Renders through `AdminHubFrame` like every other administration page, which
 * is where the headline metrics and the "Needs attention" queue come from —
 * see the `storefront` entry in the backend's admin-hub MODULE_REGISTRY. The
 * page's own stat strip is gone with it: the frame says those numbers once,
 * and two panels restating one figure is the duplication the shared frame
 * exists to remove.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, CalendarClock, Clock3, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminHubFrame } from '../../../components/admin';
import type { AdminHubAction, AdminHubTab } from '../../../components/admin';
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
  type StoreDashboard,
} from '../types';

type TabId = 'overview' | 'windows' | 'catalog' | 'orders' | 'payments' | 'settings';

/** Settings is always last — the frame's rule, on every module. */
const TABS: AdminHubTab<TabId>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'windows', label: 'Order Windows' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'orders', label: 'Orders' },
  { id: 'payments', label: 'Payments' },
  { id: 'settings', label: 'Settings' },
];

const isTabId = (value: string | null): value is TabId => TABS.some((tab) => tab.id === value);

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

const StoreAdminPage: React.FC = () => {
  const tz = useTimezone();
  // Mirrored into `?tab=` like every other admin page, so the inventory hub
  // can link at a tab rather than dropping the reader on Overview to find it.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId = isTabId(tabParam) ? tabParam : 'overview';
  const setActiveTab = useCallback(
    (tab: TabId) => {
      const next = new URLSearchParams(searchParams);
      if (tab === 'overview') next.delete('tab');
      else next.set('tab', tab);
      setSearchParams(next);
    },
    [searchParams, setSearchParams]
  );

  // The overview's hand-off into a pre-filtered Orders tab. These stay local
  // rather than joining `?tab=` in the URL: they are one click's worth of
  // context, not a place, and putting five filters in a shareable link would
  // promise a view that a reload cannot rebuild.
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
  // Bumped when the page's own work changes something the frame summarises,
  // so the metrics row and queue above reflect it without a reload.
  const [frameToken, setFrameToken] = useState(0);

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

  /** Anything that changes an order, a window or a payment moves the frame too. */
  const handleChanged = useCallback(() => {
    void loadDashboard();
    setFrameToken((token) => token + 1);
  }, [loadDashboard]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const actions: AdminHubAction[] = [
    {
      key: 'refresh',
      label: 'Refresh store figures',
      icon: RefreshCw,
      busy: loading,
      onClick: handleChanged,
    },
  ];

  return (
    <AdminHubFrame<TabId>
      moduleKey="storefront"
      title="Department Store"
      description="Order windows, catalog, orders, and payment reconciliation"
      actions={actions}
      headerAside={
        <div className="flex items-center gap-2">
          {dashboard && !dashboard.isEnabled && (
            <span className="badge border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
              Store is offline
            </span>
          )}
          {/* The frame has no back-link prop, and this page sits one level
              inside Inventory Administration — so the way back rides here,
              beside the actions, as TrainingAdminPage does with its HelpLink. */}
          <Link
            to="/inventory/admin?view=storefront"
            className="text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Inventory
          </Link>
        </div>
      }
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      refreshToken={frameToken}
    >
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {activeTab === 'overview' &&
          (loading ? (
            <div className="flex justify-center py-12" role="status" aria-live="polite">
              <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
            </div>
          ) : dashboard ? (
            <div className="space-y-6">
              {/* Open orders, awaiting payment, outstanding, to verify, ready
                  for pickup and active items all left this strip: each is a
                  metric the frame above can show, and two panels restating one
                  number is the duplication the shared frame exists to remove.
                  What stays is the pair the metric registry has no entry for,
                  and both keep their click-through into a filtered Orders tab.
                  The queues that lost a tile are still one click away — from
                  the workflow grid below, the attention queue above, or the
                  Orders tab's own filters. */}
              <div className="grid grid-cols-2 gap-3">
                <StatTile
                  label="New (24 hours)"
                  value={dashboard.newOrderCount}
                  tone="text-blue-600 dark:text-blue-400"
                  onClick={() => openOrders({ recentHours: 24 })}
                />
                <StatTile
                  label="Collected (open window)"
                  value={formatCurrency(Number(dashboard.collectedThisWindow))}
                  tone="text-green-600 dark:text-green-400"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="card-secondary p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-theme-text-primary font-semibold">Order workflow</h2>
                    <div className="flex items-center gap-2">
                      {/* The Orders tab can clear this filter but has no
                          control to set it, so the entry point has to live
                          somewhere — here, beside the status buttons it reads
                          with, rather than on a tile restating a headline
                          metric. */}
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => openOrders({ openOnly: true })}
                      >
                        Open only
                      </button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => openOrders()}>
                        View all
                      </button>
                    </div>
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

        {activeTab === 'windows' && <StoreWindowsTab onChanged={handleChanged} />}
        {activeTab === 'catalog' && <StoreCatalogTab />}
        {activeTab === 'orders' && (
          <StoreOrdersTab
            key={`${ordersStatusFilter}:${ordersPaymentFilter}:${ordersDetailId}:${ordersRecentHours ?? ''}:${ordersOpenOnly}`}
            onChanged={handleChanged}
            initialStatusFilter={ordersStatusFilter}
            initialPaymentFilter={ordersPaymentFilter}
            initialOrderId={ordersDetailId}
            initialSubmittedWithinHours={ordersRecentHours}
            initialOpenOnly={ordersOpenOnly}
          />
        )}
        {activeTab === 'payments' && <StorePaymentsTab onChanged={handleChanged} />}
        {activeTab === 'settings' && <StoreSettingsTab onChanged={handleChanged} />}
      </div>
    </AdminHubFrame>
  );
};

export default StoreAdminPage;
