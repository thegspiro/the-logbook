import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

interface OnboardingStatus {
  needs_onboarding: boolean;
  is_completed: boolean;
  current_step: number;
  total_steps: number;
  steps_completed: Record<string, any>;
  organization_name: string | null;
}

const OnboardingCheck: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const response = await axios.get<OnboardingStatus>(
        `${apiUrl}/api/v1/onboarding/status`
      );

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
      setLoading(false);
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
          <button
            onClick={checkOnboardingStatus}
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
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-red-500 mb-4"></div>
        <p className="text-white text-xl">Checking system status...</p>
      </div>
    </div>
  );
};

export default OnboardingCheck;
