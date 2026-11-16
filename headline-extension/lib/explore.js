// Exploratory statistics across series: group comparison, benchmarking, ranking,
// cross-tabulation, weighted averages, correlation and (careful) regression.
// Every function guards against the classic misreads: summing non-additive measures,
// correlations from tiny samples, shared time trends that look like relationships,
// and over-fitted curves.

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => sum(xs) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Measures that must not be added up or shared out (ranks, rates, averages, prices…).
const NON_ADDITIVE = /rank|%|percent|per\s*cent|rate|ratio|average|\bavg\b|mean|median|score|price|index|cut-?off|closing|opening|percentile|cgpa|gpa|marks|growth|yield|inflation|temperature|\bage\b|share|density|per\s+(capita|lakh|1000|thousand|day)/i;
// Words that name a measure; columns with different ones are different measures.
const MEASURE_WORD = /%|rate|ratio|avg|average|mean|median|rank|score|price|days|count|number|\bno\.|total|amount|students|applicants|candidates|seats|cases|population|marks|crore|lakh|revenue|sales|deaths|votes/i;

/** Can these values be summed and expressed as shares of a total? */
export function isAdditive(metricText, unit) {
  return unit !== '%' && !NON_ADDITIVE.test(metricText || '');
}

/** Do all these series measure the same thing (so they can be cross-tabulated)? */
export function sameMeasure(orientation, series) {
  if (series.length < 2) return false;
  if (orientation === 'years across') return true; // rows are categories of one measure
  const units = new Set(series.map((s) => s.unit ?? ''));
  if (units.size > 1) return false;
  const first = (n) => String(n).trim().split(/\s+/)[0].toLowerCase();
  if (first(series[0].name).length >= 3 && series.every((s) => first(s.name) === first(series[0].name))) return true;
  return !series.some((s) => MEASURE_WORD.test(s.name));
}

// --- ranks and correlation --------------------------------------------------------------

/** Ranks with ties given their average rank (1 = smallest). */
export function ranks(xs) {
  const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = Array(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

export function pearson(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

export const spearman = (xs, ys) => pearson(ranks(xs), ranks(ys));

/** Kendall's tau-b (handles ties). */
export function kendall(xs, ys) {
  let concordant = 0;
  let discordant = 0;
  let tiesX = 0;
  let tiesY = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const dx = Math.sign(xs[i] - xs[j]);
      const dy = Math.sign(ys[i] - ys[j]);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tiesX++;
      else if (dy === 0) tiesY++;
      else if (dx === dy) concordant++;
      else discordant++;
    }
  }
  const denom = Math.sqrt((concordant + discordant + tiesX) * (concordant + discordant + tiesY));
  return denom ? (concordant - discordant) / denom : null;
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26), accurate to about 1e-7.
function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Approximate two-sided p-value for a Pearson r (Fisher z). */
export function pearsonP(r, n) {
  if (r == null || n < 4) return null;
  if (Math.abs(r) >= 1) return 0;
  const z = Math.atanh(r) * Math.sqrt(n - 3);
  return 2 * (1 - normalCdf(Math.abs(z)));
}

const strength = (r) => (Math.abs(r) >= 0.7 ? 'strong' : Math.abs(r) >= 0.4 ? 'moderate' : 'weak');

/** Simple least-squares line y = a + b·x. */
function lineFit(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

const MIN_CORRELATION_N = 5;

/**
 * Correlations between every pair of series that share labels (years or categories).
 * `series` items: { name, points: [{ label, value }] }.
 */
export function correlations(series, timeAxis) {
  if (series.length < 2) return null;
  const pairs = [];
  const maps = series.map((s) => new Map(s.points.map((p) => [p.label, p.value])));
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const labels = series[i].points.map((p) => p.label).filter((l) => maps[j].has(l));
      const xs = labels.map((l) => maps[i].get(l));
      const ys = labels.map((l) => maps[j].get(l));
      if (labels.length < MIN_CORRELATION_N) continue;
      const r = pearson(xs, ys);
      if (r == null) continue;
      const rho = spearman(xs, ys);
      const tau = kendall(xs, ys);
      const pair = {
        a: series[i].name,
        b: series[j].name,
        n: labels.length,
        pearson: round(r, 3),
        spearman: round(rho, 3),
        kendall_tau: round(tau, 3),
        p_value_approx: round(pearsonP(r, labels.length), 4),
        strength: strength(r),
        direction: r > 0 ? 'move together' : 'move in opposite directions',
      };
      const p = pearsonP(r, labels.length);
      pair.significant_at_5pct = p != null && p < 0.05;
      if (rho != null && Math.abs(r - rho) > 0.3) pair.note = 'Pearson and Spearman disagree: one or two extreme values drive the Pearson figure; prefer Spearman';
      if (timeAxis && labels.length >= MIN_CORRELATION_N + 1) {
        // Two series that both trend over time correlate even if unrelated. Correlating
        // the year-on-year changes removes the shared trend.
        const dx = xs.slice(1).map((v, k) => v - xs[k]);
        const dy = ys.slice(1).map((v, k) => v - ys[k]);
        const rc = pearson(dx, dy);
        if (rc != null) {
          pair.r_of_yearly_changes = round(rc, 3);
          // Levels move together but the yearly changes don't (or move opposite): both just
          // trend over time, which is not evidence of a relationship.
          if (Math.abs(r) >= 0.7 && (Math.abs(rc) < 0.3 || Math.sign(rc) !== Math.sign(r))) pair.likely_shared_trend = true;
        }
      }
      if (!timeAxis && Math.abs(r) >= 0.7 && labels.length >= 6 && pair.significant_at_5pct) {
        // Simple regression for a strong cross-sectional relationship: association only.
        const fit = lineFit(xs, ys);
        if (fit) pair.regression = { y: series[j].name, x: series[i].name, slope: round(fit.slope, 4), r2: round(r * r, 3) };
      }
      pairs.push(pair);
    }
  }
  if (!pairs.length) return { skipped: `fewer than ${MIN_CORRELATION_N} shared data points per pair` };
  pairs.sort((p, q) => Math.abs(q.pearson) - Math.abs(p.pearson));
  const out = { pairs: pairs.slice(0, 6) };
  if (series.length >= 3 && series.length <= 6) {
    const lookup = new Map(pairs.map((p) => [`${p.a}\u0000${p.b}`, p.pearson]));
    out.matrix = {
      method: 'pearson',
      names: series.map((s) => s.name),
      r: series.map((s, i) => series.map((t, j) => (i === j ? 1 : lookup.get(`${s.name}\u0000${t.name}`) ?? lookup.get(`${t.name}\u0000${s.name}`) ?? null))),
    };
  }
  return out;
}

// --- group comparison, benchmarking, ranking --------------------------------------------

/** For one series across categories: benchmark against the group, ranking and gap. */
export function compareCategories(points) {
  const vals = points.map((p) => p.value);
  if (vals.length < 3) return null;
  const med = median(vals);
  const avg = mean(vals);
  const vsMedian = (v) => (med ? round(((v - med) / Math.abs(med)) * 100, 1) : null);
  const byGap = [...points].sort((a, b) => Math.abs(b.value - med) - Math.abs(a.value - med));
  const sorted = [...points].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const out = {
    benchmark: {
      group_median: round(med),
      group_mean: round(avg),
      furthest_above_median: byGap.filter((p) => p.value > med).slice(0, 2).map((p) => ({ at: p.label, value: p.value, pct_vs_median: vsMedian(p.value) })),
      furthest_below_median: byGap.filter((p) => p.value < med).slice(0, 2).map((p) => ({ at: p.label, value: p.value, pct_vs_median: vsMedian(p.value) })),
    },
    ranking: sorted.length <= 6
      ? { order: 'highest value first', all: sorted.map((p, i) => ({ rank: i + 1, at: p.label, value: p.value })) }
      : {
        order: 'highest value first',
        top: sorted.slice(0, 3).map((p, i) => ({ rank: i + 1, at: p.label, value: p.value })),
        bottom: sorted.slice(-3).map((p, i) => ({ rank: sorted.length - 2 + i, at: p.label, value: p.value })),
      },
    gap: { highest: top.label, lowest: bottom.label, difference: round(top.value - bottom.value) },
  };
  if (bottom.value > 0) out.gap.pct_difference_vs_lowest = round(((top.value - bottom.value) / bottom.value) * 100, 1);
  return out;
}

/** Across several time series: growth benchmark and who moved up or down the ranking. */
export function compareTimeSeries(series) {
  const out = {};
  const growth = series.filter((s) => s.cagr_pct != null);
  if (growth.length >= 3) {
    const med = median(growth.map((s) => s.cagr_pct));
    const ranked = [...growth].sort((a, b) => b.cagr_pct - a.cagr_pct);
    out.growth_benchmark = {
      median_cagr_pct: round(med),
      fastest: ranked.slice(0, 2).map((s) => ({ name: s.name, cagr_pct: s.cagr_pct, pp_vs_median: round(s.cagr_pct - med) })),
      slowest: ranked.slice(-2).map((s) => ({ name: s.name, cagr_pct: s.cagr_pct, pp_vs_median: round(s.cagr_pct - med) })),
    };
  }
  // Rank shifts between the first and last year every series shares.
  if (series.length >= 3) {
    const years = series.map((s) => new Map(s.points.map((p) => [p.x, p])));
    const common = [...years[0].keys()].filter((x) => years.every((m) => m.has(x))).sort((a, b) => a - b);
    if (common.length >= 2) {
      const [y0, y1] = [common[0], common[common.length - 1]];
      const rankAt = (y) => {
        const order = series.map((s, i) => ({ name: s.name, v: years[i].get(y).value })).sort((a, b) => b.v - a.v);
        return new Map(order.map((o, k) => [o.name, k + 1]));
      };
      const r0 = rankAt(y0);
      const r1 = rankAt(y1);
      const shifts = series.map((s) => ({ name: s.name, rank_first: r0.get(s.name), rank_last: r1.get(s.name), moved: r0.get(s.name) - r1.get(s.name) }))
        .filter((s) => s.moved !== 0).sort((a, b) => Math.abs(b.moved) - Math.abs(a.moved));
      out.rank_shift = {
        order: 'rank 1 = highest value',
        from: years[0].get(y0).label,
        to: years[0].get(y1).label,
        moves: shifts.slice(0, 4),
        unchanged: shifts.length === 0,
      };
    }
  }
  return Object.keys(out).length ? out : null;
}

// --- cross-tabulation ---------------------------------------------------------------------

/**
 * Treats the series × labels grid as a contingency table (only for additive measures of
 * the same kind). Reports totals, shares, the cells most over- or under-represented
 * against the overall mix and, for time tables, how each series' share shifted.
 */
export function crossTab(series, timeAxis) {
  const labels = series[0].points.map((p) => p.label).filter((l) => series.every((s) => s.points.some((p) => p.label === l)));
  if (labels.length < 2) return null;
  const grid = series.map((s) => labels.map((l) => s.points.find((p) => p.label === l).value));
  if (grid.flat().some((v) => v < 0)) return null;
  const rowTotals = grid.map(sum);
  const colTotals = labels.map((_, j) => sum(grid.map((r) => r[j])));
  const grand = sum(rowTotals);
  if (!grand) return null;

  const share = (part, whole) => (whole ? (part / whole) * 100 : 0);
  const out = {
    grand_total: round(grand),
    share_of_total: series.map((s, i) => ({ name: s.name, total: round(rowTotals[i]), pct: round(share(rowTotals[i], grand), 1) }))
      .sort((a, b) => b.pct - a.pct).slice(0, 5),
  };

  // Over/under-representation: a series' share within one column vs its overall share.
  const cells = [];
  series.forEach((s, i) => labels.forEach((l, j) => {
    const within = share(grid[i][j], colTotals[j]);
    const overall = share(rowTotals[i], grand);
    cells.push({ name: s.name, at: l, pct_of_column: round(within, 1), pct_overall: round(overall, 1), pp_difference: round(within - overall, 1) });
  }));
  out.most_over_or_under_represented = cells.sort((a, b) => Math.abs(b.pp_difference) - Math.abs(a.pp_difference)).slice(0, 3);

  // Chi-square association (Cramér's V) only for whole-number counts with enough volume.
  if (grid.flat().every(Number.isInteger) && grand >= 30) {
    let chi2 = 0;
    grid.forEach((r, i) => r.forEach((o, j) => {
      const e = (rowTotals[i] * colTotals[j]) / grand;
      if (e > 0) chi2 += (o - e) ** 2 / e;
    }));
    const k = Math.min(series.length, labels.length) - 1;
    if (k > 0) out.cramers_v = round(Math.sqrt(chi2 / (grand * k)), 3);
  }

  if (timeAxis) {
    const [first, last] = [0, labels.length - 1];
    out.share_shift = series.map((s, i) => ({
      name: s.name,
      from: labels[first],
      to: labels[last],
      pct_first: round(share(grid[i][first], colTotals[first]), 1),
      pct_last: round(share(grid[i][last], colTotals[last]), 1),
    })).map((x) => ({ ...x, pp_change: round(x.pct_last - x.pct_first, 1) }))
      .sort((a, b) => Math.abs(b.pp_change) - Math.abs(a.pp_change)).slice(0, 3);
  }
  return out;
}

// --- weighted averages --------------------------------------------------------------------

/**
 * Pairs a rate/average column with a count column over the same rows (e.g. pass % and
 * students) and reports the weighted average next to the simple one. A big difference
 * means the simple average misleads because groups differ in size.
 */
export function weightedAverages(series) {
  const rates = series.filter((s) => !s.additive);
  const weights = series.filter((s) => s.additive && s.unit !== '%' && s.points.every((p) => p.value >= 0));
  const out = [];
  for (const r of rates) {
    for (const w of weights) {
      const wm = new Map(w.points.map((p) => [p.label, p.value]));
      const pts = r.points.filter((p) => wm.has(p.label));
      if (pts.length < 3) continue;
      const totalW = sum(pts.map((p) => wm.get(p.label)));
      if (!totalW) continue;
      const weighted = sum(pts.map((p) => p.value * wm.get(p.label))) / totalW;
      const simple = mean(pts.map((p) => p.value));
      out.push({ measure: r.name, weighted_by: w.name, weighted_mean: round(weighted), simple_mean: round(simple), difference: round(weighted - simple), rows: pts.length });
      if (out.length >= 3) return out;
    }
  }
  return out.length ? out : null;
}

// --- polynomial (quadratic) trend ---------------------------------------------------------

function solve3(m, v) {
  const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-12) return null;
  return [0, 1, 2].map((c) => det(m.map((row, i) => row.map((x, j) => (j === c ? v[i] : x)))) / d);
}

const adjustedR2 = (r2, n, p) => 1 - ((1 - r2) * (n - 1)) / (n - p - 1);

// 5% critical values of F(1, df) for the partial F-test (df = n - 3).
const F_CRIT = { 3: 10.13, 4: 7.71, 5: 6.61, 6: 5.99, 7: 5.59, 8: 5.32, 9: 5.12, 10: 4.96, 11: 4.84, 12: 4.75, 13: 4.67, 14: 4.6, 15: 4.54, 16: 4.49, 17: 4.45, 18: 4.41, 19: 4.38, 20: 4.35 };
const fCrit = (df) => F_CRIT[df] ?? (df > 20 ? 4.2 : Infinity);

/**
 * Is the trend bending? Fits a quadratic and keeps it only if a partial F-test says the
 * curve explains significantly more than the straight line (5% level), so noise isn't
 * read as acceleration.
 */
export function curvature(xs, ys) {
  const n = xs.length;
  if (n < 6) return null;
  const mx = mean(xs);
  const u = xs.map((x) => x - mx);
  const s = (k) => sum(u.map((v) => v ** k));
  const coef = solve3([[n, s(1), s(2)], [s(1), s(2), s(3)], [s(2), s(3), s(4)]], [sum(ys), sum(u.map((v, i) => v * ys[i])), sum(u.map((v, i) => v * v * ys[i]))]);
  const line = lineFit(xs, ys);
  if (!coef || !line) return null;
  const my = mean(ys);
  const ssTot = sum(ys.map((y) => (y - my) ** 2));
  if (!ssTot) return null;
  const sseQ = sum(ys.map((y, i) => (y - (coef[0] + coef[1] * u[i] + coef[2] * u[i] ** 2)) ** 2));
  const sseL = sum(ys.map((y, i) => (y - (line.intercept + line.slope * xs[i])) ** 2));
  const adjQ = adjustedR2(1 - sseQ / ssTot, n, 2);
  const adjL = adjustedR2(1 - sseL / ssTot, n, 1);
  // A curve must explain a meaningful extra share of the variance (at least 1%), not just
  // rounding noise on an already straight line, and pass the F-test.
  if ((sseL - sseQ) / ssTot < 0.01) return null;
  const f = sseQ > 0 ? (sseL - sseQ) / (sseQ / (n - 3)) : Infinity;
  if (f < fCrit(n - 3) || adjQ < 0.8) return null;
  const slopeStart = coef[1] + 2 * coef[2] * u[0];
  const slopeEnd = coef[1] + 2 * coef[2] * u[n - 1];
  const shape = Math.sign(slopeStart) !== Math.sign(slopeEnd) && slopeStart && slopeEnd
    ? 'changed direction'
    : Math.abs(slopeEnd) > Math.abs(slopeStart) ? 'accelerating' : 'slowing';
  return { shape, slope_per_year_start: round(slopeStart), slope_per_year_end: round(slopeEnd), quadratic_adj_r2: round(adjQ, 3), linear_adj_r2: round(adjL, 3), f_test: 'significant at 5%' };
}
