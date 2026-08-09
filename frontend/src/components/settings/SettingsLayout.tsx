/**
 * Shared shell for a multi-section settings screen.
 *
 * Every settings screen presents the same way: a section list that is a sidebar
 * on desktop and a scrollable tab strip on phones, with the active section's
 * content in a surface card beside it. Owning that here means a new settings
 * screen inherits the layout instead of re-deriving it — the copies that
 * predated this component had already drifted apart on container width, active
 * colour, and whether the nav was labelled for screen readers at all.
 *
 * The shell renders the page container, so a caller supplies only its header
 * block and the active section's content.
 */

import React from 'react';

export interface SettingsSection<K extends string = string> {
  key: K;
  label: string;
  icon: React.ElementType;
  /** One line under the label in the desktop sidebar; omitted on mobile. */
  description: string;
}

interface SettingsLayoutProps<K extends string> {
  sections: SettingsSection<K>[];
  activeSection: K;
  onSectionChange: (key: K) => void;
  /**
   * aria-label for both nav landmarks. Two landmarks carry the same label
   * because only one is ever visible at a given breakpoint; the label names the
   * page ("Scheduling settings sections") so a screen reader announces which
   * settings screen it is on.
   */
  navLabel: string;
  /** Title block, rendered above the nav/content row. */
  header?: React.ReactNode;
  children: React.ReactNode;
}

export function SettingsLayout<K extends string>({
  sections,
  activeSection,
  onSectionChange,
  navLabel,
  header,
  children,
}: SettingsLayoutProps<K>) {
  // Colours and focus behaviour come from the settings-nav-item utilities in
  // styles/index.css; only the per-breakpoint box shape is set here.
  const buttonClass = (isActive: boolean, shape: string) =>
    `settings-nav-item ${shape} ${isActive ? 'settings-nav-item-active' : ''}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {header}

      <div className="flex flex-col gap-6 md:flex-row">
        {/* Mobile: horizontal scrollable tabs */}
        <nav className="border-theme-surface-border -mx-4 border-b px-4 md:hidden" aria-label={navLabel}>
          <div className="flex scrollbar-thin gap-1 overflow-x-auto scroll-smooth pb-2">
            {sections.map(({ key, label, icon: Icon }) => {
              const isActive = activeSection === key;
              return (
                <button
                  key={key}
                  onClick={() => onSectionChange(key)}
                  className={buttonClass(
                    isActive,
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap'
                  )}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? '' : 'text-theme-text-muted'}`} />
                  {label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Desktop: sidebar */}
        <nav className="hidden shrink-0 md:block md:w-56" aria-label={navLabel}>
          <div className="space-y-1 md:sticky md:top-24">
            {sections.map(({ key, label, icon: Icon, description }) => {
              const isActive = activeSection === key;
              return (
                <button
                  key={key}
                  onClick={() => onSectionChange(key)}
                  className={buttonClass(isActive, 'flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left')}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isActive ? '' : 'text-theme-text-muted'}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    <p className={`text-xs ${isActive ? 'text-theme-accent-blue/70' : 'text-theme-text-muted'}`}>
                      {description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Content panel */}
        <main className="min-w-0 flex-1">
          <div className="bg-theme-surface rounded-lg p-4 shadow-sm backdrop-blur-xs sm:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default SettingsLayout;
