import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ImportMembers from './ImportMembers';

const mockCreateMember = vi.fn();
const mockGetRoles = vi.fn();
const mockGetUsers = vi.fn();

vi.mock('../services/api', () => ({
  userService: {
    createMember: (...args: unknown[]) => mockCreateMember(...args) as unknown,
    getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown,
  },
  roleService: {
    getRoles: (...args: unknown[]) => mockGetRoles(...args) as unknown,
  },
}));

const mockToast = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: Object.assign((...args: unknown[]) => mockToast(...args) as unknown, {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  }),
}));

/**
 * Captures the CSV text handed to the Blob constructor by downloadTemplate, so
 * a test can feed the real template straight back into the uploader.
 */
const captureTemplate = async (): Promise<string> => {
  const user = userEvent.setup();
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();

  let captured = '';
  const originalBlob = globalThis.Blob;
  class CapturingBlob extends originalBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      captured = parts.map(String).join('');
    }
  }
  globalThis.Blob = CapturingBlob as unknown as typeof Blob;

  try {
    renderWithRouter(<ImportMembers />);
    await user.click(screen.getByText('Download CSV Template'));
  } finally {
    globalThis.Blob = originalBlob;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }

  return captured;
};

const uploadCsv = async (csv: string): Promise<void> => {
  const user = userEvent.setup();
  const file = new File([csv], 'members.csv', { type: 'text/csv' });
  await user.upload(screen.getByTestId<HTMLInputElement>('csv-file-input'), file);
};

const IMPORT_BUTTON = /^Import \d+ Members?$/;

/** Waits for pre-flight to finish, then starts the import. */
const clickImport = async (): Promise<void> => {
  await screen.findByText(IMPORT_BUTTON);
  await userEvent.setup().click(screen.getByText(IMPORT_BUTTON));
};

describe('ImportMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRoles.mockResolvedValue([]);
    mockGetUsers.mockResolvedValue([]);
    mockCreateMember.mockResolvedValue({ id: 'u1' });
  });

  it('renders the page header and instructions', () => {
    renderWithRouter(<ImportMembers />);

    expect(screen.getByText('Import Members from CSV')).toBeInTheDocument();
    expect(screen.getByText('How to Import Members')).toBeInTheDocument();
    expect(screen.getByText('Download CSV Template')).toBeInTheDocument();
  });

  // Regression: the template used to ship `membershipNumber` while the
  // validator demanded a `departmentId` column, so the downloaded file was
  // rejected on upload with "Missing required columns: departmentid".
  it('accepts every column of its own downloaded template', async () => {
    const template = await captureTemplate();
    expect(template).not.toBe('');

    await uploadCsv(template);

    await screen.findByText(IMPORT_BUTTON);
    expect(mockToastError).not.toHaveBeenCalledWith(expect.stringContaining('Missing required columns'));
    expect(mockToast).not.toHaveBeenCalledWith(expect.stringContaining('unrecognized column'), expect.anything());
  });

  it('rejects the template example row rather than importing John Doe', async () => {
    const template = await captureTemplate();
    await uploadCsv(template);

    expect(
      await screen.findByText(/This is the template's example row, not a member — delete it from the file/)
    ).toBeInTheDocument();
    await clickImport();
    expect(mockCreateMember).not.toHaveBeenCalled();
  });

  it('includes every column the create-member API accepts', async () => {
    const template = await captureTemplate();
    const headers = (template.split('\n')[0] ?? '').split(',');

    expect(headers).toEqual([
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
    ]);
  });

  it('rejects a file that is missing a genuinely required column', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName\nJohn,Doe');

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Missing required columns: email');
    });
  });

  it('validates a minimal file containing only the required columns', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email\nJohn,Doe,john@example.com');

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('File validated successfully! Found 1 members to import.');
    });
  });

  it('warns about — but does not block on — absent optional columns', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email\nJohn,Doe,john@example.com');

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        'Importing without 23 optional column(s): middleName, membershipNumber, username, dateOfBirth and 19 more',
        { icon: '⚠️' }
      );
    });
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('does not warn about membershipNumber when departmentId supplies it', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,departmentId\nJohn,Doe,john@example.com,FF-001');

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.not.stringContaining('membershipNumber'), { icon: '⚠️' });
    });
  });

  it('still accepts the legacy departmentId column as the membership number', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,departmentId\nJohn,Doe,john@example.com,FF-001');

    await waitFor(() => {
      expect(screen.getByText('FF-001')).toBeInTheDocument();
    });
  });

  it('keeps columns aligned when a quoted field contains a comma', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,street,email\nJohn,Doe,"123 Main St, Apt 4",john@example.com');

    await waitFor(() => {
      expect(screen.getByText('john@example.com')).toBeInTheDocument();
    });

    await clickImport();

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'john@example.com',
          address_street: '123 Main St, Apt 4',
        })
      );
    });
  });

  // Not John Doe: that name with that address is the template's own example
  // row, which the importer rejects rather than creating.
  it('derives the username from the email when the column is omitted', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email\nMary,Smith,mary.smith@example.com');

    await clickImport();

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({ username: 'mary_smith' }));
    });
  });

  it('uses an explicit username column when present', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,username\nJohn,Doe,john@example.com,jdoe');

    await clickImport();

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({ username: 'jdoe' }));
    });
  });

  it('resolves the role column to a role id', async () => {
    mockGetRoles.mockResolvedValue([
      { id: 'role-1', name: 'Member' },
      { id: 'role-2', name: 'Officer' },
    ]);

    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,role\nJohn,Doe,john@example.com,officer');

    await clickImport();

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({ role_ids: ['role-2'] }));
    });
  });

  it('reports an unknown role instead of silently dropping it', async () => {
    mockGetRoles.mockResolvedValue([{ id: 'role-1', name: 'Member' }]);

    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,role\nJohn,Doe,john@example.com,Chief');

    await clickImport();

    await waitFor(() => {
      expect(screen.getByText(/role "Chief" does not match any role configured under Roles/)).toBeInTheDocument();
    });
    expect(mockCreateMember).not.toHaveBeenCalled();
  });

  it('reports a partial emergency contact as a row error', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv(
      'firstName,lastName,email,emergencyName1,emergencyRelationship1,emergencyPhone1\n' +
        'John,Doe,john@example.com,Jane Doe,,'
    );

    await clickImport();

    await waitFor(() => {
      expect(
        screen.getByText(/Emergency contact 1 "Jane Doe" is missing emergencyRelationship1 and emergencyPhone1/)
      ).toBeInTheDocument();
    });
    expect(mockCreateMember).not.toHaveBeenCalled();
  });

  it('matches headers exported with spaces, underscores or mixed case', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('First Name,LAST_NAME,E-Mail,Membership Number\nJohn,Doe,john@example.com,FF-001');

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('File validated successfully! Found 1 members to import.');
    });
    expect(mockToastError).not.toHaveBeenCalled();
    expect(screen.getByText('FF-001')).toBeInTheDocument();
  });

  // Regression: Excel rewrites the template's ISO dates into the workstation's
  // locale format on save, which the API's `date` fields reject with a 422.
  it('converts locale-formatted dates to the ISO form the API accepts', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,dateOfBirth,joinDate\nJohn,Doe,john@example.com,3/15/1985,1/5/2020');

    await clickImport();

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(
        expect.objectContaining({ date_of_birth: '1985-03-15', hire_date: '2020-01-05' })
      );
    });
  });

  it('passes ISO dates through unchanged', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,dateOfBirth\nJohn,Doe,john@example.com,1985-03-15');

    await clickImport();

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({ date_of_birth: '1985-03-15' }));
    });
  });

  it('reports an unparseable date against its row instead of sending it', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,dateOfBirth\nJohn,Doe,john@example.com,March 15 1985');

    await clickImport();

    await waitFor(() => {
      expect(screen.getByText(/dateOfBirth "March 15 1985" is not a recognized date/)).toBeInTheDocument();
    });
    expect(mockCreateMember).not.toHaveBeenCalled();
  });

  it('ignores trailing blank lines when counting members', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email\nJohn,Doe,john@example.com\n\n');

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('File validated successfully! Found 1 members to import.');
    });
  });

  // The shape a real roster failed on: a quoted address shifted every later
  // column by one, so the empty secondaryPhone landed in email and the row was
  // rejected as "missing required fields" while the email sat one cell over.
  it('imports a row whose quoted address precedes an empty optional column', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv(
      'firstName,lastName,street,city,state,zipCode,primaryPhone,secondaryPhone,email,joinDate\n' +
        'David,Conner,"699 Great Falls Street, Apt 21",Falls Church,VA,22040,(555) 272-7510,,' +
        'david.conner@example.com,11/11/2012'
    );

    await clickImport();

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'david.conner@example.com',
          address_street: '699 Great Falls Street, Apt 21',
          address_city: 'Falls Church',
          address_zip: '22040',
          phone: '(555) 272-7510',
          hire_date: '2012-11-11',
        })
      );
    });
    expect(mockCreateMember.mock.calls[0]?.[0]).not.toHaveProperty('mobile');
  });

  // A roster exported from another system carries a status column, and the
  // import silently created every one of those members Active.
  it('says so when a status column will be ignored', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,status\nJohn,Doe,john@example.com,probationary');

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('The status column is ignored'), { icon: '⚠️' });
    });
  });

  it('names columns it does not recognize instead of dropping them silently', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,certifications,notes\nJohn,Doe,john@example.com,EMT-B,none');

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Ignoring 2 unrecognized column(s): certifications, notes', {
        icon: '⚠️',
      });
    });
  });

  it('does not call a recognized column unrecognized', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('First Name,LAST_NAME,E-Mail,Membership Number\nJohn,Doe,john@example.com,FF-001');

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('File validated successfully! Found 1 members to import.');
    });
    expect(mockToast).not.toHaveBeenCalledWith(expect.stringContaining('unrecognized column'), expect.anything());
  });

  // Every row of a roster whose role column holds assignments rather than
  // configured role names fails, so it is reported before the import runs
  // rather than one row at a time afterwards.
  it('reports unmatched role names at upload time', async () => {
    mockGetRoles.mockResolvedValue([{ id: 'role-1', name: 'Member' }]);

    renderWithRouter(<ImportMembers />);
    await uploadCsv(
      'firstName,lastName,email,role\n' +
        'John,Doe,john@example.com,Engine Operator\n' +
        'Jane,Roe,jane@example.com,EMT\n' +
        'Jim,Poe,jim@example.com,Engine Operator'
    );

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining('No rows can be imported — all 3 have problems'),
        { duration: 8000 }
      );
    });
    // Both rows naming that role are reported, not just the first.
    expect(screen.getAllByText(/role "Engine Operator" does not match any role configured under Roles/)).toHaveLength(
      2
    );
    expect(screen.getByRole('button', { name: /Import 0 Members/ })).toBeDisabled();
  });

  it('stays quiet at upload time when every role name matches', async () => {
    mockGetRoles.mockResolvedValue([{ id: 'role-1', name: 'Member' }]);

    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,role\nJohn,Doe,john@example.com,member');

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('File validated successfully! Found 1 members to import.');
    });
    expect(mockToastError).not.toHaveBeenCalled();
  });

  describe('shifted columns', () => {
    // The whole point of the exercise: an unquoted comma used to slide a phone
    // number into the email column and import it without a word.
    const UNQUOTED_COMMA =
      'firstName,lastName,street,city,primaryPhone,email\n' +
      'John,Doe,123 Main St, Apt 4,Springfield,(555) 111-2222,john@example.com';

    it('rejects a row carrying more values than the header has columns', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv(UNQUOTED_COMMA);

      expect(
        await screen.findByText(
          /Row has 7 values but the header has 6 columns, so every column after the extra comma is shifted/
        )
      ).toBeInTheDocument();
    });

    it('names the phone number sitting in the email column', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv(UNQUOTED_COMMA);

      expect(
        await screen.findByText(/email "\(555\) 111-2222" is not an email address — that looks like a phone number/)
      ).toBeInTheDocument();
    });

    it('never sends a shifted row to the API', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv(UNQUOTED_COMMA);
      await clickImport();

      expect(mockCreateMember).not.toHaveBeenCalled();
    });

    // A missing comma shifts the other way and cannot be caught by counting
    // cells, so the email check is the only thing standing between a merged row
    // and a member whose email address is a state abbreviation.
    it('catches a leftward shift that keeps the column count plausible', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email,state\nJohn,Doe,VA,');

      expect(await screen.findByText(/email "VA" is not an email address/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Import 0 Members/ })).toBeDisabled();
    });
  });

  it('reports every problem in a row at once, not just the first', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,dateOfBirth,joinDate\nJohn,Doe,not-an-email,32/1/1985,someday');

    expect(await screen.findByText(/email "not-an-email" is not an email address/)).toBeInTheDocument();
    expect(screen.getByText(/dateOfBirth "32\/1\/1985" is not a recognized date/)).toBeInTheDocument();
    expect(screen.getByText(/joinDate "someday" is not a recognized date/)).toBeInTheDocument();
  });

  it('flags a cell longer than the column the API stores it in', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv(`firstName,lastName,email,platoon\nJohn,Doe,john@example.com,${'A'.repeat(21)}`);

    expect(await screen.findByText('platoon is 21 characters long; the limit is 20')).toBeInTheDocument();
  });

  describe('duplicates within one file', () => {
    it('points at the line the value was first used on', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email\nJohn,Doe,dup@example.com\nJane,Roe,dup@example.com');

      expect(
        await screen.findByText('email "dup@example.com" is already used on line 2 of this file')
      ).toBeInTheDocument();
    });

    it('keeps the first occurrence importable', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email\nJohn,Doe,dup@example.com\nJane,Roe,dup@example.com');
      await clickImport();

      await waitFor(() => {
        expect(mockCreateMember).toHaveBeenCalledTimes(1);
      });
      expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({ first_name: 'John' }));
    });

    // Two different addresses can still collide, because an omitted username is
    // derived from the local part.
    it('catches usernames that collide only after being derived', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email\nJohn,Doe,j.doe@example.com\nJane,Doe,j.doe@other.org');

      expect(await screen.findByText('username "j_doe" is already used on line 2 of this file')).toBeInTheDocument();
    });
  });

  it('imports the good rows and skips the bad ones', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv(
      'firstName,lastName,email\n' +
        'John,Doe,john@example.com\n' +
        'Jane,Roe,not-an-email\n' +
        'Jim,Poe,jim@example.com'
    );

    expect(await screen.findByText('Import 2 Members')).toBeInTheDocument();
    await clickImport();

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('Import Complete!')).toBeInTheDocument();
    expect(screen.getByText('Successfully imported 2 members')).toBeInTheDocument();
  });

  // Creating a member emails a password-setup link immediately, and an import
  // creates them by the dozen — so a bulk load does not send until asked.
  describe('welcome emails', () => {
    it('does not send them unless the box is ticked', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email\nMary,Smith,mary@example.com');
      await clickImport();

      await waitFor(() => {
        expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({ send_welcome_email: false }));
      });
    });

    it('sends them when the box is ticked', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email\nMary,Smith,mary@example.com');

      await screen.findByText(IMPORT_BUTTON);
      await userEvent.setup().click(screen.getByRole('checkbox', { name: /Send welcome emails now/ }));
      await clickImport();

      await waitFor(() => {
        expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({ send_welcome_email: true }));
      });
    });
  });

  describe('members already on the roster', () => {
    const EXISTING = [
      {
        id: 'u-1',
        username: 'mary_smith',
        email: 'mary@example.com',
        membership_number: 'FF-001',
        full_name: 'Mary Smith',
      },
    ];

    it('names the member an email already belongs to', async () => {
      mockGetUsers.mockResolvedValue(EXISTING);

      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email\nMary,Smith,mary@example.com');

      expect(
        await screen.findByText(
          'email "mary@example.com" already belongs to Mary Smith in this organization — this member is already on the roster'
        )
      ).toBeInTheDocument();
      await clickImport();
      expect(mockCreateMember).not.toHaveBeenCalled();
    });

    it('catches a membership number already in use', async () => {
      mockGetUsers.mockResolvedValue(EXISTING);

      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email,membershipNumber\nPat,Jones,pat@example.com,FF-001');

      expect(await screen.findByText(/membershipNumber "FF-001" already belongs to Mary Smith/)).toBeInTheDocument();
    });

    it('imports a member who collides with nobody', async () => {
      mockGetUsers.mockResolvedValue(EXISTING);

      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email\nPat,Jones,pat@example.com');
      await clickImport();

      await waitFor(() => {
        expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({ email: 'pat@example.com' }));
      });
    });

    // Losing the roster lookup must not block the upload; the server still
    // rejects a genuine duplicate.
    it('imports anyway when the roster cannot be loaded', async () => {
      mockGetUsers.mockRejectedValue(new Error('network'));

      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email\nPat,Jones,pat@example.com');

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('Could not load the current roster'), {
          icon: '⚠️',
        });
      });
      await clickImport();
      await waitFor(() => {
        expect(mockCreateMember).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('error report', () => {
    /** Captures the CSV handed to Blob by a download, without touching the DOM download. */
    const captureDownload = async (act: () => Promise<void>): Promise<string> => {
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = vi.fn(() => 'blob:mock');
      URL.revokeObjectURL = vi.fn();

      let captured = '';
      const originalBlob = globalThis.Blob;
      class CapturingBlob extends originalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          captured = parts.map(String).join('');
        }
      }
      globalThis.Blob = CapturingBlob as unknown as typeof Blob;

      try {
        await act();
      } finally {
        globalThis.Blob = originalBlob;
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
      }
      return captured;
    };

    it('hands back the failed rows with the reason in the first column', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email\nJohn,Doe,john@example.com\nJane,Roe,not-an-email');
      await screen.findByText('Download Error Report');

      const report = await captureDownload(async () => {
        await userEvent.setup().click(screen.getByText('Download Error Report'));
      });

      const lines = report.split('\r\n');
      expect(lines[0]).toBe('errorReason,firstName,lastName,email');
      expect(lines[1]).toBe('"email ""not-an-email"" is not an email address",Jane,Roe,not-an-email');
      // Only the failures, so the corrected file cannot collide with the
      // members that already imported.
      expect(lines).toHaveLength(2);
    });

    it('carries a shifted row through verbatim so it can be re-quoted', async () => {
      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,street,email\nJohn,Doe,123 Main St, Apt 4,john@example.com');
      await screen.findByText('Download Error Report');

      const report = await captureDownload(async () => {
        await userEvent.setup().click(screen.getByText('Download Error Report'));
      });

      // Every original cell survives, including the two the stray comma made.
      expect(report).toContain('123 Main St, Apt 4');
      expect(report).toContain('Row has 5 values but the header has 4 columns');
    });

    it('lists a cancelled row as work still to do', async () => {
      // The first row parks until the test releases it, so Stop is pressed at a
      // known point rather than racing the render of its own button.
      let releaseFirstRow: () => void = () => {};
      const firstRowParked = new Promise<void>((resolve) => {
        releaseFirstRow = resolve;
      });
      let started = 0;
      mockCreateMember.mockImplementation(async () => {
        started++;
        if (started === 1) await firstRowParked;
        return { id: `u${started}` };
      });

      renderWithRouter(<ImportMembers />);
      await uploadCsv(
        'firstName,lastName,email\n' +
          'Ann,One,ann@example.com\n' +
          'Bob,Two,bob@example.com\n' +
          'Cal,Three,cal@example.com'
      );
      await clickImport();

      await userEvent.setup().click(await screen.findByText('Stop importing'));
      releaseFirstRow();

      await screen.findByText('Import Complete!');

      expect(mockCreateMember).toHaveBeenCalledTimes(1);

      const report = await captureDownload(async () => {
        await userEvent.setup().click(screen.getByText('Download Error Report'));
      });
      expect(report).toContain('Not imported — the import was stopped before this row.');
      expect(report).toContain('bob@example.com');
      expect(report).toContain('cal@example.com');
      expect(report).not.toContain('ann@example.com');
    });

    it('includes rows the server rejected alongside rows pre-flight rejected', async () => {
      mockCreateMember.mockRejectedValueOnce({
        response: { data: { detail: 'Email already exists' }, status: 400 },
      });

      renderWithRouter(<ImportMembers />);
      await uploadCsv('firstName,lastName,email\nJohn,Doe,taken@example.com\nJane,Roe,not-an-email');
      await clickImport();
      await screen.findByText('Import Complete!');

      const report = await captureDownload(async () => {
        await userEvent.setup().click(screen.getByText('Download Error Report'));
      });

      expect(report).toContain('Email already exists');
      expect(report).toContain('is not an email address');
      expect(screen.getByText('Import Complete!')).toBeInTheDocument();
    });
  });
});
