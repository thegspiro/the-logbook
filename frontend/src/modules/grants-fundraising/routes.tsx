/**
 * Grants & Fundraising Module Routes
 *
 * This function returns route elements for the grants & fundraising module,
 * including grant management, fundraising campaigns, donor management,
 * and financial reporting.
 *
 * To disable this module, simply remove or comment out
 * the call to getGrantsFundraisingRoutes() in App.tsx.
 */

import React from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

// Dashboard
const GrantsDashboardPage = lazyWithRetry(() => import('./pages/GrantsDashboardPage'));

// Grant Applications
const GrantApplicationsPage = lazyWithRetry(() => import('./pages/GrantApplicationsPage'));
const GrantDetailPage = lazyWithRetry(() => import('./pages/GrantDetailPage'));
const GrantApplicationFormPage = lazyWithRetry(() => import('./pages/GrantApplicationFormPage'));

// Grant Opportunities
const GrantOpportunitiesPage = lazyWithRetry(() => import('./pages/GrantOpportunitiesPage'));

// Fundraising
const CampaignsPage = lazyWithRetry(() => import('./pages/CampaignsPage'));
const DonorsPage = lazyWithRetry(() => import('./pages/DonorsPage'));
const DonationsPage = lazyWithRetry(() => import('./pages/DonationsPage'));

// Reports
const GrantsReportsPage = lazyWithRetry(() => import('./pages/GrantsReportsPage'));

export const getGrantsFundraisingRoutes = () => {
  return (
    <React.Fragment>
      {/* Dashboard */}
      <Route
        path="/grants"
        element={
          <ProtectedRoute
            requiredModule="grants"
            moduleLabel="Grants & Fundraising"
            requiredPermission="fundraising.view"
          >
            <GrantsDashboardPage />
          </ProtectedRoute>
        }
      />

      {/* Grant Opportunities */}
      <Route
        path="/grants/opportunities"
        element={
          <ProtectedRoute
            requiredModule="grants"
            moduleLabel="Grants & Fundraising"
            requiredPermission="fundraising.view"
          >
            <GrantOpportunitiesPage />
          </ProtectedRoute>
        }
      />

      {/* Grant Applications */}
      <Route
        path="/grants/applications"
        element={
          <ProtectedRoute
            requiredModule="grants"
            moduleLabel="Grants & Fundraising"
            requiredPermission="fundraising.view"
          >
            <GrantApplicationsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/grants/applications/new"
        element={
          <ProtectedRoute
            requiredModule="grants"
            moduleLabel="Grants & Fundraising"
            requiredPermission="fundraising.manage"
          >
            <GrantApplicationFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/grants/applications/:id"
        element={
          <ProtectedRoute
            requiredModule="grants"
            moduleLabel="Grants & Fundraising"
            requiredPermission="fundraising.view"
          >
            <GrantDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/grants/applications/:id/edit"
        element={
          <ProtectedRoute
            requiredModule="grants"
            moduleLabel="Grants & Fundraising"
            requiredPermission="fundraising.manage"
          >
            <GrantApplicationFormPage />
          </ProtectedRoute>
        }
      />

      {/* Fundraising Campaigns */}
      <Route
        path="/grants/campaigns"
        element={
          <ProtectedRoute
            requiredModule="grants"
            moduleLabel="Grants & Fundraising"
            requiredPermission="fundraising.view"
          >
            <CampaignsPage />
          </ProtectedRoute>
        }
      />

      {/* Donors */}
      <Route
        path="/grants/donors"
        element={
          <ProtectedRoute
            requiredModule="grants"
            moduleLabel="Grants & Fundraising"
            requiredPermission="fundraising.view"
          >
            <DonorsPage />
          </ProtectedRoute>
        }
      />

      {/* Donations */}
      <Route
        path="/grants/donations"
        element={
          <ProtectedRoute
            requiredModule="grants"
            moduleLabel="Grants & Fundraising"
            requiredPermission="fundraising.view"
          >
            <DonationsPage />
          </ProtectedRoute>
        }
      />

      {/* Reports */}
      <Route
        path="/grants/reports"
        element={
          <ProtectedRoute
            requiredModule="grants"
            moduleLabel="Grants & Fundraising"
            requiredPermission="fundraising.view"
          >
            <GrantsReportsPage />
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
