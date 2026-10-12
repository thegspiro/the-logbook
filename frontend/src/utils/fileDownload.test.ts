import { describe, it, expect } from 'vitest';
import { filenameFromContentDisposition } from './fileDownload';

describe('filenameFromContentDisposition', () => {
  it('reads a quoted filename', () => {
    expect(filenameFromContentDisposition('attachment; filename="2026-10-08_Engine-1_Manual.pdf"')).toBe(
      '2026-10-08_Engine-1_Manual.pdf'
    );
  });

  it('prefers the UTF-8 form', () => {
    expect(
      filenameFromContentDisposition(`attachment; filename="Bomberos.pdf"; filename*=utf-8''Cami%C3%B3n-1_Manual.pdf`)
    ).toBe('Camión-1_Manual.pdf');
  });

  it('drops any directory part', () => {
    expect(filenameFromContentDisposition('attachment; filename="../../etc/passwd"')).toBe('passwd');
  });

  it('returns undefined when there is no name', () => {
    expect(filenameFromContentDisposition(undefined)).toBeUndefined();
    expect(filenameFromContentDisposition('attachment')).toBeUndefined();
  });
});
