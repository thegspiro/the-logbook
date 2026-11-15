import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOCUMENT_CATALOGUE,
  documentCatalogueForCreate,
  documentCatalogueForUpdate,
  documentPrecheck,
} from './documentCatalogue';

const file = (name: string, megabytes: number) => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: megabytes * 1024 * 1024 });
  return f;
};

describe('documentPrecheck', () => {
  it('lets through a PDF or a scan the server accepts', () => {
    expect(documentPrecheck(file('letter.PDF', 49))).toBeNull();
    expect(documentPrecheck(file('page.jpeg', 1))).toBeNull();
    expect(documentPrecheck(file('page.webp', 1))).toBeNull();
  });

  it('says to convert a Word file, and refuses anything else', () => {
    expect(documentPrecheck(file('letter.docx', 1))).toBe('Convert Word files to PDF first');
    expect(documentPrecheck(file('letter.doc', 1))).toBe('Convert Word files to PDF first');
    expect(documentPrecheck(file('scan.tif', 1))).toBe('Not an accepted type');
  });

  it('refuses a file over 50 MB', () => {
    expect(documentPrecheck(file('minutes.pdf', 51))).toBe('Over the 50 MB limit');
  });
});

describe('document catalogue payloads', () => {
  it('leaves blanks out of a new document', () => {
    const payload = documentCatalogueForCreate({ ...EMPTY_DOCUMENT_CATALOGUE, author: '  Mayor Jones ' });
    expect(payload.author).toBe('Mayor Jones');
    expect(payload.recipient).toBeUndefined();
    expect(payload.transcription).toBeUndefined();
    expect(payload.document_type_id).toBeUndefined();
  });

  it('sends a cleared field as null on an edit, so it is actually cleared', () => {
    const payload = documentCatalogueForUpdate({ ...EMPTY_DOCUMENT_CATALOGUE, title: 'Letter' });
    expect(payload.title).toBe('Letter');
    expect(payload.transcription).toBeNull();
    expect(payload.author).toBeNull();
    expect(payload.recipient).toBeNull();
    expect(payload.document_type_id).toBeNull();
  });
});
