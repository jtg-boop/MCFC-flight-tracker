// Dates are handled as plain "YYYY-MM-DD" strings (no time zone) and local
// times as "YYYY-MM-DDTHH:MM" strings in the airport/station's own time zone.

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function dateRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function dateCombos({ departFrom, departTo, returnFrom, returnTo }) {
  const combos = [];
  for (const depart of dateRange(departFrom, departTo)) {
    for (const ret of dateRange(returnFrom, returnTo)) {
      if (ret > depart) combos.push({ departDate: depart, returnDate: ret });
    }
  }
  return combos;
}

export function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

// "2026-10-01 13:05", "2026-10-01T13:05:00" -> "2026-10-01T13:05"
export function normalizeLocalTime(value) {
  if (!value) return null;
  return String(value).replace(' ', 'T').slice(0, 16);
}

export function minutesBetween(fromLocal, toLocal) {
  return Math.round((Date.parse(`${toLocal}:00Z`) - Date.parse(`${fromLocal}:00Z`)) / 60_000);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function addMinutes(local, minutes) {
  return new Date(Date.parse(`${local}:00Z`) + minutes * 60_000).toISOString().slice(0, 16);
}
