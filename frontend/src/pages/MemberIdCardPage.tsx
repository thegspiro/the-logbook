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

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import JsBarcode from "jsbarcode";
import { CreditCard, Printer, ArrowLeft } from "lucide-react";
import { userService, organizationService } from "../services/api";
import type { OrganizationProfile } from "../services/api";
import { useAuthStore } from "../stores/authStore";
import { getErrorMessage } from "../utils/errorHandling";
import type { UserWithRoles } from "../types/role";

const STATUS_COLORS: Record<string, string> = {
  active:
    "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400",
  inactive: "bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400",
  leave:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400",
  retired: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400",
  suspended: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400",
  probationary:
    "bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400",
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[status] ?? STATUS_COLORS["inactive"]!;
}

export const MemberIdCardPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const { user: currentUser } = useAuthStore();
  const barcodeRef = useRef<SVGSVGElement>(null);

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
      setError(getErrorMessage(err, "Failed to load member ID card"));
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
          format: "CODE128",
          width: 2,
          height: 50,
          displayValue: false,
          margin: 0,
        });
      } catch {
        // If the membership number contains invalid characters, skip the barcode
      }
    }
  }, [member?.membership_number]);

  /** Build the QR payload — a JSON string with the member's ID and membership number. */
  const getQRValue = (): string => {
    if (!member || !currentUser) return "";
    return JSON.stringify({
      type: "member_id",
      id: member.id,
      membership_number: member.membership_number ?? "",
      org: currentUser.organization_id,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-theme-text-secondary">Loading ID card...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
          <p className="text-red-400">{error}</p>
        </div>
        <Link
          to={userId ? `/members/${userId}` : "/members"}
          className="text-blue-600 hover:text-blue-400"
        >
          &larr; Back to Profile
        </Link>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="max-w-md mx-auto p-6">
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
          <p className="text-yellow-300">Member not found</p>
        </div>
        <Link to="/members" className="text-blue-600 hover:text-blue-400">
          &larr; Back to Members
        </Link>
      </div>
    );
  }

  const displayName =
    member.full_name ||
    `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() ||
    member.username;
  const initials = (
    member.first_name?.[0] ??
    member.username?.[0] ??
    "?"
  ).toUpperCase();
  const qrValue = getQRValue();

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8 print:min-h-0 print:py-0 print:px-0">
      {/* Navigation — hidden when printing */}
      <div className="w-full max-w-sm mb-6 print:hidden">
        <Link
          to={`/members/${userId}`}
          className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Profile
        </Link>
      </div>

      {/* ID Card */}
      <div className="w-full max-w-sm id-card-printable" id="member-id-card">
        <div className="bg-theme-surface rounded-2xl shadow-lg overflow-hidden border border-theme-surface-border print:shadow-none print:border print:border-gray-300 print:rounded-lg">
          {/* Card Header — accent stripe */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-4 print:bg-blue-700 print:py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white">
                <CreditCard className="h-5 w-5" />
                <span className="text-sm font-semibold uppercase tracking-wider">
                  Member ID
                </span>
              </div>
              {org?.logo && (
                <div className="h-9 w-9 rounded-md bg-white/90 p-1 flex items-center justify-center flex-shrink-0">
                  <img
                    src={org.logo}
                    alt={org.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              )}
            </div>
            {org?.name && (
              <p className="text-white/90 text-sm mt-1 font-medium">
                {org.name}
              </p>
            )}
          </div>

          {/* Card Body */}
          <div className="px-6 py-5 print:py-3 print:px-4">
            {/* Photo + Info */}
            <div className="flex items-start gap-4 mb-5 print:mb-3">
              {member.photo_url ? (
                <img
                  src={member.photo_url}
                  alt={displayName}
                  className="h-20 w-20 rounded-lg object-cover flex-shrink-0 border-2 border-theme-surface-border"
                />
              ) : (
                <div className="h-20 w-20 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center flex-shrink-0 border-2 border-theme-surface-border print:bg-indigo-100">
                  <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 print:text-indigo-600">
                    {initials}
                  </span>
                </div>
              )}

              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-theme-text-primary truncate print:text-black">
                  {displayName}
                </h2>
                {member.rank && (
                  <p className="text-sm text-theme-text-secondary capitalize mt-0.5 print:text-gray-600">
                    {member.rank.replace(/_/g, " ")}
                  </p>
                )}
                {member.station && (
                  <p className="text-sm text-theme-text-muted mt-0.5 print:text-gray-500">
                    {member.station}
                  </p>
                )}
                <span
                  className={`inline-block mt-1.5 px-2 py-0.5 text-xs font-semibold rounded-full ${getStatusColor(member.status)} print:bg-gray-100 print:text-gray-800`}
                >
                  {member.status}
                </span>
              </div>
            </div>

            {/* Membership Number + Barcode */}
            {member.membership_number && (
              <div
                className="bg-theme-surface-hover rounded-lg px-4 py-2 mb-4 text-center print:bg-gray-50 print:border print:border-gray-200"
                data-testid="barcode-container"
              >
                <p className="text-xs text-theme-text-muted uppercase tracking-wider print:text-gray-500">
                  Membership #
                </p>
                <p className="text-lg font-mono font-bold text-theme-text-primary tracking-wide print:text-black">
                  {member.membership_number}
                </p>
                <div className="mt-1">
                  <svg ref={barcodeRef} data-testid="barcode" className="mx-auto" />
                </div>
              </div>
            )}

            {/* QR Code */}
            {qrValue && (
              <div className="flex flex-col items-center">
                <div className="bg-white p-4 rounded-lg print:p-2">
                  <QRCodeSVG
                    value={qrValue}
                    size={180}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <p className="text-xs text-theme-text-muted mt-2 print:text-gray-400">
                  Scan to identify member
                </p>
              </div>
            )}
          </div>

          {/* Card Footer */}
          <div className="bg-theme-surface-hover px-6 py-3 text-center print:bg-gray-50 print:py-2">
            <p className="text-xs text-theme-text-muted print:text-gray-500">
              {org?.name ?? "Organization"} &middot; Digital Member ID
            </p>
          </div>
        </div>
      </div>

      {/* Print Button — hidden when printing */}
      <div className="mt-6 print:hidden">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium"
        >
          <Printer className="h-4 w-4" />
          Print ID Card
        </button>
      </div>
    </div>
  );
};

export default MemberIdCardPage;
