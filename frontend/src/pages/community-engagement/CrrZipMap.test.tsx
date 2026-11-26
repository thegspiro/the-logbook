import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { CrrImpactZip } from '../../services/communicationsServices';

// jsdom cannot lay out a map, so Leaflet is replaced by a recorder: what the
// component asks of it is the behaviour under test.
const leaflet = vi.hoisted(() => {
  const handlers: Record<string, () => void> = {};
  const map = { fitBounds: vi.fn(), setView: vi.fn(), remove: vi.fn() };
  const tiles = {
    on: vi.fn((event: string, handler: () => void) => {
      handlers[event] = handler;
      return tiles;
    }),
    addTo: vi.fn(() => tiles),
  };
  const marker = { bindTooltip: vi.fn(() => marker), addTo: vi.fn(() => marker) };
  return {
    handlers,
    map,
    tiles,
    marker,
    api: {
      map: vi.fn(() => map),
      tileLayer: vi.fn(() => tiles),
      circleMarker: vi.fn(() => marker),
      latLngBounds: vi.fn((points: unknown) => ({ points })),
    },
  };
});
vi.mock('leaflet', () => ({ default: leaflet.api }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

import CrrZipMap from './CrrZipMap';

const zip = (overrides: Partial<CrrImpactZip>): CrrImpactZip => ({
  zip_code: '22046',
  city: 'Falls Church',
  state: 'VA',
  latitude: 38.8856,
  longitude: -77.1802,
  activities: 4,
  counts: [],
  ...overrides,
});

describe('CrrZipMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(leaflet.handlers)) delete leaflet.handlers[key];
  });

  it('draws OpenStreetMap tiles with their credit, and will not zoom on a page scroll', () => {
    render(<CrrZipMap zips={[zip({}), zip({ zip_code: '22044', latitude: 38.86, longitude: -77.15 })]} />);

    expect(leaflet.api.map).toHaveBeenCalledWith(expect.any(HTMLElement), { scrollWheelZoom: false });
    const [url, options] = leaflet.api.tileLayer.mock.calls[0] as unknown as [string, { attribution: string }];
    expect(url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(options.attribution).toContain('OpenStreetMap</a> contributors');
  });

  it('puts a circle at each placed ZIP, sized by its activities, and fits them all', () => {
    render(
      <CrrZipMap
        zips={[
          zip({}),
          zip({ zip_code: '22044', latitude: 38.86, longitude: -77.15, activities: 1 }),
          zip({ zip_code: '00000', latitude: null, longitude: null }),
        ]}
      />
    );

    expect(leaflet.api.circleMarker).toHaveBeenCalledTimes(2);
    const [[firstAt, first], [, second]] = leaflet.api.circleMarker.mock.calls as unknown as [
      [number[], { radius: number }],
      [number[], { radius: number }],
    ];
    expect(firstAt).toEqual([38.8856, -77.1802]);
    expect(first.radius).toBe(20);
    expect(second.radius).toBe(13);
    expect(leaflet.marker.bindTooltip).toHaveBeenCalledWith('22046 Falls Church, VA: 4 activities');
    expect(leaflet.map.fitBounds).toHaveBeenCalled();
  });

  it('centres on a lone ZIP rather than fitting a single point', () => {
    render(<CrrZipMap zips={[zip({})]} />);

    expect(leaflet.map.setView).toHaveBeenCalledWith([38.8856, -77.1802], 12);
    expect(leaflet.map.fitBounds).not.toHaveBeenCalled();
  });

  it('says why when the tiles cannot load', () => {
    render(<CrrZipMap zips={[zip({})]} />);

    act(() => leaflet.handlers.tileerror?.());

    expect(screen.getByRole('status')).toHaveTextContent('could not load from OpenStreetMap');
  });

  it('drops the notice once the tiles load after all', () => {
    render(<CrrZipMap zips={[zip({})]} />);

    act(() => leaflet.handlers.tileerror?.());
    act(() => leaflet.handlers.load?.());

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('removes the map when it closes', () => {
    const { unmount } = render(<CrrZipMap zips={[zip({})]} />);
    unmount();

    expect(leaflet.map.remove).toHaveBeenCalled();
  });

  it('draws no map when no ZIP has a known centre', () => {
    render(<CrrZipMap zips={[zip({ latitude: null, longitude: null })]} />);

    expect(leaflet.api.map).not.toHaveBeenCalled();
    expect(screen.getByText('None of these ZIP codes has a known location to map.')).toBeInTheDocument();
  });
});
