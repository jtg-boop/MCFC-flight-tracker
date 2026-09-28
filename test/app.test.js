import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTrip } from '../src/app.js';
import { openDb } from '../src/db.js';
import { checkTrip } from '../src/tracker.js';
import * as mockFlights from '../src/providers/flights/mock.js';
import * as estimateTrains from '../src/providers/trains/estimate.js';
import { addDays, todayIso } from '../src/dates.js';

const config = {
  maxDateCombos: 12, heathrowTransferGbp: 16, manchesterAirportTransferGbp: 5,
  lhrToEustonMinutes: 150, eustonToLhrMinutes: 240, fallbackRates: { GBP: 1.3 },
};
const base = addDays(todayIso(), 60);
const input = {
  name: 'City vs Arsenal', depart_from: base, depart_to: addDays(base, 1),
  return_from: addDays(base, 4), return_to: addDays(base, 5), target_price_usd: 100000,
};

test('validateTrip rejects bad input and too many combos', () => {
  assert.match(validateTrip({}, config).errors.join(), /name/);
  const wide = { ...input, depart_to: addDays(base, 5), return_to: addDays(base, 10) };
  assert.match(validateTrip(wide, config).errors.join(), /date combinations/);
  assert.deepEqual(validateTrip(input, config).errors, []);
});

test('checkTrip stores options for both routes using demo providers', async () => {
  const repo = openDb(':memory:');
  const { trip } = validateTrip(input, config);
  const saved = repo.createTrip(trip);
  const deps = {
    repo, config: { ...config, ntfyTopic: '' },
    flights: { name: 'mock', searchRoundTrip: mockFlights.searchRoundTrip },
    trains: { name: 'estimate', searchSingle: estimateTrains.searchSingle },
  };
  const result = await checkTrip(saved, deps);
  assert.equal(result.status, 'ok');

  const run = repo.latestRun(saved.id);
  const routes = new Set(run.options.map((o) => o.route));
  assert.deepEqual([...routes].sort(), ['LHR_RAIL', 'MAN']);
  assert.ok(run.options.some((o) => o.is_preferred && o.carrier === 'United'));
  const rail = run.options.find((o) => o.route === 'LHR_RAIL');
  assert.ok(rail.rail_usd > 0 && rail.details.trainOut && rail.details.trainBack);
  assert.equal(repo.history(saved.id).length > 0, true);
  assert.ok(repo.listTrips()[0].latest_preferred_usd > 0);
});
