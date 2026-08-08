import React from 'react';
import { Sun, Moon, Monitor, Contrast } from 'lucide-react';
import { useTheme } from '../../../contexts/ThemeContext';

interface ThemeToggleProps {
  className?: string;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
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
    <button
      onClick={cycleTheme}
      className={`text-theme-text-secondary hover:bg-theme-surface-hover focus:ring-theme-focus-ring rounded-md p-2 transition-colors focus:ring-2 focus:outline-hidden ${className}`}
      title={`Theme: ${themeLabel}`}
      aria-label={`Current theme: ${themeLabel}. Click to cycle theme.`}
    >
      <ThemeIcon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
};

export default ThemeToggle;
