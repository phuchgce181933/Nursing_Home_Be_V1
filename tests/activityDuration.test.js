const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateDurationMinutes, formatDurationLabel } = require('../utils/activityDuration');

test('calculateDurationMinutes derives the exact minute span between start and end', () => {
  assert.equal(calculateDurationMinutes('2026-07-07T09:00:00.000Z', '2026-07-07T10:30:00.000Z'), 90);
  assert.equal(calculateDurationMinutes('2026-07-07T09:00:00.000Z', '2026-07-08T09:00:00.000Z'), 1440);
});

test('formatDurationLabel uses hours and days for longer durations', () => {
  assert.equal(formatDurationLabel(90), '1h30p');
  assert.equal(formatDurationLabel(1500), '1 ngày 1h');
  assert.equal(formatDurationLabel(2880), '2 ngày');
});
