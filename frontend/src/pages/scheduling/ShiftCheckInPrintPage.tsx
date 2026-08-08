/**
 * Printable QR Card for Apparatus Check-In
 *
 * Generates a clean, print-friendly card with the apparatus name
 * and a QR code. Designed to be printed and laminated on the
 * apparatus dashboard, but also safe to open on a phone just to
 * display the code on-screen.
 *
 * URL: /scheduling/checkin/print?apparatus=<id>&name=<name>[&autoprint=1]
 */

import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, AlertTriangle } from 'lucide-react';

const ShiftCheckInPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const apparatusId = searchParams.get('apparatus') || '';
  const apparatusName = searchParams.get('name') || 'Apparatus';
  const autoPrint = searchParams.get('autoprint') === '1';

  const checkInUrl = `${window.location.origin}/scheduling/checkin?apparatus=${apparatusId}`;

  // Only auto-open the print dialog when explicitly requested (the "Print QR
  // Card" action appends autoprint=1). Opening this page just to view the code
  // on a phone must NOT force the OS print sheet.
  useEffect(() => {
    if (!autoPrint || !apparatusId) return undefined;
    const timer = setTimeout(() => window.print(), 500);
    return () => clearTimeout(timer);
  }, [autoPrint, apparatusId]);

  if (!apparatusId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-8">
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" aria-hidden="true" />
          <h1 className="mb-1 text-lg font-semibold text-gray-900">Missing apparatus</h1>
          <p className="text-sm text-gray-500">
            This check-in card link is missing its apparatus, so no QR code can be generated. Reopen it from the shift
            details.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-8">
      <div className="w-[4in] max-w-full rounded-xl border-2 border-gray-300 p-6 text-center">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">{apparatusName}</h1>
        <p className="mb-4 text-sm text-gray-500">Shift Check-In / Check-Out</p>

        <div className="mb-4 flex justify-center">
          <QRCodeSVG value={checkInUrl} size={200} level="M" includeMargin />
        </div>

        <p className="mb-2 text-xs text-gray-600">Scan with your phone to check in or out</p>
        <div className="border-t border-gray-200 pt-2">
          <p className="text-[10px] break-all text-gray-600">{checkInUrl}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => window.print()}
        className="no-print inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        <Printer className="h-4 w-4" aria-hidden="true" />
        Print
      </button>

      <style>{`
        @page { size: 4.5in 6in; margin: 0.25in; }
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
};

export default ShiftCheckInPrintPage;
