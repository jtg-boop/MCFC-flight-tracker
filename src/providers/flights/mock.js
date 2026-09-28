// Demo flight data so the app is usable before you sign up for an API key.
// Prices are made up but plausible, and drift a little day to day so the
// price-history chart has something to show.

import { addDays, todayIso } from '../../dates.js';
import { googleFlightsUrl } from '../../links.js';

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

// [carrier, hub(s), outbound depart, outbound arrive (+1 day), return depart, return arrive, base USD]
const ROUTES = {
  LHR: [
    ['UA', [], '16:30', '08:25', '12:20', '15:30', 1150],
    ['UA', ['ORD'], '07:05', '07:10', '09:40', '15:05', 980],
    ['UA', ['EWR'], '06:15', '07:30', '10:05', '16:40', 1010],
    ['BA', [], '19:15', '11:05', '13:45', '16:55', 1090],
    ['VS', ['ATL'], '08:10', '07:05', '11:30', '18:45', 890],
  ],
  MAN: [
    ['UA', ['EWR'], '06:15', '08:20', '10:30', '17:15', 1240],
    ['UA', ['ORD'], '09:30', '10:05', '11:00', '17:50', 1290],
    ['EI', ['DUB'], '13:20', '09:45', '09:10', '15:20', 1020],
    ['AA', ['PHL'], '08:05', '08:35', '11:35', '18:10', 1080],
  ],
};

function flightNumber(carrier, seed) {
  return `${carrier} ${100 + Math.floor(seed * 900)}`;
}

function buildSlice({ carrier, from, to, hubs, date, departTime, arriveTime, arrivesNextDay, seed }) {
  const stops = [from, ...hubs, to];
  const departAt = `${date}T${departTime}`;
  const arriveAt = `${arrivesNextDay ? addDays(date, 1) : date}T${arriveTime}`;
  const segments = [];
  for (let i = 0; i < stops.length - 1; i++) {
    segments.push({
      from: stops[i],
      to: stops[i + 1],
      carrier,
      flightNumber: flightNumber(carrier, hash(`${seed}${i}`)),
      departAt: i === 0 ? departAt : null,
      arriveAt: i === stops.length - 2 ? arriveAt : null,
    });
  }
  return { departAt, arriveAt, stops: hubs.length, segments };
}

export async function searchRoundTrip({ origin, destination, departDate, returnDate, adults = 1 }) {
  const routes = ROUTES[destination];
  if (!routes) return [];
  const leadDays = Math.max(1, (Date.parse(departDate) - Date.parse(todayIso())) / 86_400_000);
  // Fares climb as departure approaches and on weekends
  const leadFactor = leadDays < 14 ? 1.45 : leadDays < 45 ? 1.15 : leadDays < 120 ? 1 : 0.95;
  const weekend = [5, 6].includes(new Date(`${departDate}T00:00:00Z`).getUTCDay()) ? 1.08 : 1;

  return routes.map(([carrier, hubs, outDep, outArr, retDep, retArr, base], idx) => {
    const seed = `${destination}${departDate}${returnDate}${idx}`;
    const drift = 0.9 + hash(seed + todayIso()) * 0.2;
    const perPerson = base * leadFactor * weekend * (0.85 + hash(seed) * 0.3) * drift;
    return {
      provider: 'mock',
      price: Math.round(perPerson * adults),
      currency: 'USD',
      carriers: [carrier],
      outbound: buildSlice({ carrier, from: origin, to: destination, hubs, date: departDate, departTime: outDep, arriveTime: outArr, arrivesNextDay: true, seed: `${seed}o` }),
      inbound: buildSlice({ carrier, from: destination, to: origin, hubs: [...hubs].reverse(), date: returnDate, departTime: retDep, arriveTime: retArr, arrivesNextDay: false, seed: `${seed}i` }),
      bookingUrl: googleFlightsUrl({ origin, destination, departDate, returnDate, airline: carrier }),
    };
  });
}
