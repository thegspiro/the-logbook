/**
 * Health Check Service
 *
 * Monitors system health and provides status indicators for various components.
 */

export interface HealthCheckResult {
  component: string;
  status: 'healthy' | 'degraded' | 'down';
  responseTime?: number; // milliseconds
  message?: string;
  lastChecked: Date;
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'down';
  components: HealthCheckResult[];
  lastUpdated: Date;
}

class HealthCheckService {
  private healthResults: Map<string, HealthCheckResult> = new Map();

  /**
   * Check API connectivity
   */
  async checkAPI(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const component = 'API';

    try {
      const response = await fetch('/health', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        return this.updateHealth(component, {
          component,
          status: responseTime < 1000 ? 'healthy' : 'degraded',
          responseTime,
          message: responseTime < 1000 ? 'API is responding normally' : 'API is slow',
          lastChecked: new Date(),
        });
      } else {
        return this.updateHealth(component, {
          component,
          status: 'down',
          responseTime,
          message: `API returned ${response.status}`,
          lastChecked: new Date(),
        });
      }
    } catch (error) {
      return this.updateHealth(component, {
        component,
        status: 'down',
        message: 'Unable to reach API',
        lastChecked: new Date(),
      });
    }
  }

  /**
   * Check QR code generation
   */
  async checkQRCodeGeneration(): Promise<HealthCheckResult> {
    const component = 'QR Code Generation';

    try {
      // Test QR code library is loaded
      const QRCode = await import('qrcode.react');

      if (QRCode) {
        return this.updateHealth(component, {
          component,
          status: 'healthy',
          message: 'QR code library loaded successfully',
          lastChecked: new Date(),
        });
      } else {
        return this.updateHealth(component, {
          component,
          status: 'down',
          message: 'QR code library not available',
          lastChecked: new Date(),
        });
      }
    } catch (error) {
      return this.updateHealth(component, {
        component,
        status: 'down',
        message: 'Failed to load QR code library',
        lastChecked: new Date(),
      });
    }
  }

  /**
   * Check event check-in endpoints
   */
  async checkCheckInEndpoint(eventId?: string): Promise<HealthCheckResult> {
    const component = 'Check-In Endpoint';
    const startTime = Date.now();

    if (!eventId) {
      return this.updateHealth(component, {
        component,
        status: 'healthy',
        message: 'No event ID provided for test',
        lastChecked: new Date(),
      });
    }

    try {
      const response = await fetch(`/api/v1/events/${eventId}/qr-check-in-data`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const responseTime = Date.now() - startTime;

      if (response.ok || response.status === 404) {
        // 404 is acceptable - event might not exist, but endpoint is working
        return this.updateHealth(component, {
          component,
          status: 'healthy',
          responseTime,
          message: 'Check-in endpoint is responding',
          lastChecked: new Date(),
        });
      } else if (response.status === 401 || response.status === 403) {
        return this.updateHealth(component, {
          component,
          status: 'healthy',
          responseTime,
          message: 'Endpoint requires authentication (expected)',
          lastChecked: new Date(),
        });
      } else {
        return this.updateHealth(component, {
          component,
          status: 'degraded',
          responseTime,
          message: `Endpoint returned ${response.status}`,
          lastChecked: new Date(),
        });
      }
    } catch (error) {
      return this.updateHealth(component, {
        component,
        status: 'down',
        message: 'Unable to reach check-in endpoint',
        lastChecked: new Date(),
      });
    }
  }

  /**
   * Check browser compatibility
   */
  checkBrowserCompatibility(): HealthCheckResult {
    const component = 'Browser Compatibility';
    const issues: string[] = [];

    // Check for required features
    if (!navigator.mediaDevices) {
      issues.push('Camera access not available');
    }

    if (!window.crypto) {
      issues.push('Crypto API not available');
    }

    if (!('fetch' in window)) {
      issues.push('Fetch API not supported');
    }

    const status = issues.length === 0 ? 'healthy' : issues.length <= 1 ? 'degraded' : 'down';
    const message = issues.length === 0
      ? 'Browser fully compatible'
      : `Issues detected: ${issues.join(', ')}`;

    return this.updateHealth(component, {
      component,
      status,
      message,
      lastChecked: new Date(),
    });
  }

  /**
   * Check local storage availability
   */
  checkLocalStorage(): HealthCheckResult {
    const component = 'Local Storage';

    try {
      const testKey = '__health_check_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);

      return this.updateHealth(component, {
        component,
        status: 'healthy',
        message: 'Local storage is available',
        lastChecked: new Date(),
      });
    } catch (error) {
      return this.updateHealth(component, {
        component,
        status: 'down',
        message: 'Local storage is not available or full',
        lastChecked: new Date(),
      });
    }
  }

  /**
   * Run all health checks
   */
  async runAllChecks(eventId?: string): Promise<SystemHealth> {
    const results = await Promise.all([
      this.checkAPI(),
      this.checkQRCodeGeneration(),
      this.checkCheckInEndpoint(eventId),
      Promise.resolve(this.checkBrowserCompatibility()),
      Promise.resolve(this.checkLocalStorage()),
    ]);

    const overall = this.calculateOverallHealth(results);

    return {
      overall,
      components: results,
      lastUpdated: new Date(),
    };
  }

  /**
   * Get current system health (from cache)
   */
  getCurrentHealth(): SystemHealth {
    const components = Array.from(this.healthResults.values());
    const overall = this.calculateOverallHealth(components);

    return {
      overall,
      components,
      lastUpdated: new Date(),
    };
  }

  /**
   * Update health result for a component
   */
  private updateHealth(component: string, result: HealthCheckResult): HealthCheckResult {
    this.healthResults.set(component, result);
    return result;
  }

  /**
   * Calculate overall system health from component results
   */
  private calculateOverallHealth(components: HealthCheckResult[]): 'healthy' | 'degraded' | 'down' {
    const downCount = components.filter(c => c.status === 'down').length;
    const degradedCount = components.filter(c => c.status === 'degraded').length;

    if (downCount > 0) {
      return 'down';
    } else if (degradedCount > 0) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }
}

export const healthCheckService = new HealthCheckService();
