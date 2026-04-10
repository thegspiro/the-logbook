import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCsv, downloadFile, exportReportAsCsv } from './export';

describe('generateCsv', () => {
  it('returns empty string for empty rows', () => {
    expect(generateCsv([])).toBe('');
  });

  it('generates CSV with auto-inferred column headers', () => {
    const rows = [
      { first_name: 'John', last_name: 'Doe', age: 30 },
      { first_name: 'Jane', last_name: 'Smith', age: 25 },
    ];
    const csv = generateCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('First Name,Last Name,Age');
    expect(lines[1]).toBe('John,Doe,30');
    expect(lines[2]).toBe('Jane,Smith,25');
  });

  it('generates CSV with explicit columns', () => {
    const rows = [{ name: 'Alice', role: 'Admin' }];
    const columns = [
      { key: 'name', header: 'Full Name' },
      { key: 'role', header: 'Position' },
    ];
    const csv = generateCsv(rows, columns);
    expect(csv).toContain('Full Name,Position');
    expect(csv).toContain('Alice,Admin');
  });

  it('escapes commas and quotes in values', () => {
    const rows = [{ name: 'Smith, John', note: 'He said "hello"' }];
    const csv = generateCsv(rows);
    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"He said ""hello"""');
  });

  it('handles null and undefined values', () => {
    const rows = [{ name: null, value: undefined, count: 0 }];
    const csv = generateCsv(rows as Array<Record<string, unknown>>);
    expect(csv).toContain(',0');
  });

  it('handles array values by joining with semicolons', () => {
    const rows = [{ roles: ['admin', 'member'] }];
    const csv = generateCsv(rows as Array<Record<string, unknown>>);
    expect(csv).toContain('"admin; member"');
  });
});

describe('downloadFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates and clicks a download link', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });

    const clickSpy = vi.fn();
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      (node as HTMLAnchorElement).click = clickSpy;
      return node;
    });
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    downloadFile('test content', 'test.csv');

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});

describe('exportReportAsCsv', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates CSV with formatted filename', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });

    let capturedLink: HTMLAnchorElement | null = null;
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      capturedLink = node as HTMLAnchorElement;
      capturedLink.click = vi.fn();
      return node;
    });
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

    const rows = [{ name: 'Test', value: 1 }];
    exportReportAsCsv('My Report', rows);

    expect(capturedLink).not.toBeNull();
    expect((capturedLink as HTMLAnchorElement).download).toMatch(/^my_report_\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
