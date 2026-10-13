import { useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

/**
 * Keyboard support for a `role="tablist"`, per the WAI-ARIA tabs pattern with
 * automatic activation — the model AdminHubFrame already implements.
 *
 * Twenty tablists claimed the role without it: every tab sat in the Tab order
 * and the arrow keys did nothing, which is the opposite of what a screen reader
 * announcing "tab, 1 of 3" tells its user to expect (WCAG 4.1.2, 2.1.1).
 *
 * Spread the result onto the tablist. Arrow keys, Home and End move focus to
 * a tab and activate it by clicking it, so each tablist's own onClick stays
 * the single place selection changes. After every render only the selected tab
 * (`aria-selected="true"`, else the first) keeps tabIndex 0.
 */
export interface TablistProps<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onKeyDown: (event: KeyboardEvent<T>) => void;
}

const enabledTabs = (list: HTMLElement): HTMLElement[] =>
  Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')).filter(
    (tab) => !tab.hasAttribute('disabled') && tab.getAttribute('aria-disabled') !== 'true'
  );

export function useTablist<T extends HTMLElement = HTMLDivElement>(): TablistProps<T> {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const tabs = enabledTabs(list);
    const selected = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0];
    for (const tab of tabs) tab.tabIndex = tab === selected ? 0 : -1;
  });

  const onKeyDown = (event: KeyboardEvent<T>) => {
    const tabs = enabledTabs(event.currentTarget);
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    if (current === -1) return;
    let next: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    const target = tabs[next];
    target?.focus();
    target?.click();
  };

  return { ref, onKeyDown };
}
