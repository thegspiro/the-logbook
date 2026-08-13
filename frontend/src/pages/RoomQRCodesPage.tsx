/**
 * Check-In QR Codes Page
 *
 * A single directory of every check-in QR code in the department:
 *
 * - Room kiosk codes, grouped by station/facility. Every location gets a
 *   `display_code` when created; its QR encodes the public kiosk URL
 *   `/display/{code}`. Admins with locations.edit/manage can rotate a
 *   leaked code — the old URL stops resolving immediately.
 * - Apparatus shift check-in codes (when the Scheduling module is on and
 *   the viewer can see apparatus). Each QR encodes the permanent URL
 *   `/scheduling/checkin?apparatus={id}`, which resolves the apparatus's
 *   active shift at scan time — one printed card works for every shift.
 *
 * Print-friendly in two layouts: a compact cut-out card grid, or one
 * full-page sign per code for posting on doors and dashboards. Cards can
 * also be downloaded individually as PNGs for signage documents.
 *
 * URL: /locations/qr-codes
 */

import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Building2,
  Copy,
  Check,
  DoorOpen,
  Download,
  LayoutGrid,
  Loader2,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  StickyNote,
  Truck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { locationsService } from '../services/api';
import type { Location } from '../services/api';
import { apparatusService } from '../modules/apparatus/services/api';
import type { ApparatusListItem } from '../modules/apparatus/types';
import { groupByStation } from '../utils/locationGrouping';
import { copyToClipboard } from '../utils/clipboard';
import { useAuthStore } from '../stores/authStore';
import { useConfirm } from '../contexts/ConfirmContext';
import { useEnabledModules } from '../hooks/useEnabledModules';

/** Rasterize an inline QR SVG to a PNG download (white background for print/signage use). */
function downloadSvgAsPng(svg: SVGSVGElement, filename: string): void {
  const xml = new XMLSerializer().serializeToString(svg);
  const svgUrl = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(svgUrl);
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      toast.error('Failed to generate image');
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const anchor = document.createElement('a');
    anchor.download = filename;
    anchor.href = canvas.toDataURL('image/png');
    anchor.click();
  };
  img.onerror = () => {
    URL.revokeObjectURL(svgUrl);
    toast.error('Failed to generate image');
  };
  img.src = svgUrl;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'qr-code'
  );
}

/**
 * 'card' — compact cut-out for the grid sheet.
 * 'sign' — full-page poster (one per printed page) for posting on a door/dashboard.
 */
type QRCardVariant = 'card' | 'sign';
type QRCardIcon = 'station' | 'room' | 'apparatus';

const CARD_ICONS: Record<QRCardIcon, typeof DoorOpen> = {
  station: Building2,
  room: DoorOpen,
  apparatus: Truck,
};

function QRCard({
  title,
  subtitle,
  url,
  icon,
  variant = 'card',
  onRegenerate,
}: {
  title: string;
  /** Sign-variant context line, e.g. "Station 1 — Scan to check in" */
  subtitle?: string | undefined;
  url: string;
  icon: QRCardIcon;
  variant?: QRCardVariant;
  onRegenerate?: (() => Promise<void>) | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const isSign = variant === 'sign';
  const Icon = CARD_ICONS[icon];

  const handleCopy = async () => {
    try {
      await copyToClipboard(url);
      setCopied(true);
      toast.success('URL copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy URL');
    }
  };

  const handleDownload = () => {
    const svg = qrContainerRef.current?.querySelector('svg');
    if (!svg) return;
    downloadSvgAsPng(svg, `qr-${slugify(title)}.png`);
  };

  const handleRegenerate = async () => {
    if (!onRegenerate) return;
    setIsRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div
      className={`bg-theme-surface border-theme-surface-border flex flex-col items-center rounded-xl border text-center print:border-gray-300 ${
        isSign ? 'qr-sign p-8' : 'qr-card p-4'
      }`}
    >
      <div className={`flex items-center gap-1.5 ${isSign ? 'mb-1' : 'mb-2'}`}>
        <Icon className="text-theme-text-muted h-4 w-4 shrink-0 print:hidden" aria-hidden="true" />
        <h3
          className={`text-theme-text-primary font-semibold print:text-black ${isSign ? 'text-3xl font-bold' : 'text-sm'}`}
        >
          {title}
        </h3>
      </div>
      {isSign && subtitle && <p className="text-theme-text-secondary mb-4 text-lg print:text-black">{subtitle}</p>}
      {/* bg-white intentional for QR code readability in dark mode */}
      <div ref={qrContainerRef} className="rounded-lg bg-white p-2">
        <QRCodeSVG value={url} size={isSign ? 320 : 160} level="H" includeMargin />
      </div>
      <p
        className={`text-theme-text-muted mt-2 font-mono break-all print:text-black ${isSign ? 'text-xs' : 'text-[10px]'}`}
      >
        {url}
      </p>
      <div className="no-print mt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => {
            void handleCopy();
          }}
          className="text-theme-text-muted flex items-center gap-1.5 text-xs transition-colors hover:text-blue-500"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" aria-hidden="true" />
          ) : (
            <Copy className="h-3 w-3" aria-hidden="true" />
          )}
          Copy URL
        </button>
        <button
          onClick={handleDownload}
          className="text-theme-text-muted flex items-center gap-1.5 text-xs transition-colors hover:text-blue-500"
        >
          <Download className="h-3 w-3" aria-hidden="true" />
          Download PNG
        </button>
        {onRegenerate && (
          <button
            onClick={() => {
              void handleRegenerate();
            }}
            disabled={isRegenerating}
            title="Generate a new code — the current QR code stops working"
            className="text-theme-text-muted flex items-center gap-1.5 text-xs transition-colors hover:text-red-500 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isRegenerating ? 'animate-spin' : ''}`} aria-hidden="true" />
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
}

function locationCardProps(location: Location): { title: string; subtitle: string; url: string; icon: QRCardIcon } {
  const isStation = Boolean(location.address && !location.building && !location.room_number);
  return {
    title: `${location.name}${location.room_number ? ` #${location.room_number}` : ''}`,
    subtitle: `${location.building ? `${location.building} — ` : ''}Scan to check in`,
    url: `${window.location.origin}/display/${location.display_code}`,
    icon: isStation ? 'station' : 'room',
  };
}

function apparatusCardProps(apparatus: ApparatusListItem): {
  title: string;
  subtitle: string;
  url: string;
  icon: QRCardIcon;
} {
  return {
    title: `${apparatus.unitNumber}${apparatus.name ? ` — ${apparatus.name}` : ''}`,
    subtitle: 'Scan to check in or out of your shift',
    url: `${window.location.origin}/scheduling/checkin?apparatus=${apparatus.id}`,
    icon: 'apparatus',
  };
}

export default function RoomQRCodesPage() {
  const { confirm } = useConfirm();
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const { isModuleOn } = useEnabledModules();
  const [locations, setLocations] = useState<Location[]>([]);
  const [apparatus, setApparatus] = useState<ApparatusListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [layout, setLayout] = useState<'grid' | 'signs'>('grid');

  const canManage = checkPermission('locations.edit') || checkPermission('locations.manage');
  const schedulingOn = isModuleOn('scheduling');

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

  useEffect(() => {
    if (!schedulingOn) {
      setApparatus([]);
      return;
    }
    const load = async () => {
      try {
        const items: ApparatusListItem[] = [];
        let page = 1;
        let totalPages = 1;
        do {
          const result = await apparatusService.getApparatusList({ page, pageSize: 100 });
          items.push(...result.items);
          totalPages = result.totalPages;
          page += 1;
        } while (page <= totalPages);
        setApparatus(items);
      } catch {
        // No apparatus.view permission (or module data unavailable) — hide the section
        setApparatus([]);
      }
    };
    void load();
  }, [schedulingOn]);

  const handleRegenerate = async (location: Location) => {
    if (
      !(await confirm({
        title: 'Regenerate QR code',
        message: `Generate a new code for "${location.name}"? The current QR code and kiosk URL stop working immediately — reprint the posted code and update any kiosk tablets.`,
        confirmLabel: 'Regenerate',
        cancelLabel: 'Keep current code',
      }))
    )
      return;
    try {
      const updated = await locationsService.regenerateDisplayCode(location.id);
      setLocations((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      toast.success('New QR code generated');
    } catch {
      toast.error('Failed to regenerate code');
    }
  };

  const hasAnyCodes = locations.some((l) => l.display_code) || apparatus.length > 0;
  const query = searchQuery.trim().toLowerCase();
  const groups = groupByStation(
    query
      ? locations.filter(
          (l) =>
            l.name.toLowerCase().includes(query) ||
            l.building?.toLowerCase().includes(query) ||
            l.room_number?.toLowerCase().includes(query)
        )
      : locations
  );
  const filteredApparatus = query
    ? apparatus.filter((a) => a.unitNumber.toLowerCase().includes(query) || a.name?.toLowerCase().includes(query))
    : apparatus;
  const nothingMatches = groups.length === 0 && filteredApparatus.length === 0;

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
            <h1 className="text-theme-text-primary text-2xl font-bold sm:text-3xl">Check-In QR Codes</h1>
            <p className="text-theme-text-secondary mt-1">
              {layout === 'grid'
                ? 'Every check-in QR code in one place — room kiosk codes and apparatus shift check-in. Print this page, cut out the cards, and post each code where it belongs.'
                : 'Full-page signs, one code per printed page — post them on doors and dashboards.'}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="btn-primary flex shrink-0 items-center gap-2 self-start py-2.5 sm:self-auto"
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> Print All
          </button>
        </div>

        {/* Search + layout toggle */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative max-w-xs flex-1">
            <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search rooms or apparatus..."
              placeholder="Search rooms or apparatus..."
              className="form-input placeholder-theme-text-muted py-2 pr-4 pl-10"
            />
          </div>
          <div
            className="border-theme-surface-border flex items-center overflow-hidden rounded-lg border text-sm"
            role="group"
            aria-label="Print layout"
          >
            <button
              onClick={() => setLayout('grid')}
              aria-pressed={layout === 'grid'}
              className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${
                layout === 'grid'
                  ? 'bg-theme-surface-hover text-theme-text-primary font-medium'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" /> Cut-out cards
            </button>
            <button
              onClick={() => setLayout('signs')}
              aria-pressed={layout === 'signs'}
              className={`border-theme-surface-border flex items-center gap-1.5 border-l px-3 py-2 transition-colors ${
                layout === 'signs'
                  ? 'bg-theme-surface-hover text-theme-text-primary font-medium'
                  : 'text-theme-text-muted hover:text-theme-text-primary'
              }`}
            >
              <StickyNote className="h-3.5 w-3.5" aria-hidden="true" /> Room signs
            </button>
          </div>
        </div>
      </div>

      {/* Print-only title so the cut-out sheet is self-explanatory; signs carry their own name */}
      {layout === 'grid' && <h1 className="hidden text-xl font-bold text-black print:block">Check-In QR Codes</h1>}

      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : nothingMatches ? (
        <div className="py-20 text-center">
          <QrCode className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          {hasAnyCodes ? (
            <>
              <h3 className="text-theme-text-primary mb-1 text-lg font-medium">Nothing matches your search</h3>
              <p className="text-theme-text-muted mb-4">Try a different room, station, or apparatus name.</p>
            </>
          ) : (
            <>
              <h3 className="text-theme-text-primary mb-1 text-lg font-medium">No QR codes yet</h3>
              <p className="text-theme-text-muted mb-4">
                QR codes are generated automatically when you add stations and rooms.
              </p>
              <Link to="/locations" className="btn-primary inline-flex items-center gap-2 py-2.5">
                Set Up Locations
              </Link>
            </>
          )}
        </div>
      ) : layout === 'signs' ? (
        <div className="mx-auto max-w-lg space-y-6 print:max-w-none">
          {groups
            .flatMap((group) => group.locations)
            .map((location) => (
              <QRCard
                key={location.id}
                {...locationCardProps(location)}
                variant="sign"
                onRegenerate={canManage ? () => handleRegenerate(location) : undefined}
              />
            ))}
          {filteredApparatus.map((a) => (
            <QRCard key={a.id} {...apparatusCardProps(a)} variant="sign" />
          ))}
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
                  <QRCard
                    key={location.id}
                    {...locationCardProps(location)}
                    onRegenerate={canManage ? () => handleRegenerate(location) : undefined}
                  />
                ))}
              </div>
            </section>
          ))}
          {filteredApparatus.length > 0 && (
            <section>
              <h2 className="text-theme-text-primary mb-1 flex items-center gap-2 text-lg font-semibold print:text-black">
                <Truck className="h-5 w-5 text-red-500 print:hidden" aria-hidden="true" />
                Apparatus Shift Check-In
              </h2>
              <p className="text-theme-text-muted no-print mb-3 text-sm">
                Permanent codes — scanning resolves the apparatus's active shift, so one printed card covers every
                shift.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2">
                {filteredApparatus.map((a) => (
                  <QRCard key={a.id} {...apparatusCardProps(a)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <style>{`
        @media print {
          .qr-card { break-inside: avoid; }
          .qr-sign { break-after: page; break-inside: avoid; border: none; }
        }
      `}</style>
    </div>
  );
}
