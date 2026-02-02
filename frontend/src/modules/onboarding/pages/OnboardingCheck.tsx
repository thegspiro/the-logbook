import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../services/api-client';

interface ServiceStatus {
  name: string;
  status: 'checking' | 'connected' | 'disconnected' | 'error';
  message?: string;
  optional?: boolean;
}

const MAX_RETRIES = 20; // Reduced from 30 - about 1.5 minutes with delays
const INITIAL_DELAY = 2000;
const MAX_DELAY = 5000;
const SKIP_AVAILABLE_AFTER = 5; // Show skip option after 5 attempts

const OnboardingCheck: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'Backend API', status: 'checking' },
    { name: 'Database', status: 'checking' },
    { name: 'Cache (Redis)', status: 'checking', optional: true },
  ]);
  const [retryCount, setRetryCount] = useState(0);
  const [isWaiting, setIsWaiting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Connecting to services...');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showSkipOption, setShowSkipOption] = useState(false);
  const navigate = useNavigate();

  // Track elapsed time
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Show skip option after certain attempts
  useEffect(() => {
    if (retryCount >= SKIP_AVAILABLE_AFTER) {
      setShowSkipOption(true);
    }
  }, [retryCount]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const updateServiceStatus = useCallback((serviceName: string, status: ServiceStatus['status'], message?: string) => {
    setServices(prev => prev.map(s =>
      s.name === serviceName ? { ...s, status, message } : s
    ));
  }, []);

  const checkServices = useCallback(async (): Promise<boolean> => {
    setIsWaiting(false);

    const healthResponse = await apiClient.checkHealth();

    if (healthResponse.error || !healthResponse.data) {
      updateServiceStatus('Backend API', 'disconnected', healthResponse.error || 'Not responding');
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
      updateServiceStatus('Database', 'disconnected', 'Starting up...');
      return false;
    } else {
      updateServiceStatus('Database', 'error', health.checks.database);
      return false;
    }

    // Update Redis status (non-critical)
    if (health.checks.redis === 'connected') {
      updateServiceStatus('Cache (Redis)', 'connected');
    } else if (health.checks.redis === 'disconnected') {
      updateServiceStatus('Cache (Redis)', 'disconnected', 'Optional - skipped');
    } else {
      updateServiceStatus('Cache (Redis)', 'error', 'Optional - failed');
    }

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
        navigate('/onboarding/start');
      } else {
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
      setStatusMessage('Services ready! Redirecting...');
      await checkOnboardingStatus();
    } else {
      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(INITIAL_DELAY + (retryCount * 500), MAX_DELAY);
        setRetryCount(prev => prev + 1);
        setIsWaiting(true);

        const remainingAttempts = MAX_RETRIES - retryCount - 1;
        const estimatedSeconds = Math.round((remainingAttempts * (delay + 1000)) / 1000);
        setStatusMessage(`Waiting for services... (${retryCount + 1}/${MAX_RETRIES})`);

        setTimeout(() => {
          runCheck();
        }, delay);
      } else {
        setError('Services did not become ready in time. Please check that all containers are running.');
      }
    }
  }, [checkServices, checkOnboardingStatus, retryCount]);

  const handleSkip = () => {
    // Attempt to proceed anyway - useful if only Redis is down
    checkOnboardingStatus();
  };

  const handleRetry = () => {
    setError(null);
    setRetryCount(0);
    setElapsedTime(0);
    setShowSkipOption(false);
    setServices([
      { name: 'Backend API', status: 'checking' },
      { name: 'Database', status: 'checking' },
      { name: 'Cache (Redis)', status: 'checking', optional: true },
    ]);
    runCheck();
  };

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

  // Calculate progress percentage
  const progressPercent = Math.min((retryCount / MAX_RETRIES) * 100, 100);
  const connectedCount = services.filter(s => s.status === 'connected').length;
  const requiredServices = services.filter(s => !s.optional);
  const requiredConnected = requiredServices.filter(s => s.status === 'connected').length;

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
                <div className="flex items-center gap-2">
                  <span className="text-slate-300">{service.name}</span>
                  {service.optional && <span className="text-xs text-slate-500">(optional)</span>}
                </div>
                <div className="flex items-center gap-2">
                  {service.message && (
                    <span className={`text-xs ${getStatusColor(service.status)}`}>{service.message}</span>
                  )}
                  {getStatusIcon(service.status)}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleRetry}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-semibold rounded-lg transition-all duration-300"
            >
              Try Again
            </button>
            {requiredConnected === requiredServices.length && (
              <button
                onClick={handleSkip}
                className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition-all duration-300"
              >
                Continue Anyway
              </button>
            )}
          </div>
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
          <p className="text-slate-500 text-xs mt-2">Time elapsed: {formatTime(elapsedTime)}</p>
        </div>

        {/* Service Status Cards */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Service Status</h3>
            <span className="text-sm text-slate-400">{connectedCount}/{services.length} ready</span>
          </div>

          {services.map((service) => (
            <div
              key={service.name}
              className="flex items-center justify-between py-3 border-b border-white/10 last:border-0"
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-white">{service.name}</span>
                  {service.optional && <span className="text-xs text-slate-500">(optional)</span>}
                </div>
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
              {/* Progress bar */}
              <div className="w-full bg-slate-700 rounded-full h-2 mb-3">
                <div
                  className="bg-gradient-to-r from-red-500 to-orange-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">
                  Attempt {retryCount}/{MAX_RETRIES}
                </span>
                <span className="text-slate-500">
                  Auto-retrying...
                </span>
              </div>
              <p className="text-slate-500 text-xs mt-2">
                Services are starting up. This is normal on first deployment.
              </p>
            </div>
          )}
        </div>

        {/* Skip option - shown after several attempts */}
        {showSkipOption && requiredConnected >= 1 && (
          <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <p className="text-yellow-300 text-sm mb-3">
              Taking longer than expected? If the Backend API is connected, you can try to continue.
            </p>
            <button
              onClick={handleSkip}
              className="w-full px-4 py-2 bg-yellow-600/20 hover:bg-yellow-600/30 border border-yellow-500/50 text-yellow-300 font-medium rounded-lg transition-all duration-300 text-sm"
            >
              Skip Wait & Continue
            </button>
          </div>
        )}

        {/* Help text */}
        <div className="mt-4 text-center">
          <p className="text-slate-500 text-xs">
            If services don't connect, check your Docker logs with: <code className="text-slate-400">docker compose logs</code>
          </p>
        </div>
      </div>
    </div>
  );
};

export default OnboardingCheck;
