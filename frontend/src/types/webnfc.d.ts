/**
 * Web NFC (NDEF) ambient declarations.
 *
 * Web NFC is not part of `lib.dom.d.ts` — it ships only in Chrome on Android
 * and remains a W3C Community Group draft, so TypeScript does not declare it.
 * These declarations mirror https://w3c.github.io/web-nfc/.
 *
 * `NDEFReader` is deliberately declared as an *optional property of `Window`*
 * rather than as a global `class`. A global class would let `new NDEFReader()`
 * typecheck anywhere, and on every browser except Chrome-on-Android that is a
 * ReferenceError at runtime. Forcing callers through `window.NDEFReader` makes
 * the feature test (`if (!window.NDEFReader) ...`) the only way to reach the
 * constructor, so an unguarded use fails at compile time instead of on a
 * member's phone.
 */

interface NDEFRecord {
  readonly recordType: string;
  readonly mediaType?: string;
  readonly id?: string;
  readonly encoding?: string;
  readonly lang?: string;
  readonly data?: DataView;
  toRecords?(): NDEFRecord[];
}

interface NDEFMessage {
  readonly records: readonly NDEFRecord[];
}

interface NDEFRecordInit {
  recordType: string;
  mediaType?: string;
  id?: string;
  encoding?: string;
  lang?: string;
  data?: string | BufferSource;
}

interface NDEFMessageInit {
  records: NDEFRecordInit[];
}

interface NDEFReadingEvent extends Event {
  readonly serialNumber: string;
  readonly message: NDEFMessage;
}

interface NDEFWriteOptions {
  overwrite?: boolean;
  signal?: AbortSignal;
}

interface NDEFScanOptions {
  signal?: AbortSignal;
}

interface NDEFReader extends EventTarget {
  onreading: ((this: NDEFReader, event: NDEFReadingEvent) => void) | null;
  onreadingerror: ((this: NDEFReader, event: Event) => void) | null;
  scan(options?: NDEFScanOptions): Promise<void>;
  write(message: string | BufferSource | NDEFMessageInit, options?: NDEFWriteOptions): Promise<void>;
  makeReadOnly(options?: NDEFScanOptions): Promise<void>;
}

interface NDEFReaderConstructor {
  new (): NDEFReader;
  readonly prototype: NDEFReader;
}

interface Window {
  NDEFReader?: NDEFReaderConstructor;
}
