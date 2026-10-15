import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeFileName, saveBlob } from './saveBlob';

describe('safeFileName', () => {
  it('removes path separators and characters a filesystem rejects', () => {
    expect(safeFileName('../etc/pass:wd*?.pdf')).toBe('..etcpasswd.pdf');
  });

  it('collapses whitespace and trims', () => {
    expect(safeFileName('  October   minutes  ')).toBe('October minutes');
  });

  it('falls back when nothing usable is left', () => {
    expect(safeFileName('///')).toBe('download');
    expect(safeFileName('', 'minutes')).toBe('minutes');
  });
});

describe('saveBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clicks a download link carrying the safe name, then cleans up', () => {
    const create = vi.fn().mockReturnValue('blob:test');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    saveBlob(new Blob(['x']), 'a/b.pdf');

    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:test');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
