/**
 * Finance Module Routes
 *
 * Route definitions for the finance module including budgets,
 * purchase requests, expense reports, check requests, dues,
 * approval chains, and QuickBooks export.
 */

import React from 'react';
import { Route } from 'react-router-dom';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

// Dashboard
const FinanceDashboardPage = lazyWithRetry(
  () => import('./pages/FinanceDashboardPage'),
);

// Budgets
const BudgetsPage = lazyWithRetry(() => import('./pages/BudgetsPage'));
const BudgetDetailPage = lazyWithRetry(
  () => import('./pages/BudgetDetailPage'),
);

// Settings
const FiscalYearSettingsPage = lazyWithRetry(
  () => import('./pages/FiscalYearSettingsPage'),
);
const ApprovalChainsSettingsPage = lazyWithRetry(
  () => import('./pages/ApprovalChainsSettingsPage'),
);

// Purchase Requests
const PurchaseRequestsPage = lazyWithRetry(
  () => import('./pages/PurchaseRequestsPage'),
);
const PurchaseRequestDetailPage = lazyWithRetry(
  () => import('./pages/PurchaseRequestDetailPage'),
);
const PurchaseRequestFormPage = lazyWithRetry(
  () => import('./pages/PurchaseRequestFormPage'),
);

// Expense Reports
const ExpenseReportsPage = lazyWithRetry(
  () => import('./pages/ExpenseReportsPage'),
);
const ExpenseReportFormPage = lazyWithRetry(
  () => import('./pages/ExpenseReportFormPage'),
);

// Check Requests
const CheckRequestsPage = lazyWithRetry(
  () => import('./pages/CheckRequestsPage'),
);

// Dues
const DuesManagementPage = lazyWithRetry(
  () => import('./pages/DuesManagementPage'),
);

export const getFinanceRoutes = () => {
  return (
    <React.Fragment>
      {/* Dashboard */}
      <Route path="/finance" element={<FinanceDashboardPage />} />

      {/* Budgets */}
      <Route path="/finance/budgets" element={<BudgetsPage />} />
      <Route path="/finance/budgets/:id" element={<BudgetDetailPage />} />

      {/* Settings (finance.manage required) */}
      <Route
        path="/finance/settings"
        element={
          <ProtectedRoute requiredPermission="finance.manage">
            <FiscalYearSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/settings/approval-chains"
        element={
          <ProtectedRoute requiredPermission="finance.configure_approvals">
            <ApprovalChainsSettingsPage />
          </ProtectedRoute>
        }
      />

      {/* Purchase Requests */}
      <Route
        path="/finance/purchase-requests"
        element={<PurchaseRequestsPage />}
      />
      <Route
        path="/finance/purchase-requests/new"
        element={<PurchaseRequestFormPage />}
      />
      <Route
        path="/finance/purchase-requests/:id"
        element={<PurchaseRequestDetailPage />}
      />
      <Route
        path="/finance/purchase-requests/:id/edit"
        element={<PurchaseRequestFormPage />}
      />

      {/* Expense Reports */}
      <Route
        path="/finance/expenses"
        element={<ExpenseReportsPage />}
      />
      <Route
        path="/finance/expenses/new"
        element={<ExpenseReportFormPage />}
      />

      {/* Check Requests */}
      <Route
        path="/finance/check-requests"
        element={<CheckRequestsPage />}
      />

      {/* Dues */}
      <Route
        path="/finance/dues"
        element={
          <ProtectedRoute requiredPermission="finance.view">
            <DuesManagementPage />
          </ProtectedRoute>
        }
      />
    </React.Fragment>
  );
};
