// Duffel (https://duffel.com) - real airline offers, including United.
// Sign up, create an access token (test tokens return sandbox data), and set
// DUFFEL_ACCESS_TOKEN.

import { normalizeLocalTime } from '../../dates.js';
import { googleFlightsUrl } from '../../links.js';

const CABINS = { economy: 'economy', premium_economy: 'premium_economy', business: 'business', first: 'first' };

function toSlice(slice) {
  const segments = slice.segments.map((s) => ({
    from: s.origin.iata_code,
    to: s.destination.iata_code,
    carrier: s.marketing_carrier?.iata_code,
    flightNumber: `${s.marketing_carrier?.iata_code} ${s.marketing_carrier_flight_number}`,
    departAt: normalizeLocalTime(s.departing_at),
    arriveAt: normalizeLocalTime(s.arriving_at),
  }));
  return {
    departAt: segments[0].departAt,
    arriveAt: segments.at(-1).arriveAt,
    stops: segments.length - 1,
    segments,
  };
}

export function createDuffelProvider({ token }) {
  if (!token) throw new Error('FLIGHT_PROVIDER=duffel needs DUFFEL_ACCESS_TOKEN');

  return {
    async searchRoundTrip({ origin, destination, departDate, returnDate, adults = 1, cabin = 'economy', maxStops = 1 }) {
      const res = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=20000', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Duffel-Version': 'v2',
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          data: {
            slices: [
              { origin, destination, departure_date: departDate },
              { origin: destination, destination: origin, departure_date: returnDate },
            ],
            passengers: Array.from({ length: adults }, () => ({ type: 'adult' })),
            cabin_class: CABINS[cabin] || 'economy',
            max_connections: maxStops,
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Duffel search failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
      }
      const { data } = await res.json();
      return (data.offers || []).map((offer) => {
        const [outbound, inbound] = offer.slices.map(toSlice);
        const carriers = [...new Set([...outbound.segments, ...inbound.segments].map((s) => s.carrier))];
        return {
          provider: 'duffel',
          price: Number(offer.total_amount),
          currency: offer.total_currency,
          carriers,
          outbound,
          inbound,
          bookingUrl: googleFlightsUrl({ origin, destination, departDate, returnDate, airline: carriers.length === 1 ? carriers[0] : undefined }),
        };
      });
    },
  };
}
