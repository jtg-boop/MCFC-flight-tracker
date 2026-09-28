import { dateCombos } from './dates.js';
import { getRates } from './currency.js';
import { bestOptionsForRoute, ROUTES } from './itinerary.js';
import { sendAlert } from './notify.js';

const ROUTE_LABEL = {
  [ROUTES.LHR_RAIL]: 'via Heathrow + train',
  [ROUTES.MAN]: 'into Manchester',
};

export function describeOption(o) {
  return `${o.carrier} ${ROUTE_LABEL[o.route]}, ${o.departDate} to ${o.returnDate}: $${o.totalUsd.toLocaleString('en-US')}`;
}

export function tripCombos(trip) {
  return dateCombos({
    departFrom: trip.depart_from,
    departTo: trip.depart_to,
    returnFrom: trip.return_from,
    returnTo: trip.return_to,
  });
}

function dedupeOffers(offers) {
  const seen = new Set();
  return offers.filter((o) => {
    const key = [o.price, ...[o.outbound, o.inbound].filter(Boolean).flatMap((sl) => sl.segments.map((x) => `${x.flightNumber}@${x.departAt}`))].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Search every date pair for a trip, store the results, and alert if the
// best preferred-airline price hits the target.
export async function checkTrip(trip, { repo, flights, trains, config }) {
  const usdPer = await getRates();
  const trainCache = new Map();
  const getTrains = (from, to, date) => {
    const key = `${from}-${to}-${date}`;
    if (!trainCache.has(key)) trainCache.set(key, trains.searchSingle({ from, to, date, adults: trip.adults }));
    return trainCache.get(key);
  };

  const partnerAirlines = config.partnerAirlines || [];
  const routes = [];
  if (trip.include_lhr_rail) routes.push({ route: ROUTES.LHR_RAIL, destination: 'LHR', maxStops: trip.max_stops });
  if (trip.include_man) {
    routes.push({
      route: ROUTES.MAN,
      destination: 'MAN',
      maxStops: Math.max(trip.max_stops, config.manMaxStops ?? trip.max_stops),
      // An open search rarely surfaces United + partner connections, so ask for them too
      partnerSearch: Boolean(trip.preferred_airline && partnerAirlines.length),
    });
  }

  const options = [];
  const errors = [];
  for (const { departDate, returnDate } of tripCombos(trip)) {
    for (const { route, destination, maxStops, partnerSearch } of routes) {
      try {
        const search = (extra = {}) => flights.searchRoundTrip({
          origin: trip.origin,
          destination,
          departDate,
          returnDate,
          adults: trip.adults,
          cabin: trip.cabin,
          maxStops,
          ...extra,
        });
        let offers = await search();
        if (partnerSearch) {
          try {
            offers = dedupeOffers([...offers, ...await search({ includeAirlines: [trip.preferred_airline, ...partnerAirlines] })]);
          } catch (err) {
            errors.push(`${destination} partners ${departDate}/${returnDate}: ${err.message}`);
          }
        }
        const best = await bestOptionsForRoute(offers, route, {
          usdPer,
          settings: config,
          adults: trip.adults,
          returnDate,
          preferredAirline: trip.preferred_airline,
          partnerAirlines,
          partnerHubs: config.partnerHubs || [],
          maxStops,
          getTrains,
        });
        for (const o of best) options.push({ ...o, departDate, returnDate });
      } catch (err) {
        errors.push(`${destination} ${departDate}/${returnDate}: ${err.message}`);
      }
    }
  }

  const status = options.length ? 'ok' : 'error';
  const error = errors.length ? errors.slice(0, 5).join('\n') : options.length ? null : 'No matching flights found';
  const runId = repo.saveRun({ tripId: trip.id, status, error, flightProvider: flights.name, options });
  if (errors.length) console.warn(`[tracker] trip ${trip.id}: ${errors.length} search(es) failed\n${error}`);

  await maybeAlert(trip, options, { repo, config });
  return { runId, status, error, optionCount: options.length };
}

async function maybeAlert(trip, options, { repo, config }) {
  const best = options.filter((o) => o.isPreferred).sort((a, b) => a.totalUsd - b.totalUsd)[0];
  if (!best || !trip.target_price_usd || best.totalUsd > trip.target_price_usd) return;
  // Only re-alert when the price drops further than the last alert
  if (trip.last_alert_usd && best.totalUsd >= trip.last_alert_usd) return;

  const sent = await sendAlert(config, {
    title: `${trip.name}: $${best.totalUsd.toLocaleString('en-US')} (target $${trip.target_price_usd})`,
    message: describeOption(best),
    url: best.details?.flight?.bookingUrl,
  });
  if (sent) repo.updateTrip(trip.id, { last_alert_usd: best.totalUsd });
}

export async function checkAllActive(deps) {
  for (const trip of deps.repo.listTrips().filter((t) => t.active)) {
    try {
      const result = await checkTrip(trip, deps);
      console.log(`[tracker] checked "${trip.name}": ${result.status}, ${result.optionCount} options`);
    } catch (err) {
      console.error(`[tracker] check failed for "${trip.name}": ${err.message}`);
    }
  }
}
