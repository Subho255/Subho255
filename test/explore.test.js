import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareCategories, compareTimeSeries, correlations, crossTab, curvature, isAdditive,
  kendall, pearson, pearsonP, ranks, sameMeasure, spearman, weightedAverages,
} from '../headline-extension/lib/explore.js';
import { analyseTables } from '../headline-extension/lib/stats.js';

const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const pts = (labels, values) => labels.map((label, i) => ({ label, x: Number(label) || null, value: values[i] }));

test('Pearson and Spearman match Python statistics; ties get average ranks', () => {
  const x = [2, 4, 5, 8, 10, 11, 15];
  const y = [1, 3, 7, 6, 12, 10, 20];
  close(pearson(x, y), 0.948367);
  close(spearman(x, y), 0.928571);
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test("Kendall's tau-b and the Fisher p-value", () => {
  close(kendall([1, 2, 3], [1, 3, 2]), 1 / 3);
  close(kendall([1, 2, 3, 4], [1, 2, 3, 4]), 1);
  close(pearsonP(0.5, 10), 0.1461, 1e-3);
  assert.equal(pearsonP(0.5, 3), null);
});

test('additive vs non-additive measures', () => {
  assert.equal(isAdditive('IIT closing ranks Branch', ''), false);
  assert.equal(isAdditive('Pass %', '%'), false);
  assert.equal(isAdditive('Literacy rate', ''), false);
  assert.equal(isAdditive('Students enrolled', ''), true);
  assert.equal(isAdditive('Seats Gen', ''), true);
});

test('same measure: sub-groups yes, different measures no', () => {
  const s = (name, unit = '') => ({ name, unit });
  assert.equal(sameMeasure('categories', [s('Seats Gen'), s('Seats OBC')]), true);
  assert.equal(sameMeasure('years down', [s('Bihar'), s('Delhi')]), true);
  assert.equal(sameMeasure('categories', [s('Applicants'), s('Pass %', '%')]), false);
  assert.equal(sameMeasure('categories', [s('Days closed'), s('Schools (lakh)')]), false);
});

test('benchmark against the group median, ranking and gap', () => {
  const c = compareCategories(pts(['A', 'B', 'C', 'D', 'E'], [10, 20, 30, 40, 100]));
  assert.equal(c.benchmark.group_median, 30);
  assert.deepEqual(c.benchmark.furthest_above_median[0], { at: 'E', value: 100, pct_vs_median: 233.3 });
  assert.equal(c.ranking.all[0].at, 'E');
  assert.equal(c.gap.pct_difference_vs_lowest, 900);
});

test('rank shift and growth benchmark across time series', () => {
  const mk = (name, values) => ({ name, points: pts(['2020', '2021', '2022'], values) });
  const series = [mk('A', [100, 110, 120]), mk('B', [90, 120, 150]), mk('C', [50, 52, 55])];
  series.forEach((s) => { s.cagr_pct = ((s.points[2].value / s.points[0].value) ** 0.5 - 1) * 100; });
  const out = compareTimeSeries(series);
  assert.deepEqual(out.rank_shift.moves.map((m) => [m.name, m.rank_first, m.rank_last]), [['A', 1, 2], ['B', 2, 1]]);
  assert.equal(out.growth_benchmark.fastest[0].name, 'B');
});

test('cross-tab: shares, share shift in percentage points, Cramér\'s V for counts', () => {
  const mk = (name, values) => ({ name, points: pts(['2019', '2024'], values) });
  const ct = crossTab([mk('Bihar', [20, 40]), mk('UP', [80, 60])], true);
  assert.equal(ct.grand_total, 200);
  assert.deepEqual(ct.share_of_total[0], { name: 'UP', total: 140, pct: 70 });
  assert.deepEqual(ct.share_shift.map((s) => [s.name, s.pct_first, s.pct_last, s.pp_change]), [['Bihar', 20, 40, 20], ['UP', 80, 60, -20]]);
  assert.ok(ct.cramers_v > 0 && ct.cramers_v < 1);
});

test('weighted average vs simple average', () => {
  const rate = { name: 'Pass %', unit: '%', additive: false, points: pts(['A', 'B', 'C'], [50, 90, 70]) };
  const count = { name: 'Students', unit: '', additive: true, points: pts(['A', 'B', 'C'], [100, 10, 10]) };
  const [w] = weightedAverages([rate, count]);
  assert.equal(w.weighted_mean, 55);
  assert.equal(w.simple_mean, 70);
  assert.equal(w.difference, -15);
});

test('curvature needs a significant F-test; a straight line or noise is not a bend', () => {
  const years = [2019, 2020, 2021, 2022, 2023, 2024];
  const bend = curvature(years, [20, 21, 23, 26, 29, 33]);
  assert.equal(bend.shape, 'accelerating');
  assert.equal(curvature(years, [10, 20, 30, 40, 50, 60]), null);
  assert.equal(curvature(years, [10, 14, 9, 15, 11, 13]), null);
  assert.equal(curvature(years.slice(0, 5), [1, 4, 9, 16, 25]), null, 'needs 6+ points');
});

test('correlations: minimum sample, significance, shared trends, regression only when significant', () => {
  const mk = (name, labels, values) => ({ name, points: pts(labels, values) });
  const short = correlations([mk('a', ['1', '2', '3', '4'], [1, 2, 3, 4]), mk('b', ['1', '2', '3', '4'], [2, 4, 6, 9])], false);
  assert.match(short.skipped, /fewer than 5/);

  const yrs = ['2019', '2020', '2021', '2022', '2023', '2024'];
  const trend = correlations([mk('Bihar', yrs, [20, 21, 23, 26, 29, 33]), mk('UP', yrs, [41, 42, 42.5, 43, 43.4, 44])], true);
  assert.equal(trend.pairs[0].likely_shared_trend, true);

  const cats = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const strong = correlations([mk('x', cats, [1, 2, 3, 4, 5, 6, 7, 8]), mk('y', cats, [2.1, 3.9, 6.2, 8.1, 9.8, 12.2, 13.9, 16.1])], false);
  assert.equal(strong.pairs[0].significant_at_5pct, true);
  assert.ok(strong.pairs[0].regression.slope > 1.9 && strong.pairs[0].regression.slope < 2.1);

  const weak = correlations([mk('x', cats, [1, 2, 3, 4, 5, 6, 7, 8]), mk('y', cats, [5, 1, 7, 2, 8, 3, 6, 4])], false);
  assert.equal(weak.pairs[0].significant_at_5pct, false);
  assert.equal(weak.pairs[0].regression, undefined);
});

test('analyseTables: no totals or cross-tab for ranks; weighted averages and matrix for state data', () => {
  const [ranksT, statesT] = analyseTables([
    { caption: 'IIT closing ranks', rows: [['Branch', '2021', '2022', '2023'], ['CS', '67', '68', '68'], ['Civil', '3812', '3640', '3512'], ['ME', '1734', '1785', '1861']] },
    { caption: 'States', rows: [
      ['State', 'Literacy rate (%)', 'Female workforce (%)', 'Population (lakh)'],
      ['Kerala', '96.2', '34.1', '356'], ['Himachal', '86.6', '46.2', '73'], ['Tamil Nadu', '82.9', '38.5', '770'],
      ['Maharashtra', '84.8', '33.9', '1240'], ['Gujarat', '82.4', '31.2', '700'], ['Rajasthan', '69.7', '36.8', '810'],
      ['Uttar Pradesh', '73.0', '22.1', '2410'], ['Bihar', '70.9', '13.8', '1270'],
    ] },
  ]).map((r) => r.stats);
  assert.equal(ranksT.cross_tab, undefined);
  assert.equal(ranksT.series[0].additive, false);
  assert.ok(ranksT.comparison.rank_shift);

  assert.equal(statesT.cross_tab, undefined, 'different measures are not cross-tabulated');
  assert.equal(statesT.series[0].total, undefined, 'rates are not summed');
  assert.equal(statesT.weighted_averages[0].weighted_mean, 77.29);
  assert.equal(statesT.correlations.matrix.names.length, 3);
  assert.equal(statesT.series[0].benchmark.furthest_above_median[0].at, 'Kerala');
});
