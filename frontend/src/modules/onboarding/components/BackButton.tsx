/**
 * BackButton Component
 *
 * Reusable back button for onboarding flow
 * Used in steps 2-9 (not step 1 which is the entry point)
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface BackButtonProps {
  /**
   * Optional specific path to navigate to
   * If not provided, uses navigate(-1) for browser back
   */
  to?: string;

  /**
   * Optional className for custom styling
   */
  className?: string;

  /**
   * Optional label text (defaults to "Back")
   */
  label?: string;
}

export const BackButton: React.FC<BackButtonProps> = ({
  to,
  className = '',
  label = 'Back'
}) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (to) {
      navigate(to);
    } else {
      navigate(-1);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary bg-transparent border border-theme-input-border hover:border-theme-input-border rounded-lg font-medium transition-all duration-300 ${className}`}
      aria-label={`Go back to previous step`}
    >
      <ArrowLeft className="w-4 h-4 mr-2" />
      {label}
    </button>
  );
};
