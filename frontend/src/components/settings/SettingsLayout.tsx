/**
 * Shared shell for a multi-section settings screen.
 *
 * Nine screens across the product call themselves "settings", and before this
 * component owned the chrome they rendered with five navigation idioms, four
 * container widths and an accent colour (violet) that is declared in no theme.
 * Everything here exists so a new settings screen inherits one answer instead
 * of inventing a fifth.
 *
 * The shell is two levels. Sections run across the top as a segmented pill row;
 * a section's own sub-pages take a left rail beneath it. A section with no
 * sub-pages drops the rail entirely and the panel runs full width — the rail is
 * never rendered empty, and no screen ever carries two stacked horizontal
 * strips. Both levels reuse an active treatment the app already has, so neither
 * is new to a member: blue-muted for the selected section, the 3px red marker
 * for the selected sub-page.
 *
 * The shell renders the page container and the title block, so a caller
 * supplies the section list, the active keys, and the active panel's content.
 */

import React from 'react';
import { Settings as SettingsIcon, ArrowLeft } from 'lucide-react';
import SaveStatusPill, { type SaveState } from './SaveStatusPill';

export interface SettingsSubPage<K extends string = string> {
  key: K;
  label: string;
  /** One line under the label; hidden below md, where the rail is a strip. */
  hint?: string;
}

export interface SettingsSection<K extends string = string, S extends string = string> {
  key: K;
  label: string;
  icon: React.ElementType;
  /**
   * One line describing the section. Rendered as the page subtitle when this
   * section is active, so it is still the caller's one-line summary — it just
   * no longer sits in a sidebar that this shell does not have.
   */
  description: string;
  /**
   * The section's own pages. Omitted or empty means the section has no second
   * level, and the rail is not rendered for it.
   */
  subPages?: SettingsSubPage<S>[];
}

interface SettingsLayoutProps<K extends string, S extends string> {
  sections: SettingsSection<K, S>[];
  activeSection: K;
  onSectionChange: (key: K) => void;
  /** Null when the active section has no sub-pages. */
  activeSubPage?: S | null;
  onSubPageChange?: (key: S) => void;
  /**
   * aria-label for the section nav landmark. Names the page ("Scheduling
   * settings sections") so a screen reader announces which settings screen it
   * is on, not merely that it found some settings.
   */
  navLabel: string;
  /** Page title — names the page ("Organization Settings"), never the module alone. */
  title: string;
  /** One line under the title. Defaults to the active section's description. */
  subtitle?: string;
  /** Autosave status. Omitted on screens that still save explicitly. */
  saveState?: SaveState;
  onRetrySave?: (() => void) | undefined;
  /**
   * Extra header controls, rendered left of the autosave pill — a HelpLink for
   * the page, and nothing that competes with the pill for the same meaning.
   */
  headerAside?: React.ReactNode;
  /** Renders a back button left of the icon tile when set. */
  onBack?: (() => void) | undefined;
  backLabel?: string;
  children: React.ReactNode;
}

export function SettingsLayout<K extends string, S extends string = string>({
  sections,
  activeSection,
  onSectionChange,
  activeSubPage = null,
  onSubPageChange,
  navLabel,
  title,
  subtitle,
  saveState,
  onRetrySave,
  headerAside,
  onBack,
  backLabel = 'Go back',
  children,
}: SettingsLayoutProps<K, S>) {
  const current = sections.find((section) => section.key === activeSection);
  const subPages = current?.subPages ?? [];
  const hasSubPages = subPages.length > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* One content column at every settings screen, replacing the max-w-4xl /
          5xl / 6xl / 1600px the nine screens had drifted into. */}
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                aria-label={backLabel}
                className="btn-icon text-theme-text-muted hover:text-theme-text-primary shrink-0"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : null}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-600">
              <SettingsIcon className="h-6 w-6 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-theme-text-primary text-2xl leading-8 font-bold">{title}</h1>
              <p className="text-theme-text-muted mt-0.5 text-sm">{subtitle ?? current?.description}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerAside}
            {saveState ? <SaveStatusPill state={saveState} onRetry={onRetrySave} /> : null}
          </div>
        </header>

        <nav className="segmented-group hscroll flex gap-1 md:flex-wrap md:overflow-x-visible" aria-label={navLabel}>
          {sections.map(({ key, label, icon: Icon }) => {
            const isActive = activeSection === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSectionChange(key)}
                className={`settings-section-tab ${isActive ? 'settings-nav-item-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? '' : 'text-theme-text-muted'}`} />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
          {hasSubPages ? (
            <nav
              className="border-theme-surface-border hscroll flex shrink-0 gap-1 border-b pb-2 md:w-52 md:flex-col md:gap-0 md:border-b-0 md:border-l md:pb-0"
              aria-label={`${current?.label ?? ''} pages`.trim()}
            >
              {subPages.map(({ key, label, hint }) => {
                const isActive = activeSubPage === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSubPageChange?.(key)}
                    className={`settings-subnav-item ${isActive ? 'settings-subnav-item-active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="block text-sm font-medium">{label}</span>
                    {hint ? <span className="text-theme-text-muted mt-0.5 hidden text-xs md:block">{hint}</span> : null}
                  </button>
                );
              })}
            </nav>
          ) : null}

          <main className="card min-w-0 flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

export default SettingsLayout;
