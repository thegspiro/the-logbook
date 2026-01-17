import { useState, useEffect } from 'react';
import { getOnboardingData, getDepartmentName, getLogoData } from '../utils/storage';
import { OnboardingData } from '../types';

/**
 * Custom hook to manage onboarding data from session storage
 */
export const useOnboardingStorage = () => {
  const [onboardingData, setOnboardingData] = useState<Partial<OnboardingData>>({});
  const [departmentName, setDepartmentName] = useState<string>('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    const data = getOnboardingData();
    setOnboardingData(data);

    const name = getDepartmentName();
    if (name) {
      setDepartmentName(name);
    }

    const logo = getLogoData();
    if (logo) {
      setLogoPreview(logo);
    }
  }, []);

  const refreshData = () => {
    const data = getOnboardingData();
    setOnboardingData(data);

    const name = getDepartmentName();
    if (name) {
      setDepartmentName(name);
    }

    const logo = getLogoData();
    if (logo) {
      setLogoPreview(logo);
    }
  };

  return {
    onboardingData,
    departmentName,
    logoPreview,
    refreshData,
  };
};
