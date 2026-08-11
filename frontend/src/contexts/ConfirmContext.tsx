/**
 * App-wide confirmation dialog.
 *
 * Replaces `window.confirm` while keeping the shape of the call it replaces —
 *
 *     if (!(await confirm({ message: 'Delete this?' }))) return;
 *
 * — so a call site reads the same as the blocking builtin did, and converting
 * one is a single line rather than hoisting the pending action into component
 * state and splitting the function in two.
 *
 * The dialog is rendered once, here, rather than handed back to each caller to
 * mount. An earlier version returned the element and every consumer had to
 * remember to render it; forgetting meant `confirm()` set state nothing was
 * listening to, its promise never settled, the caller's `await` hung forever
 * and the action silently did nothing — the exact failure this component
 * exists to eliminate. Nothing to render is nothing to forget.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ux/ConfirmDialog';

export interface ConfirmOptions {
  /** Accepts a node so a decision that turns on a list can be shown as one. */
  message: React.ReactNode;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  // Mirrored into a ref so unmount can settle a promise a caller is still
  // awaiting, and so a second question can answer the first before replacing
  // it. Either way an unsettled promise would strand the caller mid-function.
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;
  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
    },
    []
  );

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false);
        setPending({ options, resolve });
      }),
    []
  );

  const settle = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed);
    setPending(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        isOpen={pending !== null}
        onClose={() => settle(false)}
        onConfirm={() => settle(true)}
        title={pending?.options.title ?? 'Are you sure?'}
        message={pending?.options.message ?? ''}
        {...(pending?.options.confirmLabel ? { confirmLabel: pending.options.confirmLabel } : {})}
        {...(pending?.options.cancelLabel ? { cancelLabel: pending.options.cancelLabel } : {})}
        variant={pending?.options.variant ?? 'danger'}
      />
    </ConfirmContext.Provider>
  );
};

/**
 * Ask the user to confirm something. Returns true if they did.
 *
 * Throws when no provider is mounted. That is deliberate: the alternative is
 * resolving the promise to some default, and neither default is safe — `true`
 * would carry out a deletion nobody agreed to, `false` would swallow the action
 * without a word. A missing provider is a wiring mistake, and it should fail
 * loudly at the call rather than quietly at the consequence.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): { confirm: ConfirmFn } {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error(
      'useConfirm must be used within a ConfirmProvider (mounted at the app root, and in test render helpers)'
    );
  }
  return { confirm };
}

export default ConfirmProvider;
