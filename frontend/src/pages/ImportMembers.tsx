import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Upload, Download, FileText, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { CSVMemberRow } from '../types/member';
import { userService, roleService } from '../services/api';
import { getErrorMessage } from '@/utils/errorHandling';

/**
 * One rejected row: why it was rejected, and the cells it was rejected from.
 *
 * The cells are kept verbatim so the downloadable error report can hand the
 * original row back for correction. A rejection the uploader cannot act on is
 * worth nothing, and "row 3 failed" without the row is exactly that.
 */
interface RowIssue {
  line: number;
  reasons: string[];
  cells: string[];
}

interface ValidRow {
  line: number;
  data: CSVMemberRow;
  cells: string[];
}

/**
 * The verdict on every data row, reached before a single member is created.
 *
 * Validation used to run inside the import loop, so row 21's problem surfaced
 * only after rows 1-20 had already been created — the uploader could not see
 * the scale of the problem until the database had been half-written.
 */
interface Preflight {
  headerRow: string[];
  total: number;
  valid: ValidRow[];
  invalid: RowIssue[];
}

interface ImportResult {
  success: number;
  /** Pre-flight rejections and server-side failures, as one list. */
  issues: RowIssue[];
}

/**
 * Columns emitted by the downloadable template, in display order.
 *
 * The validator below derives its required/recommended sets from this list, so
 * the template can never again ship a file that its own validator rejects.
 * `status` is deliberately absent: POST /users always creates members as
 * Active and has no field to override it, so a status column would silently
 * discard whatever the department typed.
 */
const TEMPLATE_HEADERS = [
  'firstName',
  'lastName',
  'middleName',
  'membershipNumber',
  'username',
  'dateOfBirth',
  'street',
  'city',
  'state',
  'zipCode',
  'primaryPhone',
  'secondaryPhone',
  'email',
  'joinDate',
  'rank',
  'role',
  'station',
  'platoon',
  'emergencyName1',
  'emergencyRelationship1',
  'emergencyPhone1',
  'emergencyEmail1',
  'emergencyName2',
  'emergencyRelationship2',
  'emergencyPhone2',
  'emergencyEmail2',
] as const;

/**
 * The filled-in row the template ships with, so the columns are self-
 * explanatory to whoever opens it.
 *
 * The instructions say to replace it, and when it was left in it imported as a
 * real member — a John Doe with a working password-setup link. The importer
 * recognizes its own example and rejects that row instead.
 */
const TEMPLATE_EXAMPLE: Record<(typeof TEMPLATE_HEADERS)[number], string> = {
  firstName: 'John',
  lastName: 'Doe',
  middleName: 'Michael',
  membershipNumber: 'FF-001',
  username: 'john.doe',
  dateOfBirth: '1985-03-15',
  street: '123 Main Street, Apt 4',
  city: 'Springfield',
  state: 'IL',
  zipCode: '62701',
  primaryPhone: '(555) 123-4567',
  secondaryPhone: '(555) 987-6543',
  email: 'john.doe@example.com',
  joinDate: '2020-01-15',
  rank: 'Firefighter',
  role: 'Member',
  station: 'Station 1',
  platoon: 'A',
  emergencyName1: 'Jane Doe',
  emergencyRelationship1: 'Spouse',
  emergencyPhone1: '(555) 234-5678',
  emergencyEmail1: 'jane.doe@example.com',
  emergencyName2: 'Bob Doe',
  emergencyRelationship2: 'Parent',
  emergencyPhone2: '(555) 345-6789',
  emergencyEmail2: 'bob.doe@example.com',
};

/**
 * All three of name and address must match, so a real member who happens to be
 * called John Doe is not turned away over his name alone.
 */
const isTemplateExampleRow = (data: CSVMemberRow): boolean =>
  data.firstName.trim().toLowerCase() === TEMPLATE_EXAMPLE.firstName.toLowerCase() &&
  data.lastName.trim().toLowerCase() === TEMPLATE_EXAMPLE.lastName.toLowerCase() &&
  data.email.trim().toLowerCase() === TEMPLATE_EXAMPLE.email.toLowerCase();

/**
 * Only these three are enforced as hard requirements, because they are the only
 * fields `AdminUserCreate` rejects a request without. Membership numbers are
 * auto-assigned server-side when omitted, and every other column maps to an
 * Optional backend field — blocking the upload on them turns a partial roster
 * into an unimportable one.
 */
const REQUIRED_HEADERS = ['firstname', 'lastname', 'email'] as const;

/**
 * `departmentId` is the legacy spelling of `membershipNumber` from earlier
 * versions of this template. Accept either so rosters built from an older
 * download still import.
 */
const MEMBERSHIP_NUMBER_HEADERS = ['membershipnumber', 'departmentid'] as const;

/**
 * Column names are matched on this normalized form, so a roster exported from
 * another system ("First Name", "membership_number", "Join-Date") lines up with
 * the template's camelCase spelling instead of being reported as a missing
 * required column. The leading BOM strip is belt-and-braces: `Blob.text()`
 * already removes it, but a file read through another path would otherwise
 * leave it glued to the first header and fail the required-column check.
 */
const normalizeHeader = (header: string): string =>
  header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const OPTIONAL_HEADERS = TEMPLATE_HEADERS.filter(
  (h) => !(REQUIRED_HEADERS as readonly string[]).includes(normalizeHeader(h))
);

/**
 * Every column this importer reads. A column outside this set is dropped, so it
 * is named back to the uploader rather than discarded in silence — a roster
 * exported from another system routinely carries columns (`status`,
 * `certifications`, `notes`) that look imported because the upload succeeds.
 */
const RECOGNIZED_HEADERS: readonly string[] = [...TEMPLATE_HEADERS.map(normalizeHeader), ...MEMBERSHIP_NUMBER_HEADERS];

/**
 * `status` earns a specific note instead of the generic one: unlike a stray
 * column, it names a member property the app really has, so "ignored" is
 * surprising without the reason. POST /users has no status field — every member
 * is created Active and adjusted afterwards.
 */
const STATUS_HEADER = 'status';

/**
 * Length ceilings copied from `AdminUserCreate` and `EmergencyContact`.
 *
 * Checked here so an over-long cell is reported as the column, its length and
 * the limit. The server's own answer is "Value is too long.", which names
 * neither the column nor the ceiling.
 */
const FIELD_LIMITS: Partial<Record<keyof CSVMemberRow, number>> = {
  firstName: 100,
  lastName: 100,
  middleName: 100,
  membershipNumber: 50,
  username: 100,
  street: 255,
  city: 100,
  state: 50,
  zipCode: 20,
  primaryPhone: 20,
  secondaryPhone: 20,
  rank: 100,
  station: 100,
  platoon: 20,
  emergencyName1: 100,
  emergencyRelationship1: 50,
  emergencyPhone1: 20,
  emergencyName2: 100,
  emergencyRelationship2: 50,
  emergencyPhone2: 20,
};

const EMAIL_COLUMNS = ['email', 'emergencyEmail1', 'emergencyEmail2'] as const;

/**
 * Deliberately permissive. Its job is to catch a phone number or a name sitting
 * in an email column — the signature of a shifted row — not to out-guess the
 * server's RFC-grade parser and reject an address the API would have accepted.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Seven or more digits and no `@`: the tell of a phone number in a shifted row. */
const looksLikePhone = (value: string): boolean => !value.includes('@') && (value.match(/\d/g) ?? []).length >= 7;

/**
 * Excel rewrites an ISO date cell into the workstation's locale format the
 * moment the template is opened and saved, so a filled-in roster comes back
 * with `3/15/1985` where the template showed `1985-03-15`. The API binds these
 * columns to a Pydantic `date`, which accepts ISO only — without this every row
 * of an Excel-edited file fails with an opaque 422.
 *
 * Returns the ISO form, or null when the value is not a date this importer
 * recognizes.
 */
const toIsoDate = (value: string): string | null => {
  const trimmed = value.trim();

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(trimmed);

  let year: number;
  let month: number;
  let day: number;

  if (iso) {
    year = Number(iso[1] ?? '');
    month = Number(iso[2] ?? '');
    day = Number(iso[3] ?? '');
  } else if (us) {
    month = Number(us[1] ?? '');
    day = Number(us[2] ?? '');
    const rawYear = us[3] ?? '';
    // A two-digit year is ambiguous; 70+ reads as 19xx so that a 1972 date of
    // birth does not land in 2072.
    year =
      rawYear.length === 2
        ? Number(rawYear) >= 70
          ? 1900 + Number(rawYear)
          : 2000 + Number(rawYear)
        : Number(rawYear);
  } else {
    return null;
  }

  // Rejects overflow dates (2025-02-30) that would otherwise roll forward.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/**
 * One parsed record: its cells, plus the 1-based line the record started on.
 *
 * The line is tracked during the scan rather than inferred from the record's
 * position, because a quoted field may contain newlines — which puts record 12
 * somewhere well below line 13. An error has to name a line the uploader can
 * actually find in the file.
 */
interface CsvRecord {
  cells: string[];
  line: number;
}

/**
 * Minimal RFC 4180 parser. A plain `split(',')` shifts every column right of a
 * quoted address ("123 Main St, Apt 4") — which surfaces as bogus "missing
 * required field" errors on rows that are actually well-formed.
 */
const parseCsv = (text: string): CsvRecord[] => {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === '\n') line++;
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Treat CRLF as a single terminator.
      if (char === '\r' && text[i + 1] === '\n') i++;
      cells.push(field);
      records.push({ cells, line: recordLine });
      cells = [];
      field = '';
      line++;
      recordLine = line;
    } else {
      field += char;
    }
  }

  if (field.length > 0 || cells.length > 0) {
    cells.push(field);
    records.push({ cells, line: recordLine });
  }

  return records;
};

const isBlankRow = (cells: string[]): boolean => cells.every((cell) => cell.trim() === '');

const cell = (row: string[], headers: string[], name: string): string | undefined => {
  const index = headers.indexOf(name);
  if (index === -1) return undefined;
  return row[index]?.trim();
};

const buildRow = (row: string[], headers: string[]): CSVMemberRow => ({
  firstName: cell(row, headers, 'firstname') || '',
  lastName: cell(row, headers, 'lastname') || '',
  middleName: cell(row, headers, 'middlename'),
  membershipNumber: MEMBERSHIP_NUMBER_HEADERS.map((h) => cell(row, headers, h)).find((v) => v) || '',
  username: cell(row, headers, 'username'),
  dateOfBirth: cell(row, headers, 'dateofbirth'),
  street: cell(row, headers, 'street') || '',
  city: cell(row, headers, 'city') || '',
  state: cell(row, headers, 'state') || '',
  zipCode: cell(row, headers, 'zipcode') || '',
  primaryPhone: cell(row, headers, 'primaryphone') || '',
  secondaryPhone: cell(row, headers, 'secondaryphone'),
  email: cell(row, headers, 'email') || '',
  joinDate: cell(row, headers, 'joindate') || '',
  status: cell(row, headers, 'status'),
  rank: cell(row, headers, 'rank'),
  role: cell(row, headers, 'role'),
  station: cell(row, headers, 'station'),
  platoon: cell(row, headers, 'platoon'),
  emergencyName1: cell(row, headers, 'emergencyname1') || '',
  emergencyRelationship1: cell(row, headers, 'emergencyrelationship1') || '',
  emergencyPhone1: cell(row, headers, 'emergencyphone1') || '',
  emergencyEmail1: cell(row, headers, 'emergencyemail1'),
  emergencyName2: cell(row, headers, 'emergencyname2'),
  emergencyRelationship2: cell(row, headers, 'emergencyrelationship2'),
  emergencyPhone2: cell(row, headers, 'emergencyphone2'),
  emergencyEmail2: cell(row, headers, 'emergencyemail2'),
});

const usernameFromEmail = (email: string): string =>
  (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_');

/**
 * Every reason this row cannot be created, not just the first one found.
 *
 * Returning on the first problem means a row with three bad cells takes three
 * upload-fix-upload cycles to clear. Each reason names the column and the
 * offending value, because a reason the uploader cannot map back to a cell is
 * no better than no reason at all.
 */
const validateRow = (data: CSVMemberRow): string[] => {
  const problems: string[] = [];

  const missing = (
    [
      ['firstName', data.firstName],
      ['lastName', data.lastName],
      ['email', data.email],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([column]) => column);
  if (missing.length > 0) {
    problems.push(`Missing required ${missing.length === 1 ? 'field' : 'fields'}: ${missing.join(', ')}`);
  }

  for (const column of EMAIL_COLUMNS) {
    const value = data[column];
    if (!value || EMAIL_PATTERN.test(value)) continue;
    problems.push(
      `${column} "${value}" is not an email address` +
        (looksLikePhone(value) ? " — that looks like a phone number, so this row's columns are probably shifted" : '')
    );
  }

  for (const [column, max] of Object.entries(FIELD_LIMITS)) {
    const value = data[column as keyof CSVMemberRow];
    if (max !== undefined && value && value.length > max) {
      problems.push(`${column} is ${value.length} characters long; the limit is ${max}`);
    }
  }

  // The API's minimum is 3 characters, and an omitted username is derived from
  // the email's local part — so a two-letter mailbox fails a column the file
  // never had.
  const username = data.username || (data.email ? usernameFromEmail(data.email) : '');
  if (username && username.length < 3) {
    problems.push(
      data.username
        ? `username "${username}" is under the 3-character minimum`
        : `username "${username}", derived from email "${data.email}", is under the 3-character minimum — add a username column for this member`
    );
  }

  // EmergencyContact requires name, relationship and phone together; a partial
  // contact is rejected by the API rather than saved with blanks.
  for (const [label, suffix, name, relationship, phone] of [
    ['Emergency contact 1', '1', data.emergencyName1, data.emergencyRelationship1, data.emergencyPhone1],
    ['Emergency contact 2', '2', data.emergencyName2, data.emergencyRelationship2, data.emergencyPhone2],
  ] as const) {
    if (!name) continue;
    const absent = [
      relationship ? '' : `emergencyRelationship${suffix}`,
      phone ? '' : `emergencyPhone${suffix}`,
    ].filter(Boolean);
    if (absent.length > 0) {
      problems.push(
        `${label} "${name}" is missing ${absent.join(' and ')} — name, relationship and phone are stored together or not at all`
      );
    }
  }

  for (const [column, value] of [
    ['dateOfBirth', data.dateOfBirth],
    ['joinDate', data.joinDate],
  ] as const) {
    if (value && toIsoDate(value) === null) {
      problems.push(`${column} "${value}" is not a recognized date — use YYYY-MM-DD or MM/DD/YYYY`);
    }
  }

  return problems;
};

/**
 * The organization's current members, indexed by the three values a new member
 * cannot reuse. Each map holds a display name, so a collision can say who owns
 * the value rather than only that one exists.
 */
interface ExistingMembers {
  byEmail: Map<string, string>;
  byUsername: Map<string, string>;
  byMembershipNumber: Map<string, string>;
}

const describeMember = (member: {
  full_name?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
  username: string;
}): string => member.full_name || [member.first_name, member.last_name].filter(Boolean).join(' ') || member.username;

/**
 * Indexes the roster so a row that collides with an existing member is caught
 * before the import runs.
 *
 * Without this the collision surfaces as the API's "Email already exists" on
 * that one row, partway through a write — the worst moment to learn it, and the
 * usual outcome of re-uploading a file after fixing a few rows. Emails are
 * omitted from the response when the organization hides contact information, in
 * which case that dimension simply goes unchecked and the server still catches
 * it.
 */
const indexExistingMembers = (
  members: Array<{
    email?: string | undefined;
    username: string;
    membership_number?: string | undefined;
    full_name?: string | undefined;
    first_name?: string | undefined;
    last_name?: string | undefined;
  }>
): ExistingMembers => {
  const index: ExistingMembers = {
    byEmail: new Map<string, string>(),
    byUsername: new Map<string, string>(),
    byMembershipNumber: new Map<string, string>(),
  };

  for (const member of members) {
    const name = describeMember(member);
    if (member.email) index.byEmail.set(member.email.trim().toLowerCase(), name);
    if (member.username) index.byUsername.set(member.username.trim().toLowerCase(), name);
    if (member.membership_number) {
      index.byMembershipNumber.set(member.membership_number.trim().toLowerCase(), name);
    }
  }

  return index;
};

/**
 * Judges every data row up front, so the uploader sees the whole problem before
 * any member is created rather than discovering it partway through a write.
 *
 * `knownRoles` is null when roles could not be loaded or none are configured,
 * which means the role column is skipped rather than failing every row.
 * `existing` is null when the roster could not be loaded, which likewise skips
 * the collision check rather than blocking the import on it.
 */
const runPreflight = (
  records: CsvRecord[],
  headerRow: string[],
  headers: string[],
  knownRoles: Set<string> | null,
  existing: ExistingMembers | null
): Preflight => {
  const dataRecords = records.slice(1).filter((record) => !isBlankRow(record.cells));

  // Cross-row uniqueness. The API answers a repeat with "Email already exists",
  // which is true but says nothing about the collision being with another row
  // of the very file being uploaded. The first occurrence stays importable.
  const claimed: Array<[Map<string, number>, string, (row: CSVMemberRow) => string | undefined]> = [
    [new Map<string, number>(), 'email', (row) => row.email],
    [new Map<string, number>(), 'username', (row) => row.username || (row.email ? usernameFromEmail(row.email) : '')],
    [new Map<string, number>(), 'membershipNumber', (row) => row.membershipNumber],
  ];

  const valid: ValidRow[] = [];
  const invalid: RowIssue[] = [];

  for (const record of dataRecords) {
    const reasons: string[] = [];

    // Extra cells mean a comma inside an unquoted value split one column into
    // two, sliding every later column right — which is how a phone number ends
    // up in the email field. There is no safe way to guess the intended split.
    if (record.cells.length > headerRow.length) {
      reasons.push(
        `Row has ${record.cells.length} values but the header has ${headerRow.length} columns, so every column after the extra comma is shifted. Wrap any value containing a comma in double quotes.`
      );
    }

    const data = buildRow(record.cells, headers);

    if (isTemplateExampleRow(data)) {
      invalid.push({
        line: record.line,
        reasons: ["This is the template's example row, not a member — delete it from the file before importing."],
        cells: record.cells,
      });
      continue;
    }

    reasons.push(...validateRow(data));

    if (knownRoles && data.role && !knownRoles.has(data.role.toLowerCase())) {
      reasons.push(
        `role "${data.role}" does not match any role configured under Roles — create it there, or clear the role column and use rank instead`
      );
    }

    if (existing) {
      const effectiveUsername = data.username || (data.email ? usernameFromEmail(data.email) : '');
      for (const [map, label, value] of [
        [existing.byEmail, 'email', data.email],
        [existing.byUsername, 'username', effectiveUsername],
        [existing.byMembershipNumber, 'membershipNumber', data.membershipNumber],
      ] as const) {
        const key = value.trim().toLowerCase();
        if (!key) continue;
        const owner = map.get(key);
        if (owner) {
          reasons.push(
            `${label} "${value}" already belongs to ${owner} in this organization — this member is already on the roster`
          );
        }
      }
    }

    for (const [seen, label, read] of claimed) {
      const key = (read(data) ?? '').trim().toLowerCase();
      if (!key) continue;
      const firstSeen = seen.get(key);
      if (firstSeen === undefined) {
        seen.set(key, record.line);
      } else {
        reasons.push(`${label} "${read(data) ?? ''}" is already used on line ${firstSeen} of this file`);
      }
    }

    if (reasons.length > 0) {
      invalid.push({ line: record.line, reasons, cells: record.cells });
    } else {
      valid.push({ line: record.line, data, cells: record.cells });
    }
  }

  return { headerRow, total: dataRecords.length, valid, invalid };
};

const escapeCell = (value: string): string => {
  // Spreadsheet applications can execute cells beginning with these characters
  // as formulas. A leading apostrophe makes the value literal when the CSV is
  // opened in a spreadsheet while leaving the user-supplied text visible.
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safeValue) ? `"${safeValue.replace(/"/g, '""')}"` : safeValue;
};

/**
 * The rejected rows, with spreadsheet formula prefixes neutralized and the
 * reasons in a leading column.
 *
 * `errorReason` leads rather than trails so it cannot collide with a row that
 * carries more cells than the header — precisely the shifted-column case this
 * report exists to explain. Delete column A and the file is ready to re-upload,
 * and because it holds only the failures, re-uploading cannot collide with the
 * members that imported successfully.
 */
const buildErrorReport = (headerRow: string[], issues: RowIssue[]): string => {
  const header = ['errorReason', ...headerRow].map(escapeCell).join(',');
  const rows = issues.map((issue) => [issue.reasons.join(' | '), ...issue.cells].map(escapeCell).join(','));
  return [header, ...rows].join('\r\n');
};

const downloadCsv = (contents: string, filename: string): void => {
  const blob = new Blob([contents], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const ImportMembers: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [roleIdsByName, setRoleIdsByName] = useState<Map<string, string>>(new Map());
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /**
   * Off by default, deliberately. Creating a member sends a password-setup link
   * the moment the record exists, and an import creates them by the dozen — a
   * roster loaded for staging, or from a list with stale addresses, would put
   * mail no one can recall in front of every one of them.
   */
  const [sendWelcomeEmails, setSendWelcomeEmails] = useState(false);
  /** Read inside the import loop, so a ref rather than state — a re-render would not reach it. */
  const cancelRequested = useRef(false);

  const resetFileState = () => {
    setPreflight(null);
    setRoleIdsByName(new Map());
    setImportResult(null);
    setProgress(null);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }

    setFile(selectedFile);
    resetFileState();
    void validateFile(selectedFile);
  };

  const validateFile = async (file: File) => {
    setValidating(true);
    try {
      const text = await file.text();
      const records = parseCsv(text);
      const headerRecord = records[0];

      if (!headerRecord || isBlankRow(headerRecord.cells)) {
        toast.error('The file is empty or has no header row.');
        setValidating(false);
        return;
      }

      const headerRow = headerRecord.cells;
      const headers = headerRow.map(normalizeHeader);

      const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
      if (missingHeaders.length > 0) {
        toast.error(`Missing required columns: ${missingHeaders.join(', ')}`);
        setValidating(false);
        return;
      }

      if (records.length < 2 || records.slice(1).every((r) => isBlankRow(r.cells))) {
        toast.error('The file has a header row but no member data.');
        setValidating(false);
        return;
      }

      const missingOptional = OPTIONAL_HEADERS.filter((h) => {
        const key = normalizeHeader(h);
        // Either spelling of the membership number column satisfies this one.
        if (key === 'membershipnumber') {
          return !MEMBERSHIP_NUMBER_HEADERS.some((alias) => headers.includes(alias));
        }
        return !headers.includes(key);
      });
      if (missingOptional.length > 0) {
        const shown = missingOptional.slice(0, 4).join(', ');
        const rest = missingOptional.length - 4;
        toast(
          `Importing without ${missingOptional.length} optional column(s): ${shown}` +
            (rest > 0 ? ` and ${rest} more` : ''),
          { icon: '⚠️' }
        );
      }

      if (headers.includes(STATUS_HEADER)) {
        toast(
          'The status column is ignored — every member is created Active. Set status on the member record after importing.',
          { icon: '⚠️' }
        );
      }

      const ignoredHeaders = headerRow
        .map((raw, index) => ({ raw: raw.trim(), key: headers[index] ?? '' }))
        .filter(({ raw, key }) => raw !== '' && key !== STATUS_HEADER && !RECOGNIZED_HEADERS.includes(key))
        .map(({ raw }) => raw);
      if (ignoredHeaders.length > 0) {
        const shown = ignoredHeaders.slice(0, 4).join(', ');
        const rest = ignoredHeaders.length - 4;
        toast(
          `Ignoring ${ignoredHeaders.length} unrecognized column(s): ${shown}` + (rest > 0 ? ` and ${rest} more` : ''),
          { icon: '⚠️' }
        );
      }

      // Roles are named in the CSV but assigned by id, so the org's roles are
      // resolved once here and reused by the import rather than re-fetched.
      let knownRoles: Set<string> | null = null;
      const resolvedRoleIds = new Map<string, string>();
      if (headers.includes('role')) {
        try {
          const roles = await roleService.getRoles();
          roles.forEach((role) => resolvedRoleIds.set(role.name.trim().toLowerCase(), role.id));
          // An empty list means roles are not configured yet, which the import
          // treats as "skip the column" rather than "every row is wrong".
          knownRoles = resolvedRoleIds.size > 0 ? new Set(resolvedRoleIds.keys()) : null;
        } catch (_error) {
          toast.error('Could not load roles; the role column will be skipped.');
        }
      }
      setRoleIdsByName(resolvedRoleIds);

      // One request turns "Email already exists", discovered per row partway
      // through a write, into a reason naming the member it collides with.
      let existing: ExistingMembers | null = null;
      try {
        existing = indexExistingMembers(await userService.getUsers());
      } catch (_error) {
        toast(
          'Could not load the current roster, so rows that duplicate an existing member will only be caught during the import.',
          { icon: '⚠️' }
        );
      }

      const report = runPreflight(records, headerRow, headers, knownRoles, existing);
      setPreflight(report);

      if (report.invalid.length === 0) {
        toast.success(`File validated successfully! Found ${report.total} members to import.`);
      } else if (report.valid.length === 0) {
        toast.error(
          `No rows can be imported — all ${report.total} have problems. Download the error report for the reason on each row.`,
          { duration: 8000 }
        );
      } else {
        toast(
          `${report.valid.length} of ${report.total} rows are ready; ${report.invalid.length} will be skipped. Review the reasons below.`,
          { icon: '⚠️', duration: 8000 }
        );
      }
    } catch (_error) {
      toast.error('Failed to parse CSV file. Please check the format.');
    }
    setValidating(false);
  };

  const handleImport = async () => {
    if (!preflight || preflight.valid.length === 0) return;

    setImporting(true);
    cancelRequested.current = false;
    setProgress({ done: 0, total: preflight.valid.length });
    // Rows rejected before the import began belong in the same report as rows
    // the server rejected during it; the uploader needs one list, not two.
    const issues: RowIssue[] = [...preflight.invalid];
    let success = 0;

    for (const [index, row] of preflight.valid.entries()) {
      // Cancelled rows go into the report like any other unimported row, so the
      // downloaded file is exactly what is left to do.
      if (cancelRequested.current) {
        for (const remaining of preflight.valid.slice(index)) {
          issues.push({
            line: remaining.line,
            reasons: ['Not imported — the import was stopped before this row.'],
            cells: remaining.cells,
          });
        }
        break;
      }

      const rowData = row.data;
      try {
        const username = rowData.username || usernameFromEmail(rowData.email);
        const roleId = rowData.role ? roleIdsByName.get(rowData.role.trim().toLowerCase()) : undefined;

        // Pre-flight has already rejected anything toIsoDate cannot parse.
        const dateOfBirth = rowData.dateOfBirth ? toIsoDate(rowData.dateOfBirth) : null;
        const joinDate = rowData.joinDate ? toIsoDate(rowData.joinDate) : null;

        const emergencyContacts: Array<{
          name: string;
          relationship: string;
          phone: string;
          email?: string | undefined;
          is_primary: boolean;
        }> = [];

        if (rowData.emergencyName1) {
          emergencyContacts.push({
            name: rowData.emergencyName1,
            relationship: rowData.emergencyRelationship1,
            phone: rowData.emergencyPhone1,
            ...(rowData.emergencyEmail1 ? { email: rowData.emergencyEmail1 } : {}),
            is_primary: true,
          });
        }

        if (rowData.emergencyName2) {
          emergencyContacts.push({
            name: rowData.emergencyName2,
            relationship: rowData.emergencyRelationship2 || '',
            phone: rowData.emergencyPhone2 || '',
            ...(rowData.emergencyEmail2 ? { email: rowData.emergencyEmail2 } : {}),
            is_primary: false,
          });
        }

        await userService.createMember({
          username,
          email: rowData.email,
          first_name: rowData.firstName,
          last_name: rowData.lastName,
          address_country: 'USA',
          emergency_contacts: emergencyContacts,
          send_welcome_email: sendWelcomeEmails,
          ...(rowData.middleName ? { middle_name: rowData.middleName } : {}),
          ...(rowData.membershipNumber ? { membership_number: rowData.membershipNumber } : {}),
          ...(rowData.primaryPhone ? { phone: rowData.primaryPhone } : {}),
          ...(rowData.secondaryPhone ? { mobile: rowData.secondaryPhone } : {}),
          ...(dateOfBirth ? { date_of_birth: dateOfBirth } : {}),
          ...(joinDate ? { hire_date: joinDate } : {}),
          ...(rowData.rank ? { rank: rowData.rank } : {}),
          ...(rowData.station ? { station: rowData.station } : {}),
          ...(rowData.platoon ? { platoon: rowData.platoon } : {}),
          ...(rowData.street ? { address_street: rowData.street } : {}),
          ...(rowData.city ? { address_city: rowData.city } : {}),
          ...(rowData.state ? { address_state: rowData.state } : {}),
          ...(rowData.zipCode ? { address_zip: rowData.zipCode } : {}),
          ...(roleId ? { role_ids: [roleId] } : {}),
        });

        success++;
      } catch (error: unknown) {
        issues.push({
          line: row.line,
          reasons: [getErrorMessage(error, 'The server rejected this row without a reason.')],
          cells: row.cells,
        });
      }

      setProgress({ done: index + 1, total: preflight.valid.length });
    }

    issues.sort((a, b) => a.line - b.line);
    setImportResult({ success, issues });
    setProgress(null);

    if (success > 0) {
      toast.success(`Successfully imported ${success} members!`);
    }
    if (issues.length > 0) {
      toast.error(`${issues.length} row(s) were not imported. Download the error report for details.`);
    }
    setImporting(false);
  };

  const downloadErrorReport = (issues: RowIssue[]) => {
    if (!preflight) return;
    downloadCsv(buildErrorReport(preflight.headerRow, issues), 'member-import-errors.csv');
    toast.success('Error report downloaded!');
  };

  const downloadTemplate = () => {
    const exampleRow = TEMPLATE_HEADERS.map((h) => escapeCell(TEMPLATE_EXAMPLE[h]));

    downloadCsv([TEMPLATE_HEADERS.join(','), exampleRow.join(',')].join('\n'), 'member-import-template.csv');

    toast.success('Template downloaded!');
  };

  const renderIssues = (issues: RowIssue[]) => (
    <div className="space-y-2 text-sm">
      {issues.map((issue) => (
        <div key={issue.line}>
          <p className="text-theme-alert-danger-title font-medium">Line {issue.line}</p>
          <ul className="text-theme-alert-danger-text ml-4 list-disc">
            {issue.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-theme-input-bg border-theme-surface-border border-b px-6 py-4 backdrop-blur-xs">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center space-x-3">
              <div className="shrink-0 rounded-lg bg-purple-600 p-2">
                <Upload className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-theme-text-primary text-xl font-bold">Import Members from CSV</h1>
                <p className="text-theme-text-muted text-sm">Bulk import member records</p>
              </div>
            </div>
            <button
              onClick={() => void navigate('/members')}
              className="text-theme-text-secondary hover:text-theme-text-primary shrink-0 self-start text-sm transition-colors sm:self-auto"
            >
              ← Back to Members
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Instructions */}
        <div className="bg-theme-alert-info-bg border-theme-alert-info-border mb-8 rounded-lg border p-6">
          <h2 className="text-theme-text-primary mb-3 flex items-center space-x-2 font-bold">
            <FileText className="text-theme-alert-info-icon h-5 w-5" />
            <span>How to Import Members</span>
          </h2>
          <ol className="text-theme-alert-info-text ml-6 list-decimal space-y-2 text-sm">
            <li>Download the CSV template below</li>
            <li>
              Fill in member information — <strong>firstName</strong>, <strong>lastName</strong> and{' '}
              <strong>email</strong> are required on every row; the rest are optional
            </li>
            <li>Replace the sample row — it is imported like any other row if left in</li>
            <li>Wrap any value containing a comma in double quotes, or its row will be rejected</li>
            <li>Leave membershipNumber blank to have the system assign one</li>
            <li>Role must match a role name configured under Roles</li>
            <li>Dates accept either YYYY-MM-DD or MM/DD/YYYY</li>
            <li>Upload your completed CSV file and review the check results</li>
            <li>Rows that pass are imported; any that fail come back as a downloadable report</li>
          </ol>

          <div className="border-theme-alert-info-border mt-4 border-t pt-4">
            <button onClick={downloadTemplate} className="btn-info flex items-center space-x-2">
              <Download className="h-4 w-4" />
              <span>Download CSV Template</span>
            </button>
          </div>
        </div>

        {/* File Upload */}
        <div className="card mb-8 p-8">
          <h2 className="text-theme-text-primary mb-4 font-bold">Step 1: Upload CSV File</h2>

          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-theme-input-border cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-colors hover:border-blue-500"
          >
            <Upload className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
            {file ? (
              <>
                <p className="text-theme-text-primary mb-1 font-medium">{file.name}</p>
                <p className="text-theme-text-muted text-sm">{(file.size / 1024).toFixed(2)} KB</p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    resetFileState();
                  }}
                  className="mt-3 text-sm text-red-700 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                >
                  Remove file
                </button>
              </>
            ) : (
              <>
                <p className="text-theme-text-primary mb-1 font-medium">Click to upload CSV file</p>
                <p className="text-theme-text-muted text-sm">or drag and drop</p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
            data-testid="csv-file-input"
          />

          {validating && (
            <div className="mt-4 flex items-center justify-center space-x-2 text-blue-700 dark:text-blue-400">
              <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-blue-700 dark:border-blue-400"></div>
              <span>Validating file...</span>
            </div>
          )}
        </div>

        {/* Pre-flight review */}
        {preflight && !importResult && (
          <div className="card mb-8 p-8">
            <h2 className="text-theme-text-primary mb-4 font-bold">Step 2: Preview Data</h2>
            {preflight.valid.length > 0 && (
              <>
                <p className="text-theme-text-secondary mb-4 text-sm">
                  Showing the first {Math.min(5, preflight.valid.length)} of {preflight.valid.length} members that will
                  be imported
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-theme-input-bg border-theme-surface-border border-b">
                      <tr>
                        <th scope="col" className="text-theme-text-secondary px-4 py-2 text-left">
                          Name
                        </th>
                        <th scope="col" className="text-theme-text-secondary px-4 py-2 text-left">
                          Member #
                        </th>
                        <th scope="col" className="text-theme-text-secondary px-4 py-2 text-left">
                          Email
                        </th>
                        <th scope="col" className="text-theme-text-secondary px-4 py-2 text-left">
                          Phone
                        </th>
                        <th scope="col" className="text-theme-text-secondary px-4 py-2 text-left">
                          Emergency Contact
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-theme-surface-border divide-y">
                      {preflight.valid.slice(0, 5).map(({ line, data }) => (
                        <tr key={line} className="hover:bg-theme-surface-secondary">
                          <td className="text-theme-text-primary px-4 py-2">
                            {data.firstName} {data.lastName}
                          </td>
                          <td className="text-theme-text-secondary px-4 py-2 font-mono">{data.membershipNumber}</td>
                          <td className="text-theme-text-secondary px-4 py-2">{data.email}</td>
                          <td className="text-theme-text-secondary px-4 py-2">{data.primaryPhone}</td>
                          <td className="text-theme-text-secondary px-4 py-2">
                            {data.emergencyName1
                              ? `${data.emergencyName1}${data.emergencyRelationship1 ? ` (${data.emergencyRelationship1})` : ''}`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {preflight.invalid.length > 0 && (
              <div className="bg-theme-alert-danger-bg border-theme-alert-danger-border mt-6 rounded-lg border p-4">
                <h3 className="text-theme-alert-danger-title mb-1 flex items-center space-x-2 font-bold">
                  <AlertTriangle className="h-5 w-5" />
                  <span>{preflight.invalid.length} row(s) will not be imported</span>
                </h3>
                <p className="text-theme-alert-danger-text mb-3 text-sm">
                  Download the report to get these rows back with the reason in the first column. Fix them, delete that
                  column, and upload the file again.
                </p>
                {renderIssues(preflight.invalid)}
                <button
                  onClick={() => downloadErrorReport(preflight.invalid)}
                  className="btn-info mt-4 flex items-center space-x-2"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Error Report</span>
                </button>
              </div>
            )}

            {preflight.valid.length > 0 && (
              <label className="mt-6 flex cursor-pointer items-start space-x-3">
                <input
                  type="checkbox"
                  checked={sendWelcomeEmails}
                  onChange={(e) => setSendWelcomeEmails(e.target.checked)}
                  disabled={importing}
                  className="border-theme-input-border mt-1 h-4 w-4 rounded"
                />
                <span className="text-sm">
                  <span className="text-theme-text-primary font-medium">Send welcome emails now</span>
                  <span className="text-theme-text-muted block">
                    Each member is emailed a password-setup link the moment their record is created, and it cannot be
                    recalled. Left off, the roster imports quietly and you issue credentials later from Member
                    Management.
                  </span>
                </span>
              </label>
            )}

            {progress && (
              <div className="mt-6">
                <div className="text-theme-text-secondary mb-1 flex justify-between text-sm">
                  <span>
                    Importing {progress.done} of {progress.total}
                  </span>
                  <span>{Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%</span>
                </div>
                <div className="bg-theme-input-bg h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="h-full bg-green-600 transition-all"
                    style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
                    role="progressbar"
                    aria-valuenow={progress.done}
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-label="Import progress"
                  />
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              {importing && (
                <button
                  onClick={() => {
                    cancelRequested.current = true;
                  }}
                  className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary rounded-lg border px-6 py-3 transition-colors"
                >
                  Stop importing
                </button>
              )}
              <button
                onClick={() => {
                  void handleImport();
                }}
                disabled={importing || preflight.valid.length === 0}
                className="flex items-center space-x-2 rounded-lg bg-linear-to-r from-green-600 to-emerald-600 px-6 py-3 text-white shadow-lg transition-all hover:from-green-700 hover:to-emerald-700 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing ? (
                  <>
                    <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-white"></div>
                    <span>Importing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-5 w-5" />
                    <span>Import {preflight.valid.length} Members</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Import Results */}
        {importResult && (
          <div className="card p-8">
            <div className="mb-6 text-center">
              <CheckCircle className="text-theme-alert-success-icon mx-auto mb-4 h-16 w-16" />
              <h2 className="text-theme-text-primary mb-2 text-2xl font-bold">Import Complete!</h2>
              <p className="text-theme-text-secondary">Successfully imported {importResult.success} members</p>
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="bg-theme-alert-success-bg border-theme-alert-success-border rounded-lg border p-4 text-center">
                <p className="text-theme-alert-success-title text-2xl font-bold">{importResult.success}</p>
                <p className="text-theme-alert-success-text text-sm">Successful</p>
              </div>
              <div className="bg-theme-alert-danger-bg border-theme-alert-danger-border rounded-lg border p-4 text-center">
                <p className="text-theme-alert-danger-title text-2xl font-bold">{importResult.issues.length}</p>
                <p className="text-theme-alert-danger-text text-sm">Failed</p>
              </div>
            </div>

            {importResult.issues.length > 0 && (
              <div className="bg-theme-alert-danger-bg border-theme-alert-danger-border mb-6 rounded-lg border p-4">
                <h3 className="text-theme-alert-danger-title mb-2 font-bold">Errors:</h3>
                {renderIssues(importResult.issues)}
                <button
                  onClick={() => downloadErrorReport(importResult.issues)}
                  className="btn-info mt-4 flex items-center space-x-2"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Error Report</span>
                </button>
              </div>
            )}

            <div className="flex items-center justify-center space-x-3">
              <button
                onClick={() => void navigate('/members')}
                className="btn-info flex items-center space-x-2 px-6 py-3"
              >
                <span>View Members</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default ImportMembers;
