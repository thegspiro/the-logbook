import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api-client';

interface ServiceStatus {
  name: string;
  status: 'checking' | 'connected' | 'disconnected' | 'error';
  message?: string;
}

const MAX_RETRIES = 30; // Maximum retries (about 3 minutes with delays)
const INITIAL_DELAY = 2000; // Start with 2 second delay
const MAX_DELAY = 5000; // Cap at 5 seconds between retries

const OnboardingCheck: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'Backend API', status: 'checking' },
    { name: 'Database', status: 'checking' },
    { name: 'Cache (Redis)', status: 'checking' },
  ]);
  const [retryCount, setRetryCount] = useState(0);
  const [isWaiting, setIsWaiting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting to services...');
  const navigate = useNavigate();

  const updateServiceStatus = useCallback((serviceName: string, status: ServiceStatus['status'], message?: string) => {
    setServices(prev => prev.map(s =>
      s.name === serviceName ? { ...s, status, message } : s
    ));
  }, []);

  const checkServices = useCallback(async (): Promise<boolean> => {
    setIsWaiting(false);

    // First check health endpoint
    const healthResponse = await apiClient.checkHealth();

    if (healthResponse.error || !healthResponse.data) {
      // Backend not responding
      updateServiceStatus('Backend API', 'disconnected', healthResponse.error);
      updateServiceStatus('Database', 'checking');
      updateServiceStatus('Cache (Redis)', 'checking');
      return false;
    }

    const health = healthResponse.data;

    // Update Backend API status
    updateServiceStatus('Backend API', 'connected', `v${health.version}`);

    // Update Database status
    if (health.checks.database === 'connected') {
      updateServiceStatus('Database', 'connected');
    } else if (health.checks.database === 'disconnected') {
      updateServiceStatus('Database', 'disconnected', 'Waiting for database...');
      return false;
    } else {
      updateServiceStatus('Database', 'error', health.checks.database);
      return false;
    }

    // Update Redis status (non-critical, but show status)
    if (health.checks.redis === 'connected') {
      updateServiceStatus('Cache (Redis)', 'connected');
    } else if (health.checks.redis === 'disconnected') {
      updateServiceStatus('Cache (Redis)', 'disconnected', 'Optional service');
    } else {
      updateServiceStatus('Cache (Redis)', 'error', health.checks.redis);
    }

    // Check if system is healthy enough to proceed
    // We require API and Database, Redis is optional
    return health.status !== 'unhealthy' && health.checks.database === 'connected';
  }, [updateServiceStatus]);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await apiClient.getStatus();

      if (response.error || !response.data) {
        setError(
          response.error || 'Unable to connect to the server. Please check your connection and try again.'
        );
        return;
      }

      const status = response.data;

      if (status.needs_onboarding) {
        // Redirect to onboarding wizard
        navigate('/onboarding/start');
      } else {
        // Onboarding already complete, redirect to login
        navigate('/login');
      }
    } catch (err) {
      console.error('Error checking onboarding status:', err);
      setError(
        'Unable to connect to the server. Please check your connection and try again.'
      );
    }
  }, [navigate]);

  const runCheck = useCallback(async () => {
    setStatusMessage('Checking services...');

    const servicesReady = await checkServices();

    if (servicesReady) {
      setStatusMessage('Services ready! Checking onboarding status...');
      await checkOnboardingStatus();
    } else {
      // Services not ready, schedule retry
      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(INITIAL_DELAY + (retryCount * 500), MAX_DELAY);
        setRetryCount(prev => prev + 1);
        setIsWaiting(true);
        setStatusMessage(`Waiting for services to be ready... (attempt ${retryCount + 1}/${MAX_RETRIES})`);

        setTimeout(() => {
          runCheck();
        }, delay);
      } else {
        setError('Services did not become ready in time. Please check that all containers are running.');
      }
    }
  }, [checkServices, checkOnboardingStatus, retryCount]);

  useEffect(() => {
    runCheck();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const getStatusIcon = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'connected':
        return <span className="text-green-400 text-xl">✓</span>;
      case 'disconnected':
        return <span className="text-yellow-400 text-xl animate-pulse">●</span>;
      case 'error':
        return <span className="text-red-400 text-xl">✗</span>;
      case 'checking':
      default:
        return (
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
        );
    }
  };

  const getStatusColor = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'connected':
        return 'text-green-400';
      case 'disconnected':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-slate-300';
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white/10 backdrop-blur-sm rounded-lg p-8 text-center border border-white/20">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-white mb-4">
            Connection Error
          </h2>
          <p className="text-slate-300 mb-6">{error}</p>

          {/* Show service status even on error */}
          <div className="mb-6 text-left bg-black/20 rounded-lg p-4">
            <p className="text-sm text-slate-400 mb-3">Service Status:</p>
            {services.map((service) => (
              <div key={service.name} className="flex items-center justify-between py-2 border-b border-white/10 last:border-0">
                <span className="text-slate-300">{service.name}</span>
                <div className="flex items-center gap-2">
                  {service.message && (
                    <span className={`text-xs ${getStatusColor(service.status)}`}>{service.message}</span>
                  )}
                  {getStatusIcon(service.status)}
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              setError(null);
              setRetryCount(0);
              setServices([
                { name: 'Backend API', status: 'checking' },
                { name: 'Database', status: 'checking' },
                { name: 'Cache (Redis)', status: 'checking' },
              ]);
              runCheck();
            }}
            className="px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-semibold rounded-lg transition-all duration-300"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-red-500 mb-4"></div>
          <p className="text-white text-xl mb-2">Initializing The Logbook</p>
          <p className="text-slate-400 text-sm">{statusMessage}</p>
        </div>

        {/* Service Status Cards */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
          <h3 className="text-white font-semibold mb-4">Service Status</h3>

          {services.map((service) => (
            <div
              key={service.name}
              className="flex items-center justify-between py-3 border-b border-white/10 last:border-0"
            >
              <div className="flex flex-col">
                <span className="text-white">{service.name}</span>
                {service.message && (
                  <span className={`text-xs ${getStatusColor(service.status)}`}>
                    {service.message}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm ${getStatusColor(service.status)}`}>
                  {service.status === 'connected' && 'Ready'}
                  {service.status === 'disconnected' && 'Waiting...'}
                  {service.status === 'error' && 'Error'}
                  {service.status === 'checking' && 'Checking...'}
                </span>
                {getStatusIcon(service.status)}
              </div>
            </div>
          ))}

          {isWaiting && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"></span>
                <span>Auto-retrying... ({retryCount}/{MAX_RETRIES})</span>
              </div>
              <p className="text-slate-500 text-xs mt-2">
                Please wait while services start up. This is normal on first deployment.
              </p>
            </div>
          )}
        </div>

        {/* Help text */}
        <div className="mt-4 text-center">
          <p className="text-slate-500 text-xs">
            If services don't connect after a few minutes, check your Docker logs.
          </p>
        </div>
      </div>
    </div>
  );
};

export default OnboardingCheck;
