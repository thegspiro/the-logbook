import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** iOS Safari has never implemented `beforeinstallprompt`, so the programmatic
 *  install path is permanently unavailable there. Add-to-Home-Screen still
 *  works, but only as a manual gesture the user has to be told about — hence
 *  the separate `needsManualInstall` signal below. */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; the touch-point check separates it
  // from a real desktop Safari, which never supports Add to Home Screen.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Add to Home Screen on iOS is a Safari feature. Third-party browsers on iOS
 *  (Chrome, Firefox, Edge) are WebKit shells that historically lacked it, and
 *  in-app webviews never have it — showing them Share-sheet instructions that
 *  don't apply is worse than showing nothing. */
function isIOSSafari(): boolean {
  if (!isIOS()) return false;
  const ua = navigator.userAgent;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|Mercury/.test(ua);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS predates the display-mode media query and exposes this instead.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [needsManualInstall, setNeedsManualInstall] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (isStandalone()) {
      setIsInstalled(true);
      return;
    }

    // iOS gets no `beforeinstallprompt`; surface manual instructions instead.
    if (isIOSSafari()) {
      setNeedsManualInstall(true);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    const installedHandler = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      setNeedsManualInstall(false);
    };
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setInstallPrompt(null);
    }
    return outcome === 'accepted';
  };

  return {
    canInstall: !!installPrompt && !isInstalled,
    /** True on iOS Safari, where install is possible but only via the Share
     *  sheet. Callers should render instructions rather than an install button. */
    needsManualInstall: needsManualInstall && !isInstalled,
    isInstalled,
    install,
  };
}
