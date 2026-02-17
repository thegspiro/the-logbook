import React, { useEffect, useState } from 'react';
import { healthCheckService, type SystemHealth } from '../services/healthCheck';
import { useTimezone } from '../hooks/useTimezone';
import { formatTime } from '../utils/dateFormatting';

interface HealthStatusProps {
  eventId?: string;
  compact?: boolean;
}

/**
 * Health Status Component
 *
 * Displays system health status with automatic refresh.
 * Can be embedded in pages or shown as a full dashboard.
 */
const HealthStatus: React.FC<HealthStatusProps> = ({ eventId, compact = false }) => {
  const tz = useTimezone();
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const runChecks = async () => {
      setLoading(true);
      const result = await healthCheckService.runAllChecks(eventId);
      setHealth(result);
      setLoading(false);
    };

    runChecks();

    // Refresh every 30 seconds
    const interval = setInterval(runChecks, 30000);

    return () => clearInterval(interval);
  }, [eventId]);

  if (loading || !health) {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-blue-600 rounded-full"></div>
        <span className="text-sm">Checking system health...</span>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-500';
      case 'degraded':
        return 'bg-yellow-500';
      case 'down':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'Operational';
      case 'degraded':
        return 'Degraded';
      case 'down':
        return 'Down';
      default:
        return 'Unknown';
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${getStatusColor(health.overall)} ${health.overall === 'healthy' ? 'animate-pulse' : ''}`}></div>
        <span className="text-sm text-gray-700">
          System: {getStatusText(health.overall)}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-gray-900">System Health</h2>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${getStatusColor(health.overall)} ${health.overall === 'healthy' ? 'animate-pulse' : ''}`}></div>
          <span className="text-sm font-medium text-gray-700">
            {getStatusText(health.overall)}
          </span>
        </div>
      </div>

      {/* Component Status List */}
      <div className="space-y-3">
        {health.components.map((component) => (
          <div key={component.component} className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${getStatusColor(component.status)}`}></div>
                <span className="text-sm font-medium text-gray-900">{component.component}</span>
              </div>
              {component.message && (
                <p className="text-xs text-gray-600 ml-4 mt-1">{component.message}</p>
              )}
            </div>
            <div className="flex flex-col items-end text-xs text-gray-500">
              <span>{getStatusText(component.status)}</span>
              {component.responseTime !== undefined && (
                <span className="text-gray-400">{component.responseTime}ms</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Last Updated */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Last checked: {formatTime(health.lastUpdated, tz)}
        </p>
      </div>
    </div>
  );
};

export default HealthStatus;
