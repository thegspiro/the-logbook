import React from 'react';
import { Shield, Sun, Moon, Monitor, Contrast } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';

interface OnboardingHeaderProps {
  departmentName: string;
  logoPreview?: string | null;
  icon?: React.ReactNode;
  /** Line under the department name. The final step overrides the default. */
  subtitle?: string;
}

const OnboardingHeader: React.FC<OnboardingHeaderProps> = ({
  departmentName,
  logoPreview,
  icon = <Shield aria-hidden="true" className="h-6 w-6 text-white" />,
  subtitle = 'Setup in Progress',
}) => {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    const order = ['light', 'dark', 'system', 'high-contrast'] as const;
    const currentIndex = order.indexOf(theme);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex] ?? 'system');
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : theme === 'high-contrast' ? Contrast : Monitor;
  const themeLabel =
    theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : theme === 'high-contrast' ? 'High Contrast' : 'System';

  return (
    <header className="bg-theme-nav-bg border-theme-nav-border border-b px-6 py-4 backdrop-blur-xs">
      <div className="mx-auto flex max-w-7xl items-center">
        {logoPreview ? (
          <div className="bg-theme-surface mr-4 flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg">
            <img src={logoPreview} alt={`${departmentName} logo`} className="max-h-full max-w-full object-contain" />
          </div>
        ) : (
          <div className="mr-4 flex h-12 w-12 items-center justify-center rounded-lg bg-red-600">{icon}</div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-theme-text-primary text-lg font-semibold">{departmentName}</h1>
          <p className="text-theme-text-muted text-sm">{subtitle}</p>
        </div>
        <button
          onClick={cycleTheme}
          className="text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring ml-4 rounded-md p-2 transition-colors focus:ring-2 focus:outline-hidden"
          title={`Theme: ${themeLabel}`}
          aria-label={`Current theme: ${themeLabel}. Click to cycle theme.`}
        >
          <ThemeIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};

export default OnboardingHeader;
