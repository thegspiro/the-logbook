import { useEffect } from 'react';

/** Message an embedded form sends its host page; the embed snippet listens for it. */
export const EMBED_HEIGHT_MESSAGE = 'logbook:form-height';

/**
 * Tell the page framing this one how tall it is, so the host can size the
 * iframe to fit instead of showing a second scrollbar.
 *
 * Posted to any origin: the message carries only a height and the form's
 * public slug, both of which the host page already has, and the host's origin
 * is not known here (the department may list several sites). The receiving
 * snippet checks that the message came from this app's origin.
 */
export function useEmbedHeight(enabled: boolean, slug: string | undefined): void {
  useEffect(() => {
    if (!enabled || window.parent === window || typeof ResizeObserver === 'undefined') return undefined;

    let last = 0;
    const report = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (height === last) return;
      last = height;
      window.parent.postMessage({ type: EMBED_HEIGHT_MESSAGE, slug, height }, '*');
    };

    const observer = new ResizeObserver(report);
    observer.observe(document.body);
    report();
    return () => observer.disconnect();
  }, [enabled, slug]);
}
