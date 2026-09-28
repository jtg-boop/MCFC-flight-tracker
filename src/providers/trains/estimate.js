// Estimated Avanti West Coast fares between London Euston and Manchester
// Piccadilly. UK rail has no free public fares API, so this models the
// typical Advance single pricing (cheap when booked early, expensive close
// in) on a realistic timetable. Every fare is flagged as an estimate and
// links to National Rail so you can check the real price.

import { addDays, daysBetween, todayIso } from '../../dates.js';
import { nationalRailUrl } from '../../links.js';

const JOURNEY_MINUTES = 130; // ~2h10m non-stop-ish Pendolino

function seeded(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

function timetable(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const [first, last] = day === 0 ? [8 * 60 + 30, 21 * 60] : day === 6 ? [7 * 60, 21 * 60] : [6 * 60 + 20, 21 * 60 + 40];
  const departures = [];
  for (let m = first; m <= last; m += 20) departures.push(m);
  return departures;
}

function advanceFare(daysAhead) {
  if (daysAhead >= 84) return 28;
  if (daysAhead >= 56) return 34;
  if (daysAhead >= 28) return 45;
  if (daysAhead >= 14) return 62;
  if (daysAhead >= 7) return 85;
  return 120;
}

function isPeak(date, minutes, from) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return false;
  // Morning peak out of either city, evening peak out of London
  return minutes < 9 * 60 + 30 || (from === 'EUS' && minutes >= 16 * 60 && minutes < 19 * 60);
}

const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function localTime(date, minutes) {
  return `${addDays(date, Math.floor(minutes / 1440))}T${hhmm(minutes % 1440)}`;
}

export async function searchSingle({ from, to, date, adults = 1 }) {
  const daysAhead = Math.max(0, daysBetween(todayIso(), date));
  const base = advanceFare(daysAhead);
  return timetable(date).map((dep) => {
    const peak = isPeak(date, dep, from);
    const jitter = 0.85 + seeded(`${from}${to}${date}${dep}`) * 0.4;
    const perPerson = Math.round(base * jitter * (peak ? 1.6 : 1));
    return {
      provider: 'estimate',
      isEstimate: true,
      operator: 'Avanti West Coast',
      from,
      to,
      departAt: localTime(date, dep),
      arriveAt: localTime(date, dep + JOURNEY_MINUTES),
      fareType: 'Advance Single (est.)',
      price: perPerson * adults,
      currency: 'GBP',
      bookingUrl: nationalRailUrl({ from, to, date, time: hhmm(dep), adults }),
    };
  });
}
