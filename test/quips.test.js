import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressFor, quipSequence } from '../headline-extension/lib/quips.js';

// Deterministic "random" for repeatable shuffles.
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

test('always starts with the Stanley cups, then a shuffled mix with no repeats', () => {
  const lines = quipSequence({ random: seeded() });
  assert.equal(lines[0], 'Preparing Stanley cups…');
  assert.equal(new Set(lines).size, lines.length);
  assert.ok(lines.some((l) => l.includes('Lisa from BLACKPINK')));
  assert.ok(lines.some((l) => l.includes('Lara from KATSEYE is checking the API calls')));
  assert.ok(lines.length >= 25);
});

test('day and night get their own lines', () => {
  const day = quipSequence({ theme: 'day', random: seeded() });
  const night = quipSequence({ theme: 'night', random: seeded() });
  assert.ok(day.includes('Tying the pink bow…') && !day.includes('Alfred is brewing a very strong coffee…'));
  assert.ok(night.includes('Alfred is brewing a very strong coffee…') && !night.includes('Tying the pink bow…'));
});

test('articles with tables mix in data lines', () => {
  const plain = quipSequence({ random: seeded() });
  const data = quipSequence({ hasTables: true, random: seeded() });
  assert.ok(!plain.some((l) => l.includes('Shapiro')));
  assert.ok(data.some((l) => l.includes('Shapiro')));
  assert.ok(data.slice(0, 5).some((l) => /Shapiro|CAGR|outliers|correlation|averages|Kendall/.test(l)), 'a data line appears early');
});

test('progress eases towards 95% and never claims to be done', () => {
  assert.equal(progressFor(0), 0);
  assert.ok(progressFor(15000) > 0.65 && progressFor(15000) < 0.75);
  assert.equal(progressFor(10 * 60 * 1000), 0.95);
});
