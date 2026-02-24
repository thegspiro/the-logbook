import React from 'react';
import { Shield, Sun, Moon, Monitor, Contrast } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';

interface OnboardingHeaderProps {
  departmentName: string;
  logoPreview?: string | null;
  icon?: React.ReactNode;
}

const OnboardingHeader: React.FC<OnboardingHeaderProps> = ({
  departmentName,
  logoPreview,
  icon = <Shield aria-hidden="true" className="w-6 h-6 text-white" />,
}) => {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    const order = ['light', 'dark', 'system', 'high-contrast'] as const;
    const currentIndex = order.indexOf(theme as typeof order[number]);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex] ?? 'system');
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : theme === 'high-contrast' ? Contrast : Monitor;
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : theme === 'high-contrast' ? 'High Contrast' : 'System';

  return (
    <header className="bg-theme-nav-bg backdrop-blur-sm border-b border-theme-nav-border px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center">
        {logoPreview ? (
          <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center overflow-hidden mr-4">
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
        <div className="flex-1 min-w-0">
          <h1 className="text-theme-text-primary text-lg font-semibold">{departmentName}</h1>
          <p className="text-theme-text-muted text-sm">Setup in Progress</p>
        </div>
        <button
          onClick={cycleTheme}
          className="ml-4 text-theme-text-secondary p-2 rounded-md hover:bg-theme-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
          title={`Theme: ${themeLabel}`}
          aria-label={`Current theme: ${themeLabel}. Click to cycle theme.`}
        >
          <ThemeIcon className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};

export default OnboardingHeader;
