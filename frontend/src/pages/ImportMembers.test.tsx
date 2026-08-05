import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';
import ImportMembers from './ImportMembers';

const mockCreateMember = vi.fn();
const mockGetRoles = vi.fn();

vi.mock('../services/api', () => ({
  userService: {
    createMember: (...args: unknown[]) => mockCreateMember(...args) as unknown,
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

describe('ImportMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRoles.mockResolvedValue([]);
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
  it('accepts its own downloaded template without reporting missing columns', async () => {
    const template = await captureTemplate();
    expect(template).not.toBe('');

    await uploadCsv(template);

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith('File validated successfully! Found 1 members to import.');
    });
    expect(mockToastError).not.toHaveBeenCalled();
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

    await userEvent.setup().click(screen.getByText('Import All Members'));

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'john@example.com',
          address_street: '123 Main St, Apt 4',
        })
      );
    });
  });

  it('derives the username from the email when the column is omitted', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email\nJohn,Doe,john.doe@example.com');

    expect(await screen.findByText('Import All Members')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Import All Members'));

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({ username: 'john_doe' }));
    });
  });

  it('uses an explicit username column when present', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,username\nJohn,Doe,john@example.com,jdoe');

    expect(await screen.findByText('Import All Members')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Import All Members'));

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

    expect(await screen.findByText('Import All Members')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Import All Members'));

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(expect.objectContaining({ role_ids: ['role-2'] }));
    });
  });

  it('reports an unknown role instead of silently dropping it', async () => {
    mockGetRoles.mockResolvedValue([{ id: 'role-1', name: 'Member' }]);

    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,role\nJohn,Doe,john@example.com,Chief');

    expect(await screen.findByText('Import All Members')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Import All Members'));

    await waitFor(() => {
      expect(screen.getByText(/Unknown role "Chief"/)).toBeInTheDocument();
    });
    expect(mockCreateMember).not.toHaveBeenCalled();
  });

  it('reports a partial emergency contact as a row error', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv(
      'firstName,lastName,email,emergencyName1,emergencyRelationship1,emergencyPhone1\n' +
        'John,Doe,john@example.com,Jane Doe,,'
    );

    expect(await screen.findByText('Import All Members')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Import All Members'));

    await waitFor(() => {
      expect(screen.getByText(/needs both emergencyRelationship1 and emergencyPhone1/)).toBeInTheDocument();
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
    await uploadCsv(
      'firstName,lastName,email,dateOfBirth,joinDate\nJohn,Doe,john@example.com,3/15/1985,1/5/2020'
    );

    expect(await screen.findByText('Import All Members')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Import All Members'));

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(
        expect.objectContaining({ date_of_birth: '1985-03-15', hire_date: '2020-01-05' })
      );
    });
  });

  it('passes ISO dates through unchanged', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,dateOfBirth\nJohn,Doe,john@example.com,1985-03-15');

    expect(await screen.findByText('Import All Members')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Import All Members'));

    await waitFor(() => {
      expect(mockCreateMember).toHaveBeenCalledWith(
        expect.objectContaining({ date_of_birth: '1985-03-15' })
      );
    });
  });

  it('reports an unparseable date against its row instead of sending it', async () => {
    renderWithRouter(<ImportMembers />);
    await uploadCsv('firstName,lastName,email,dateOfBirth\nJohn,Doe,john@example.com,March 15 1985');

    expect(await screen.findByText('Import All Members')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Import All Members'));

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
});
