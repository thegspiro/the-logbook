/**
 * Room QR Codes Page
 *
 * A single directory of every kiosk QR code in the department, grouped by
 * station/facility, so admins don't have to hunt through individual room
 * cards to find them. Print-friendly: the global print stylesheet hides
 * navigation, and each card avoids page breaks so the sheet can be cut up
 * and posted in each room.
 *
 * Every location (station or room) gets a `display_code` when it is
 * created; the QR code encodes the public kiosk URL `/display/{code}`.
 *
 * URL: /locations/qr-codes
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Building2, Copy, Check, DoorOpen, Loader2, Printer, QrCode } from 'lucide-react';
import toast from 'react-hot-toast';
import { locationsService } from '../services/api';
import type { Location } from '../services/api';
import { groupByStation } from '../utils/locationGrouping';

/** Copy text to clipboard with fallback for non-HTTPS contexts */
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // clipboard API failed (e.g. non-secure context) — fall through to fallback
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

function QRCard({ location }: { location: Location }) {
  const [copied, setCopied] = useState(false);
  const kioskUrl = `${window.location.origin}/display/${location.display_code}`;
  const isStation = Boolean(location.address && !location.building && !location.room_number);

  const handleCopy = async () => {
    try {
      await copyToClipboard(kioskUrl);
      setCopied(true);
      toast.success('Kiosk URL copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy URL');
    }
  };

  return (
    <div className="qr-card bg-theme-surface border-theme-surface-border flex flex-col items-center rounded-xl border p-4 text-center print:border-gray-300">
      <div className="mb-2 flex items-center gap-1.5">
        {isStation ? (
          <Building2 className="text-theme-text-muted h-4 w-4 shrink-0 print:hidden" aria-hidden="true" />
        ) : (
          <DoorOpen className="text-theme-text-muted h-4 w-4 shrink-0 print:hidden" aria-hidden="true" />
        )}
        <h3 className="text-theme-text-primary text-sm font-semibold print:text-black">
          {location.name}
          {location.room_number ? ` #${location.room_number}` : ''}
        </h3>
      </div>
      {/* bg-white intentional for QR code readability in dark mode */}
      <div className="rounded-lg bg-white p-2">
        <QRCodeSVG value={kioskUrl} size={160} level="H" includeMargin />
      </div>
      <p className="text-theme-text-muted mt-2 font-mono text-[10px] break-all print:text-black">{kioskUrl}</p>
      <button
        onClick={() => {
          void handleCopy();
        }}
        className="no-print text-theme-text-muted mt-2 flex items-center gap-1.5 text-xs transition-colors hover:text-blue-500"
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-500" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
        Copy URL
      </button>
    </div>
  );
}

export default function RoomQRCodesPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await locationsService.getLocations({ is_active: true });
        setLocations(data);
      } catch {
        toast.error('Failed to load locations');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const groups = groupByStation(locations);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="no-print">
        <Link
          to="/locations"
          className="text-theme-text-muted hover:text-theme-text-primary mb-2 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Locations
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-theme-text-primary text-2xl font-bold sm:text-3xl">Room QR Codes</h1>
            <p className="text-theme-text-secondary mt-1">
              Every room's check-in QR code in one place. Print this page, cut out the cards, and post each code in its
              room — scanning opens the room's kiosk display for event check-in.
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="btn-primary flex shrink-0 items-center gap-2 self-start py-2.5 sm:self-auto"
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> Print All
          </button>
        </div>
      </div>

      {/* Print-only title so the sheet is self-explanatory */}
      <h1 className="hidden text-xl font-bold text-black print:block">Room QR Codes</h1>

      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="py-20 text-center">
          <QrCode className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <h3 className="text-theme-text-primary mb-1 text-lg font-medium">No QR codes yet</h3>
          <p className="text-theme-text-muted mb-4">
            QR codes are generated automatically when you add stations and rooms.
          </p>
          <Link to="/locations" className="btn-primary inline-flex items-center gap-2 py-2.5">
            Set Up Locations
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.name}>
              <h2 className="text-theme-text-primary mb-3 flex items-center gap-2 text-lg font-semibold print:text-black">
                <Building2 className="h-5 w-5 text-red-500 print:hidden" aria-hidden="true" />
                {group.name}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2">
                {group.locations.map((location) => (
                  <QRCard key={location.id} location={location} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <style>{`
        @media print {
          .qr-card { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
