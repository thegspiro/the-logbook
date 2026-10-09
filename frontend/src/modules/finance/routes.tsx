/**
 * Finance Module Routes
 *
 * Route definitions for the finance module including budgets,
 * purchase requests, expense reports, check requests, dues,
 * approvals, approval chains, and QuickBooks export.
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
const MyBudgetsPage = lazyWithRetry(() => import('./pages/MyBudgetsPage'));
const BudgetRequestsPage = lazyWithRetry(() => import('./pages/BudgetRequestsPage'));
const BudgetRequestReviewPage = lazyWithRetry(() => import('./pages/BudgetRequestReviewPage'));

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

// Approvals
const ApprovalsPage = lazyWithRetry(() => import('./pages/ApprovalsPage'));

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
      {/*
        A budget line opens to finance.view and to the member who owns it
        (holds its owner position, or its category's). Ownership is not a
        permission, so the route asks only for a session and the API decides:
        anyone else gets a 404, which the page shows as "Budget not found".
        My Budgets lists the caller's own lines and is empty for everyone else.
      */}
      <Route
        path="/finance/budgets/:id"
        element={
          <ProtectedRoute requiredModule="finance" moduleLabel="Finance">
            <BudgetDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/my-budgets"
        element={
          <ProtectedRoute requiredModule="finance" moduleLabel="Finance">
            <MyBudgetsPage />
          </ProtectedRoute>
        }
      />
      {/*
        Next year's budget requests. The owner's screen needs only a session,
        like My Budgets: what a member may request is their ownership of a
        line, which the API decides. The review screen is the Treasurer's
        (finance.manage, the decide endpoint's gate) and senior leadership's
        (finance.budget_review, the review endpoint's gate).
      */}
      <Route
        path="/finance/budget-requests"
        element={
          <ProtectedRoute requiredModule="finance" moduleLabel="Finance">
            <BudgetRequestsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/budget-requests/review"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.manage', 'finance.budget_review']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <BudgetRequestReviewPage />
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

      {/* Approvals — the gate the approve/deny endpoints themselves enforce */}
      <Route
        path="/finance/approvals"
        element={
          <ProtectedRoute requiredPermission="finance.approve" requiredModule="finance" moduleLabel="Finance">
            <ApprovalsPage />
          </ProtectedRoute>
        }
      />

      {/*
        Purchase requests, expense reports and check requests are every
        member's: finance.request raises and reads your own (the API confines
        a holder without finance.view to what they raised), finance.view
        reads the queue. Raising and editing need finance.request or
        finance.manage — finance.view alone cannot save, so it is not offered
        the form.
      */}
      {/* Purchase Requests */}
      <Route
        path="/finance/purchase-requests"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.request', 'finance.view', 'finance.manage']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <PurchaseRequestsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/purchase-requests/new"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.request', 'finance.manage']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <PurchaseRequestFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/purchase-requests/:id"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.request', 'finance.view', 'finance.manage']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <PurchaseRequestDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/purchase-requests/:id/edit"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.request', 'finance.manage']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <PurchaseRequestFormPage />
          </ProtectedRoute>
        }
      />

      {/* Expense Reports */}
      <Route
        path="/finance/expenses"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.request', 'finance.view', 'finance.manage']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <ExpenseReportsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/expenses/new"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.request', 'finance.manage']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <ExpenseReportFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/expenses/:id"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.request', 'finance.view', 'finance.manage']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <ExpenseReportDetailPage />
          </ProtectedRoute>
        }
      />

      {/* Check Requests */}
      <Route
        path="/finance/check-requests"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.request', 'finance.view', 'finance.manage']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <CheckRequestsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/check-requests/new"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.request', 'finance.manage']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
            <CheckRequestFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/finance/check-requests/:id"
        element={
          <ProtectedRoute
            requiredAnyPermission={['finance.request', 'finance.view', 'finance.manage']}
            requiredModule="finance"
            moduleLabel="Finance"
          >
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
