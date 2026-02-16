/**
 * HelpLink Component
 *
 * Provides contextual help links throughout the application.
 * Links can open documentation pages, tooltips, or external help resources.
 */

import React, { useState } from 'react';
import { HelpCircle, ExternalLink, X } from 'lucide-react';

interface HelpLinkProps {
  /** Help topic identifier (e.g., "dashboard", "organization-setup") */
  topic: string;
  /** Display variant */
  variant?: 'icon' | 'button' | 'inline';
  /** Custom label for button variant */
  label?: string;
  /** Tooltip content for quick help */
  tooltip?: string;
  /** External documentation URL */
  docUrl?: string;
  /** Position of the tooltip */
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
}

export const HelpLink: React.FC<HelpLinkProps> = ({
  topic,
  variant = 'icon',
  label = 'Help',
  tooltip,
  docUrl,
  tooltipPosition = 'top',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  // Default documentation URLs for common topics
  const getDocUrl = (): string => {
    if (docUrl) return docUrl;

    const baseUrl = '/docs'; // This would be your documentation base URL
    const topicUrls: Record<string, string> = {
      'dashboard': `${baseUrl}/dashboard`,
      'organization-setup': `${baseUrl}/onboarding/organization`,
      'members': `${baseUrl}/members/overview`,
      'events': `${baseUrl}/events/overview`,
      'reports': `${baseUrl}/reports`,
      'training': `${baseUrl}/training`,
      'settings': `${baseUrl}/settings`,
    };

    return topicUrls[topic] || `${baseUrl}/${topic}`;
  };

  const handleClick = () => {
    if (tooltip) {
      setShowTooltip(!showTooltip);
    } else {
      // Open documentation in new tab
      window.open(getDocUrl(), '_blank', 'noopener,noreferrer');
    }
  };

  // Position classes for tooltip
  const getTooltipPositionClasses = () => {
    switch (tooltipPosition) {
      case 'top':
        return 'bottom-full left-1/2 -translate-x-1/2 mb-2';
      case 'bottom':
        return 'top-full left-1/2 -translate-x-1/2 mt-2';
      case 'left':
        return 'right-full top-1/2 -translate-y-1/2 mr-2';
      case 'right':
        return 'left-full top-1/2 -translate-y-1/2 ml-2';
      default:
        return 'bottom-full left-1/2 -translate-x-1/2 mb-2';
    }
  };

  // Icon variant: Just an icon button
  if (variant === 'icon') {
    return (
      <div className="relative inline-block">
        <button
          onClick={handleClick}
          className="text-theme-text-muted hover:text-theme-text-primary transition-colors p-1 rounded focus:outline-none focus:ring-2 focus:ring-red-500"
          aria-label={`Help: ${topic}`}
          type="button"
        >
          <HelpCircle className="w-5 h-5" aria-hidden="true" />
        </button>

        {/* Tooltip */}
        {showTooltip && tooltip && (
          <div className={`absolute z-50 ${getTooltipPositionClasses()}`}>
            <div className="bg-slate-800 text-theme-text-primary text-sm rounded-lg p-3 shadow-xl border border-theme-surface-border max-w-xs">
              <div className="flex items-start justify-between space-x-2 mb-2">
                <p>{tooltip}</p>
                <button
                  onClick={() => setShowTooltip(false)}
                  className="text-theme-text-muted hover:text-theme-text-primary flex-shrink-0"
                  aria-label="Close help"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <a
                href={getDocUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-cyan-700 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 flex items-center space-x-1"
              >
                <span>View full documentation</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Button variant: Full button with text
  if (variant === 'button') {
    return (
      <a
        href={getDocUrl()}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center space-x-2 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-theme-text-primary text-sm rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
      >
        <HelpCircle className="w-4 h-4" aria-hidden="true" />
        <span>{label}</span>
        <ExternalLink className="w-3 h-3" aria-hidden="true" />
      </a>
    );
  }

  // Inline variant: Text link with icon
  if (variant === 'inline') {
    return (
      <a
        href={getDocUrl()}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center space-x-1 text-cyan-700 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
      >
        <HelpCircle className="w-4 h-4" aria-hidden="true" />
        <span>{label}</span>
        <ExternalLink className="w-3 h-3" aria-hidden="true" />
      </a>
    );
  }

  return null;
};

export default HelpLink;
