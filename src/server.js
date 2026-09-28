import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createFlightProvider } from './providers/flights/index.js';
import { createTrainProvider } from './providers/trains/index.js';
import { checkAllActive } from './tracker.js';

const deps = {
  config,
  repo: openDb(config.dbPath),
  flights: createFlightProvider(config),
  trains: createTrainProvider(config),
};

createApp(deps).listen(config.port, () => {
  console.log(`MCFC travel tracker running at http://localhost:${config.port}`);
  console.log(`Flight prices: ${deps.flights.name}${deps.flights.name === 'mock' ? ' (demo data - see README to use real prices)' : ''}`);
  console.log(`Train prices:  ${deps.trains.name}`);
});

if (config.checkIntervalHours > 0) {
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await checkAllActive(deps);
    } finally {
      running = false;
    }
  }, config.checkIntervalHours * 60 * 60 * 1000);
  console.log(`Re-checking active trips every ${config.checkIntervalHours}h`);
}
