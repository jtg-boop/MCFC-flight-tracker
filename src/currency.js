import { config } from './config.js';

const TTL_MS = 12 * 60 * 60 * 1000;
let cache = null; // { fetchedAt, usdPer: { GBP: 1.27, ... } }

async function fetchRates() {
  // Frankfurter publishes European Central Bank reference rates; no key needed.
  const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD');
  if (!res.ok) throw new Error(`Exchange rate lookup failed: HTTP ${res.status}`);
  const body = await res.json();
  const usdPer = {};
  for (const [code, perUsd] of Object.entries(body.rates || {})) usdPer[code] = 1 / perUsd;
  return usdPer;
}

export async function getRates() {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.usdPer;
  try {
    cache = { fetchedAt: Date.now(), usdPer: await fetchRates() };
  } catch (err) {
    console.warn(`[currency] ${err.message}; using fallback rates`);
    cache = { fetchedAt: Date.now(), usdPer: { ...config.fallbackRates } };
  }
  return cache.usdPer;
}

export function convertToUsd(amount, currency, usdPer) {
  if (currency === 'USD') return amount;
  const rate = usdPer[currency];
  if (!rate) throw new Error(`No exchange rate for ${currency}`);
  return amount * rate;
}
