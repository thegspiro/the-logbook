import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { getErrorMessage } from '../utils/errorHandling';
import type { EmailConnectionTestResult, EmailServiceSettings } from '../types/user';

/**
 * Runs the settings-screen email connection test and reports its outcome.
 *
 * A test signs in to the provider and can take up to 30 seconds, with the
 * form still editable throughout. The result therefore describes the
 * settings as they were when the button was pressed, not necessarily the
 * ones on screen when the answer arrives — so an administrator who corrects
 * a password mid-test would otherwise get a green toast vouching for the
 * value they just replaced, and could save an untested configuration
 * believing it had passed.
 *
 * The submitted settings are captured at the start and compared by identity
 * against the live ones when the result lands. Identity is the right
 * comparison: the settings object is replaced rather than mutated on every
 * edit, so any change at all produces a different reference.
 */
export const useEmailConnectionTest = (
  settings: EmailServiceSettings,
  test: (settings: EmailServiceSettings) => Promise<EmailConnectionTestResult>
) => {
  const [testing, setTesting] = useState(false);

  // Read at result time rather than closed over, so the comparison sees the
  // form as it stands now instead of as it stood when the test started.
  const latest = useRef<EmailServiceSettings>(settings);
  useEffect(() => {
    latest.current = settings;
  }, [settings]);

  const runTest = useCallback(async () => {
    const submitted = latest.current;
    setTesting(true);
    try {
      const result = await test(submitted);
      if (latest.current !== submitted) {
        toast.error('Email settings changed while the test was running. Test again.');
        return;
      }
      if (result.success) {
        toast.success(result.message || 'Email connection test successful');
      } else {
        toast.error(result.message || 'Email connection test failed');
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      toast.error(
        status === 403
          ? 'Permission denied.'
          : status === 429
            ? 'Too many connection tests. Wait a minute and try again.'
            : getErrorMessage(err, 'Failed to test email connection.')
      );
    } finally {
      setTesting(false);
    }
  }, [test]);

  return { testing, runTest };
};
