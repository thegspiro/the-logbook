/**
 * Member ID Card Page
 *
 * Displays a mobile-friendly digital ID card for a member, including:
 * - Photo, name, rank, station, membership number
 * - Organization name and logo
 * - QR code encoding the member's ID for scanning (e.g., gear assignment)
 * - Code128 barcode of the membership number (for USB barcode scanners)
 * - Member status badge
 *
 * Accessible at /members/:userId/id-card. Any authenticated user can view
 * their own card; viewing another member's card requires members.view or
 * members.manage permission.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import JsBarcode from 'jsbarcode';
import { CreditCard, Printer, ArrowLeft } from 'lucide-react';
import { userService, organizationService } from '../services/api';
import type { OrganizationProfile } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { useRanks } from '../hooks/useRanks';
import type { UserWithRoles } from '../types/role';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  inactive: 'bg-theme-surface-secondary text-theme-text-secondary',
  leave: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  retired: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  suspended: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  probationary: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400',
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS['inactive'] ?? '';
}

export const MemberIdCardPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const { user: currentUser } = useAuthStore();
  const { formatRank } = useRanks();
  const tz = useTimezone();
  const barcodeRef = useRef<SVGSVGElement>(null);
  const [barcodeReady, setBarcodeReady] = useState(false);

  const [member, setMember] = useState<UserWithRoles | null>(null);
  const [org, setOrg] = useState<OrganizationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      setError(null);

      const [userData, orgData] = await Promise.all([
        userService.getUserWithRoles(userId),
        organizationService.getProfile(),
      ]);
      setMember(userData);
      setOrg(orgData);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load member ID card'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Render the Code128 barcode when the member data loads
  useEffect(() => {
    if (barcodeRef.current && member?.membership_number) {
      try {
        JsBarcode(barcodeRef.current, member.membership_number, {
          format: 'CODE128',
          width: 2,
          height: 50,
          displayValue: false,
          margin: 0,
        });
      } catch {
        // If the membership number contains invalid characters, skip the barcode
      }
    }
    // Mark barcode as ready once the effect has run (even if no barcode was needed)
    if (member) {
      setBarcodeReady(true);
    }
  }, [member?.membership_number, member]);

  /** Build the QR payload — a JSON string with the member's ID and membership number. */
  const getQRValue = (): string => {
    if (!member || !currentUser) return '';
    return JSON.stringify({
      type: 'member_id',
      id: member.id,
      membership_number: member.membership_number ?? '',
      org: currentUser.organization_id,
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-theme-text-secondary">Loading ID card...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-red-700 dark:text-red-400">{error}</p>
        </div>
        <Link
          to={userId ? `/members/${userId}` : '/members'}
          className="text-blue-600 hover:text-blue-800 dark:hover:text-blue-400"
        >
          &larr; Back to Profile
        </Link>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="mx-auto max-w-md p-6">
        <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="text-yellow-700 dark:text-yellow-300">Member not found</p>
        </div>
        <Link to="/members" className="text-blue-600 hover:text-blue-800 dark:hover:text-blue-400">
          &larr; Back to Members
        </Link>
      </div>
    );
  }

  const displayName =
    member.full_name || `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || member.username;
  const initials = (member.first_name?.[0] ?? member.username?.[0] ?? '?').toUpperCase();
  const qrValue = getQRValue();

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-8 print:min-h-0 print:px-0 print:py-0">
      {/* Navigation — hidden when printing */}
      <div className="mb-6 w-full max-w-sm print:hidden">
        <Link
          to={`/members/${userId}`}
          className="text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Profile
        </Link>
      </div>

      {/* ID Card */}
      <div className="id-card-printable w-full max-w-sm" id="member-id-card">
        <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-2xl border shadow-lg print:rounded-lg print:border print:border-gray-300 print:shadow-none">
          {/* Card Header — accent stripe */}
          <div className="bg-linear-to-r from-blue-600 to-indigo-700 px-6 py-4 print:bg-blue-700 print:py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <CreditCard className="h-5 w-5" />
                <span className="text-sm font-semibold tracking-wider uppercase">Member ID</span>
              </div>
              {org?.logo && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/90 p-1">
                  <img src={org.logo} alt={org.name} className="max-h-full max-w-full object-contain" />
                </div>
              )}
            </div>
            {org?.name && <p className="mt-1 text-sm font-medium text-white/90">{org.name}</p>}
          </div>

          {/* Card Body */}
          <div className="px-6 py-5 print:px-4 print:py-3">
            {/* Photo + Info */}
            <div className="mb-5 flex items-start gap-4 print:mb-3">
              {member.photo_url ? (
                <img
                  src={member.photo_url}
                  alt={displayName}
                  className="border-theme-surface-border h-20 w-20 shrink-0 rounded-lg border-2 object-cover"
                />
              ) : (
                <div className="border-theme-surface-border flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border-2 bg-indigo-100 dark:bg-indigo-500/20 print:bg-indigo-100">
                  <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 print:text-indigo-600">
                    {initials}
                  </span>
                </div>
              )}

              <div className="min-w-0 flex-1">
                <h2 className="text-theme-text-primary truncate text-lg font-bold print:text-black">{displayName}</h2>
                {member.station && (
                  <p className="text-theme-text-muted mt-0.5 text-sm print:text-gray-500">{member.station}</p>
                )}
                <span
                  className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${getStatusColor(member.status)} print:bg-gray-100 print:text-gray-800`}
                >
                  {member.status}
                </span>
              </div>
            </div>

            {/* Rank & Member Since */}
            {(member.rank || member.hire_date) && (
              <div className="mb-4 grid grid-cols-2 gap-3">
                {member.rank && (
                  <div className="bg-theme-surface-hover rounded-lg px-3 py-2 text-center print:border print:border-gray-200 print:bg-gray-50">
                    <p className="text-theme-text-muted text-xs tracking-wider uppercase print:text-gray-500">Rank</p>
                    <p className="text-theme-text-primary text-sm font-semibold print:text-black">
                      {formatRank(member.rank)}
                    </p>
                  </div>
                )}
                {member.hire_date && (
                  <div className="bg-theme-surface-hover rounded-lg px-3 py-2 text-center print:border print:border-gray-200 print:bg-gray-50">
                    <p className="text-theme-text-muted text-xs tracking-wider uppercase print:text-gray-500">
                      Member Since
                    </p>
                    <p className="text-theme-text-primary text-sm font-semibold print:text-black">
                      {new Date(member.hire_date).getFullYear()}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Membership Number + Barcode */}
            {member.membership_number && (
              <div
                className="bg-theme-surface-hover mb-4 rounded-lg px-4 py-2 text-center print:border print:border-gray-200 print:bg-gray-50"
                data-testid="barcode-container"
              >
                <p className="text-theme-text-muted text-xs tracking-wider uppercase print:text-gray-500">
                  Membership #
                </p>
                <p className="text-theme-text-primary font-mono text-lg font-bold tracking-wide print:text-black">
                  {member.membership_number}
                </p>
                <div className="mt-1">
                  {/* Constrain the intrinsic SVG width so long membership
                      numbers scale down to fit the card on narrow phones
                      instead of overflowing horizontally. */}
                  <svg
                    ref={barcodeRef}
                    data-testid="barcode"
                    className="mx-auto"
                    style={{ maxWidth: '100%', height: 'auto' }}
                  />
                </div>
              </div>
            )}

            {/* QR Code */}
            {qrValue && (
              <div className="flex flex-col items-center">
                <div className="rounded-lg bg-white p-4 print:p-2">
                  {/* includeMargin adds the spec quiet zone — without it the
                      code is unreliable when scanned off one phone screen by
                      another device. */}
                  <QRCodeSVG value={qrValue} size={200} level="M" includeMargin />
                </div>
                <p className="text-theme-text-muted mt-2 text-xs print:text-gray-400">Scan to identify member</p>
              </div>
            )}
          </div>

          {/* Card Footer */}
          <div className="bg-theme-surface-hover px-6 py-3 text-center print:bg-gray-50 print:py-2">
            <p className="text-theme-text-muted text-xs print:text-gray-500">
              {org?.name ?? 'Organization'} &middot; Digital Member ID
            </p>
            <p className="text-theme-text-muted/70 mt-0.5 text-[10px] print:text-gray-400">
              Generated {formatDate(new Date(), tz)}
            </p>
          </div>
        </div>
      </div>

      {/* Print Button — hidden when printing */}
      <div className="mt-6 print:hidden">
        <button
          onClick={() => window.print()}
          disabled={!barcodeReady}
          className="btn-info inline-flex items-center gap-2 px-5 text-sm font-medium transition disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          Print ID Card
        </button>
      </div>
    </div>
  );
};

export default MemberIdCardPage;
