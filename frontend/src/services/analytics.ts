/**
 * QR Code Analytics Service
 *
 * Tracks and analyzes QR code check-in metrics including:
 * - Scan rates
 * - Check-in success rates
 * - Time-to-check-in
 * - Device types
 * - Error rates
 */

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

class AnalyticsService {
  private events: AnalyticsEvent[] = [];
  private maxEvents = 1000;

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
    timeToCheckIn: number // seconds from scan to success
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
   * Generic event tracking
   */
  private trackEvent(
    eventType: AnalyticsEvent['eventType'],
    eventId: string,
    userId: string | undefined,
    metadata: Record<string, any>
  ): void {
    const analyticsEvent: AnalyticsEvent = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      eventType,
      eventId,
      userId,
      metadata,
    };

    this.events.unshift(analyticsEvent);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }

    // Send to backend (placeholder)
    this.sendToBackend(analyticsEvent);
  }

  /**
   * Get metrics for a specific event
   */
  getEventMetrics(eventId: string): QRCodeMetrics {
    const eventEvents = this.events.filter(e => e.eventId === eventId);

    const scans = eventEvents.filter(e => e.eventType === 'qr_scan').length;
    const successes = eventEvents.filter(e => e.eventType === 'check_in_success');
    const failures = eventEvents.filter(e => e.eventType === 'check_in_failure');

    // Calculate success rate
    const total = successes.length + failures.length;
    const successRate = total > 0 ? (successes.length / total) * 100 : 0;

    // Calculate average time to check-in
    const checkInTimes = successes
      .map(e => e.metadata.timeToCheckIn)
      .filter(t => typeof t === 'number');
    const avgTimeToCheckIn = checkInTimes.length > 0
      ? checkInTimes.reduce((a, b) => a + b, 0) / checkInTimes.length
      : 0;

    // Device breakdown
    const deviceBreakdown = {
      mobile: 0,
      desktop: 0,
      tablet: 0,
      unknown: 0,
    };

    eventEvents.forEach(e => {
      const deviceType = e.metadata.deviceType || 'unknown';
      if (deviceType in deviceBreakdown) {
        (deviceBreakdown as any)[deviceType]++;
      } else {
        deviceBreakdown.unknown++;
      }
    });

    // Error breakdown
    const errorBreakdown: Record<string, number> = {};
    failures.forEach(e => {
      const errorType = e.metadata.errorType || 'unknown';
      errorBreakdown[errorType] = (errorBreakdown[errorType] || 0) + 1;
    });

    // Hourly activity
    const hourlyActivity = this.calculateHourlyActivity(eventEvents);

    // Check-in trends (last 24 hours, grouped by 15-minute intervals)
    const checkInTrends = this.calculateCheckInTrends(successes);

    return {
      totalScans: scans,
      successfulCheckIns: successes.length,
      failedCheckIns: failures.length,
      successRate: Math.round(successRate * 100) / 100,
      avgTimeToCheckIn: Math.round(avgTimeToCheckIn),
      deviceBreakdown,
      errorBreakdown,
      hourlyActivity,
      checkInTrends,
    };
  }

  /**
   * Get overall platform metrics
   */
  getOverallMetrics(): QRCodeMetrics {
    const scans = this.events.filter(e => e.eventType === 'qr_scan').length;
    const successes = this.events.filter(e => e.eventType === 'check_in_success');
    const failures = this.events.filter(e => e.eventType === 'check_in_failure');

    const total = successes.length + failures.length;
    const successRate = total > 0 ? (successes.length / total) * 100 : 0;

    const checkInTimes = successes
      .map(e => e.metadata.timeToCheckIn)
      .filter(t => typeof t === 'number');
    const avgTimeToCheckIn = checkInTimes.length > 0
      ? checkInTimes.reduce((a, b) => a + b, 0) / checkInTimes.length
      : 0;

    const deviceBreakdown = {
      mobile: 0,
      desktop: 0,
      tablet: 0,
      unknown: 0,
    };

    this.events.forEach(e => {
      const deviceType = e.metadata.deviceType || 'unknown';
      if (deviceType in deviceBreakdown) {
        (deviceBreakdown as any)[deviceType]++;
      } else {
        deviceBreakdown.unknown++;
      }
    });

    const errorBreakdown: Record<string, number> = {};
    failures.forEach(e => {
      const errorType = e.metadata.errorType || 'unknown';
      errorBreakdown[errorType] = (errorBreakdown[errorType] || 0) + 1;
    });

    const hourlyActivity = this.calculateHourlyActivity(this.events);
    const checkInTrends = this.calculateCheckInTrends(successes);

    return {
      totalScans: scans,
      successfulCheckIns: successes.length,
      failedCheckIns: failures.length,
      successRate: Math.round(successRate * 100) / 100,
      avgTimeToCheckIn: Math.round(avgTimeToCheckIn),
      deviceBreakdown,
      errorBreakdown,
      hourlyActivity,
      checkInTrends,
    };
  }

  /**
   * Calculate hourly activity distribution
   */
  private calculateHourlyActivity(events: AnalyticsEvent[]): Array<{ hour: number; count: number }> {
    const hourCounts: Record<number, number> = {};

    events.forEach(e => {
      const hour = e.timestamp.getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hourCounts[hour] || 0,
    }));
  }

  /**
   * Calculate check-in trends over time
   */
  private calculateCheckInTrends(
    checkIns: AnalyticsEvent[]
  ): Array<{ time: Date; count: number }> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Filter last 24 hours
    const recentCheckIns = checkIns.filter(e => e.timestamp >= oneDayAgo);

    // Group by 15-minute intervals
    const intervals: Record<string, number> = {};

    recentCheckIns.forEach(e => {
      const minutes = Math.floor(e.timestamp.getMinutes() / 15) * 15;
      const intervalTime = new Date(e.timestamp);
      intervalTime.setMinutes(minutes, 0, 0);
      const key = intervalTime.toISOString();
      intervals[key] = (intervals[key] || 0) + 1;
    });

    return Object.entries(intervals)
      .map(([time, count]) => ({ time: new Date(time), count }))
      .sort((a, b) => a.time.getTime() - b.time.getTime());
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
   * Send to backend (placeholder)
   */
  private async sendToBackend(event: AnalyticsEvent): Promise<void> {
    // TODO: Implement backend analytics storage
    /*
    try {
      await fetch('/api/v1/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
    } catch (err) {
      console.error('Failed to send analytics:', err);
    }
    */
  }

  /**
   * Export analytics data
   */
  exportAnalytics(): string {
    return JSON.stringify({
      events: this.events,
      metrics: this.getOverallMetrics(),
      exportedAt: new Date().toISOString(),
    }, null, 2);
  }

  /**
   * Clear all analytics data
   */
  clearAnalytics(): void {
    this.events = [];
  }
}

// Export singleton
export const analyticsService = new AnalyticsService();
