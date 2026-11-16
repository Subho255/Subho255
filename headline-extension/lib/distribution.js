// Descriptive statistics and distribution analysis for one set of values:
// mode, variance, range, percentiles and quartiles, IQR, skewness, kurtosis, a
// Shapiro–Wilk normality test, a frequency distribution, bimodality and outliers.
// Shape statistics are only meaningful across categories (states, branches), not for
// a trending time series, so stats.js applies them to category tables only.

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => sum(xs) / xs.length;

/** Percentile with linear interpolation (the common "type 7" definition, as in NumPy/Excel). */
export function percentile(values, p) {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * (p / 100);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function variance(values) {
  const m = mean(values);
  return sum(values.map((v) => (v - m) ** 2)) / (values.length - 1);
}

/** Mode(s): the most frequent value(s), only when some value repeats. */
export function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = Math.max(...counts.values());
  if (top < 2) return null;
  const modes = [...counts].filter(([, c]) => c === top).map(([v]) => v).sort((a, b) => a - b);
  return { values: modes.slice(0, 3), count: top };
}

/** Sample skewness, adjusted Fisher–Pearson (G1, as SciPy's skew with bias=False). */
export function skewness(xs) {
  const n = xs.length;
  if (n < 3) return null;
  const m = mean(xs);
  const m2 = sum(xs.map((x) => (x - m) ** 2)) / n;
  const m3 = sum(xs.map((x) => (x - m) ** 3)) / n;
  if (!m2) return 0;
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * (m3 / m2 ** 1.5);
}

/** Sample excess kurtosis (G2, as SciPy's kurtosis with bias=False). 0 = normal. */
export function kurtosis(xs) {
  const n = xs.length;
  if (n < 4) return null;
  const m = mean(xs);
  const m2 = sum(xs.map((x) => (x - m) ** 2)) / n;
  const m4 = sum(xs.map((x) => (x - m) ** 4)) / n;
  if (!m2) return 0;
  return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * (m4 / m2 ** 2) - 3 * (n - 1));
}

// --- normal distribution helpers -------------------------------------------------------

function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Inverse standard normal CDF (Acklam's algorithm, relative error about 1e-9). */
export function normalInv(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normalInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const poly = (cc, x) => cc.reduceRight((acc, c) => acc * x + c, 0);

/**
 * Shapiro–Wilk normality test (Royston 1995, algorithm AS R94, as in SciPy).
 * Returns { w, p } for 3 <= n <= 5000, else null.
 */
export function shapiroWilk(values) {
  const x = [...values].sort((p, q) => p - q);
  const n = x.length;
  if (n < 3 || n > 5000) return null;
  const range = x[n - 1] - x[0];
  if (range === 0) return null;
  const half = Math.floor(n / 2);
  const a = Array(half).fill(0);
  if (n === 3) {
    a[0] = Math.SQRT1_2;
  } else {
    const m = [];
    let summ2 = 0;
    for (let i = 1; i <= half; i++) {
      m[i - 1] = normalInv((i - 0.375) / (n + 0.25));
      summ2 += m[i - 1] ** 2;
    }
    summ2 *= 2;
    const ssumm2 = Math.sqrt(summ2);
    const rsn = 1 / Math.sqrt(n);
    const a1 = poly([0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056], rsn) - m[0] / ssumm2;
    let fac;
    let start;
    if (n > 5) {
      const a2 = -m[1] / ssumm2 + poly([0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633], rsn);
      fac = Math.sqrt((summ2 - 2 * m[0] ** 2 - 2 * m[1] ** 2) / (1 - 2 * a1 ** 2 - 2 * a2 ** 2));
      a[1] = a2;
      start = 2;
    } else {
      fac = Math.sqrt((summ2 - 2 * m[0] ** 2) / (1 - 2 * a1 ** 2));
      start = 1;
    }
    a[0] = a1;
    for (let i = start; i < half; i++) a[i] = -m[i] / fac;
  }
  let num = 0;
  for (let i = 0; i < half; i++) num += a[i] * (x[n - 1 - i] - x[i]);
  const mx = mean(x);
  const ssq = sum(x.map((v) => (v - mx) ** 2));
  const w = Math.min(1, (num * num) / ssq);

  let p;
  if (n === 3) {
    p = Math.max(0, 1.90985931710274 * (Math.asin(Math.sqrt(w)) - 1.0471975511966));
  } else {
    const w1 = Math.log(1 - w);
    let y;
    let mu;
    let sigma;
    if (n <= 11) {
      const gamma = poly([-2.273, 0.459], n);
      if (gamma - w1 <= 0) return { w, p: 1e-12 };
      y = -Math.log(gamma - w1);
      mu = poly([0.544, -0.39978, 0.025054, -6.714e-4], n);
      sigma = Math.exp(poly([1.3822, -0.77857, 0.062767, -0.0020322], n));
    } else {
      const ln = Math.log(n);
      y = w1;
      mu = poly([-1.5861, -0.31082, -0.083751, 0.0038915], ln);
      sigma = Math.exp(poly([-0.4803, -0.082676, 0.0030302], ln));
    }
    p = 1 - normalCdf((y - mu) / sigma);
  }
  return { w, p };
}

// --- frequency distribution and modality -------------------------------------------------

/** A "nice" bin width: 1, 2, 2.5 or 5 times a power of ten. */
function niceWidth(raw) {
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

/** Equal-width frequency distribution, with Sturges' rule for the number of bins. */
export function histogram(values) {
  const n = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return null;
  const k = Math.min(10, Math.ceil(Math.log2(n)) + 1);
  const width = niceWidth((max - min) / k);
  const start = Math.floor(min / width) * width;
  const bins = [];
  for (let from = start; from <= max; from += width) {
    const to = from + width;
    bins.push({ from: round(from, 4), to: round(to, 4), count: values.filter((v) => v >= from && (v < to || (v === max && to > max))).length });
    if (bins.length > 12) break;
  }
  return bins;
}

/** Peaks in a histogram: runs of bins higher than their neighbours, each holding 2+ values. */
function histogramPeaks(bins) {
  const c = bins.map((b) => b.count);
  const peaks = [];
  for (let i = 0; i < c.length; i++) {
    let j = i;
    while (j + 1 < c.length && c[j + 1] === c[i]) j++;
    const left = i > 0 ? c[i - 1] : 0;
    const right = j + 1 < c.length ? c[j + 1] : 0;
    if (c[i] >= 2 && c[i] > left && c[i] > right) peaks.push({ from: bins[i].from, to: bins[j].to, count: c[i] });
    i = j;
  }
  return peaks;
}

/**
 * Are there two (or more) clusters? Needs agreement between the histogram (2+ peaks) and
 * the bimodality coefficient (> 0.555, the value for a uniform distribution), and 10+ values.
 */
export function modality(values, labels) {
  const n = values.length;
  if (n < 10) return null;
  const g1 = skewness(values);
  const g2 = kurtosis(values);
  const bc = (g1 ** 2 + 1) / (g2 + (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)));
  const peaks = histogramPeaks(histogram(values) ?? []);
  const verdict = peaks.length >= 2 && bc > 0.555 ? (peaks.length >= 3 ? 'multimodal' : 'bimodal') : 'single peak';
  const out = { verdict, bimodality_coefficient: round(bc, 3), peaks: peaks.length };
  if (verdict !== 'single peak') {
    // Where the groups split: the widest gap between neighbouring values.
    const order = values.map((v, i) => ({ v, label: labels[i] })).sort((a, b) => a.v - b.v);
    let best = 1;
    for (let i = 2; i < order.length; i++) if (order[i].v - order[i - 1].v > order[best].v - order[best - 1].v) best = i;
    const lower = order.slice(0, best);
    const upper = order.slice(best);
    out.split = {
      gap_from: order[best - 1].v,
      gap_to: order[best].v,
      lower_group: { count: lower.length, examples: lower.slice(-3).map((o) => o.label) },
      upper_group: { count: upper.length, examples: upper.slice(0, 3).map((o) => o.label) },
    };
  }
  return out;
}

/** Outliers by two methods: Tukey's IQR fences and the robust (median/MAD) z-score. */
export function outliers(values, labels) {
  if (values.length < 5) return null;
  const q1 = percentile(values, 25);
  const q3 = percentile(values, 75);
  const iqr = q3 - q1;
  const med = percentile(values, 50);
  const mad = percentile(values.map((v) => Math.abs(v - med)), 50);
  const found = [];
  values.forEach((v, i) => {
    const methods = [];
    if (iqr > 0 && (v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr)) methods.push('IQR');
    if (mad > 0 && Math.abs((0.6745 * (v - med)) / mad) > 3.5) methods.push('robust z-score');
    if (methods.length) found.push({ at: labels[i], value: v, side: v > med ? 'high' : 'low', methods });
  });
  return found;
}

// --- summaries used by stats.js -----------------------------------------------------------

/** Descriptive statistics: for any series with 3+ values. */
export function describe(values) {
  const n = values.length;
  if (n < 3) return null;
  const out = {
    variance: round(variance(values)),
    range: round(Math.max(...values) - Math.min(...values)),
  };
  const m = mode(values);
  out.mode = m ? { values: m.values, appears: m.count } : 'none (no value repeats)';
  if (n >= 5) {
    const q1 = percentile(values, 25);
    const q3 = percentile(values, 75);
    out.quartiles = { q1: round(q1), q2_median: round(percentile(values, 50)), q3: round(q3) };
    out.iqr = round(q3 - q1);
  }
  if (n >= 10) out.percentiles = { p10: round(percentile(values, 10)), p90: round(percentile(values, 90)) };
  return out;
}

/** Distribution shape across categories: for 5+ values (normality and modality need more). */
export function distribution(values, labels) {
  const n = values.length;
  if (n < 5) return null;
  const g1 = skewness(values);
  const g2 = kurtosis(values);
  const out = {
    skewness: round(g1, 3),
    skew_shape: Math.abs(g1) < 0.5 ? 'roughly symmetric' : g1 > 0 ? 'positive (right) skew: a few high values pull the mean up' : 'negative (left) skew: a few low values pull the mean down',
    excess_kurtosis: round(g2, 3),
    tails: g2 > 1 ? 'heavy tails: more extreme values than a normal distribution' : g2 < -1 ? 'light tails: flatter than a normal distribution' : 'close to normal',
  };
  if (n >= 8) {
    const sw = shapiroWilk(values);
    if (sw) {
      out.normality = {
        test: 'Shapiro-Wilk',
        w: round(sw.w, 4),
        p_value: round(sw.p, 4),
        verdict: sw.p < 0.05 ? 'not normal (p < 0.05): prefer the median and percentiles over the mean'
          : n < 20 ? 'no evidence against normal, but the sample is small' : 'consistent with a normal distribution',
      };
    }
    const bins = histogram(values);
    if (bins) out.frequency = { method: `equal-width bins (Sturges' rule)`, bins };
  }
  const mod = modality(values, labels);
  if (mod) out.modality = mod;
  const outs = outliers(values, labels);
  if (outs?.length) out.outliers = outs;
  return out;
}

/**
 * Years that break the trend. The trend line is fitted robustly (Theil–Sen: the median
 * of all pairwise slopes), so the unusual year can't drag the line towards itself; then
 * residuals with a robust z-score above 3.5 are flagged. For time series with 6+ points.
 */
export function unusualYears(points) {
  if (points.length < 6) return null;
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (points[j].x !== points[i].x) slopes.push((points[j].value - points[i].value) / (points[j].x - points[i].x));
    }
  }
  if (!slopes.length) return null;
  const slope = percentile(slopes, 50);
  const intercept = percentile(points.map((p) => p.value - slope * p.x), 50);
  const res = points.map((p) => p.value - (intercept + slope * p.x));
  const med = percentile(res, 50);
  const mad = percentile(res.map((r) => Math.abs(r - med)), 50);
  // Robust z-score: 0.6745·(r − median)/MAD; if MAD is 0 (most years exactly on the
  // line), use the mean absolute deviation instead: (r − median)/(1.2533·MeanAD).
  const meanAd = mean(res.map((r) => Math.abs(r - med)));
  const z = (r) => (mad ? (0.6745 * (r - med)) / mad : meanAd ? (r - med) / (1.2533 * meanAd) : 0);
  const found = points.map((p, i) => ({ p, r: res[i] }))
    .filter((o) => Math.abs(z(o.r)) > 3.5)
    .map((o) => ({ year: o.p.label, value: o.p.value, trend_value: round(o.p.value - o.r), above_or_below_trend: o.r > 0 ? 'above' : 'below' }));
  return found.length ? found : null;
}
