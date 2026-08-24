/**
 * Title block at the top of a settings panel.
 *
 * Every panel across the settings screens opens the same way — a title, a line
 * of description, and optionally a short right-aligned fact about the thing
 * being configured ("6 ranks", "Gmail · Workspace"). Owning that here keeps the
 * type scale from drifting the way the page titles did, where the same heading
 * rendered at 30px, 24px, 20px and not at all depending on the screen.
 */

import React from 'react';

interface SettingsPanelHeadProps {
  title: string;
  /**
   * `| undefined` is explicit on the optional props because
   * exactOptionalPropertyTypes is on: callers derive these from state and pass
   * the result straight through, so the value genuinely can be undefined
   * rather than the key merely being absent.
   */
  description?: string | undefined;
  /** Short status fact, right-aligned. Never a control. */
  meta?: string | undefined;
}

export const SettingsPanelHead: React.FC<SettingsPanelHeadProps> = ({ title, description, meta }) => (
  <div className="mb-5 flex items-baseline justify-between gap-3">
    <div className="min-w-0">
      <h2 className="text-theme-text-primary text-lg leading-7 font-semibold">{title}</h2>
      {description ? <p className="text-theme-text-muted mt-1 text-sm">{description}</p> : null}
    </div>
    {meta ? <span className="text-theme-text-muted shrink-0 text-xs whitespace-nowrap">{meta}</span> : null}
  </div>
);

export default SettingsPanelHead;
