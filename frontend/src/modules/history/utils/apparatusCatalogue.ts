/**
 * The form a historical apparatus is entered with, and the two payloads built
 * from it: a create omits blanks, an update sends a cleared field as null
 * (CLAUDE.md pitfall #1) and every designation, so a removed one is removed.
 */
import { blankToNull, numberOrNull } from '../../../utils/formValues';
import type {
  ApparatusCreate,
  ApparatusDisposition,
  ApparatusFields,
  ApparatusFullView,
  DatePrecision,
  DesignationWrite,
} from '../types';

export interface ApparatusForm {
  name: string;
  apparatus_type_id: string;
  year: string;
  make: string;
  model: string;
  body_builder: string;
  pump_gpm: string;
  tank_gallons: string;
  ladder_feet: string;
  in_service_date: string | null;
  in_service_precision: DatePrecision;
  in_service_circa: boolean;
  out_of_service_date: string | null;
  out_of_service_precision: DatePrecision;
  out_of_service_circa: boolean;
  disposition: ApparatusDisposition;
  current_location: string;
  description: string;
  research_notes: string;
  source_id: string;
  accession_number: string;
  designations: DesignationWrite[];
}

export const EMPTY_APPARATUS_FORM: ApparatusForm = {
  name: '',
  apparatus_type_id: '',
  year: '',
  make: '',
  model: '',
  body_builder: '',
  pump_gpm: '',
  tank_gallons: '',
  ladder_feet: '',
  in_service_date: null,
  in_service_precision: 'year',
  in_service_circa: false,
  out_of_service_date: null,
  out_of_service_precision: 'year',
  out_of_service_circa: false,
  disposition: 'unknown',
  current_location: '',
  description: '',
  research_notes: '',
  source_id: '',
  accession_number: '',
  designations: [],
};

export const blankDesignation = (): DesignationWrite => ({
  designation: '',
  station_id: null,
  start_date: null,
  start_precision: 'year',
  start_circa: false,
  end_date: null,
  end_precision: 'year',
  end_circa: false,
});

/** Whole numbers only: a blank or a half-typed "1,500" sends nothing. */
const wholeNumber = (value: string): number | null => {
  const parsed = numberOrNull(value.trim());
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const designations = (form: ApparatusForm): DesignationWrite[] =>
  form.designations
    .filter((d) => d.designation.trim())
    .map((d) => ({ ...d, designation: d.designation.trim(), station_id: d.station_id || null }));

export const apparatusForCreate = (form: ApparatusForm): ApparatusCreate => {
  const payload: ApparatusCreate = {
    name: form.name.trim(),
    designations: designations(form),
    in_service_precision: form.in_service_precision,
    in_service_circa: form.in_service_circa,
    out_of_service_precision: form.out_of_service_precision,
    out_of_service_circa: form.out_of_service_circa,
    disposition: form.disposition,
    apparatus_type_id: form.apparatus_type_id || undefined,
    make: form.make.trim() || undefined,
    model: form.model.trim() || undefined,
    body_builder: form.body_builder.trim() || undefined,
    in_service_date: form.in_service_date || undefined,
    out_of_service_date: form.out_of_service_date || undefined,
    current_location: form.current_location.trim() || undefined,
    description: form.description.trim() || undefined,
    research_notes: form.research_notes.trim() || undefined,
    source_id: form.source_id || undefined,
    accession_number: form.accession_number.trim() || undefined,
  };
  // Numbers are left out when blank, as the strings above are.
  const year = wholeNumber(form.year);
  const pump = wholeNumber(form.pump_gpm);
  const tank = wholeNumber(form.tank_gallons);
  const ladder = wholeNumber(form.ladder_feet);
  if (year !== null) payload.year = year;
  if (pump !== null) payload.pump_gpm = pump;
  if (tank !== null) payload.tank_gallons = tank;
  if (ladder !== null) payload.ladder_feet = ladder;
  return payload;
};

export const apparatusForUpdate = (form: ApparatusForm): ApparatusFields & { designations: DesignationWrite[] } => ({
  name: form.name.trim(),
  apparatus_type_id: form.apparatus_type_id || null,
  year: wholeNumber(form.year),
  make: blankToNull(form.make),
  model: blankToNull(form.model),
  body_builder: blankToNull(form.body_builder),
  pump_gpm: wholeNumber(form.pump_gpm),
  tank_gallons: wholeNumber(form.tank_gallons),
  ladder_feet: wholeNumber(form.ladder_feet),
  in_service_date: form.in_service_date,
  in_service_precision: form.in_service_precision,
  in_service_circa: form.in_service_circa,
  out_of_service_date: form.out_of_service_date,
  out_of_service_precision: form.out_of_service_precision,
  out_of_service_circa: form.out_of_service_circa,
  disposition: form.disposition,
  current_location: blankToNull(form.current_location),
  description: blankToNull(form.description),
  research_notes: blankToNull(form.research_notes),
  source_id: form.source_id || null,
  accession_number: blankToNull(form.accession_number),
  designations: designations(form),
});

const text = (value: string | null) => value ?? '';
const numberText = (value: number | null) => (value === null ? '' : String(value));

/** The edit form, filled from a record as the server sent it. */
export const apparatusFormFrom = (item: ApparatusFullView): ApparatusForm => ({
  name: item.name,
  apparatus_type_id: text(item.apparatus_type_id),
  year: numberText(item.year),
  make: text(item.make),
  model: text(item.model),
  body_builder: text(item.body_builder),
  pump_gpm: numberText(item.pump_gpm),
  tank_gallons: numberText(item.tank_gallons),
  ladder_feet: numberText(item.ladder_feet),
  in_service_date: item.in_service_date,
  in_service_precision: item.in_service_precision,
  in_service_circa: item.in_service_circa,
  out_of_service_date: item.out_of_service_date,
  out_of_service_precision: item.out_of_service_precision,
  out_of_service_circa: item.out_of_service_circa,
  disposition: item.disposition,
  current_location: text(item.current_location),
  description: text(item.description),
  research_notes: text(item.research_notes),
  source_id: text(item.source_id),
  accession_number: text(item.accession_number),
  designations: item.designations.map((d) => ({
    designation: d.designation,
    station_id: d.station_id,
    start_date: d.start_date,
    start_precision: d.start_precision,
    start_circa: d.start_circa,
    end_date: d.end_date,
    end_precision: d.end_precision,
    end_circa: d.end_circa,
  })),
});
