/**
 * Events Module Routes
 *
 * This function returns route elements for the events module.
 * To disable the events module, simply remove or comment out
 * the call to this function in App.tsx.
 */

import React, { Suspense } from 'react';
import { Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

// Lazy-loaded pages
const EventsPage = lazyWithRetry(() =>
  import('../../pages/EventsPage').then((m) => ({ default: m.EventsPage })),
);
const EventDetailPage = lazyWithRetry(() =>
  import('../../pages/EventDetailPage').then((m) => ({
    default: m.EventDetailPage,
  })),
);
const EventQRCodePage = lazyWithRetry(() => import('../../pages/EventQRCodePage'));
const EventSelfCheckInPage = lazyWithRetry(
  () => import('../../pages/EventSelfCheckInPage'),
);
const EventsAdminHub = lazyWithRetry(() =>
  import('../../pages/EventsAdminHub').then((m) => ({ default: m.EventsAdminHub })),
);
const EventEditPage = lazyWithRetry(() =>
  import('../../pages/EventEditPage').then((m) => ({ default: m.EventEditPage })),
);
const EventCheckInMonitoringPage = lazyWithRetry(
  () => import('../../pages/EventCheckInMonitoringPage'),
);
const AnalyticsDashboardPage = lazyWithRetry(
  () => import('../../pages/AnalyticsDashboardPage'),
);

export const getEventsRoutes = () => {
  return (
    <React.Fragment>
      {/* Events Module - Member-facing */}
      <Route
        path="/events"
        element={
          <Suspense fallback={null}>
            <EventsPage />
          </Suspense>
        }
      />
      <Route
        path="/events/:id"
        element={
          <Suspense fallback={null}>
            <EventDetailPage />
          </Suspense>
        }
      />
      <Route
        path="/events/:id/qr-code"
        element={
          <Suspense fallback={null}>
            <EventQRCodePage />
          </Suspense>
        }
      />
      <Route
        path="/events/:id/check-in"
        element={
          <Suspense fallback={null}>
            <EventSelfCheckInPage />
          </Suspense>
        }
      />

      {/* Events Module - Admin Hub */}
      <Route
        path="/events/admin"
        element={
          <ProtectedRoute requiredPermission="events.manage">
            <Suspense fallback={null}>
              <EventsAdminHub />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Events Module - Per-event admin */}
      <Route
        path="/events/:id/edit"
        element={
          <ProtectedRoute requiredPermission="events.manage">
            <Suspense fallback={null}>
              <EventEditPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/events/:id/monitoring"
        element={
          <ProtectedRoute requiredPermission="events.manage">
            <Suspense fallback={null}>
              <EventCheckInMonitoringPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/events/:id/analytics"
        element={
          <ProtectedRoute requiredPermission="analytics.view">
            <Suspense fallback={null}>
              <AnalyticsDashboardPage />
            </Suspense>
          </ProtectedRoute>
        }
      />

      {/* Events Module - Legacy redirect */}
      <Route
        path="/events/new"
        element={<Navigate to="/events/admin?tab=create" replace />}
      />
    </React.Fragment>
  );
};

/**
 * Public routes for the events module.
 *
 * Currently empty — EventRequestStatusPage is already defined outside
 * the AppLayout in App.tsx.
 */
export const getEventsPublicRoutes = () => {
  return <React.Fragment />;
};
