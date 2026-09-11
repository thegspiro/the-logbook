/**
 * A tag pill with actions on it.
 *
 * Extracted because two lists in this module render the same chip — the shared
 * EditableTagList and ShiftReportsSettingsPanel's own TagListEditor — with the
 * same actions in the same pill and only their action *set* differing. They had
 * drifted already, and a chip has one property worth stating once: the actions
 * on it do not fit a finger.
 *
 * At desktop density the actions sit inline as 12px icons, which suits a
 * pointer. Four 44px targets do not fit a pill, and growing them anyway makes a
 * chip about 200px wide, so a tag list becomes one chip per row. On a phone the
 * pill itself is therefore the target, and the actions appear beneath the one
 * pressed.
 *
 * `useMediaQuery` rather than `hidden md:inline-flex`, on that hook's own
 * advice: rendering both and hiding one puts every action into the
 * accessibility tree twice.
 */

import React, { useState } from 'react';
import { useMediaQuery } from '../../../hooks/useMediaQuery';

export interface TagChipAction {
  /** Rendered inside the button; sized by the chip, not the caller. */
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  /**
   * The accessible name, and it must name the item. "Move up" alone tells a
   * screen-reader user nothing about which of a dozen chips it moves.
   */
  label: string;
  disabled?: boolean;
  /** Extra classes for this action alone, e.g. a destructive hover colour. */
  className?: string;
}

interface TagChipProps {
  item: string;
  actions: TagChipAction[];
  /** Pill colour and border. */
  className?: string;
  title?: string | undefined;
}

export const TagChip: React.FC<TagChipProps> = ({ item, actions, className = '', title }) => {
  const isPhone = useMediaQuery('(max-width: 767px)');
  const [open, setOpen] = useState(false);

  const iconSize = isPhone ? 'h-4 w-4' : 'h-3 w-3';
  const actionClass = isPhone ? 'mobile-touch-target rounded-full' : 'rounded-full p-0.5';

  const buttons = actions.map(({ icon: Icon, onClick, label, disabled, className: actionExtra = '' }) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        onClick();
        setOpen(false);
      }}
      disabled={disabled ?? false}
      className={`${actionClass} transition-colors disabled:opacity-30 ${actionExtra}`}
      aria-label={label}
    >
      <Icon className={iconSize} />
    </button>
  ));

  if (isPhone) {
    return (
      <span
        className={`inline-flex flex-wrap items-center gap-1 rounded-full px-2.5 text-xs font-medium ${className}`}
        title={title}
      >
        <button
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={open}
          aria-label={`Actions for ${item}`}
          className="mobile-touch-row bg-transparent font-medium text-inherit"
        >
          {item}
        </button>
        {open && <span className="flex items-center gap-1">{buttons}</span>}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
      title={title}
    >
      {item}
      {buttons}
    </span>
  );
};

export default TagChip;
