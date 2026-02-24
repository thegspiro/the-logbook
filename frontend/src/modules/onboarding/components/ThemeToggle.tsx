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
    const currentIndex = order.indexOf(theme as typeof order[number]);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex] ?? 'system');
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : theme === 'high-contrast' ? Contrast : Monitor;
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : theme === 'high-contrast' ? 'High Contrast' : 'System';

  return (
    <button
      onClick={cycleTheme}
      className={`text-theme-text-secondary p-2 rounded-md hover:bg-theme-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-theme-focus-ring ${className}`}
      title={`Theme: ${themeLabel}`}
      aria-label={`Current theme: ${themeLabel}. Click to cycle theme.`}
    >
      <ThemeIcon className="w-5 h-5" aria-hidden="true" />
    </button>
  );
};

export default ThemeToggle;
