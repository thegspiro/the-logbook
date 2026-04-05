/**
 * Printable QR Card for Apparatus Check-In
 *
 * Generates a clean, print-friendly card with the apparatus name
 * and a QR code. Designed to be printed and laminated on the
 * apparatus dashboard.
 *
 * URL: /scheduling/checkin/print?apparatus=<id>&name=<name>
 */

import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';

const ShiftCheckInPrintPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const apparatusId = searchParams.get('apparatus') || '';
  const apparatusName = searchParams.get('name') || 'Apparatus';

  const checkInUrl = `${window.location.origin}/scheduling/checkin?apparatus=${apparatusId}`;

  useEffect(() => {
    const timer = setTimeout(() => window.print(), 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white p-8">
      <div className="w-[4in] border-2 border-gray-300 rounded-xl p-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">
          {apparatusName}
        </h1>
        <p className="text-sm text-gray-500 mb-4">
          Shift Check-In / Check-Out
        </p>

        <div className="flex justify-center mb-4">
          <QRCodeSVG
            value={checkInUrl}
            size={200}
            level="M"
            includeMargin
          />
        </div>

        <p className="text-xs text-gray-400 mb-2">
          Scan with your phone to check in or out
        </p>
        <div className="border-t border-gray-200 pt-2">
          <p className="text-[10px] text-gray-300 break-all">
            {checkInUrl}
          </p>
        </div>
      </div>

      <style>{`
        @media print {
          body { margin: 0; }
          @page { size: 4.5in 6in; margin: 0.25in; }
        }
      `}</style>
    </div>
  );
};

export default ShiftCheckInPrintPage;
