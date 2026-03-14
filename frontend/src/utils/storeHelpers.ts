/**
 * Store Helpers
 *
 * Shared utilities for Zustand stores to standardize error handling
 * and reduce boilerplate in Zustand store fetch/CRUD actions.
 */

import { getErrorMessage } from './errorHandling';

/**
 * Extracts a user-friendly error message from an unknown catch value.
 * Wraps `getErrorMessage()` for consistent usage across all stores.
 */
export function handleStoreError(err: unknown, fallback: string): string {
  return getErrorMessage(err, fallback);
}

/* ------------------------------------------------------------------
 * Generic fetch-action factory
 *
 * Eliminates the repeated pattern found in 15+ Zustand stores:
 *
 *   set({ isLoading: true, error: null });
 *   try {
 *     const data = await service.fetch(params);
 *     set({ someKey: data, isLoading: false });
 *   } catch (err) {
 *     set({ isLoading: false, error: handleStoreError(err, '...') });
 *   }
 *
 * Usage:
 *   fetchItems: createFetchAction(
 *     set,
 *     (params) => itemService.list(params),
 *     'items',               // state key to write the result into
 *     'Failed to load items' // fallback error message
 *   ),
 *
 * With a custom loading key:
 *   fetchTypes: createFetchAction(
 *     set,
 *     () => typeService.list(),
 *     'types',
 *     'Failed to load types',
 *     'isLoadingTypes'
 *   ),
 * ------------------------------------------------------------------ */

/** Minimal Zustand `set` signature we depend on. */
type ZustandSet<S> = (
  partial: Partial<S> | ((state: S) => Partial<S>),
) => void;

/**
 * Creates an async store action that:
 * 1. Sets a loading flag + clears the error
 * 2. Awaits the service call
 * 3. Writes the result to `stateKey`
 * 4. Clears the loading flag (or sets error on failure)
 */
export function createFetchAction<
  S extends object,
  P extends unknown[],
  R,
>(
  set: ZustandSet<S>,
  serviceFn: (...args: P) => Promise<R>,
  stateKey: keyof S & string,
  errorMessage: string,
  loadingKey: keyof S & string = 'isLoading' as keyof S & string,
): (...args: P) => Promise<void> {
  return async (...args: P) => {
    set({ [loadingKey]: true, error: null } as unknown as Partial<S>);
    try {
      const result = await serviceFn(...args);
      set({
        [stateKey]: result,
        [loadingKey]: false,
      } as unknown as Partial<S>);
    } catch (err: unknown) {
      set({
        [loadingKey]: false,
        error: handleStoreError(err, errorMessage),
      } as unknown as Partial<S>);
    }
  };
}

/* ------------------------------------------------------------------
 * Generic CRUD-action factories
 *
 * Eliminates the repeated create/update/delete patterns:
 *
 *   create → append to array in state
 *   update → map-replace item by id
 *   delete → filter out item by id
 * ------------------------------------------------------------------ */

/**
 * Creates an action that calls a service create method and appends
 * the result to an array in state.
 */
export function createCreateAction<
  S extends object,
  TData,
  TResult extends { id: string },
>(
  set: ZustandSet<S>,
  serviceFn: (data: TData) => Promise<TResult>,
  stateKey: keyof S & string,
): (data: TData) => Promise<TResult> {
  return async (data: TData) => {
    const result = await serviceFn(data);
    set((state) => ({
      [stateKey]: [...(state[stateKey as keyof S] as unknown as TResult[]), result],
    }) as unknown as Partial<S>);
    return result;
  };
}

/**
 * Creates an action that calls a service update method and replaces
 * the matching item (by id) in an array in state.
 */
export function createUpdateAction<
  S extends object,
  TData,
  TResult extends { id: string },
>(
  set: ZustandSet<S>,
  serviceFn: (id: string, data: TData) => Promise<TResult>,
  stateKey: keyof S & string,
): (id: string, data: TData) => Promise<TResult> {
  return async (id: string, data: TData) => {
    const result = await serviceFn(id, data);
    set((state) => ({
      [stateKey]: (state[stateKey as keyof S] as unknown as TResult[]).map((item) =>
        item.id === id ? result : item,
      ),
    }) as unknown as Partial<S>);
    return result;
  };
}

/**
 * Creates an action that calls a service delete method and removes
 * the matching item (by id) from an array in state.
 */
export function createDeleteAction<
  S extends object,
  TResult extends { id: string },
>(
  set: ZustandSet<S>,
  serviceFn: (id: string) => Promise<void>,
  stateKey: keyof S & string,
): (id: string) => Promise<void> {
  return async (id: string) => {
    await serviceFn(id);
    set((state) => ({
      [stateKey]: (state[stateKey as keyof S] as unknown as TResult[]).filter(
        (item) => item.id !== id,
      ),
    }) as unknown as Partial<S>);
  };
}
