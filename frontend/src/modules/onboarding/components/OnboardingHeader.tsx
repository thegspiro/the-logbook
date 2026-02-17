import React from 'react';
import { Shield } from 'lucide-react';

interface OnboardingHeaderProps {
  departmentName: string;
  logoPreview?: string | null;
  icon?: React.ReactNode;
}

const OnboardingHeader: React.FC<OnboardingHeaderProps> = ({
  departmentName,
  logoPreview,
  icon = <Shield className="w-6 h-6 text-white" />,
}) => {
  return (
    <header className="bg-theme-nav-bg backdrop-blur-sm border-b border-theme-nav-border px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center">
        {logoPreview ? (
          <div className="w-12 h-12 rounded-lg flex items-center justify-center overflow-hidden mr-4">
            <img
              src={logoPreview}
              alt={`${departmentName} logo`}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        ) : (
          <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center mr-4">
            {icon}
          </div>
        )}
        <div>
          <h1 className="text-theme-text-primary text-lg font-semibold">{departmentName}</h1>
          <p className="text-theme-text-muted text-sm">Setup in Progress</p>
        </div>
      </div>
    </header>
  );
};

export default OnboardingHeader;
