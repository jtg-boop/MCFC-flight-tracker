import * as estimate from './estimate.js';

// Only an estimator ships today; a real fares source (e.g. a licensed
// National Rail / Rail Data Marketplace feed) can be added here with the same
// searchSingle({ from, to, date, adults }) shape.
export function createTrainProvider(config) {
  switch (config.trainProvider) {
    case 'estimate':
      return { name: 'estimate', searchSingle: estimate.searchSingle };
    default:
      throw new Error(`Unknown TRAIN_PROVIDER "${config.trainProvider}" (use estimate)`);
  }
}
