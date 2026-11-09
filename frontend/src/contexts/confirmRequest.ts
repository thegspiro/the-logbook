/**
 * The confirmation context itself, apart from the provider that renders the
 * dialog (ConfirmContext.tsx).
 *
 * Kept in its own module so shared plumbing that only sometimes asks — `Modal`
 * and `DialogPanel` ask before discarding only when given `isDirty` (see
 * useDiscardGuard) — does not depend on the provider module. Dozens of tests
 * replace that module with a stub exporting only `useConfirm`; a dialog that
 * never asks must still render under them.
 */
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

export interface ConfirmOptions {
  /** Accepts a node so a decision that turns on a list can be shown as one. */
  message: React.ReactNode;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
export type RequestConfirmFn = (options: ConfirmOptions, signal: AbortSignal) => Promise<boolean>;

export const ConfirmContext = createContext<RequestConfirmFn | null>(null);
export const missingProviderMessage =
  'useConfirm must be used within a ConfirmProvider (mounted at the app root, and in test render helpers)';

/**
 * The confirm function and whether a provider is mounted, without throwing.
 *
 * useConfirm is this plus the throw. Callers that only sometimes ask use it
 * directly, and must still refuse to run without a provider at the point they
 * would ask; see useDiscardGuard.
 */
export function useConfirmRequest(): { confirm: ConfirmFn; available: boolean } {
  const requestConfirm = useContext(ConfirmContext);
  const controllerRef = useRef(new AbortController());

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    return () => controller.abort();
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (options) => {
      if (!requestConfirm) throw new Error(missingProviderMessage);
      return requestConfirm(options, controllerRef.current.signal);
    },
    [requestConfirm]
  );

  return { confirm, available: requestConfirm !== null };
}
