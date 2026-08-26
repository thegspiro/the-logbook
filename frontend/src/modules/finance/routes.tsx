/**
 * Finance Module Routes
 *
 * Route definitions for the finance module including budgets,
 * purchase requests, expense reports, check requests, dues,
 * approval chains, and QuickBooks export.
 */

import React from 'react';
import { Route } from 'react-router';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

// Dashboard
const FinanceDashboardPage = lazyWithRetry(() => import('./pages/FinanceDashboardPage'));

// Budgets
const BudgetsPage = lazyWithRetry(() => import('./pages/BudgetsPage'));
const BudgetDetailPage = lazyWithRetry(() => import('./pages/BudgetDetailPage'));

// Settings
const FiscalYearSettingsPage = lazyWithRetry(() => import('./pages/FiscalYearSettingsPage'));
const ApprovalChainsSettingsPage = lazyWithRetry(() => import('./pages/ApprovalChainsSettingsPage'));

// Purchase Requests
const PurchaseRequestsPage = lazyWithRetry(() => import('./pages/PurchaseRequestsPage'));
const PurchaseRequestDetailPage = lazyWithRetry(() => import('./pages/PurchaseRequestDetailPage'));
const PurchaseRequestFormPage = lazyWithRetry(() => import('./pages/PurchaseRequestFormPage'));

// Expense Reports
const ExpenseReportsPage = lazyWithRetry(() => import('./pages/ExpenseReportsPage'));
const ExpenseReportFormPage = lazyWithRetry(() => import('./pages/ExpenseReportFormPage'));
const ExpenseReportDetailPage = lazyWithRetry(() => import('./pages/ExpenseReportDetailPage'));

// Check Requests
const CheckRequestsPage = lazyWithRetry(() => import('./pages/CheckRequestsPage'));
const CheckRequestDetailPage = lazyWithRetry(() => import('./pages/CheckRequestDetailPage'));
const CheckRequestFormPage = lazyWithRetry(() => import('./pages/CheckRequestFormPage'));

// Dues
const DuesManagementPage = lazyWithRetry(() => import('./pages/DuesManagementPage'));

export const getFinanceRoutes = () => {
  return (
    <React.Fragment>
      {/* Dashboard */}
      <Route
        path="/finance"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <FinanceDashboardPage />
          </ProtectedRoute>
        }
      />

      {/* Budgets */}
      <Route
        path="/finance/budgets"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <BudgetsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/budgets/:id"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <BudgetDetailPage />
          </ProtectedRoute>
        }
      />

      {/* Settings (finance.manage required) */}
      <Route
        path="/finance/settings"
        element={
          <ProtectedRoute requiredPermission="finance.manage" requiredModule="finance" moduleLabel="Finance">
            <FiscalYearSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/settings/approval-chains"
        element={
          <ProtectedRoute
            requiredPermission="finance.configure_approvals"
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <ApprovalChainsSettingsPage />
          </ProtectedRoute>
        }
      />

      {/* Purchase Requests */}
      <Route
        path="/finance/purchase-requests"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <PurchaseRequestsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/purchase-requests/new"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <PurchaseRequestFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/purchase-requests/:id"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <PurchaseRequestDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/purchase-requests/:id/edit"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <PurchaseRequestFormPage />
          </ProtectedRoute>
        }
      />

      {/* Expense Reports */}
      <Route
        path="/finance/expenses"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <ExpenseReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/expenses/new"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <ExpenseReportFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/expenses/:id"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <ExpenseReportDetailPage />
          </ProtectedRoute>
        }
      />

      {/* Check Requests */}
      <Route
        path="/finance/check-requests"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <CheckRequestsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/check-requests/new"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <CheckRequestFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/check-requests/:id"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <CheckRequestDetailPage />
          </ProtectedRoute>
        }
      />

      {/* Dues */}
      <Route
        path="/finance/dues"
        element={
          <ProtectedRoute requiredPermission="finance.view" requiredModule="finance" moduleLabel="Finance">
            <DuesManagementPage />
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
