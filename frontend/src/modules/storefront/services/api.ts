/**
 * Storefront API Service
 *
 * All API calls for the department storefront module.
 */

import { createApiClient } from '../../../utils/createApiClient';
import type {
  StoreDashboard,
  StoreOrder,
  StoreOrderListResponse,
  StoreOrderWindow,
  StoreOrderWindowInput,
  StorePaymentEvent,
  StorePaymentEventList,
  StorePermissions,
  StoreProduct,
  StoreProductInput,
  StoreSettings,
  StoreSettingsUpdate,
  StoreWindowSummary,
  Storefront,
} from '../types';

const api = createApiClient();

export interface OrderItemInput {
  productId: string;
  variantId?: string | undefined;
  quantity: number;
  personalizationText?: string | undefined;
}

export interface PlaceOrderInput {
  windowId?: string | undefined;
  items: OrderItemInput[];
  paymentMethod?: string | undefined;
  fulfillmentMethod: string;
  shippingAddress?: string | undefined;
  memberNotes?: string | undefined;
}

export interface WindowOfferingInput {
  productId: string;
  priceOverride?: number | undefined;
  quantityLimit?: number | undefined;
  maxPerMember?: number | undefined;
  sortOrder: number;
}

export const storefrontService = {
  // --- Member-facing ---

  async getStorefront(windowId?: string): Promise<Storefront> {
    const response = await api.get<Storefront>('/store/storefront', {
      params: windowId ? { window_id: windowId } : {},
    });
    return response.data;
  },

  async getPermissions(): Promise<StorePermissions> {
    const response = await api.get<StorePermissions>('/store/permissions');
    return response.data;
  },

  async placeOrder(payload: PlaceOrderInput): Promise<StoreOrder> {
    const response = await api.post<StoreOrder>('/store/orders', payload);
    return response.data;
  },

  async getMyOrders(): Promise<StoreOrder[]> {
    const response = await api.get<StoreOrder[]>('/store/orders/mine');
    return response.data;
  },

  async getMyOrder(orderId: string): Promise<StoreOrder> {
    const response = await api.get<StoreOrder>(`/store/orders/mine/${orderId}`);
    return response.data;
  },

  async reportPayment(
    orderId: string,
    payload: { paymentMethod: string; reference?: string | undefined; note?: string | undefined }
  ): Promise<StoreOrder> {
    const response = await api.post<StoreOrder>(`/store/orders/mine/${orderId}/report-payment`, payload);
    return response.data;
  },

  async cancelMyOrder(orderId: string, reason?: string): Promise<StoreOrder> {
    const response = await api.post<StoreOrder>(`/store/orders/mine/${orderId}/cancel`, {
      reason,
      notifyMember: false,
    });
    return response.data;
  },

  // --- Settings ---

  async getSettings(): Promise<StoreSettings> {
    const response = await api.get<StoreSettings>('/store/settings');
    return response.data;
  },

  async updateSettings(payload: StoreSettingsUpdate): Promise<StoreSettings> {
    const response = await api.put<StoreSettings>('/store/settings', payload);
    return response.data;
  },

  // --- Catalog ---

  async getProducts(params?: {
    status?: string | undefined;
    search?: string | undefined;
    includeArchived?: boolean;
  }): Promise<StoreProduct[]> {
    const response = await api.get<StoreProduct[]>('/store/products', {
      params: {
        status: params?.status,
        search: params?.search,
        include_archived: params?.includeArchived,
      },
    });
    return response.data;
  },

  async createProduct(payload: StoreProductInput): Promise<StoreProduct> {
    const response = await api.post<StoreProduct>('/store/products', payload);
    return response.data;
  },

  async updateProduct(productId: string, payload: Partial<StoreProductInput>): Promise<StoreProduct> {
    const response = await api.put<StoreProduct>(`/store/products/${productId}`, payload);
    return response.data;
  },

  async archiveProduct(productId: string): Promise<void> {
    await api.delete(`/store/products/${productId}`);
  },

  async uploadProductImage(productId: string, file: File): Promise<StoreProduct> {
    const form = new FormData();
    form.append('file', file);
    const response = await api.post<StoreProduct>(`/store/products/${productId}/image`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async deleteProductImage(productId: string): Promise<void> {
    await api.delete(`/store/products/${productId}/image`);
  },

  // --- Order windows ---

  async getWindows(status?: string): Promise<StoreOrderWindow[]> {
    const response = await api.get<StoreOrderWindow[]>('/store/windows', {
      params: status ? { status } : {},
    });
    return response.data;
  },

  async createWindow(
    payload: StoreOrderWindowInput & { offerings?: WindowOfferingInput[] }
  ): Promise<StoreOrderWindow> {
    const response = await api.post<StoreOrderWindow>('/store/windows', payload);
    return response.data;
  },

  async updateWindow(
    windowId: string,
    payload: Partial<StoreOrderWindowInput> & {
      offerings?: WindowOfferingInput[];
    }
  ): Promise<StoreOrderWindow> {
    const response = await api.put<StoreOrderWindow>(`/store/windows/${windowId}`, payload);
    return response.data;
  },

  async openWindow(
    windowId: string,
    payload: { notifyMembers: boolean; message?: string | undefined }
  ): Promise<StoreOrderWindow> {
    const response = await api.post<StoreOrderWindow>(`/store/windows/${windowId}/open`, payload);
    return response.data;
  },

  async closeWindow(
    windowId: string,
    payload: { notifyMembers: boolean; message?: string | undefined }
  ): Promise<StoreOrderWindow> {
    const response = await api.post<StoreOrderWindow>(`/store/windows/${windowId}/close`, payload);
    return response.data;
  },

  async cancelWindow(windowId: string): Promise<StoreOrderWindow> {
    const response = await api.post<StoreOrderWindow>(`/store/windows/${windowId}/cancel`, {});
    return response.data;
  },

  async fulfillWindow(windowId: string): Promise<StoreOrderWindow> {
    const response = await api.post<StoreOrderWindow>(`/store/windows/${windowId}/fulfill`, {});
    return response.data;
  },

  async deleteWindow(windowId: string): Promise<void> {
    await api.delete(`/store/windows/${windowId}`);
  },

  async getWindowSummary(windowId: string): Promise<StoreWindowSummary> {
    const response = await api.get<StoreWindowSummary>(`/store/windows/${windowId}/summary`);
    return response.data;
  },

  // --- Order administration ---

  async getDashboard(): Promise<StoreDashboard> {
    const response = await api.get<StoreDashboard>('/store/dashboard');
    return response.data;
  },

  async getOrders(params?: {
    windowId?: string | undefined;
    status?: string | undefined;
    paymentStatus?: string | undefined;
    search?: string | undefined;
    page?: number;
    pageSize?: number;
  }): Promise<StoreOrderListResponse> {
    const response = await api.get<StoreOrderListResponse>('/store/orders', {
      params: {
        window_id: params?.windowId,
        status: params?.status,
        payment_status: params?.paymentStatus,
        search: params?.search,
        page: params?.page ?? 1,
        page_size: params?.pageSize ?? 25,
      },
    });
    return response.data;
  },

  async getOrder(orderId: string): Promise<StoreOrder> {
    const response = await api.get<StoreOrder>(`/store/orders/${orderId}`);
    return response.data;
  },

  async updateOrderStatus(
    orderId: string,
    payload: {
      status: string;
      message?: string | undefined;
      notifyMember: boolean;
    }
  ): Promise<StoreOrder> {
    const response = await api.post<StoreOrder>(`/store/orders/${orderId}/status`, payload);
    return response.data;
  },

  async recordPayment(
    orderId: string,
    payload: {
      amount: number;
      paymentMethod?: string | undefined;
      reference?: string | undefined;
      markPaid: boolean;
      notifyMember: boolean;
    }
  ): Promise<StoreOrder> {
    const response = await api.post<StoreOrder>(`/store/orders/${orderId}/payments`, payload);
    return response.data;
  },

  async markOrderPaid(
    orderId: string,
    payload: {
      paymentMethod?: string | undefined;
      reference?: string | undefined;
      notifyMember: boolean;
    }
  ): Promise<StoreOrder> {
    const response = await api.post<StoreOrder>(`/store/orders/${orderId}/mark-paid`, payload);
    return response.data;
  },

  async waiveOrderPayment(
    orderId: string,
    payload: { reason?: string | undefined; notifyMember: boolean }
  ): Promise<StoreOrder> {
    const response = await api.post<StoreOrder>(`/store/orders/${orderId}/waive`, payload);
    return response.data;
  },

  async bulkMarkPaid(payload: {
    orderIds: string[];
    paymentMethod?: string | undefined;
    reference?: string | undefined;
    notifyMembers: boolean;
  }): Promise<{ updated: number; skipped: number }> {
    const response = await api.post<{ updated: number; skipped: number }>('/store/orders/bulk-payment', payload);
    return response.data;
  },

  async refundOrder(
    orderId: string,
    payload: {
      amount?: number | undefined;
      reason?: string | undefined;
      notifyMember: boolean;
    }
  ): Promise<StoreOrder> {
    const response = await api.post<StoreOrder>(`/store/orders/${orderId}/refund`, payload);
    return response.data;
  },

  async cancelOrder(
    orderId: string,
    payload: { reason?: string | undefined; notifyMember: boolean }
  ): Promise<StoreOrder> {
    const response = await api.post<StoreOrder>(`/store/orders/${orderId}/cancel`, payload);
    return response.data;
  },

  async addOrderMessage(
    orderId: string,
    payload: {
      message: string;
      isMemberVisible: boolean;
      notifyMember: boolean;
    }
  ): Promise<StoreOrder> {
    const response = await api.post<StoreOrder>(`/store/orders/${orderId}/messages`, payload);
    return response.data;
  },

  async setOrderNotes(orderId: string, adminNotes?: string): Promise<StoreOrder> {
    const response = await api.put<StoreOrder>(`/store/orders/${orderId}/notes`, { adminNotes });
    return response.data;
  },

  async bulkUpdateStatus(payload: {
    orderIds: string[];
    status: string;
    message?: string | undefined;
    notifyMembers: boolean;
  }): Promise<{ updated: number; skipped: number }> {
    const response = await api.post<{ updated: number; skipped: number }>('/store/orders/bulk-status', payload);
    return response.data;
  },

  // ---- External payment reconciliation ----

  async listPaymentEvents(params?: {
    status?: string | undefined;
    unresolvedOnly?: boolean | undefined;
  }): Promise<StorePaymentEventList> {
    const response = await api.get<StorePaymentEventList>('/store/payments', {
      params: { status: params?.status, unresolved_only: params?.unresolvedOnly },
    });
    return response.data;
  },

  async applyPaymentEvent(eventId: string, orderId?: string): Promise<StorePaymentEvent> {
    const response = await api.post<StorePaymentEvent>(`/store/payments/${eventId}/apply`, {
      orderId,
    });
    return response.data;
  },

  async ignorePaymentEvent(eventId: string, reason?: string): Promise<StorePaymentEvent> {
    const response = await api.post<StorePaymentEvent>(`/store/payments/${eventId}/ignore`, {
      reason,
    });
    return response.data;
  },

  /** Download the line-level order export as a CSV blob. */
  async exportOrders(params?: { windowId?: string | undefined; status?: string | undefined }): Promise<Blob> {
    const response = await api.get('/store/orders/export', {
      params: { window_id: params?.windowId, status: params?.status },
      responseType: 'blob',
    });
    return response.data as Blob;
  },
};
