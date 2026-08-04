/**
 * Storefront Module Types
 *
 * Mirrors the backend `app/schemas/storefront.py` response shapes. Backend
 * responses use `alias_generator=to_camel`, so every field here is camelCase.
 */

export const StoreProductStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;
export type StoreProductStatus = (typeof StoreProductStatus)[keyof typeof StoreProductStatus];

export const StoreWindowStatus = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  OPEN: 'open',
  CLOSED: 'closed',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
} as const;
export type StoreWindowStatus = (typeof StoreWindowStatus)[keyof typeof StoreWindowStatus];

export const StoreOrderStatus = {
  SUBMITTED: 'submitted',
  AWAITING_PAYMENT: 'awaiting_payment',
  PAID: 'paid',
  ORDERED: 'ordered',
  READY_FOR_PICKUP: 'ready_for_pickup',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
} as const;
export type StoreOrderStatus = (typeof StoreOrderStatus)[keyof typeof StoreOrderStatus];

export const StorePaymentStatus = {
  UNPAID: 'unpaid',
  PENDING_VERIFICATION: 'pending_verification',
  PARTIAL: 'partial',
  PAID: 'paid',
  REFUNDED: 'refunded',
  WAIVED: 'waived',
} as const;
export type StorePaymentStatus = (typeof StorePaymentStatus)[keyof typeof StorePaymentStatus];

export const StorePaymentMethod = {
  VENMO: 'venmo',
  PAYPAL: 'paypal',
  CASH: 'cash',
  CHECK: 'check',
  PAYROLL_DEDUCTION: 'payroll_deduction',
  OTHER: 'other',
} as const;
export type StorePaymentMethod = (typeof StorePaymentMethod)[keyof typeof StorePaymentMethod];

export const StoreFulfillmentMethod = {
  PICKUP: 'pickup',
  SHIP: 'ship',
} as const;
export type StoreFulfillmentMethod = (typeof StoreFulfillmentMethod)[keyof typeof StoreFulfillmentMethod];

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  venmo: 'Venmo',
  paypal: 'PayPal',
  cash: 'Cash',
  check: 'Check',
  payroll_deduction: 'Payroll deduction',
  other: 'Other',
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  ordered: 'Ordered from vendor',
  ready_for_pickup: 'Ready for pickup',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Unpaid',
  pending_verification: 'Reported — needs verification',
  partial: 'Partially paid',
  paid: 'Paid',
  refunded: 'Refunded',
  waived: 'Waived',
};

export const WINDOW_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  open: 'Open',
  closed: 'Closed',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

export const ORDER_STATUS_BADGES: Record<string, string> = {
  submitted: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30',
  awaiting_payment: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  paid: 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30',
  ordered: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/30',
  ready_for_pickup: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/30',
  fulfilled: 'bg-theme-surface-secondary text-theme-text-muted border border-theme-surface-border',
  cancelled: 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30',
};

export const PAYMENT_STATUS_BADGES: Record<string, string> = {
  unpaid: 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30',
  pending_verification: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  partial: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  paid: 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30',
  refunded: 'bg-theme-surface-secondary text-theme-text-muted border border-theme-surface-border',
  waived: 'bg-theme-surface-secondary text-theme-text-muted border border-theme-surface-border',
};

export const WINDOW_STATUS_BADGES: Record<string, string> = {
  draft: 'bg-theme-surface-secondary text-theme-text-muted border border-theme-surface-border',
  scheduled: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30',
  open: 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30',
  closed: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  fulfilled: 'bg-theme-surface-secondary text-theme-text-muted border border-theme-surface-border',
  cancelled: 'bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30',
};

export interface StoreSettings {
  id: string;
  organizationId: string;
  isEnabled: boolean;
  storeName: string;
  tagline?: string | null;
  description?: string | null;
  currency: string;
  acceptedPaymentMethods: string[];
  venmoHandle?: string | null;
  paypalMeUrl?: string | null;
  paypalEmail?: string | null;
  checkPayableTo?: string | null;
  checkMailingAddress?: string | null;
  cashInstructions?: string | null;
  payrollDeductionInstructions?: string | null;
  otherPaymentInstructions?: string | null;
  paymentInstructions?: string | null;
  taxRate: string;
  shippingFlatRate?: string | null;
  allowPickup: boolean;
  allowShipping: boolean;
  pickupLocation?: string | null;
  notifyEmails: string[];
  notifyAdminsOnOrder: boolean;
  sendOrderConfirmation: boolean;
  sendStatusUpdates: boolean;
  sendPaymentReminders: boolean;
  paymentReminderDays: number;
  windowReminderHours: number;
  termsText?: string | null;
  receiptFooter?: string | null;
}

export interface StoreSettingsUpdate {
  isEnabled?: boolean;
  storeName?: string;
  tagline?: string | undefined;
  description?: string | undefined;
  acceptedPaymentMethods?: string[];
  venmoHandle?: string | undefined;
  paypalMeUrl?: string | undefined;
  paypalEmail?: string | undefined;
  checkPayableTo?: string | undefined;
  checkMailingAddress?: string | undefined;
  cashInstructions?: string | undefined;
  payrollDeductionInstructions?: string | undefined;
  otherPaymentInstructions?: string | undefined;
  paymentInstructions?: string | undefined;
  taxRate?: number;
  shippingFlatRate?: number | undefined;
  allowPickup?: boolean;
  allowShipping?: boolean;
  pickupLocation?: string | undefined;
  notifyEmails?: string[];
  notifyAdminsOnOrder?: boolean;
  sendOrderConfirmation?: boolean;
  sendStatusUpdates?: boolean;
  sendPaymentReminders?: boolean;
  paymentReminderDays?: number;
  windowReminderHours?: number;
  termsText?: string | undefined;
  receiptFooter?: string | undefined;
}

export interface StoreProductVariant {
  id: string;
  productId: string;
  label: string;
  sku?: string | null;
  priceDelta: string;
  stockQuantity?: number | null;
  isActive: boolean;
  sortOrder: number;
}

export interface StoreProductVariantInput {
  id?: string | undefined;
  label: string;
  sku?: string | undefined;
  priceDelta: number;
  stockQuantity?: number | undefined;
  isActive: boolean;
  sortOrder: number;
}

export interface StoreProduct {
  id: string;
  organizationId: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  inventoryItemId?: string | null;
  price: string;
  cost?: string | null;
  isTaxable: boolean;
  status: StoreProductStatus;
  maxPerMember?: number | null;
  trackStock: boolean;
  stockQuantity?: number | null;
  requiresVariant: boolean;
  personalizationEnabled: boolean;
  personalizationRequired: boolean;
  personalizationLabel?: string | null;
  personalizationMaxLength: number;
  personalizationPrice: string;
  sortOrder: number;
  internalNotes?: string | null;
  hasImage: boolean;
  variants: StoreProductVariant[];
}

export interface StoreProductInput {
  name: string;
  sku?: string | undefined;
  description?: string | undefined;
  imageUrl?: string | undefined;
  category?: string | undefined;
  price: number;
  cost?: number | undefined;
  isTaxable: boolean;
  status: StoreProductStatus;
  maxPerMember?: number | undefined;
  trackStock: boolean;
  stockQuantity?: number | undefined;
  requiresVariant: boolean;
  personalizationEnabled: boolean;
  personalizationRequired: boolean;
  personalizationLabel?: string | undefined;
  personalizationMaxLength: number;
  personalizationPrice: number;
  sortOrder: number;
  internalNotes?: string | undefined;
  variants: StoreProductVariantInput[];
}

export interface StoreWindowOffering {
  id: string;
  productId: string;
  productName?: string | null;
  priceOverride?: string | null;
  quantityLimit?: number | null;
  maxPerMember?: number | null;
  sortOrder: number;
}

export interface StoreOrderWindow {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  status: StoreWindowStatus;
  opensAt?: string | null;
  closesAt?: string | null;
  autoOpen: boolean;
  autoClose: boolean;
  expectedDeliveryDate?: string | null;
  pickupInstructions?: string | null;
  includeAllProducts: boolean;
  notifyOnOpen: boolean;
  openedAt?: string | null;
  closedAt?: string | null;
  cancelledAt?: string | null;
  notes?: string | null;
  orderCount: number;
  totalSales: string;
  outstandingBalance: string;
  offerings: StoreWindowOffering[];
}

export interface StoreOrderWindowInput {
  name: string;
  description?: string | undefined;
  opensAt?: string | undefined;
  closesAt?: string | undefined;
  autoOpen: boolean;
  autoClose: boolean;
  expectedDeliveryDate?: string | undefined;
  pickupInstructions?: string | undefined;
  includeAllProducts: boolean;
  notifyOnOpen: boolean;
  notes?: string | undefined;
}

export interface StorefrontVariantOption {
  id: string;
  label: string;
  price: string;
  availableQuantity?: number | null;
  isAvailable: boolean;
}

export interface StorefrontProductOffer {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  price: string;
  isTaxable: boolean;
  requiresVariant: boolean;
  maxPerMember?: number | null;
  personalizationEnabled: boolean;
  personalizationRequired: boolean;
  personalizationLabel?: string | null;
  personalizationMaxLength: number;
  personalizationPrice: string;
  availableQuantity?: number | null;
  isAvailable: boolean;
  variants: StorefrontVariantOption[];
}

export interface StorefrontWindowSummary {
  id: string;
  name: string;
  description?: string | null;
  closesAt?: string | null;
  expectedDeliveryDate?: string | null;
  pickupInstructions?: string | null;
}

export interface Storefront {
  isEnabled: boolean;
  storeName: string;
  tagline?: string | null;
  description?: string | null;
  currency: string;
  termsText?: string | null;
  allowPickup: boolean;
  allowShipping: boolean;
  pickupLocation?: string | null;
  shippingFlatRate?: string | null;
  taxRate: string;
  acceptedPaymentMethods: string[];
  paymentInstructions?: string | null;
  window?: StorefrontWindowSummary | null;
  otherOpenWindows: StorefrontWindowSummary[];
  products: StorefrontProductOffer[];
}

export interface StoreOrderItem {
  id: string;
  productId?: string | null;
  variantId?: string | null;
  productName: string;
  variantLabel?: string | null;
  sku?: string | null;
  personalizationText?: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  fulfilledQuantity: number;
}

export interface StoreOrderEvent {
  id: string;
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  message?: string | null;
  isMemberVisible: boolean;
  authorName?: string | null;
  createdAt?: string | null;
}

export interface StorePaymentInstructions {
  method?: string | null;
  label?: string | null;
  paymentUrl?: string | null;
  handle?: string | null;
  instructions?: string | null;
  reference?: string | null;
  amountDue: string;
}

export interface StoreOrder {
  id: string;
  organizationId: string;
  windowId?: string | null;
  windowName?: string | null;
  userId?: string | null;
  orderNumber: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  status: StoreOrderStatus;
  paymentStatus: StorePaymentStatus;
  paymentMethod?: StorePaymentMethod | null;
  subtotal: string;
  taxAmount: string;
  shippingAmount: string;
  discountAmount: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  paymentReference?: string | null;
  paymentReportedAt?: string | null;
  paidAt?: string | null;
  fulfillmentMethod: StoreFulfillmentMethod;
  shippingAddress?: string | null;
  memberNotes?: string | null;
  adminNotes?: string | null;
  submittedAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  fulfilledAt?: string | null;
  items: StoreOrderItem[];
  events: StoreOrderEvent[];
  paymentInstructions?: StorePaymentInstructions | null;
}

export interface StoreOrderListResponse {
  items: StoreOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StoreWindowProductTally {
  productId?: string | null;
  productName: string;
  variantLabel?: string | null;
  sku?: string | null;
  personalizationText?: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface StoreWindowSummary {
  windowId: string;
  windowName: string;
  status: StoreWindowStatus;
  orderCount: number;
  memberCount: number;
  grossSales: string;
  collected: string;
  outstanding: string;
  unpaidOrderCount: number;
  pendingVerificationCount: number;
  tallies: StoreWindowProductTally[];
}

export interface StoreDashboard {
  isEnabled: boolean;
  activeWindow?: StoreOrderWindow | null;
  openOrderCount: number;
  awaitingPaymentCount: number;
  pendingVerificationCount: number;
  readyForPickupCount: number;
  outstandingBalance: string;
  collectedThisWindow: string;
  activeProductCount: number;
  recentOrders: StoreOrder[];
}

export interface StorePermissions {
  can_view: boolean;
  can_order: boolean;
  can_manage: boolean;
}

/** A line in the member's local (unsubmitted) cart. */
export interface CartLine {
  productId: string;
  variantId?: string | undefined;
  productName: string;
  variantLabel?: string | undefined;
  /** Free text to embroider/engrave. Part of the line identity: two shirts
   *  with different names are different goods, never merged into one line. */
  personalizationText?: string | undefined;
  unitPrice: number;
  quantity: number;
  isTaxable: boolean;
}
