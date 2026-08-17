/**
 * Challenge-response (CAPTCHA) widget lifecycle for anonymous forms.
 *
 * The server decides whether a challenge is enforced; this hook mirrors that
 * decision rather than making its own. When the backend reports the feature is
 * off — or on but misconfigured — `required` is false, no provider script is
 * loaded, and the form submits exactly as it did before. That keeps the widget
 * out of every deployment that has not opted in, which is most of them.
 *
 * Two provider shapes are supported:
 *   - Turnstile and hCaptcha render a visible widget and hand back a token via
 *     callback. Their explicit-render APIs are argument-compatible, so they
 *     share a code path.
 *   - reCAPTCHA v3 has no widget at all; it scores the session and mints a
 *     token on demand, so its token is fetched inside `getToken()` at submit
 *     time rather than captured up front.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';

export interface CaptchaConfig {
  enabled: boolean;
  provider: 'turnstile' | 'hcaptcha' | 'recaptcha' | null;
  siteKey: string | null;
}

/** Header the backend reads the token from (see app/core/captcha.py). */
export const CAPTCHA_HEADER = 'X-Captcha-Token';

const SCRIPT_URLS: Record<string, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  hcaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit',
  recaptcha: 'https://www.google.com/recaptcha/api.js?render=',
};

interface WidgetApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
}

interface RecaptchaApi {
  ready: (cb: () => void) => void;
  execute: (siteKey: string, opts: { action: string }) => Promise<string>;
}

type CaptchaWindow = Window & {
  turnstile?: WidgetApi;
  hcaptcha?: WidgetApi;
  grecaptcha?: RecaptchaApi;
};

/**
 * The config is a per-deployment constant, so it is fetched once per page load
 * and shared. Without the memo every form mounting the hook would issue its own
 * request, and the anonymous pages that need this often mount more than one.
 */
let configPromise: Promise<CaptchaConfig> | null = null;

function fetchConfig(): Promise<CaptchaConfig> {
  configPromise ??= axios
    .get<CaptchaConfig>('/api/v1/auth/captcha-config')
    .then((r) => r.data)
    .catch(() => {
      // Treat an unreachable config endpoint as "not required" so a transient
      // failure cannot make every anonymous form unsubmittable. The server
      // still enforces the challenge independently, so this cannot be used to
      // skip a challenge that is actually switched on — such a submission is
      // rejected server-side with a 400.
      configPromise = null;
      return { enabled: false, provider: null, siteKey: null };
    });
  return configPromise;
}

/** Load a provider script once, resolving when it is ready to use. */
const scriptPromises = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = scriptPromises.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => {
      resolve();
    };
    el.onerror = () => {
      // Allow a later mount to retry rather than caching the failure forever.
      scriptPromises.delete(src);
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(el);
  });
  scriptPromises.set(src, promise);
  return promise;
}

export interface UseCaptchaResult {
  /** True when the server enforces a challenge on this deployment. */
  required: boolean;
  /** True once the widget can produce a token. */
  ready: boolean;
  /** Populated when the provider script or widget failed to load. */
  error: string | null;
  /** Mount point for widget-style providers. Unused by reCAPTCHA v3. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Token for this submission, or null when none is required. */
  getToken: () => Promise<string | null>;
  /** Discard the current token so the next submission solves a fresh one. */
  reset: () => void;
}

export function useCaptcha(action = 'submit'): UseCaptchaResult {
  const [config, setConfig] = useState<CaptchaConfig | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tokenRef = useRef<string | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config?.enabled || !config.provider || !config.siteKey) return;

    const { provider, siteKey } = config;
    const src = provider === 'recaptcha' ? `${SCRIPT_URLS.recaptcha ?? ''}${siteKey}` : (SCRIPT_URLS[provider] ?? '');
    if (!src) return;

    let cancelled = false;
    void loadScript(src)
      .then(() => {
        if (cancelled) return;
        const w = window as CaptchaWindow;

        if (provider === 'recaptcha') {
          // No widget to mount — the token is minted at submit time.
          w.grecaptcha?.ready(() => {
            if (!cancelled) setReady(true);
          });
          return;
        }

        const api = provider === 'turnstile' ? w.turnstile : w.hcaptcha;
        if (!api || !containerRef.current) {
          setError('Challenge unavailable. Please reload the page.');
          return;
        }
        // Guard against a double render in StrictMode's remount, which would
        // otherwise leave two widgets stacked in the same container.
        if (widgetIdRef.current !== null) return;

        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token: string) => {
            tokenRef.current = token;
          },
          'expired-callback': () => {
            tokenRef.current = null;
          },
          'error-callback': () => {
            tokenRef.current = null;
          },
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setError('Challenge unavailable. Please reload the page.');
      });

    return () => {
      cancelled = true;
    };
  }, [config]);

  const reset = useCallback(() => {
    tokenRef.current = null;
    const provider = config?.provider;
    if (!provider || provider === 'recaptcha') return;
    const w = window as CaptchaWindow;
    const api = provider === 'turnstile' ? w.turnstile : w.hcaptcha;
    if (api && widgetIdRef.current !== null) api.reset(widgetIdRef.current);
  }, [config]);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!config?.enabled || !config.siteKey) return null;

    if (config.provider === 'recaptcha') {
      const w = window as CaptchaWindow;
      if (!w.grecaptcha) return null;
      return w.grecaptcha.execute(config.siteKey, { action });
    }
    return tokenRef.current;
  }, [config, action]);

  return {
    required: Boolean(config?.enabled),
    ready,
    error,
    containerRef,
    getToken,
    reset,
  };
}
