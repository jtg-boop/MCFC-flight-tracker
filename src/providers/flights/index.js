import * as mock from './mock.js';
import { createDuffelProvider } from './duffel.js';
import { createSerpApiProvider } from './serpapi.js';

export function createFlightProvider(config) {
  switch (config.flightProvider) {
    case 'duffel':
      return { name: 'duffel', ...createDuffelProvider({ token: config.duffelToken }) };
    case 'serpapi':
      return { name: 'serpapi', ...createSerpApiProvider({ apiKey: config.serpApiKey }) };
    case 'mock':
      return { name: 'mock', searchRoundTrip: mock.searchRoundTrip };
    default:
      throw new Error(`Unknown FLIGHT_PROVIDER "${config.flightProvider}" (use mock, duffel or serpapi)`);
  }
}
