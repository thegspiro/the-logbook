/**
 * Finance Module
 *
 * This module handles internal financial workflows for fire departments:
 * fiscal years, budgets, purchase requests, expense reports,
 * check requests, dues/assessments, configurable approval chains,
 * and QuickBooks export.
 *
 * To enable/disable this module, simply include or exclude the
 * getFinanceRoutes function call in your main App.tsx routing.
 */

// Export routes
export { getFinanceRoutes } from './routes';
