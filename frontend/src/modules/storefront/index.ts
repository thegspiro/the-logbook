/**
 * Storefront Module — Barrel Export
 *
 * Optional department store that sits alongside logistics: catalog items,
 * time-boxed order windows, member orders, and out-of-band payment
 * reconciliation (Venmo / PayPal / cash / check).
 */

// Routes
export { getStorefrontRoutes } from './routes';

// Services
export { storefrontService } from './services/api';

// Store
export { useStorefrontStore, computeCartTotals } from './store/storefrontStore';

// Types
export type {
  CartLine,
  StoreDashboard,
  StoreOrder,
  StoreOrderItem,
  StoreOrderWindow,
  StoreProduct,
  StoreSettings,
  Storefront,
  StorefrontProductOffer,
  StoreWindowSummary,
} from './types';
