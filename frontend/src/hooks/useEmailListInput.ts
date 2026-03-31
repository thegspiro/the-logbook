import { useState, useCallback } from 'react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmailList(raw: string): string | null {
  if (!raw.trim()) return null;
  const entries = raw.split(',').map((e) => e.trim()).filter(Boolean);
  const invalid = entries.filter((e) => !EMAIL_REGEX.test(e));
  if (invalid.length > 0) {
    return `Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`;
  }
  return null;
}

export function parseEmailList(raw: string): string[] {
  return raw.split(',').map((e) => e.trim()).filter(Boolean);
}

interface UseEmailListInputResult {
  inputValue: string;
  setInputValue: (value: string) => void;
  add: () => void;
  remove: (email: string) => void;
  validationError: string | null;
}

export function useEmailListInput(
  currentList: string[],
  onChange: (updated: string[]) => void,
): UseEmailListInputResult {
  const [inputValue, setInputValue] = useState('');

  const add = useCallback(() => {
    const email = inputValue.trim();
    if (!email || currentList.includes(email)) return;
    onChange([...currentList, email]);
    setInputValue('');
  }, [inputValue, currentList, onChange]);

  const remove = useCallback(
    (email: string) => {
      onChange(currentList.filter((e) => e !== email));
    },
    [currentList, onChange],
  );

  const validationError = validateEmailList(inputValue);

  return { inputValue, setInputValue, add, remove, validationError };
}
