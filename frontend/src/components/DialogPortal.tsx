/**
 * Renders a dialog's fixed-position shell into `document.body`.
 *
 * A `position: fixed` overlay is only positioned against the viewport while no
 * ancestor establishes a containing block for it. `backdrop-filter`, `filter`,
 * `transform`, `perspective`, `contain` and `will-change` all do, and the app's
 * own `card` / `stat-card` utilities carry `backdrop-blur-xs` for the dark-mode
 * glass surface — so a dialog declared inside a card is laid out inside that
 * card instead of over the page.
 *
 * The failure is silent and does not look like a positioning bug: the panel is
 * centred in the card's box, keeps its `100dvh` height cap, and so hangs off
 * the bottom of the screen with its action row unreachable. Body scroll is
 * locked while a dialog is open, so nothing can bring that row back. That is
 * what made an edit to a pipeline stage impossible to save (2026-08-25) — the
 * "Update Stage" button sat ~265px below the fold with no way to scroll to it.
 *
 * Portalling to the body puts the shell outside every page container, so no
 * ancestor a page happens to introduce can capture it. React context and event
 * bubbling follow the React tree, not the DOM, so consumers are unaffected.
 */
import React, { type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface DialogPortalProps {
  children: ReactNode;
}

export const DialogPortal: React.FC<DialogPortalProps> = ({ children }) => {
  // The app is a browser-only SPA (and jsdom supplies a body in tests), so the
  // target always exists by the time a dialog renders.
  if (typeof document === 'undefined') return <>{children}</>;
  return createPortal(children, document.body);
};

export default DialogPortal;
