import { afterEach, vi, expect, beforeAll, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import * as matchers from 'vitest-axe/matchers';
import 'vitest-axe/extend-expect';

// Add vitest-axe matchers for accessibility testing
expect.extend(matchers);

// Cleanup after each test case
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock window.print
Object.defineProperty(window, 'print', {
  writable: true,
  value: vi.fn(),
});

// jsdom does not implement window.scrollTo — it logs a "Not implemented" error
// on every call. Pages reset scroll on navigation and on in-page view changes,
// so without this stub that noise floods any test touching those paths.
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

// jsdom does not implement navigator.mediaDevices. Provide a stub so camera /
// scanner code treats the test environment as a secure context (the real
// secure-context guard checks for this API's presence). Individual tests still
// drive the scanner via the mocked html5-qrcode library.
if (!('mediaDevices' in navigator)) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(null),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
  });
}

// jsdom implements Blob/File but not the Blob.text() / .arrayBuffer() readers
// that CSV import pages use to read an uploaded file. Back them with
// FileReader, which jsdom does implement.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  const readAs = <T>(read: (reader: FileReader) => void): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as T);
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
      read(reader);
    });

  Object.defineProperty(Blob.prototype, 'text', {
    configurable: true,
    writable: true,
    value: function text(this: Blob): Promise<string> {
      return readAs<string>((reader) => reader.readAsText(this));
    },
  });

  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value: function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
      return readAs<ArrayBuffer>((reader) => reader.readAsArrayBuffer(this));
    },
  });
}

// Mock IntersectionObserver
globalThis.IntersectionObserver = class IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  // Required by lib.dom's IntersectionObserver as of TypeScript 7; jsdom does
  // not implement the observer at all, so the value is inert.
  readonly scrollMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
  disconnect() {}
  observe(_target: Element) {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve(_target: Element) {}
};

// Mock ResizeObserver
globalThis.ResizeObserver = class ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  disconnect() {}
  observe(_target: Element, _options?: ResizeObserverOptions) {}
  unobserve(_target: Element) {}
};

// Suppress console errors during tests (optional)
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Warning: ReactDOM.render')) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
