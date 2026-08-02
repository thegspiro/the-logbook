/// <reference types="vite/client" />

/** Injected at build time by versionJsonPlugin in vite.config.ts. */
declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

/*
 * VITE_WS_URL, VITE_ENV, VITE_ENABLE_PWA and VITE_ENABLE_ANALYTICS were
 * declared here and documented as configuration, but nothing in the app or
 * the build ever read them — an operator setting them got no effect and no
 * warning. Two were actively misleading:
 *
 *   VITE_WS_URL     the inventory socket derives its URL from
 *                   window.location.host, which is what makes it work behind
 *                   a reverse proxy. There is no override to honour.
 *   VITE_ENABLE_PWA the VitePWA plugin is registered unconditionally, so
 *                   setting this false still shipped a service worker —
 *                   which matters, because the worker's NetworkOnly rule for
 *                   /api/ is part of the HIPAA caching posture.
 *
 * Re-declare one only alongside code that reads it.
 */

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// BarcodeDetector API (Chrome/Edge 83+, Android)
// https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector
interface DetectedBarcode {
  rawValue: string;
  format: string;
  boundingBox: DOMRectReadOnly;
  cornerPoints: { x: number; y: number }[];
}

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
  static getSupportedFormats(): Promise<string[]>;
}
