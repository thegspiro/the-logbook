import { useState, useCallback } from 'react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmailList(raw: string): string | null {
  if (!raw.trim()) return null;
  const entries = raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const invalid = entries.filter((e) => !EMAIL_REGEX.test(e));
  if (invalid.length > 0) {
    return `Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`;
  }
  return null;
}

export function parseEmailList(raw: string): string[] {
  return raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

interface UseEmailListInputResult {
  inputValue: string;
  setInputValue: (value: string) => void;
  /** Adds the typed address; returns false, and sets `error`, when it refuses. */
  add: () => boolean;
  remove: (email: string) => void;
  validationError: string | null;
  /** Why the last add was refused, until the box is edited. */
  error: string | null;
}

export const INVALID_EMAIL_MESSAGE = 'Enter a full email address, like name@example.com.';
export const DUPLICATE_EMAIL_MESSAGE = 'That address is already on the list.';

export function useEmailListInput(
  currentList: string[],
  onChange: (updated: string[]) => void
): UseEmailListInputResult {
  const [inputValue, setInputValueState] = useState('');
  const [error, setError] = useState<string | null>(null);

  const setInputValue = useCallback((value: string) => {
    setInputValueState(value);
    setError(null);
  }, []);

  // Refused rather than stored: every caller saves the list as soon as it
  // changes, so an address that is not one went straight into the settings.
  const add = useCallback(() => {
    const email = inputValue.trim();
    if (!email) return false;
    if (!EMAIL_REGEX.test(email)) {
      setError(INVALID_EMAIL_MESSAGE);
      return false;
    }
    if (currentList.includes(email)) {
      setError(DUPLICATE_EMAIL_MESSAGE);
      return false;
    }
    onChange([...currentList, email]);
    setInputValueState('');
    setError(null);
    return true;
  }, [inputValue, currentList, onChange]);

  const remove = useCallback(
    (email: string) => {
      onChange(currentList.filter((e) => e !== email));
    },
    [currentList, onChange]
  );

  const validationError = validateEmailList(inputValue);

  return { inputValue, setInputValue, add, remove, validationError, error };
}
