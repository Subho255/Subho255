import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, distribution, histogram, kurtosis, mode, modality, normalInv, outliers, percentile, shapiroWilk, skewness, unusualYears, variance } from '../headline-extension/lib/distribution.js';
import { analyseTables } from '../headline-extension/lib/stats.js';

// Reference values from SciPy 1.18 / NumPy (skew and kurtosis with bias=False,
// stats.shapiro, np.percentile, np.var with ddof=1).
const SETS = {
  lit: { x: [96.2, 86.6, 82.9, 84.8, 82.4, 69.7, 73.0, 70.9], skew: 0.278443, kurt: -0.538022, w: 0.926249, p: 0.482581, q: [70.54, 72.475, 82.65, 85.25, 89.48], v: 82.26125 },
  skewed: { x: [10, 12, 11, 9, 95, 13, 10, 14, 12, 11, 15, 10], skew: 3.430664, kurt: 11.831358, w: 0.393838, p: 0.000003, q: [10, 10, 11.5, 13.25, 14.9], v: 583.545455 },
  bimodal: { x: [12, 14, 13, 15, 11, 14, 48, 50, 47, 52, 49, 51], skew: 0.00567, kurt: -2.399163, w: 0.724781, p: 0.001476, q: [12.1, 13.75, 31, 49.25, 50.9], v: 362.606061 },
  n20: { x: [3.1, 4.5, 2.2, 5.9, 4.4, 3.8, 6.1, 2.9, 4.0, 5.2, 3.3, 4.8, 5.5, 3.9, 4.1, 4.6, 2.7, 5.0, 3.6, 4.3], skew: 0.008272, kurt: -0.494924, w: 0.988729, p: 0.996127, q: [2.88, 3.525, 4.2, 4.85, 5.54], v: 1.111026 },
};
const close = (a, b, eps = 1e-5) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

for (const [name, ref] of Object.entries(SETS)) {
  test(`matches SciPy: ${name} (skewness, kurtosis, Shapiro-Wilk, percentiles, variance)`, () => {
    close(skewness(ref.x), ref.skew);
    close(kurtosis(ref.x), ref.kurt);
    const sw = shapiroWilk(ref.x);
    close(sw.w, ref.w);
    close(sw.p, ref.p);
    [10, 25, 50, 75, 90].forEach((p, i) => close(percentile(ref.x, p), ref.q[i]));
    close(variance(ref.x), ref.v);
  });
}

test('inverse normal CDF', () => {
  close(normalInv(0.975), 1.959964, 1e-6);
  close(normalInv(0.5), 0, 1e-9);
  close(normalInv(0.001), -3.090232, 1e-6);
});

test('mode only when a value repeats', () => {
  assert.deepEqual(mode([1, 2, 2, 3, 3]), { values: [2, 3], count: 2 });
  assert.equal(mode([1, 2, 3]), null);
  assert.equal(describe([1, 2, 3]).mode, 'none (no value repeats)');
});

test('describe: range, quartiles and IQR from 5 values, percentiles from 10', () => {
  const d = describe([1, 2, 3, 4, 5]);
  assert.equal(d.range, 4);
  assert.deepEqual(d.quartiles, { q1: 2, q2_median: 3, q3: 4 });
  assert.equal(d.iqr, 2);
  assert.equal(d.percentiles, undefined);
  assert.deepEqual(describe(Array.from({ length: 10 }, (_, i) => i + 1)).percentiles, { p10: 1.9, p90: 9.1 });
});

test('frequency distribution: nice bins that cover every value', () => {
  const bins = histogram(SETS.n20.x);
  assert.equal(bins.reduce((a, b) => a + b.count, 0), 20);
  assert.deepEqual(bins.map((b) => b.from), [2, 3, 4, 5, 6]);
});

test('bimodality needs both the histogram and the coefficient, and 10+ values', () => {
  const labels = SETS.bimodal.x.map((_, i) => `S${i}`);
  const m = modality(SETS.bimodal.x, labels);
  assert.equal(m.verdict, 'bimodal');
  assert.deepEqual([m.split.gap_from, m.split.gap_to, m.split.lower_group.count], [15, 47, 6]);
  assert.equal(modality(SETS.n20.x, SETS.n20.x.map(String)).verdict, 'single peak');
  assert.equal(modality(SETS.lit.x, SETS.lit.x.map(String)), null);
});

test('outliers by IQR and robust z-score', () => {
  const o = outliers(SETS.skewed.x, SETS.skewed.x.map((_, i) => `R${i}`));
  assert.deepEqual(o, [{ at: 'R4', value: 95, side: 'high', methods: ['IQR', 'robust z-score'] }]);
  assert.deepEqual(outliers(SETS.n20.x, SETS.n20.x.map(String)), []);
});

test('normality verdicts are careful with small samples', () => {
  const d = distribution(SETS.lit.x, SETS.lit.x.map(String));
  assert.match(d.normality.verdict, /sample is small/);
  assert.match(distribution(SETS.skewed.x, SETS.skewed.x.map(String)).normality.verdict, /not normal/);
  assert.match(distribution(SETS.skewed.x, SETS.skewed.x.map(String)).skew_shape, /positive/);
  assert.match(distribution(SETS.skewed.x, SETS.skewed.x.map(String)).tails, /heavy/);
});

test('unusual years: a spike off a steady trend', () => {
  const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024];
  const values = [100, 104, 108, 160, 116, 120, 124];
  const odd = unusualYears(years.map((x, i) => ({ x, label: String(x), value: values[i] })));
  assert.deepEqual(odd, [{ year: '2021', value: 160, trend_value: 112, above_or_below_trend: 'above' }]);
  // A steady trend with ordinary noise has no unusual years.
  assert.equal(unusualYears(years.map((x, i) => ({ x, label: String(x), value: [100, 105, 107, 113, 115, 121, 124][i] }))), null);
});

test('analyseTables: distribution only for category tables, unusual years for time tables', () => {
  const rows = [['State', 'Cases'], ...SETS.bimodal.x.map((v, i) => [`S${i}`, String(v)])];
  const [cat] = analyseTables([{ rows }]);
  assert.equal(cat.stats.series[0].distribution.modality.verdict, 'bimodal');
  assert.equal(cat.stats.series[0].distribution.normality.test, 'Shapiro-Wilk');
  const [time] = analyseTables([{ rows: [['Year', 'Cases'], ['2018', '100'], ['2019', '104'], ['2020', '108'], ['2021', '160'], ['2022', '116'], ['2023', '120'], ['2024', '124']] }]);
  assert.equal(time.stats.series[0].distribution, undefined);
  assert.equal(time.stats.series[0].unusual_years[0].year, '2021');
});
