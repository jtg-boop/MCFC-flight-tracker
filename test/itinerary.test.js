import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestOptionsForRoute, isPreferredOffer, pickTrain, ROUTES } from '../src/itinerary.js';

const settings = { lhrToEustonMinutes: 150, eustonToLhrMinutes: 240, heathrowTransferGbp: 16, manchesterAirportTransferGbp: 5 };
const usdPer = { GBP: 1.25 };

function slice(carrier, from, to, departAt, arriveAt) {
  return { departAt, arriveAt, stops: 0, segments: [{ from, to, carrier, flightNumber: `${carrier} 1`, departAt, arriveAt }] };
}

function offer(carrier, price, { outArrive = '2026-10-02T08:30', backDepart = '2026-10-06T12:00', inbound = true } = {}) {
  return {
    price, currency: 'USD', carriers: [carrier],
    outbound: slice(carrier, 'DEN', 'LHR', '2026-10-01T16:30', outArrive),
    inbound: inbound ? slice(carrier, 'LHR', 'DEN', backDepart, '2026-10-06T15:00') : null,
    bookingUrl: 'https://example.test',
  };
}

function train(from, date, time, price) {
  const [h, m] = time.split(':').map(Number);
  const arr = h * 60 + m + 130;
  const arrive = `${String(Math.floor(arr / 60)).padStart(2, '0')}:${String(arr % 60).padStart(2, '0')}`;
  return { from, departAt: `${date}T${time}`, arriveAt: `${date}T${arrive}`, price, currency: 'GBP', operator: 'Avanti West Coast', isEstimate: true };
}

const timetable = {
  'EUS-MAN-2026-10-02': [train('EUS', '2026-10-02', '09:00', 20), train('EUS', '2026-10-02', '11:00', 40), train('EUS', '2026-10-02', '13:00', 30)],
  'MAN-EUS-2026-10-06': [train('MAN', '2026-10-06', '05:00', 90), train('MAN', '2026-10-06', '06:00', 50)],
  'MAN-EUS-2026-10-05': [train('MAN', '2026-10-05', '18:00', 25)],
};
const getTrains = async (from, to, date) => timetable[`${from}-${to}-${date}`] || [];
const ctx = { usdPer, settings, adults: 1, returnDate: '2026-10-06', preferredAirline: 'UA', maxStops: 1, getTrains };

test('isPreferredOffer requires every segment on the preferred airline', () => {
  assert.equal(isPreferredOffer(offer('UA', 1000), 'UA'), true);
  const mixed = offer('UA', 1000);
  mixed.inbound.segments[0].carrier = 'LH';
  assert.equal(isPreferredOffer(mixed, 'UA'), false);
});

test('pickTrain respects the connection window and picks the cheapest', () => {
  const trains = timetable['EUS-MAN-2026-10-02'];
  // Landing 08:30 + 150 min => first possible train 11:00; 13:00 is cheaper
  assert.equal(pickTrain(trains, { earliestDepart: '2026-10-02T11:00' }).departAt, '2026-10-02T13:00');
  assert.equal(pickTrain(trains, { earliestDepart: '2026-10-02T14:00' }), null);
});

test('pickTrain ignores a cheap train hours after the first one you could catch', () => {
  const trains = [train('EUS', '2026-10-02', '10:00', 60), train('EUS', '2026-10-02', '12:00', 55), train('EUS', '2026-10-02', '20:00', 20)];
  assert.equal(pickTrain(trains, { earliestDepart: '2026-10-02T10:00', windowMinutes: 180 }).departAt, '2026-10-02T12:00');
  const home = [train('MAN', '2026-10-06', '06:00', 20), train('MAN', '2026-10-06', '10:00', 50), train('MAN', '2026-10-06', '11:00', 70)];
  assert.equal(pickTrain(home, { latestArrive: '2026-10-06T13:30', preferLate: true, windowMinutes: 180 }).departAt, '2026-10-06T10:00');
});

test('LHR + rail option adds trains and Heathrow transfers', async () => {
  const [best] = await bestOptionsForRoute([offer('UA', 1000)], ROUTES.LHR_RAIL, ctx);
  // Out: 13:00 £30. Back: flight 12:00 - 240 min => must arrive Euston by 08:00, only 05:00 (£90) fits.
  assert.equal(best.details.trainOut.departAt, '2026-10-02T13:00');
  assert.equal(best.details.trainBack.departAt, '2026-10-06T05:00');
  assert.equal(best.railUsd, Math.round((30 + 90) * 1.25));
  assert.equal(best.transferUsd, Math.round(32 * 1.25));
  assert.equal(best.totalUsd, 1000 + 150 + 40);
  assert.equal(best.isPreferred, true);
});

test('early return flight falls back to the day-before train with a note', async () => {
  const [best] = await bestOptionsForRoute([offer('UA', 1000, { backDepart: '2026-10-06T09:00' })], ROUTES.LHR_RAIL, ctx);
  assert.equal(best.details.trainBack.departAt, '2026-10-05T18:00');
  assert.match(best.details.notes.join(' '), /day before/);
});

test('missing return flight times assume a late-morning departure', async () => {
  const [best] = await bestOptionsForRoute([offer('UA', 1000, { inbound: false })], ROUTES.LHR_RAIL, ctx);
  assert.ok(best.details.trainBack);
  assert.match(best.details.notes.join(' '), /assumed/);
});

test('returns best preferred and best other-airline option separately', async () => {
  const offers = [offer('UA', 1200), offer('UA', 1100), offer('BA', 900)];
  const results = await bestOptionsForRoute(offers, ROUTES.MAN, ctx);
  assert.equal(results.length, 2);
  assert.equal(results[0].isPreferred, true);
  assert.equal(results[0].flightUsd, 1100);
  assert.equal(results[1].isPreferred, false);
  assert.equal(results[1].flightUsd, 900);
  assert.equal(results[0].railUsd, 0);
});
