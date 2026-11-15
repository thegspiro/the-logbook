/**
 * The catalogue form a document is entered with, and the two payloads built
 * from it: a create omits blanks, an update sends a cleared field as null
 * (CLAUDE.md pitfall #1).
 */
import { blankToNull } from '../../../utils/formValues';
import type { DatePrecision, DocumentFields, DocumentFullView } from '../types';

export interface DocumentCatalogueForm {
  title: string;
  description: string;
  taken_date: string | null;
  taken_date_precision: DatePrecision;
  taken_date_circa: boolean;
  place: string;
  document_type_id: string;
  author: string;
  recipient: string;
  source_id: string;
  rights_note: string;
  accession_number: string;
  original_location: string;
  research_notes: string;
  transcription: string;
}

export const EMPTY_DOCUMENT_CATALOGUE: DocumentCatalogueForm = {
  title: '',
  description: '',
  taken_date: null,
  taken_date_precision: 'year',
  taken_date_circa: false,
  place: '',
  document_type_id: '',
  author: '',
  recipient: '',
  source_id: '',
  rights_note: '',
  accession_number: '',
  original_location: '',
  research_notes: '',
  transcription: '',
};

/** For a new document: blanks are left out, so the server's defaults apply
 * (the title, for one, defaults to the file's name). */
export const documentCatalogueForCreate = (form: DocumentCatalogueForm): DocumentFields => ({
  title: form.title.trim() || undefined,
  description: form.description.trim() || undefined,
  taken_date: form.taken_date || undefined,
  taken_date_precision: form.taken_date_precision,
  taken_date_circa: form.taken_date_circa,
  place: form.place.trim() || undefined,
  document_type_id: form.document_type_id || undefined,
  author: form.author.trim() || undefined,
  recipient: form.recipient.trim() || undefined,
  source_id: form.source_id || undefined,
  rights_note: form.rights_note.trim() || undefined,
  accession_number: form.accession_number.trim() || undefined,
  original_location: form.original_location.trim() || undefined,
  research_notes: form.research_notes.trim() || undefined,
  transcription: form.transcription.trim() || undefined,
});

/** For an edit: every field is sent, and a cleared one as null, so emptying a
 * box actually empties it (CLAUDE.md pitfall #1). */
export const documentCatalogueForUpdate = (form: DocumentCatalogueForm): DocumentFields => ({
  title: form.title.trim(),
  description: blankToNull(form.description),
  taken_date: form.taken_date,
  taken_date_precision: form.taken_date_precision,
  taken_date_circa: form.taken_date_circa,
  place: blankToNull(form.place),
  document_type_id: form.document_type_id || null,
  author: blankToNull(form.author),
  recipient: blankToNull(form.recipient),
  source_id: form.source_id || null,
  rights_note: blankToNull(form.rights_note),
  accession_number: blankToNull(form.accession_number),
  original_location: blankToNull(form.original_location),
  research_notes: blankToNull(form.research_notes),
  transcription: blankToNull(form.transcription),
});

/** The edit form, filled from a document as the server sent it. */
export const documentCatalogueFrom = (item: DocumentFullView): DocumentCatalogueForm => ({
  title: item.title,
  description: item.description ?? '',
  taken_date: item.taken_date,
  taken_date_precision: item.taken_date_precision,
  taken_date_circa: item.taken_date_circa,
  place: item.place ?? '',
  document_type_id: item.document_type_id ?? '',
  author: item.author ?? '',
  recipient: item.recipient ?? '',
  source_id: item.source_id ?? '',
  rights_note: item.rights_note ?? '',
  accession_number: item.accession_number ?? '',
  original_location: item.original_location ?? '',
  research_notes: item.research_notes ?? '',
  transcription: item.transcription ?? '',
});

/** Files the archive takes as documents, checked in the browser first so a
 * file that would be refused is not sent at all. The server still decides. */
export const DOCUMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const DOCUMENT_MAX_MB = 50;

export const documentPrecheck = (file: File): string | null => {
  const dot = file.name.lastIndexOf('.');
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!DOCUMENT_EXTENSIONS.includes(extension)) {
    return extension === '.doc' || extension === '.docx' ? 'Convert Word files to PDF first' : 'Not an accepted type';
  }
  return file.size > DOCUMENT_MAX_MB * 1024 * 1024 ? `Over the ${DOCUMENT_MAX_MB} MB limit` : null;
};
