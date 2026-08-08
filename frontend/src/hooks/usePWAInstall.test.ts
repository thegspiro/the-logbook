import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePWAInstall } from './usePWAInstall';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

function setStandalone(value: boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query === '(display-mode: standalone)' ? value : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('usePWAInstall', () => {
  beforeEach(() => {
    setStandalone(false);
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
    delete (navigator as Navigator & { standalone?: boolean }).standalone;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('flags iOS Safari as needing manual install, since beforeinstallprompt never fires there', () => {
    setUserAgent(IPHONE_SAFARI);
    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.needsManualInstall).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it('does not offer manual install instructions in non-Safari iOS browsers', () => {
    setUserAgent(IPHONE_CHROME);
    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.needsManualInstall).toBe(false);
  });

  it('does not flag manual install on Android, which gets a real prompt event', () => {
    setUserAgent(ANDROID_CHROME);
    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.needsManualInstall).toBe(false);
    expect(result.current.canInstall).toBe(false);
  });

  it('exposes canInstall once beforeinstallprompt fires', () => {
    setUserAgent(ANDROID_CHROME);
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      const event = new Event('beforeinstallprompt');
      window.dispatchEvent(event);
    });

    expect(result.current.canInstall).toBe(true);
  });

  it('suppresses both install affordances when already running standalone', () => {
    setUserAgent(IPHONE_SAFARI);
    setStandalone(true);
    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.needsManualInstall).toBe(false);
    expect(result.current.canInstall).toBe(false);
  });

  it('treats the legacy iOS navigator.standalone flag as installed', () => {
    setUserAgent(IPHONE_SAFARI);
    setStandalone(false);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.needsManualInstall).toBe(false);
  });
});
