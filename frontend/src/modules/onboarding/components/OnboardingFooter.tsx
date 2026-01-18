import React from 'react';

interface OnboardingFooterProps {
  departmentName: string;
}

const OnboardingFooter: React.FC<OnboardingFooterProps> = ({ departmentName }) => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-slate-900/50 backdrop-blur-sm border-t border-white/10 px-6 py-4">
      <div className="max-w-7xl mx-auto text-center">
        <p className="text-slate-300 text-sm">
          © {currentYear} {departmentName}. All rights reserved.
        </p>
        <p className="text-slate-500 text-xs mt-1">Powered by The Logbook</p>
      </div>
    </footer>
  );
};

export default OnboardingFooter;
