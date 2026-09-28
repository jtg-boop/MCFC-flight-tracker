// Deep links so you can jump straight to booking a price you like.

const AIRLINE_NAMES = {
  UA: 'United',
  AC: 'Air Canada',
  LH: 'Lufthansa',
  LX: 'Swiss',
  OS: 'Austrian',
  SN: 'Brussels Airlines',
  TP: 'TAP Air Portugal',
  EI: 'Aer Lingus',
  BA: 'British Airways',
  AA: 'American',
  DL: 'Delta',
  VS: 'Virgin Atlantic',
  IB: 'Iberia',
  AF: 'Air France',
  KL: 'KLM',
  IS: 'Icelandair',
  FI: 'Icelandair',
  LS: 'Jet2',
};

export function airlineName(code) {
  return AIRLINE_NAMES[code] || code;
}

export function googleFlightsUrl({ origin, destination, departDate, returnDate, airline }) {
  const q = `Flights from ${origin} to ${destination} on ${departDate} through ${returnDate}${airline ? ` on ${airlineName(airline)}` : ''}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

export function unitedUrl({ origin, destination, departDate, returnDate, adults = 1 }) {
  const p = new URLSearchParams({ f: origin, t: destination, d: departDate, r: returnDate, px: String(adults), taxng: '1', tqp: 'R' });
  return `https://www.united.com/en/us/fsr/choose-flights?${p}`;
}

export function nationalRailUrl({ from, to, date, time = '09:00', adults = 1 }) {
  const [y, m, d] = date.split('-');
  const [hh, mm] = time.split(':');
  const p = new URLSearchParams({
    type: 'single',
    origin: from,
    destination: to,
    leavingType: 'departing',
    leavingDate: `${d}${m}${y.slice(2)}`,
    leavingHour: hh,
    leavingMin: mm,
    adults: String(adults),
    extraTime: '0',
  });
  return `https://www.nationalrail.co.uk/journey-planner/?${p}#O`;
}

export const STATIONS = {
  EUS: 'London Euston',
  MAN: 'Manchester Piccadilly',
};
