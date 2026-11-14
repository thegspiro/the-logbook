import { describe, expect, it } from 'vitest';

import { fileTypeLabel } from './fileTypeLabel';

describe('fileTypeLabel', () => {
  it.each([
    ['application/pdf', 'PDF'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word'],
    ['application/vnd.ms-excel', 'Excel'],
    ['text/plain', 'Text'],
    ['text/csv', 'CSV'],
    ['image/png', 'PNG image'],
    ['application/x-zip-compressed', 'ZIP'],
  ])('names %s as %s', (mime, label) => {
    expect(fileTypeLabel(mime)).toBe(label);
  });

  it('ignores parameters and case', () => {
    expect(fileTypeLabel('Text/Plain; charset=utf-8')).toBe('Text');
  });

  it('falls back to the family, then to "File"', () => {
    expect(fileTypeLabel('image/tiff')).toBe('Image');
    expect(fileTypeLabel('application/x-unknown')).toBe('File');
  });

  it('has no label for a missing type', () => {
    expect(fileTypeLabel(null)).toBeUndefined();
    expect(fileTypeLabel('')).toBeUndefined();
  });
});
