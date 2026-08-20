import { describe, it, expect, vi, afterEach } from 'vitest';
import { escapeCsvCell, buildCsv, downloadCsv } from './csvExport';

describe('escapeCsvCell', () => {
  // The whole point of the utility: a cell a spreadsheet would execute.
  it.each(['=cmd|/c calc', '+1+1', '-2+3', '@SUM(A1)', '\tlead'])(
    'should neutralize a formula trigger: %j',
    (value) => {
      expect(escapeCsvCell(value)).toBe(`'${value}`);
    }
  );

  // A leading CR is a formula trigger *and* forces quoting, so it gets both.
  it('should neutralize and quote a leading carriage return', () => {
    expect(escapeCsvCell('\rlead')).toBe(`"'\rlead"`);
  });

  it('should leave an ordinary value alone', () => {
    expect(escapeCsvCell('Monthly Business Meeting')).toBe('Monthly Business Meeting');
    expect(escapeCsvCell('Smith, John')).toBe('"Smith, John"');
  });

  it('should double embedded quotes and quote the cell', () => {
    expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
  });

  it('should neutralize and quote a value that needs both', () => {
    expect(escapeCsvCell('=a,b')).toBe(`"'=a,b"`);
  });

  it('should render null and undefined as empty', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  it('should stringify non-string values', () => {
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(false)).toBe('false');
  });
});

describe('buildCsv', () => {
  it('should join cells and rows with CRLF line endings', () => {
    expect(
      buildCsv([
        ['Title', 'Going'],
        ['CPR Training', 30],
      ])
    ).toBe('Title,Going\r\nCPR Training,30');
  });

  it('should neutralize every cell it writes, not just the first', () => {
    expect(buildCsv([['ok', '=EVIL()']])).toBe("ok,'=EVIL()");
  });
});

describe('downloadCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should hand the browser a named text/csv blob', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadCsv('a,b', 'events.csv');

    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect((createObjectURL.mock.calls[0]?.[0] as Blob).type).toBe('text/csv;charset=utf-8');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    // The anchor must not be left behind in the document.
    expect(document.querySelector('a[download]')).toBeNull();

    vi.unstubAllGlobals();
  });
});
