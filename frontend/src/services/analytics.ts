/**
 * QR Code Analytics Service
 *
 * Tracks and analyzes QR code check-in metrics including:
 * - Scan rates
 * - Check-in success rates
 * - Time-to-check-in
 * - Device types
 * - Error rates
 *
 * Events are persisted to the backend API and metrics are fetched from there.
 * A local buffer is kept for immediate UI responsiveness.
 */

import { analyticsApiService, type AnalyticsMetrics } from './api';

export interface AnalyticsEvent {
  id: string;
  timestamp: Date;
  eventType: 'qr_scan' | 'check_in_success' | 'check_in_failure' | 'qr_view' | 'qr_print';
  eventId: string;
  userId?: string;
  metadata: Record<string, any>;
}

export interface QRCodeMetrics {
  totalScans: number;
  successfulCheckIns: number;
  failedCheckIns: number;
  successRate: number;
  avgTimeToCheckIn: number; // seconds
  deviceBreakdown: {
    mobile: number;
    desktop: number;
    tablet: number;
    unknown: number;
  };
  errorBreakdown: Record<string, number>;
  hourlyActivity: Array<{ hour: number; count: number }>;
  checkInTrends: Array<{ time: Date; count: number }>;
}

function mapApiMetrics(data: AnalyticsMetrics): QRCodeMetrics {
  return {
    totalScans: data.total_scans,
    successfulCheckIns: data.successful_check_ins,
    failedCheckIns: data.failed_check_ins,
    successRate: data.success_rate,
    avgTimeToCheckIn: data.avg_time_to_check_in,
    deviceBreakdown: {
      mobile: data.device_breakdown?.mobile || 0,
      desktop: data.device_breakdown?.desktop || 0,
      tablet: data.device_breakdown?.tablet || 0,
      unknown: data.device_breakdown?.unknown || 0,
    },
    errorBreakdown: data.error_breakdown || {},
    hourlyActivity: data.hourly_activity || Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
    checkInTrends: [],
  };
}

class AnalyticsService {
  /**
   * Track a QR code scan
   */
  trackQRScan(eventId: string, userId?: string): void {
    this.trackEvent('qr_scan', eventId, userId, {
      deviceType: this.getDeviceType(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Track successful check-in
   */
  trackCheckInSuccess(
    eventId: string,
    userId: string,
    timeToCheckIn: number
  ): void {
    this.trackEvent('check_in_success', eventId, userId, {
      timeToCheckIn,
      deviceType: this.getDeviceType(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Track failed check-in
   */
  trackCheckInFailure(
    eventId: string,
    userId: string | undefined,
    errorType: string,
    errorMessage: string
  ): void {
    this.trackEvent('check_in_failure', eventId, userId, {
      errorType,
      errorMessage,
      deviceType: this.getDeviceType(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Track QR code view (when page is loaded)
   */
  trackQRView(eventId: string): void {
    this.trackEvent('qr_view', eventId, undefined, {
      deviceType: this.getDeviceType(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Track QR code print
   */
  trackQRPrint(eventId: string): void {
    this.trackEvent('qr_print', eventId, undefined, {
      deviceType: this.getDeviceType(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Generic event tracking - sends to backend
   */
  private trackEvent(
    eventType: AnalyticsEvent['eventType'],
    eventId: string,
    userId: string | undefined,
    metadata: Record<string, any>
  ): void {
    analyticsApiService.trackEvent({
      event_type: eventType,
      event_id: eventId,
      user_id: userId,
      metadata,
    }).catch(() => {
      // Silently fail - analytics should not block the user
    });
  }

  /**
   * Get metrics for a specific event (from backend)
   */
  async getEventMetrics(eventId: string): Promise<QRCodeMetrics> {
    try {
      const data = await analyticsApiService.getMetrics(eventId);
      return mapApiMetrics(data);
    } catch {
      return this.emptyMetrics();
    }
  }

  /**
   * Get overall platform metrics (from backend)
   */
  async getOverallMetrics(): Promise<QRCodeMetrics> {
    try {
      const data = await analyticsApiService.getMetrics();
      return mapApiMetrics(data);
    } catch {
      return this.emptyMetrics();
    }
  }

  /**
   * Detect device type
   */
  private getDeviceType(): 'mobile' | 'desktop' | 'tablet' | 'unknown' {
    const ua = navigator.userAgent.toLowerCase();

    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
      return 'tablet';
    }

    if (/mobile|iphone|ipod|android|blackberry|opera mini|opera mobi|skyfire|maemo|windows phone|palm|iemobile|symbian|symbianos|fennec/i.test(ua)) {
      return 'mobile';
    }

    if (/mozilla|chrome|safari|firefox|opera/i.test(ua)) {
      return 'desktop';
    }

    return 'unknown';
  }

  /**
   * Export analytics data (from backend)
   */
  async exportAnalytics(eventId?: string): Promise<string> {
    try {
      return await analyticsApiService.exportAnalytics(eventId);
    } catch {
      return JSON.stringify({ events: [], error: 'Failed to export' }, null, 2);
    }
  }

  /**
   * Clear all analytics data
   */
  clearAnalytics(): void {
    // No-op for backend-persisted analytics
  }

  private emptyMetrics(): QRCodeMetrics {
    return {
      totalScans: 0,
      successfulCheckIns: 0,
      failedCheckIns: 0,
      successRate: 0,
      avgTimeToCheckIn: 0,
      deviceBreakdown: { mobile: 0, desktop: 0, tablet: 0, unknown: 0 },
      errorBreakdown: {},
      hourlyActivity: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
      checkInTrends: [],
    };
  }
}

// Export singleton
export const analyticsService = new AnalyticsService();
