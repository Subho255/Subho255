// Exact statistics for tables in the article. The model is good at judging what a number
// means, not at arithmetic, so every figure it may quote is computed here first.
// Pure functions: used by the extension and the server alike.

export const LIMITS = { tables: 6, rows: 80, cols: 20, cell: 80 };

// A projection is offered only when the trend is long and steady enough to justify it.
const PROJECTION_MIN_POINTS = 5;
const PROJECTION_MIN_R2 = 0.85;

const UNIT_WORDS = /\s*(crore|cr|lakh|lakhs|lac|million|mn|billion|bn|thousand|k|per\s*cent|percent|pc|seats|students|rs\.?)\s*$/i;

/** Parses a table cell as a number. Returns { value, unit } or null. */
export function parseNumber(raw) {
  let s = String(raw ?? '').trim();
  if (!s || /^(-|–|—|na|n\/a|nil|none)$/i.test(s)) return null;
  let unit = '';
  if (/%/.test(s)) unit = '%';
  if (/^(₹|rs\.?\s)/i.test(s)) unit = '₹';
  if (/^\$/.test(s)) unit = '$';
  const word = UNIT_WORDS.exec(s);
  if (word) {
    unit = unit || word[1].toLowerCase().replace(/\s+/g, '');
    s = s.slice(0, word.index);
  }
  s = s.replace(/^(₹|rs\.?|\$|€|£)\s*/i, '').replace(/[,\s%]/g, '').replace(/^\+/, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return { value: Number(s), unit };
}

/** Year-like labels: 2024, 2023-24, 2023–2024, FY24, FY 2024. Returns the year or null. */
export function parseYear(raw) {
  const s = String(raw ?? '').trim();
  let m = /^((?:19|20)\d{2})(?:\s*[-–/]\s*(?:\d{2}|(?:19|20)\d{2}))?$/.exec(s);
  if (m) return Number(m[1]);
  m = /^FY\s*'?(\d{2}|(?:19|20)\d{2})$/i.exec(s);
  if (m) return m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  return null;
}

const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => sum(xs) / xs.length;

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Least-squares line through (x, y). Returns slope, intercept and R². */
export function linearFit(xs, ys) {
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
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept: my - slope * mx, r2 };
}

const isMostly = (cells, test, share = 0.6) => {
  const filled = cells.filter((c) => String(c ?? '').trim());
  return filled.length > 0 && filled.filter(test).length / filled.length >= share;
};

/** Trims a raw table to the size limits and normalises cell text. */
export function cleanTable(table) {
  const rows = (Array.isArray(table?.rows) ? table.rows : [])
    .slice(0, LIMITS.rows)
    .map((r) => (Array.isArray(r) ? r : []).slice(0, LIMITS.cols).map((c) => String(c ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.cell)))
    .filter((r) => r.some(Boolean));
  const width = Math.max(0, ...rows.map((r) => r.length));
  return {
    caption: String(table?.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    rows: rows.map((r) => [...r, ...Array(width - r.length).fill('')]),
  };
}

/** Splits a table into series, detecting whether years run across or down. */
export function toSeries({ rows }) {
  if (rows.length < 2 || rows[0].length < 2) return { orientation: 'none', series: [] };
  // Merge a second header row ("Seats" over "Gen | OBC") into the first: "Seats Gen".
  let header = rows[0];
  let start = 1;
  while (start < Math.min(rows.length - 1, 3)) {
    const next = rows[start].slice(1);
    if (!next.some(Boolean) || next.some((c) => c && (parseNumber(c) !== null || parseYear(c) !== null))) break;
    header = header.map((h, i) => (rows[start][i] && rows[start][i] !== h ? [h, rows[start][i]].filter(Boolean).join(' ') : h));
    start += 1;
  }
  const body = rows.slice(start);
  const numeric = (c) => parseNumber(c) !== null && parseYear(c) === null;

  // Years across the header: each body row is one series over time.
  const headYears = header.slice(1).map(parseYear);
  if (headYears.filter((y) => y !== null).length >= 2 && isMostly(header.slice(1), (c) => parseYear(c) !== null)) {
    const series = body.map((r) => ({
      name: r[0] || 'Row',
      points: headYears.map((x, i) => ({ x, label: header[i + 1], cell: r[i + 1] })).filter((p) => p.x !== null),
    }));
    return { orientation: 'years across', series };
  }

  // Years down the first column: each numeric column is one series over time.
  const colYears = body.map((r) => parseYear(r[0]));
  if (colYears.filter((y) => y !== null).length >= 3 && isMostly(body.map((r) => r[0]), (c) => parseYear(c) !== null)) {
    const series = [];
    for (let c = 1; c < header.length; c++) {
      if (!isMostly(body.map((r) => r[c]), numeric)) continue;
      series.push({
        name: header[c] || `Column ${c + 1}`,
        points: body.map((r, i) => ({ x: colYears[i], label: r[0], cell: r[c] })).filter((p) => p.x !== null),
      });
    }
    return { orientation: 'years down', series };
  }

  // No time axis: numeric columns compared across the categories in the first text column.
  const labelCol = [...header.keys()].find((c) => !isMostly(body.map((r) => r[c]), numeric)) ?? 0;
  const series = [];
  for (let c = 0; c < header.length; c++) {
    if (c === labelCol || !isMostly(body.map((r) => r[c]), numeric)) continue;
    series.push({ name: header[c] || `Column ${c + 1}`, points: body.map((r) => ({ x: null, label: r[labelCol], cell: r[c] })) });
  }
  return { orientation: 'categories', series };
}

/** Statistics for one series. Returns null when there is too little numeric data. */
export function seriesStats(name, rawPoints, timeAxis) {
  const parsed = rawPoints.map((p) => ({ ...p, num: parseNumber(p.cell) })).filter((p) => p.num);
  const units = [...new Set(parsed.map((p) => p.num.unit))];
  if (units.length > 1) return { name, skipped: `mixed units (${units.filter(Boolean).join(', ') || 'none'})` };
  if (parsed.length < 2) return null;

  const pts = timeAxis ? [...parsed].sort((a, b) => a.x - b.x) : parsed;
  const ys = pts.map((p) => p.num.value);
  const sorted = [...ys].sort((a, b) => a - b);
  const minP = pts[ys.indexOf(sorted[0])];
  const maxP = pts[ys.indexOf(sorted[sorted.length - 1])];
  const avg = mean(ys);
  const med = median(ys);
  const out = {
    name,
    unit: units[0] || undefined,
    n: ys.length,
    min: { value: sorted[0], at: minP.label },
    max: { value: sorted[sorted.length - 1], at: maxP.label },
    mean: round(avg),
    median: round(med),
  };
  if (ys.length >= 3) {
    const sd = Math.sqrt(sum(ys.map((y) => (y - avg) ** 2)) / (ys.length - 1));
    out.std_dev = round(sd);
    if (avg !== 0) out.coefficient_of_variation_pct = round((sd / Math.abs(avg)) * 100, 1);
    // Mean well above or below the median signals skew; then the median is the fairer centre.
    if (med !== 0 && Math.abs(avg - med) / Math.abs(med) > 0.15) out.skew = avg > med ? 'pulled up by high values; prefer the median' : 'pulled down by low values; prefer the median';
  }
  // Outliers only make sense across categories: in a trend the first and last values
  // always look extreme.
  if (!timeAxis && ys.length >= 5) {
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const outliers = pts.filter((p) => p.num.value < q1 - 1.5 * iqr || p.num.value > q3 + 1.5 * iqr);
    if (iqr > 0 && outliers.length) out.outliers = outliers.map((p) => ({ at: p.label, value: p.num.value }));
  }

  if (!timeAxis) {
    if (ys.every((y) => y >= 0) && sum(ys) > 0) {
      out.total = round(sum(ys));
      out.top_share_pct = round((sorted[sorted.length - 1] / sum(ys)) * 100, 1);
    }
    if (sorted[0] > 0) out.max_to_min_ratio = round(sorted[sorted.length - 1] / sorted[0]);
    return out;
  }

  const first = pts[0];
  const last = pts[pts.length - 1];
  const span = last.x - first.x;
  out.first = { year: first.label, value: first.num.value };
  out.last = { year: last.label, value: last.num.value };
  out.change = round(last.num.value - first.num.value);
  const isRate = units[0] === '%';
  // For a column that is already a percentage, report the change in percentage points;
  // a "% change of a percentage" and its CAGR mislead readers.
  if (isRate) out.change_unit = 'percentage points';
  else if (first.num.value !== 0) out.change_pct = round(((last.num.value - first.num.value) / Math.abs(first.num.value)) * 100, 1);
  if (!isRate && span >= 2 && first.num.value > 0 && last.num.value > 0) {
    out.cagr_pct = round(((last.num.value / first.num.value) ** (1 / span) - 1) * 100, 2);
  }
  out.latest_vs_median = round(last.num.value - med);

  const diffs = ys.slice(1).map((y, i) => y - ys[i]);
  const ups = diffs.filter((d) => d > 0).length;
  const downs = diffs.filter((d) => d < 0).length;
  out.direction = !downs && ups ? 'rose every period' : !ups && downs ? 'fell every period' : `mixed (${ups} rises, ${downs} falls)`;
  const bigIdx = diffs.reduce((b, d, i) => (Math.abs(d) > Math.abs(diffs[b]) ? i : b), 0);
  out.biggest_move = { from: pts[bigIdx].label, to: pts[bigIdx + 1].label, change: round(diffs[bigIdx]) };

  const xs = pts.map((p) => p.x);
  const fit = linearFit(xs, ys);
  if (fit) {
    out.trend_per_year = round(fit.slope);
    out.trend_r2 = round(fit.r2, 3);
    const steps = xs.slice(1).map((x, i) => x - xs[i]);
    const evenly = steps.every((s) => s === steps[0] && s > 0);
    let reason = '';
    if (ys.length < PROJECTION_MIN_POINTS) reason = `only ${ys.length} data points (needs ${PROJECTION_MIN_POINTS})`;
    else if (fit.r2 < PROJECTION_MIN_R2) reason = `trend not steady enough (R² ${round(fit.r2, 2)}, needs ${PROJECTION_MIN_R2})`;
    else if (!evenly) reason = 'years are not evenly spaced';
    if (!reason) {
      const nextX = last.x + steps[0];
      const value = fit.slope * nextX + fit.intercept;
      if (ys.every((y) => y >= 0) && value < 0) reason = 'a straight line would go below zero';
      else out.projection = { year: nextX, value: round(value), method: `straight-line fit over ${ys.length} points, R² ${round(fit.r2, 2)}; one period ahead only` };
    }
    if (reason) out.projection_not_allowed = reason;
  }
  return out;
}

/** Statistics for every table. Input: [{ caption, rows }] as read from the page. */
export function analyseTables(tables) {
  return (Array.isArray(tables) ? tables : []).slice(0, LIMITS.tables).map(cleanTable)
    .filter((t) => t.rows.length >= 2)
    .map((t, i) => {
      const { orientation, series } = toSeries(t);
      const timeAxis = orientation.startsWith('years');
      const stats = series.map((s) => seriesStats(s.name, s.points, timeAxis)).filter(Boolean);
      const result = { table: i + 1, caption: t.caption || undefined, orientation, series: stats };

      if (timeAxis) {
        // Which series moved most, and which moved in opposite directions.
        const moving = stats.filter((s) => s.change_pct != null);
        if (moving.length >= 2) {
          result.ranked_by_change_pct = [...moving].sort((a, b) => b.change_pct - a.change_pct)
            .map((s) => ({ name: s.name, change_pct: s.change_pct }));
          const up = moving.filter((s) => s.change > 0);
          const down = moving.filter((s) => s.change < 0);
          if (up.length && down.length) {
            result.opposite_directions = {
              rising: up.map((s) => s.name).slice(0, 5),
              falling: down.map((s) => s.name).slice(0, 5),
            };
          }
        }
      }
      return { table: t, stats: result };
    });
}

/** Renders a table as Markdown for the prompt. */
export function tableToMarkdown({ caption, rows }) {
  const esc = (c) => c.replace(/\|/g, '/');
  const lines = [`| ${rows[0].map(esc).join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.map(esc).join(' | ')} |`)];
  return `${caption ? `Caption: ${caption}\n` : ''}${lines.join('\n')}`;
}
