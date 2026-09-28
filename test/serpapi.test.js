import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSerpApiProvider } from '../src/providers/flights/serpapi.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Trimmed example of SerpApi's Google Flights response format
const sample = {
  best_flights: [{
    flights: [{
      departure_airport: { name: 'Denver International Airport', id: 'DEN', time: '2027-01-25 16:30' },
      arrival_airport: { name: 'Heathrow Airport', id: 'LHR', time: '2027-01-26 08:25' },
      airline: 'United', flight_number: 'UA 16',
    }],
    total_duration: 595, price: 1043, type: 'Round trip', departure_token: 'abc',
  }],
  other_flights: [
    {
      flights: [
        { departure_airport: { id: 'DEN', time: '2027-01-25 07:00' }, arrival_airport: { id: 'ATL', time: '2027-01-25 11:55' }, airline: 'Delta', flight_number: 'DL 1234' },
        { departure_airport: { id: 'ATL', time: '2027-01-25 18:30' }, arrival_airport: { id: 'LHR', time: '2027-01-26 07:40' }, airline: 'Virgin Atlantic', flight_number: 'VS 104' },
      ],
      price: 912, type: 'Round trip',
    },
    { flights: [], price: 500 },
  ],
};

test('serpapi provider sends the right query and parses offers', async () => {
  let requested;
  globalThis.fetch = async (url) => {
    requested = new URL(url);
    return new Response(JSON.stringify(sample), { status: 200 });
  };
  const provider = createSerpApiProvider({ apiKey: 'k' });
  const offers = await provider.searchRoundTrip({ origin: 'DEN', destination: 'LHR', departDate: '2027-01-25', returnDate: '2027-02-04', maxStops: 1 });

  assert.equal(requested.searchParams.get('engine'), 'google_flights');
  assert.equal(requested.searchParams.get('outbound_date'), '2027-01-25');
  assert.equal(requested.searchParams.get('return_date'), '2027-02-04');
  assert.equal(requested.searchParams.get('stops'), '2'); // 1 stop or fewer
  assert.equal(requested.searchParams.has('include_airlines'), false);

  assert.equal(offers.length, 2);
  const [united, other] = offers;
  assert.deepEqual(united.carriers, ['UA']);
  assert.equal(united.price, 1043);
  assert.equal(united.outbound.arriveAt, '2027-01-26T08:25');
  assert.equal(united.outbound.stops, 0);
  assert.equal(united.inbound, null);
  assert.deepEqual(other.carriers, ['DL', 'VS']);
  assert.equal(other.outbound.stops, 1);
});

test('serpapi errors are reported clearly', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Invalid API key.' }), { status: 401 });
  const provider = createSerpApiProvider({ apiKey: 'bad' });
  await assert.rejects(
    provider.searchRoundTrip({ origin: 'DEN', destination: 'LHR', departDate: '2027-01-25', returnDate: '2027-02-04' }),
    /Invalid API key/,
  );
});

test('serpapi provider can restrict results to given airlines', async () => {
  let requested;
  globalThis.fetch = async (url) => {
    requested = new URL(url);
    return new Response(JSON.stringify(sample), { status: 200 });
  };
  const provider = createSerpApiProvider({ apiKey: 'k' });
  await provider.searchRoundTrip({ origin: 'DEN', destination: 'MAN', departDate: '2027-01-25', returnDate: '2027-02-04', maxStops: 2, includeAirlines: ['UA', 'LH', 'SN'] });
  assert.equal(requested.searchParams.get('include_airlines'), 'UA,LH,SN');
  assert.equal(requested.searchParams.get('stops'), '3'); // 2 stops or fewer
});
