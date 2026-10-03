/**
 * Bottom-bar tabs (My Account → Appearance).
 *
 * Lets a member choose the two tabs either side of Quick Add on the phone
 * bottom bar. The choice is saved to their account, so it follows them to
 * every device. Saves on change, like the other personal settings, with the
 * shared status pill as the answer to "did that stick?".
 */

import React, { useState } from 'react';
import { userService } from '../../services/userServices';
import { useAuthStore } from '../../stores/authStore';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { bottomNavChoices, resolveBottomNavTabs } from '../layout/bottomNavTabs';
import { SaveStatusPill, type SaveState } from './SaveStatusPill';

const SLOT_LABELS = ['Left of Add', 'Right of Add'];

export const BottomNavigationSettings: React.FC = () => {
  const chosen = useAuthStore((state) => state.user?.bottom_nav_slots);
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const setBottomNavSlots = useAuthStore((state) => state.setBottomNavSlots);
  const { isModuleOn } = useEnabledModules();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // What the member last asked for while it is unsaved or failed to save. A
  // failed save keeps showing their pick rather than snapping back, so the
  // retry sends what they see (see SaveStatusPill).
  const [draft, setDraft] = useState<string[] | null>(null);
  const [pendingReset, setPendingReset] = useState(false);

  // The picker shows exactly what the bar shows, from the same resolver.
  const showing = resolveBottomNavTabs({ chosen, isModuleOn, checkPermission })
    .slice(1)
    .map((tab) => tab.path);
  const choices = bottomNavChoices({ isModuleOn, checkPermission });
  const selected = draft ?? showing;
  const hasChoice = Boolean(chosen?.length);

  const save = async (slots: string[] | null): Promise<void> => {
    setSaveState('saving');
    try {
      const saved = await userService.setMyBottomNavigation(slots);
      setBottomNavSlots(saved);
      setDraft(null);
      setPendingReset(false);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const choose = (index: number, path: string): void => {
    const next = selected.map((current, i) => (i === index ? path : current));
    setDraft(next);
    setPendingReset(false);
    void save(next);
  };

  const useDefaults = (): void => {
    setDraft(null);
    setPendingReset(true);
    void save(null);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-theme-text-primary text-base font-semibold">Phone navigation bar</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            Choose the two tabs beside Add on the bar at the bottom of the screen on a phone. Saved to your account, so
            they follow you to every device.
          </p>
        </div>
        <SaveStatusPill state={saveState} onRetry={() => void save(pendingReset ? null : selected)} />
      </div>

      <div className="form-grid-2">
        {selected.map((path, index) => {
          const other = selected[index === 0 ? 1 : 0];
          const id = `bottom-nav-slot-${index}`;
          return (
            <div key={id}>
              <label htmlFor={id} className="form-label">
                {SLOT_LABELS[index] ?? `Tab ${index + 1}`}
              </label>
              <select
                id={id}
                className="form-input"
                value={path}
                disabled={saveState === 'saving'}
                onChange={(event) => choose(index, event.target.value)}
              >
                {choices.map((tab) => (
                  <option key={tab.path} value={tab.path} disabled={tab.path === other}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      {hasChoice && (
        <button
          type="button"
          onClick={useDefaults}
          disabled={saveState === 'saving'}
          className="text-theme-text-secondary hover:text-theme-text-primary mobile-touch-target mt-3 text-sm underline underline-offset-2"
        >
          Use the default tabs
        </button>
      )}
    </div>
  );
};

export default BottomNavigationSettings;
