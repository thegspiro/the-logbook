import React from 'react';

interface OnboardingFooterProps {
  departmentName: string;
}

const OnboardingFooter: React.FC<OnboardingFooterProps> = ({ departmentName }) => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-theme-nav-bg border-theme-nav-border border-t px-6 py-4 backdrop-blur-xs">
      <div className="mx-auto max-w-7xl text-center">
        <p className="text-theme-text-secondary text-sm">
          © {currentYear} {departmentName}. All rights reserved.
        </p>
        <p className="text-theme-text-muted mt-1 text-xs">Powered by The Logbook</p>
      </div>
    </footer>
  );
};

export default OnboardingFooter;
