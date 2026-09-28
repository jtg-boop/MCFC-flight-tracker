import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const num = (value, fallback) => {
  const n = Number(value);
  return value === undefined || value === '' || Number.isNaN(n) ? fallback : n;
};

export const config = {
  port: num(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH || resolve(process.cwd(), 'data', 'tracker.db'),

  // Which price sources to use. With no keys it falls back to "mock" demo data;
  // with a SerpApi or Duffel key it uses that automatically.
  flightProvider: (
    process.env.FLIGHT_PROVIDER
    || (process.env.SERPAPI_KEY ? 'serpapi' : process.env.DUFFEL_ACCESS_TOKEN ? 'duffel' : 'mock')
  ).toLowerCase(),
  trainProvider: (process.env.TRAIN_PROVIDER || 'estimate').toLowerCase(),
  duffelToken: process.env.DUFFEL_ACCESS_TOKEN || '',
  serpApiKey: process.env.SERPAPI_KEY || '',

  // Man City fixtures (https://www.football-data.org, free tier)
  footballDataKey: process.env.FOOTBALL_DATA_API_KEY || '',

  // Push alerts to your phone via https://ntfy.sh (free app, no account needed)
  ntfyTopic: process.env.NTFY_TOPIC || '',
  ntfyServer: process.env.NTFY_SERVER || 'https://ntfy.sh',

  // How often every active trip is re-checked. 0 disables the scheduler.
  // SerpApi's free plan is 100 searches/month, so check less often by default.
  checkIntervalHours: num(process.env.CHECK_INTERVAL_HOURS, process.env.SERPAPI_KEY ? 24 : 12),
  // Each (outbound date x return date) pair costs one flight search per route.
  maxDateCombos: num(process.env.MAX_DATE_COMBOS, 12),

  // Ground legs (one-way, per person, GBP)
  heathrowTransferGbp: num(process.env.HEATHROW_TRANSFER_GBP, 16),
  manchesterAirportTransferGbp: num(process.env.MANCHESTER_AIRPORT_TRANSFER_GBP, 5),
  // Minutes from landing at LHR until you can board a train at Euston
  lhrToEustonMinutes: num(process.env.LHR_TO_EUSTON_MINUTES, 150),
  // Minutes you need between a train arriving at Euston and your flight leaving LHR
  eustonToLhrMinutes: num(process.env.EUSTON_TO_LHR_MINUTES, 240),
  // Only consider trains within this many minutes of the first one you could
  // catch (or the last one that works going home)
  trainWindowMinutes: num(process.env.TRAIN_WINDOW_MINUTES, 180),

  fallbackRates: {
    GBP: num(process.env.GBP_USD_RATE, 1.33),
    EUR: num(process.env.EUR_USD_RATE, 1.15),
  },
};
