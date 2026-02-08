import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Server, Shield, Wrench, Clock, CheckCircle2 } from 'lucide-react';
import { apiClient } from '../services/api-client';

interface ServiceStatus {
  name: string;
  status: 'checking' | 'connected' | 'disconnected' | 'error';
  message?: string;
  optional?: boolean;
}

interface StartupInfo {
  phase: string;
  message: string;
  ready: boolean;
  detailed_message?: string;
  migrations?: {
    total: number;
    completed: number;
    current: string | null;
    progress_percent: number;
  };
  uptime_seconds: number;
  errors?: string[] | null;
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
  const [startupInfo, setStartupInfo] = useState<StartupInfo | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [migrationStartTime, setMigrationStartTime] = useState<number | null>(null);
  const [lastMigrationCount, setLastMigrationCount] = useState<number>(0);
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

  // Track migration progress for ETA calculation
  useEffect(() => {
    if (startupInfo?.phase === 'migrations' && startupInfo?.migrations) {
      const { completed } = startupInfo.migrations;

      // Start timer when first migration completes
      if (completed > 0 && !migrationStartTime) {
        setMigrationStartTime(Date.now());
        setLastMigrationCount(completed);
      }

      // Update count when migrations progress
      if (completed > lastMigrationCount) {
        setLastMigrationCount(completed);
      }
    }
  }, [startupInfo, migrationStartTime, lastMigrationCount]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  // Get detailed phase information with icon and description
  const getPhaseDetails = (phase: string) => {
    const phases: Record<string, { icon: React.ReactNode; title: string; description: string }> = {
      security: {
        icon: <Shield className="h-5 w-5" />,
        title: 'Security Validation',
        description: 'Verifying encryption keys and security configuration'
      },
      database: {
        icon: <Database className="h-5 w-5" />,
        title: 'Database Connection',
        description: 'Establishing connection to MySQL database (may retry while database initializes)'
      },
      migrations: {
        icon: <Wrench className="h-5 w-5" />,
        title: 'Database Setup',
        description: 'Creating database tables for users, training, events, elections, and more (this may take 1-2 minutes on first startup)'
      },
      redis: {
        icon: <Server className="h-5 w-5" />,
        title: 'Cache Connection',
        description: 'Connecting to Redis cache service'
      },
      ready: {
        icon: <CheckCircle2 className="h-5 w-5" />,
        title: 'Ready',
        description: 'All systems ready'
      }
    };
    return phases[phase] || {
      icon: <Clock className="h-5 w-5" />,
      title: 'Initializing',
      description: 'Preparing backend services'
    };
  };

  // Calculate estimated time remaining for migrations
  const getEstimatedTimeRemaining = (): string | null => {
    if (!startupInfo?.migrations || !migrationStartTime) return null;

    const { completed, total } = startupInfo.migrations;
    if (completed === 0 || completed === total) return null;

    const elapsed = (Date.now() - migrationStartTime) / 1000; // seconds
    const avgTimePerMigration = elapsed / completed;
    const remaining = (total - completed) * avgTimePerMigration;

    if (remaining < 5) return 'less than 5 seconds';
    if (remaining < 60) return `~${Math.round(remaining)} seconds`;
    return `~${Math.round(remaining / 60)} minute${Math.round(remaining / 60) > 1 ? 's' : ''}`;
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
      // Don't clear startupInfo - preserve last known state for user visibility
      return false;
    }

    const health = healthResponse.data;

    // Check for schema errors
    if (health.schema_error) {
      setSchemaError(health.schema_error);
      setError('Database schema is inconsistent and requires a reset.');
      return false;
    }

    // Extract startup info if available
    if (health.startup) {
      setStartupInfo(health.startup as StartupInfo);
      // Update status message based on startup phase
      if (!health.startup.ready) {
        setStatusMessage(health.startup.message || 'Starting up...');
      }
      // Check for startup errors
      if (health.startup.errors && health.startup.errors.length > 0) {
        const hasSchemaError = health.startup.errors.some(
          (e: string) => e.toLowerCase().includes('schema')
        );
        if (hasSchemaError) {
          setSchemaError(
            'Database schema is inconsistent. This usually happens when migrations fail partway through.'
          );
        }
      }
    }

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
    setStatusMessage('Checking setup status...');
    try {
      const response = await apiClient.getStatus();

      if (response.error || !response.data) {
        setError(
          response.error || 'Failed to check onboarding status. The server is running but the status endpoint returned an error.'
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
        'Failed to check onboarding status. Please verify the backend is running and try again.'
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
          <div className="text-red-400 text-6xl mb-4">{schemaError ? '🔧' : '⚠️'}</div>
          <h2 className="text-2xl font-bold text-white mb-4">
            {schemaError ? 'Database Reset Required' : 'Connection Error'}
          </h2>
          <p className="text-slate-300 mb-6">{error}</p>

          {/* Schema error specific instructions */}
          {schemaError && (
            <div className="mb-6 text-left bg-black/30 rounded-lg p-4 border border-orange-500/30">
              <p className="text-orange-300 text-sm font-semibold mb-2">To Fix This Issue:</p>
              <ol className="text-slate-300 text-sm space-y-2 list-decimal list-inside">
                <li>Stop all containers:
                  <code className="block mt-1 bg-black/40 rounded px-2 py-1 text-orange-200 font-mono text-xs">
                    docker compose down -v
                  </code>
                </li>
                <li>Rebuild and start:
                  <code className="block mt-1 bg-black/40 rounded px-2 py-1 text-orange-200 font-mono text-xs">
                    docker compose up --build
                  </code>
                </li>
              </ol>
              <p className="text-slate-400 text-xs mt-3">
                The <code className="text-orange-200">-v</code> flag removes database volumes for a fresh start.
                Since onboarding hasn't completed, no data will be lost.
              </p>
            </div>
          )}

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

          {/* Startup Progress Details */}
          {!startupInfo && isWaiting && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/30">
                    <div className="text-blue-400 animate-pulse">
                      <Server className="h-5 w-5" />
                    </div>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-blue-400 font-semibold text-base mb-1">
                    Waiting for Backend
                  </h3>
                  <p className="text-slate-300 text-sm mb-1">
                    The backend server is starting up. This process includes initializing services, connecting to the database, and running migrations.
                  </p>
                  <p className="text-slate-400 text-xs">
                    First startup can take 1-2 minutes while containers initialize and database tables are created.
                  </p>
                </div>
              </div>
            </div>
          )}
          {startupInfo && !startupInfo.ready && (
            <div className="mt-4 pt-4 border-t border-white/10">
              {(() => {
                const phaseDetails = getPhaseDetails(startupInfo.phase);
                return (
                  <>
                    {/* Current Phase with Icon */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="flex-shrink-0 mt-0.5">
                        <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/30">
                          <div className="text-orange-400 animate-pulse">
                            {phaseDetails.icon}
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-orange-400 font-semibold text-base mb-1">
                          {phaseDetails.title}
                        </h3>
                        <p className="text-slate-300 text-sm mb-1">
                          {startupInfo.detailed_message || phaseDetails.description}
                        </p>
                        {startupInfo.message && (
                          <p className="text-slate-400 text-xs">
                            {startupInfo.message}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Migration progress bar */}
                    {startupInfo.migrations && startupInfo.migrations.total > 0 && (
                      <div className="mt-3 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                          <span className="font-medium">Database Migrations</span>
                          <span className="text-orange-400 font-semibold">
                            {startupInfo.migrations.completed}/{startupInfo.migrations.total}
                          </span>
                        </div>
                        {startupInfo.migrations.completed === 0 && startupInfo.migrations.total > 0 && (
                          <div className="text-xs text-slate-400 mb-2 space-y-1">
                            <p className="font-medium text-orange-400">
                              Creating {startupInfo.migrations.total} database tables...
                            </p>
                            <p className="text-slate-500">
                              Setting up tables for users, organizations, training records, events, elections, inventory, and audit logs.
                              This process runs in the background and may take 1-2 minutes.
                            </p>
                          </div>
                        )}
                        <div className="w-full bg-slate-700 rounded-full h-2.5 mb-2">
                          <div
                            className="bg-gradient-to-r from-orange-500 to-yellow-500 h-2.5 rounded-full transition-all duration-300"
                            style={{ width: `${(startupInfo.migrations.completed / startupInfo.migrations.total) * 100}%` }}
                          ></div>
                        </div>

                        {/* Current migration and ETA */}
                        <div className="space-y-1">
                          {startupInfo.migrations.current && (
                            <p className="text-slate-400 text-xs truncate">
                              <span className="text-slate-500">Current:</span> {startupInfo.migrations.current}
                            </p>
                          )}
                          {getEstimatedTimeRemaining() && (
                            <p className="text-slate-400 text-xs">
                              <span className="text-slate-500">Est. remaining:</span> {getEstimatedTimeRemaining()}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {isWaiting && (
            <div className="mt-4 pt-4 border-t border-white/10">
              {/* Retry progress bar */}
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
                Services are starting up. On first deployment, database initialization can take 1-3 minutes.
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
