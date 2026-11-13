/**
 * The catalogue form a photo, recording or video is entered with, and the two
 * payloads built from it: a create omits blanks, an update sends a cleared
 * field as null (CLAUDE.md pitfall #1).
 */
import { blankToNull } from '../../../utils/formValues';
import type { DatePrecision, MediaFields } from '../types';

export interface CatalogueForm {
  title: string;
  description: string;
  taken_date: string | null;
  taken_date_precision: DatePrecision;
  taken_date_circa: boolean;
  place: string;
  creator: string;
  source_id: string;
  rights_note: string;
  accession_number: string;
  original_location: string;
  research_notes: string;
}

export const EMPTY_CATALOGUE: CatalogueForm = {
  title: '',
  description: '',
  taken_date: null,
  taken_date_precision: 'year',
  taken_date_circa: false,
  place: '',
  creator: '',
  source_id: '',
  rights_note: '',
  accession_number: '',
  original_location: '',
  research_notes: '',
};

/** For a new item: blanks are left out, so the server's defaults apply (the
 * title, for one, defaults to the file's name). */
export const catalogueForCreate = (form: CatalogueForm): MediaFields => ({
  title: form.title.trim() || undefined,
  description: form.description.trim() || undefined,
  taken_date: form.taken_date || undefined,
  taken_date_precision: form.taken_date_precision,
  taken_date_circa: form.taken_date_circa,
  place: form.place.trim() || undefined,
  creator: form.creator.trim() || undefined,
  source_id: form.source_id || undefined,
  rights_note: form.rights_note.trim() || undefined,
  accession_number: form.accession_number.trim() || undefined,
  original_location: form.original_location.trim() || undefined,
  research_notes: form.research_notes.trim() || undefined,
});

/** For an edit: every field is sent, and a cleared one as null, so emptying a
 * box actually empties it (CLAUDE.md pitfall #1). */
export const catalogueForUpdate = (form: CatalogueForm): MediaFields => ({
  title: form.title.trim(),
  description: blankToNull(form.description),
  taken_date: form.taken_date,
  taken_date_precision: form.taken_date_precision,
  taken_date_circa: form.taken_date_circa,
  place: blankToNull(form.place),
  creator: blankToNull(form.creator),
  source_id: form.source_id || null,
  rights_note: blankToNull(form.rights_note),
  accession_number: blankToNull(form.accession_number),
  original_location: blankToNull(form.original_location),
  research_notes: blankToNull(form.research_notes),
});
