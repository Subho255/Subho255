import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseTables, linearFit, median, parseNumber, parseYear, seriesStats } from '../headline-extension/lib/stats.js';

const josaa = {
  caption: 'IIT Bombay closing ranks',
  rows: [
    ['Branch', '2020', '2021', '2022', '2023', '2024', '2025'],
    ['Computer Science', '66', '67', '68', '68', '68', '71'],
    ['Civil Engineering', '3,966', '3,812', '3,640', '3,512', '3,301', '3,105'],
  ],
};

test('parses Indian number formats, currency, percentages and units; rejects ranges', () => {
  assert.deepEqual(parseNumber('1,23,456'), { value: 123456, unit: '' });
  assert.deepEqual(parseNumber('₹ 45.5'), { value: 45.5, unit: '₹' });
  assert.deepEqual(parseNumber('12.5%'), { value: 12.5, unit: '%' });
  assert.deepEqual(parseNumber('45 lakh'), { value: 45, unit: 'lakh' });
  assert.equal(parseNumber('1200-1500'), null);
  assert.equal(parseNumber('NA'), null);
  assert.equal(parseNumber('Round 6'), null);
});

test('recognises year labels including fiscal years', () => {
  assert.equal(parseYear('2024'), 2024);
  assert.equal(parseYear('2023-24'), 2023);
  assert.equal(parseYear('FY24'), 2024);
  assert.equal(parseYear('Rank'), null);
  assert.equal(parseYear('12024'), null);
});

test('median, and a perfect line has R² 1', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  const fit = linearFit([2020, 2021, 2022], [10, 20, 30]);
  assert.equal(fit.slope, 10);
  assert.equal(fit.r2, 1);
});

test('years across the header: change, CAGR, direction and divergence are exact', () => {
  const [{ stats }] = analyseTables([josaa]);
  assert.equal(stats.orientation, 'years across');
  const civil = stats.series.find((s) => s.name === 'Civil Engineering');
  assert.equal(civil.change, -861);
  assert.equal(civil.change_pct, -21.7);
  assert.equal(civil.cagr_pct, -4.78);
  assert.equal(civil.direction, 'fell every period');
  assert.equal(civil.median, 3576);
  assert.deepEqual(stats.opposite_directions, { rising: ['Computer Science'], falling: ['Civil Engineering'] });
  assert.equal(stats.ranked_by_change_pct[0].name, 'Computer Science');
});

test('projection only for 5+ evenly spaced points with a steady trend', () => {
  const [{ stats }] = analyseTables([josaa]);
  const civil = stats.series.find((s) => s.name === 'Civil Engineering');
  const cs = stats.series.find((s) => s.name === 'Computer Science');
  assert.equal(civil.projection.year, 2026);
  assert.ok(civil.trend_r2 >= 0.85);
  assert.equal(cs.projection, undefined);
  assert.match(cs.projection_not_allowed, /not steady enough/);

  const short = seriesStats('x', [2021, 2022, 2023].map((x, i) => ({ x, label: String(x), cell: String(10 + i) })), true);
  assert.match(short.projection_not_allowed, /only 3 data points/);
  const gaps = seriesStats('x', [2015, 2016, 2018, 2019, 2020].map((x, i) => ({ x, label: String(x), cell: String(10 + i) })), true);
  assert.match(gaps.projection_not_allowed, /not evenly spaced/);
  const toZero = seriesStats('x', [2020, 2021, 2022, 2023, 2024].map((x, i) => ({ x, label: String(x), cell: String(40 - i * 10) })), true);
  assert.match(toZero.projection_not_allowed, /below zero/);
});

test('years down the first column, sorted, with percentage columns in points', () => {
  const [{ stats }] = analyseTables([{ rows: [
    ['Year', 'Pass %', 'Students'],
    ['2024', '60%', '1,230'],
    ['2022', '59%', '905'],
    ['2023', '62%', '1,113'],
  ] }]);
  assert.equal(stats.orientation, 'years down');
  const pass = stats.series.find((s) => s.name === 'Pass %');
  assert.equal(pass.first.year, '2022');
  assert.equal(pass.change, 1);
  assert.equal(pass.change_unit, 'percentage points');
  assert.equal(pass.change_pct, undefined);
  assert.equal(pass.cagr_pct, undefined);
});

test('categories: share of total, outliers and skew', () => {
  const [{ stats }] = analyseTables([{ rows: [
    ['State', 'Cases'], ['A', '10'], ['B', '12'], ['C', '11'], ['D', '9'], ['E', '95'],
  ] }]);
  assert.equal(stats.orientation, 'categories');
  const s = stats.series[0];
  assert.equal(s.total, 137);
  assert.equal(s.top_share_pct, 69.3);
  assert.deepEqual(s.outliers, [{ at: 'E', value: 95, side: 'high', methods: ['IQR', 'robust z-score'] }]);
  assert.match(s.skew, /prefer the median/);
});

test('mixed units in one column are skipped, not averaged', () => {
  const [{ stats }] = analyseTables([{ rows: [['Item', 'Amount'], ['a', '5 lakh'], ['b', '2 crore'], ['c', '3 lakh']] }]);
  assert.match(stats.series[0].skipped, /mixed units/);
});

test('oversized tables are trimmed', () => {
  const rows = [['Name', ...Array.from({ length: 30 }, (_, i) => String(2000 + i))], ...Array.from({ length: 200 }, (_, r) => [`r${r}`, ...Array(30).fill('1')])];
  const [{ table }] = analyseTables([{ rows }]);
  assert.equal(table.rows.length, 80);
  assert.equal(table.rows[0].length, 20);
});

test('two-row headers are merged before reading the data', () => {
  const [{ stats }] = analyseTables([{ rows: [
    ['Branch', 'Seats', 'Seats'], ['Branch', 'Gen', 'OBC'], ['CSE', '58', '32'], ['EE', '40', '22'], ['ME', '45', '25'],
  ] }]);
  assert.deepEqual(stats.series.map((x) => x.name), ['Seats Gen', 'Seats OBC']);
  assert.equal(stats.series[0].total, 143);
});

test('a section row with only a label is not treated as a header', () => {
  const [{ stats }] = analyseTables([{ rows: [['Zone', 'Cases'], ['North', ''], ['Delhi', '12'], ['Punjab', '8'], ['Haryana', '5']] }]);
  assert.equal(stats.series[0].name, 'Cases');
  assert.equal(stats.series[0].n, 3);
});
