/**
 * Quick Add — the phone bottom bar's one action, as opposed to its four
 * destinations.
 *
 * Every capture flow in the app was previously three or four navigation taps
 * from wherever the member was standing: More, then the drawer, then the
 * module, then the page, then its button. This is the two-tap version of the
 * same journey, and it deliberately adds no forms of its own — each row lands
 * on the screen that already owns that entry.
 *
 * Built on the shared `Modal` rather than a hand-rolled shell. That is where
 * the focus trap, Escape, body scroll lock, portal, height cap and — the one
 * that matters here — `useOverlaySurface` registration come from. Without that
 * registration the bottom bar, which is `fixed bottom-0 z-50` and painted after
 * the page, would sit on top of the sheet its own tab just opened.
 */

import React from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Modal } from '../Modal';
import { useAuthStore } from '../../stores/authStore';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { prefetchRoute } from '../../utils/routePrefetch';
import { availableQuickAddActions, QUICK_ADD_SECTIONS, type QuickAddAction } from './quickAddActions';

interface QuickAddSheetProps {
  isOpen: boolean;
  /** Dismissed without choosing — Escape, the backdrop, or the close button. */
  onClose: () => void;
  /**
   * A row was chosen and the sheet is navigating.
   *
   * Distinct from `onClose` because of where focus should land: a dismissal
   * returns the member to the tab they opened, and a choice hands them a new
   * page that must not have focus dragged back onto the bar behind it.
   */
  onSelected: () => void;
}

export const QuickAddSheet: React.FC<QuickAddSheetProps> = ({ isOpen, onClose, onSelected }) => {
  const navigate = useNavigate();
  const { isModuleOn } = useEnabledModules();
  const checkPermission = useAuthStore((state) => state.checkPermission);

  const actions = availableQuickAddActions(isModuleOn, checkPermission);

  const handleSelect = (action: QuickAddAction) => {
    onSelected();
    void navigate(action.path);
  };

  // routePrefetch keys on the bare path, so a row carrying a query string
  // (`/events/admin?tab=create`) would silently miss its chunk.
  const prefetch = (action: QuickAddAction) => prefetchRoute(action.path.split('?')[0] ?? action.path);

  // The tab that opens this sheet is itself hidden when nothing is available,
  // so an empty list should be unreachable. Rendering nothing rather than an
  // empty panel keeps the two in agreement if a gate ever changes underneath.
  if (actions.length === 0) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Quick add" size="sm" titleId="quick-add-title">
      <div className="flex flex-col gap-5">
        {QUICK_ADD_SECTIONS.map((section) => {
          const rows = actions.filter((action) => action.section === section);
          if (rows.length === 0) return null;
          return (
            <section key={section} aria-labelledby={`quick-add-${section.replace(/\s+/g, '-').toLowerCase()}`}>
              <h4
                id={`quick-add-${section.replace(/\s+/g, '-').toLowerCase()}`}
                className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wide uppercase"
              >
                {section}
              </h4>
              <ul className="flex flex-col gap-1.5">
                {rows.map((action) => {
                  const Icon = action.icon;
                  return (
                    <li key={action.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(action)}
                        onTouchStart={() => prefetch(action)}
                        onMouseEnter={() => prefetch(action)}
                        className="border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover focus:ring-theme-focus-ring flex min-h-[56px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus:ring-2 focus:outline-hidden"
                      >
                        <span
                          className="bg-theme-input-bg text-theme-text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                          aria-hidden="true"
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-theme-text-primary block text-sm font-medium">{action.label}</span>
                          <span className="text-theme-text-secondary block text-xs">{action.description}</span>
                        </span>
                        <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
};
