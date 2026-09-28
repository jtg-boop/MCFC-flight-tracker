import express from 'express';
import { fileURLToPath } from 'node:url';
import { isIsoDate } from './dates.js';
import { upcomingFixtures } from './fixtures.js';
import { checkTrip, tripCombos } from './tracker.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const CHART_JS_DIR = fileURLToPath(new URL('../node_modules/chart.js/dist', import.meta.url));
const CABINS = ['economy', 'premium_economy', 'business', 'first'];

export function validateTrip(body, { maxDateCombos }) {
  const errors = [];
  const trip = {
    name: String(body.name || '').trim(),
    origin: String(body.origin || 'DEN').trim().toUpperCase(),
    depart_from: body.depart_from,
    depart_to: body.depart_to || body.depart_from,
    return_from: body.return_from,
    return_to: body.return_to || body.return_from,
    adults: Number(body.adults ?? 1),
    cabin: body.cabin || 'economy',
    preferred_airline: String(body.preferred_airline ?? 'UA').trim().toUpperCase(),
    max_stops: Number(body.max_stops ?? 1),
    include_lhr_rail: body.include_lhr_rail === false ? 0 : 1,
    include_man: body.include_man === false ? 0 : 1,
    target_price_usd: body.target_price_usd ? Number(body.target_price_usd) : null,
    match_date: isIsoDate(body.match_date) ? body.match_date : null,
    match_label: body.match_label ? String(body.match_label).slice(0, 200) : null,
  };

  if (!trip.name) errors.push('Give the trip a name');
  if (!/^[A-Z]{3}$/.test(trip.origin)) errors.push('Home airport must be a 3-letter code');
  for (const f of ['depart_from', 'depart_to', 'return_from', 'return_to']) {
    if (!isIsoDate(trip[f])) errors.push(`${f} must be a date (YYYY-MM-DD)`);
  }
  if (!errors.length) {
    if (trip.depart_to < trip.depart_from) errors.push('Outbound date range ends before it starts');
    if (trip.return_to < trip.return_from) errors.push('Return date range ends before it starts');
    const combos = tripCombos(trip).length;
    if (combos === 0) errors.push('Return dates must be after outbound dates');
    if (combos > maxDateCombos) {
      errors.push(`That's ${combos} date combinations; narrow it to ${maxDateCombos} or fewer (each one is a separate search)`);
    }
  }
  if (!Number.isInteger(trip.adults) || trip.adults < 1 || trip.adults > 9) errors.push('Travellers must be 1 to 9');
  if (!CABINS.includes(trip.cabin)) errors.push('Unknown cabin');
  if (!Number.isInteger(trip.max_stops) || trip.max_stops < 0 || trip.max_stops > 2) errors.push('Max stops must be 0 to 2');
  if (trip.preferred_airline && !/^[A-Z0-9]{2}$/.test(trip.preferred_airline)) errors.push('Preferred airline must be a 2-character code like UA');
  if (!trip.include_lhr_rail && !trip.include_man) errors.push('Pick at least one route');
  if (trip.target_price_usd !== null && !(trip.target_price_usd > 0)) errors.push('Target price must be a positive number');

  return { trip, errors };
}

export function createApp(deps) {
  const { repo, config, flights, trains } = deps;
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));
  app.use('/vendor', express.static(CHART_JS_DIR));

  const findTrip = (req, res) => {
    const trip = repo.getTrip(Number(req.params.id));
    if (!trip) res.status(404).json({ error: 'Trip not found' });
    return trip;
  };

  app.get('/api/config', (_req, res) => {
    res.json({
      flightProvider: flights.name,
      trainProvider: trains.name,
      fixturesEnabled: !!config.footballDataKey,
      alertsEnabled: !!config.ntfyTopic,
      checkIntervalHours: config.checkIntervalHours,
      maxDateCombos: config.maxDateCombos,
    });
  });

  app.get('/api/fixtures', async (_req, res) => {
    try {
      res.json(await upcomingFixtures(config));
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message });
    }
  });

  app.get('/api/trips', (_req, res) => res.json(repo.listTrips()));

  app.post('/api/trips', async (req, res) => {
    const { trip, errors } = validateTrip(req.body || {}, config);
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    const created = repo.createTrip(trip);
    // Kick off the first price check in the background
    checkTrip(created, deps).catch((err) => console.error(`[tracker] initial check failed: ${err.message}`));
    res.status(201).json(created);
  });

  app.get('/api/trips/:id', (req, res) => {
    const trip = findTrip(req, res);
    if (!trip) return;
    res.json({ trip, latestRun: repo.latestRun(trip.id), history: repo.history(trip.id) });
  });

  app.patch('/api/trips/:id', (req, res) => {
    const trip = findTrip(req, res);
    if (!trip) return;
    const changes = {};
    if (typeof req.body?.active === 'boolean') changes.active = req.body.active ? 1 : 0;
    if (req.body?.target_price_usd !== undefined) {
      const target = req.body.target_price_usd === null || req.body.target_price_usd === '' ? null : Number(req.body.target_price_usd);
      if (target !== null && !(target > 0)) return res.status(400).json({ error: 'Target price must be a positive number' });
      changes.target_price_usd = target;
      changes.last_alert_usd = null;
    }
    res.json(repo.updateTrip(trip.id, changes));
  });

  app.delete('/api/trips/:id', (req, res) => {
    if (!repo.deleteTrip(Number(req.params.id))) return res.status(404).json({ error: 'Trip not found' });
    res.status(204).end();
  });

  app.post('/api/trips/:id/check', async (req, res) => {
    const trip = findTrip(req, res);
    if (!trip) return;
    try {
      res.json(await checkTrip(trip, deps));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return app;
}
