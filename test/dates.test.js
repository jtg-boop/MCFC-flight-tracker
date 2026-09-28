import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMinutes, dateCombos, normalizeLocalTime } from '../src/dates.js';

test('addDays crosses month boundaries', () => {
  assert.equal(addDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('addMinutes rolls over midnight', () => {
  assert.equal(addMinutes('2026-10-01T22:30', 150), '2026-10-02T01:00');
  assert.equal(addMinutes('2026-10-01T02:00', -240), '2026-09-30T22:00');
});

test('dateCombos pairs every outbound with every later return', () => {
  const combos = dateCombos({ departFrom: '2026-10-01', departTo: '2026-10-02', returnFrom: '2026-10-02', returnTo: '2026-10-03' });
  assert.deepEqual(combos, [
    { departDate: '2026-10-01', returnDate: '2026-10-02' },
    { departDate: '2026-10-01', returnDate: '2026-10-03' },
    { departDate: '2026-10-02', returnDate: '2026-10-03' },
  ]);
});

test('normalizeLocalTime handles provider formats', () => {
  assert.equal(normalizeLocalTime('2026-10-01 13:05'), '2026-10-01T13:05');
  assert.equal(normalizeLocalTime('2026-10-01T13:05:00'), '2026-10-01T13:05');
});
