import { describe, it, expect } from 'vitest';
import { emptyTrip, priceTrips, totalMiles, toTripPayload, tripLogError, type TripEntry } from './mileage';

const trip = (overrides: Partial<TripEntry> = {}): TripEntry => ({
  tripDate: '2026-10-01',
  fromLocation: 'Station 1',
  toLocation: 'Supply house',
  purpose: 'Collect couplings',
  miles: '12.5',
  ...overrides,
});

describe('the trip log preview', () => {
  it('prices miles at the rate to the cent, half up, as the server does', () => {
    // 42.7 x 0.700 = 29.89; 11.0 x 0.655 = 7.205 -> 7.21
    expect(priceTrips([trip(), trip({ miles: '30.2' })], '0.700')).toBe('29.89');
    expect(priceTrips([trip({ miles: '10.5' }), trip({ miles: '0.5' })], '0.655')).toBe('7.21');
  });

  it('has nothing to show without a rate', () => {
    expect(priceTrips([trip()], null)).toBeNull();
    expect(priceTrips([trip()], '')).toBeNull();
  });

  it('totals the miles to a tenth and ignores a trip still being typed', () => {
    expect(totalMiles([trip(), trip({ miles: '30.2' }), trip({ miles: '' })])).toBe('42.7');
  });

  it('names the first problem with an unfinished trip', () => {
    expect(tripLogError([trip()])).toBeNull();
    expect(tripLogError([trip({ tripDate: '' })])).toBe('Each trip needs a date');
    expect(tripLogError([trip({ purpose: '  ' })])).toBe('Each trip needs its purpose');
    expect(tripLogError([trip({ miles: '12.55' })])).toBe('Miles are entered to a tenth of a mile, e.g. 12.5');
    expect(tripLogError([trip({ miles: '0' })])).toBe('Miles must be more than zero');
    expect(tripLogError([trip({ miles: '1000.1' })])).toBe('A trip is at most 1000 miles');
    expect(tripLogError([emptyTrip()])).toBe('Each trip needs a date');
  });

  it('sends the trips trimmed', () => {
    expect(toTripPayload([trip({ fromLocation: '  Station 1 ', miles: ' 12.5 ' })])).toEqual([
      {
        tripDate: '2026-10-01',
        fromLocation: 'Station 1',
        toLocation: 'Supply house',
        purpose: 'Collect couplings',
        miles: '12.5',
      },
    ]);
  });
});
