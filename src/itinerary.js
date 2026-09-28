// Turns raw flight + train search results into comparable door-to-door
// options: "United to Heathrow + train to Manchester" vs "fly into Manchester".

import { addDays, addMinutes } from './dates.js';
import { convertToUsd } from './currency.js';
import { airlineName } from './links.js';

export const ROUTES = {
  LHR_RAIL: 'LHR_RAIL',
  MAN: 'MAN',
};

const CANDIDATES_PER_GROUP = 3;
const ASSUMED_RETURN_DEPARTURE = '11:00';

function offerCarriers(offer) {
  const segments = [...offer.outbound.segments, ...(offer.inbound?.segments || [])];
  return [...new Set(segments.map((s) => s.carrier))];
}

export function isPreferredOffer(offer, preferredAirline) {
  if (!preferredAirline) return true;
  return offerCarriers(offer).every((c) => c === preferredAirline);
}

export function carrierLabel(offer) {
  return offerCarriers(offer).map(airlineName).join(' + ');
}

// Cheapest train you can make, but only among trains close to the first one
// you could catch (or the last one that still works on the way home): a
// cheaper fare isn't worth half a day sitting at Euston.
export function pickTrain(trains, { earliestDepart, latestArrive, preferLate = false, windowMinutes = 180 }) {
  let valid = trains.filter(
    (t) => (!earliestDepart || t.departAt >= earliestDepart) && (!latestArrive || t.arriveAt <= latestArrive),
  );
  if (!valid.length) return null;
  if (windowMinutes != null) {
    if (preferLate) {
      const cutoff = addMinutes(valid.reduce((m, t) => (t.arriveAt > m ? t.arriveAt : m), valid[0].arriveAt), -windowMinutes);
      valid = valid.filter((t) => t.arriveAt >= cutoff);
    } else {
      const cutoff = addMinutes(valid.reduce((m, t) => (t.departAt < m ? t.departAt : m), valid[0].departAt), windowMinutes);
      valid = valid.filter((t) => t.departAt <= cutoff);
    }
  }
  valid.sort((a, b) => a.price - b.price || (preferLate ? b.departAt.localeCompare(a.departAt) : a.departAt.localeCompare(b.departAt)));
  return valid[0];
}

async function outboundTrain(offer, { getTrains, settings }) {
  const earliestDepart = addMinutes(offer.outbound.arriveAt, settings.lhrToEustonMinutes);
  const arrivalDate = earliestDepart.slice(0, 10);
  let train = pickTrain(await getTrains('EUS', 'MAN', arrivalDate), { earliestDepart, windowMinutes: settings.trainWindowMinutes });
  if (train) return { train, note: null };
  train = pickTrain(await getTrains('EUS', 'MAN', addDays(arrivalDate, 1)), { windowMinutes: settings.trainWindowMinutes });
  return train ? { train, note: 'Lands too late for a train north the same day. Budget a night in London.' } : { train: null };
}

async function returnTrain(offer, { returnDate, getTrains, settings }) {
  let note = null;
  let flightDepart = offer.inbound?.departAt;
  if (!flightDepart) {
    flightDepart = `${returnDate}T${ASSUMED_RETURN_DEPARTURE}`;
    note = `Return flight time not provided by this price source; assumed ${ASSUMED_RETURN_DEPARTURE} from Heathrow.`;
  }
  const latestArrive = addMinutes(flightDepart, -settings.eustonToLhrMinutes);
  const flightDate = flightDepart.slice(0, 10);
  let train = pickTrain(await getTrains('MAN', 'EUS', flightDate), { latestArrive, preferLate: true, windowMinutes: settings.trainWindowMinutes });
  if (train) return { train, note };
  train = pickTrain(await getTrains('MAN', 'EUS', addDays(flightDate, -1)), { preferLate: true, windowMinutes: settings.trainWindowMinutes });
  const overnight = 'Flight leaves too early to get there by train that morning. Train down the day before.';
  return train ? { train, note: note ? `${note} ${overnight}` : overnight } : { train: null };
}

async function priceOffer(offer, route, ctx) {
  const { usdPer, settings, adults, returnDate } = ctx;
  const flightUsd = convertToUsd(offer.price, offer.currency, usdPer);
  const notes = [];
  let railUsd = 0;
  let transferUsd;
  let trainOut = null;
  let trainBack = null;

  if (route === ROUTES.LHR_RAIL) {
    const out = await outboundTrain(offer, ctx);
    const back = await returnTrain(offer, { ...ctx, returnDate });
    if (!out.train || !back.train) return null;
    trainOut = out.train;
    trainBack = back.train;
    for (const n of [out.note, back.note]) if (n) notes.push(n);
    railUsd = convertToUsd(trainOut.price, trainOut.currency, usdPer) + convertToUsd(trainBack.price, trainBack.currency, usdPer);
    transferUsd = convertToUsd(2 * settings.heathrowTransferGbp * adults, 'GBP', usdPer);
    if (trainOut.isEstimate) notes.push('Train fares are estimates; tap a train to check the live price.');
  } else {
    transferUsd = convertToUsd(2 * settings.manchesterAirportTransferGbp * adults, 'GBP', usdPer);
  }

  return {
    route,
    isPreferred: isPreferredOffer(offer, ctx.preferredAirline),
    carrier: carrierLabel(offer),
    flightUsd: Math.round(flightUsd),
    railUsd: Math.round(railUsd),
    transferUsd: Math.round(transferUsd),
    totalUsd: Math.round(flightUsd + railUsd + transferUsd),
    details: { flight: offer, trainOut, trainBack, notes },
  };
}

// For one date pair and one route, return the best preferred-airline option
// and the best option on any airline (if it differs).
export async function bestOptionsForRoute(offers, route, ctx) {
  const eligible = offers.filter((o) => o.outbound?.arriveAt && o.outbound.stops <= ctx.maxStops);
  const byPrice = (a, b) => a.price - b.price;
  const preferred = eligible.filter((o) => isPreferredOffer(o, ctx.preferredAirline)).sort(byPrice);
  const others = eligible.filter((o) => !isPreferredOffer(o, ctx.preferredAirline)).sort(byPrice);

  const best = async (list) => {
    let winner = null;
    for (const offer of list.slice(0, CANDIDATES_PER_GROUP)) {
      const option = await priceOffer(offer, route, ctx);
      if (option && (!winner || option.totalUsd < winner.totalUsd)) winner = option;
    }
    return winner;
  };

  const bestPreferred = await best(preferred);
  const bestOther = await best(others);
  return [bestPreferred, bestOther].filter(Boolean);
}
