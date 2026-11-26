/**
 * Where the department's CRR work happened: a circle at each ZIP code's centre,
 * sized by the number of activities, over OpenStreetMap's street map.
 *
 * Loaded only when someone asks for it (owner decision, 2026-11-23): the tiles
 * come from tile.openstreetmap.org, so opening the map tells OpenStreetMap
 * which area is being looked at, and the CSP allows that one host (img-src in
 * the nginx configs). The markers are drawn here from the report's own data;
 * no activity, count or ZIP code is sent anywhere. The list beside the map
 * carries the same figures for anyone who cannot use it.
 */

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { CrrImpactZip } from '../../services/communicationsServices';
import { markerRadius, placedZips } from './crrImpact';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// OpenStreetMap's tile usage policy requires this credit on the map itself.
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

interface CrrZipMapProps {
  zips: CrrImpactZip[];
}

const CrrZipMap: React.FC<CrrZipMapProps> = ({ zips }) => {
  const container = useRef<HTMLDivElement | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    const element = container.current;
    const placed = placedZips(zips);
    if (!element || placed.length === 0) return undefined;

    // A page scroll must not turn into a zoom on the way past the map.
    const map = L.map(element, { scrollWheelZoom: false });
    const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION });
    // An air-gapped install, or a network that blocks the tile host, gets a
    // blank map; say why rather than leave an empty grey box.
    tiles.on('tileerror', () => setTilesFailed(true));
    // A passing blip should not leave the notice up once every visible tile
    // has loaded, and a new period's map starts with a clean slate.
    tiles.on('load', () => setTilesFailed(false));
    tiles.addTo(map);

    const most = Math.max(...placed.map((z) => z.activities));
    for (const z of placed) {
      const place = [z.city, z.state].filter(Boolean).join(', ');
      const label = `${z.zip_code}${place ? ` ${place}` : ''}: ${z.activities} ${z.activities === 1 ? 'activity' : 'activities'}`;
      L.circleMarker([z.latitude, z.longitude], {
        radius: markerRadius(z.activities, most),
        color: '#991b1b',
        weight: 2,
        fillColor: '#991b1b',
        fillOpacity: 0.35,
      })
        .bindTooltip(label)
        .addTo(map);
    }

    const first = placed[0];
    if (placed.length === 1 && first) {
      map.setView([first.latitude, first.longitude], 12);
    } else {
      map.fitBounds(L.latLngBounds(placed.map((z) => [z.latitude, z.longitude])), { padding: [24, 24] });
    }
    return () => {
      map.remove();
    };
  }, [zips]);

  if (placedZips(zips).length === 0) {
    return <p className="text-theme-text-muted text-sm">None of these ZIP codes has a known location to map.</p>;
  }

  return (
    <div>
      <div
        ref={container}
        className="border-theme-surface-border h-80 w-full overflow-hidden rounded-md border"
        role="region"
        aria-label="Map of CRR activities by ZIP code"
      />
      {tilesFailed && (
        <p className="text-theme-text-secondary mt-2 text-xs" role="status">
          The street map could not load from OpenStreetMap; the circles still show where the work was.
        </p>
      )}
    </div>
  );
};

export default CrrZipMap;
