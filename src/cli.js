// One-shot check of every active trip, for running from cron instead of
// leaving the server up:  npm run check
import { config } from './config.js';
import { openDb } from './db.js';
import { createFlightProvider } from './providers/flights/index.js';
import { createTrainProvider } from './providers/trains/index.js';
import { checkAllActive } from './tracker.js';

await checkAllActive({
  config,
  repo: openDb(config.dbPath),
  flights: createFlightProvider(config),
  trains: createTrainProvider(config),
});
