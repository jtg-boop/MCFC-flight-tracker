// Google Flights prices via SerpApi (https://serpapi.com, free tier: 100
// searches/month). Set SERPAPI_KEY. Round-trip results include the full
// price but only the outbound flight details; the return flight's times are
// not known, so rail connections home are timed with an assumption.

import { normalizeLocalTime } from '../../dates.js';
import { googleFlightsUrl } from '../../links.js';

const TRAVEL_CLASS = { economy: 1, premium_economy: 2, business: 3, first: 4 };

function toSlice(result) {
  const segments = result.flights.map((f) => ({
    from: f.departure_airport.id,
    to: f.arrival_airport.id,
    carrier: String(f.flight_number || '').split(' ')[0] || f.airline,
    flightNumber: f.flight_number,
    departAt: normalizeLocalTime(f.departure_airport.time),
    arriveAt: normalizeLocalTime(f.arrival_airport.time),
  }));
  return {
    departAt: segments[0].departAt,
    arriveAt: segments.at(-1).arriveAt,
    stops: segments.length - 1,
    segments,
  };
}

export function createSerpApiProvider({ apiKey }) {
  if (!apiKey) throw new Error('FLIGHT_PROVIDER=serpapi needs SERPAPI_KEY');

  return {
    async searchRoundTrip({ origin, destination, departDate, returnDate, adults = 1, cabin = 'economy', maxStops = 1, includeAirlines }) {
      const params = new URLSearchParams({
        engine: 'google_flights',
        api_key: apiKey,
        type: '1',
        departure_id: origin,
        arrival_id: destination,
        outbound_date: departDate,
        return_date: returnDate,
        currency: 'USD',
        hl: 'en',
        adults: String(adults),
        travel_class: String(TRAVEL_CLASS[cabin] || 1),
        // SerpApi stops: 0 any, 1 nonstop, 2 up to 1 stop, 3 up to 2 stops
        stops: String(Math.min(3, maxStops + 1)),
      });
      if (includeAirlines?.length) params.set('include_airlines', includeAirlines.join(','));
      const res = await fetch(`https://serpapi.com/search.json?${params}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) {
        throw new Error(`SerpApi search failed (HTTP ${res.status}): ${body.error || 'unknown error'}`);
      }
      const results = [...(body.best_flights || []), ...(body.other_flights || [])];
      return results
        .filter((r) => typeof r.price === 'number' && r.flights?.length)
        .map((r) => {
          const outbound = toSlice(r);
          const carriers = [...new Set(outbound.segments.map((s) => s.carrier))];
          return {
            provider: 'serpapi',
            price: r.price,
            currency: 'USD',
            carriers,
            outbound,
            inbound: null,
            bookingUrl: googleFlightsUrl({ origin, destination, departDate, returnDate, airline: carriers.length === 1 ? carriers[0] : undefined }),
          };
        });
    },
  };
}
