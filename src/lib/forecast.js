import { atr, ema, macd } from './indicators.js';

// Next-session outlook from daily bars.
//   - A trend-based ESTIMATE for the next close (not a guarantee), built from the
//     stock's own trend and the broad market trend.
//   - The range the stock usually moves in one day (volatility).
//   - Classic floor pivots for the next session.
//   - A walk-forward test of the same estimate over recent sessions, so the
//     user can see how reliable it has actually been for this stock.

const MAX_PULL = 0.75; // the estimate never moves more than 0.75 × a typical day

function logSigma(closes, j, len = 20) {
  if (j - len < 0) return null;
  const rets = [];
  for (let k = j - len + 1; k <= j; k++) rets.push(Math.log(closes[k] / closes[k - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1));
}

// Slope of a least-squares line through ln(close) over the last `len` bars (per bar).
function logSlope(closes, j, len = 20) {
  if (j - len + 1 < 0) return null;
  let sx = 0; let sy = 0; let sxy = 0; let sxx = 0;
  for (let k = 0; k < len; k++) {
    const y = Math.log(closes[j - len + 1 + k]);
    sx += k; sy += y; sxy += k * y; sxx += k * k;
  }
  return (len * sxy - sx * sy) / (len * sxx - sx * sx);
}

// Expected log return for the bar after index j, using only data up to j.
function model(ind, j, marketDir = 0) {
  const { closes, e20, e50, M } = ind;
  const sigma = logSigma(closes, j);
  const slope = logSlope(closes, j);
  if (sigma == null || slope == null || e50[j] == null || M.hist[j] == null) return null;
  const align = e20[j] > e50[j] && closes[j] > e20[j] ? 1 : e20[j] < e50[j] && closes[j] < e20[j] ? -1 : 0;
  const mom = Math.sign(M.hist[j]);
  const parts = {
    trend: 0.5 * slope, // half of the recent daily trend tends to carry over
    align: 0.15 * sigma * align, // price and averages lined up
    momentum: 0.1 * sigma * mom, // MACD histogram direction
    market: 0.1 * sigma * marketDir, // NIFTY 50 trend
  };
  let mu = parts.trend + parts.align + parts.momentum + parts.market;
  mu = Math.max(-MAX_PULL * sigma, Math.min(MAX_PULL * sigma, mu));
  return { mu, sigma, slope, align, mom, parts };
}

export function nextSession(daily, market = null) {
  if (!daily || daily.length < 60) return null;
  const n = daily.length;
  const last = daily[n - 1];
  const close = last.close;
  const closes = daily.map((c) => c.close);
  const ind = { closes, e20: ema(closes, 20), e50: ema(closes, 50), M: macd(closes) };

  const marketDir = market?.nifty ? (market.nifty.above20 ? 1 : -1) : 0;
  const m = model(ind, n - 1, marketDir);
  if (!m) return null;
  const sigma = m.sigma;

  const estimate = close * Math.exp(m.mu);
  const estPct = (Math.exp(m.mu) - 1) * 100;
  const strength = Math.abs(m.mu) / sigma; // 0 … 0.75
  const bias = strength < 0.1 ? 'flat' : m.mu > 0 ? 'up' : 'down';

  // Walk-forward test: for each of the last 60 sessions, estimate the next close
  // using only the data available that day, then compare with what happened.
  // (The market term is left out here because past NIFTY readings aren't loaded.)
  let tested = 0; let dirHits = 0; let dirCalls = 0; let inside = 0; let absErr = 0; let naiveErr = 0;
  for (let j = Math.max(55, n - 61); j < n - 1; j++) {
    const t = model(ind, j, 0);
    if (!t) continue;
    const actual = Math.log(closes[j + 1] / closes[j]);
    tested++;
    if (Math.abs(t.mu) / t.sigma >= 0.1) {
      dirCalls++;
      if (Math.sign(actual) === Math.sign(t.mu)) dirHits++;
    }
    if (Math.abs(actual - t.mu) <= t.sigma) inside++;
    absErr += Math.abs(Math.exp(actual) - Math.exp(t.mu)) * 100;
    naiveErr += Math.abs(Math.exp(actual) - 1) * 100;
  }
  const backtest = tested ? {
    sessions: tested,
    dirCalls,
    dirHitPct: dirCalls ? (dirHits / dirCalls) * 100 : null,
    insidePct: (inside / tested) * 100,
    avgMissPct: absErr / tested,
    naiveMissPct: naiveErr / tested,
  } : null;

  const A = atr(daily, 14);
  const atrNow = A[n - 1] ?? last.high - last.low;
  const P = (last.high + last.low + close) / 3;
  const pivots = { R2: P + (last.high - last.low), R1: 2 * P - last.low, P, S1: 2 * P - last.high, S2: P - (last.high - last.low) };

  let ups = 0;
  for (let k = n - 20; k < n; k++) if (daily[k].close > daily[k - 1].close) ups++;

  const basis = new Date(last.time * 1000);
  const next = new Date(basis);
  do next.setUTCDate(next.getUTCDate() + 1); while (next.getUTCDay() === 0 || next.getUTCDay() === 6);

  return {
    close,
    basisDay: basis.toISOString().slice(0, 10),
    nextDay: next,
    estimate,
    estPct,
    bias,
    strength,
    drivers: {
      trendPct: (Math.exp(m.slope) - 1) * 100,
      align: m.align,
      momentum: m.mom,
      market: marketDir,
    },
    backtest,
    sigmaPct: sigma * 100,
    range68: [estimate * Math.exp(-sigma), estimate * Math.exp(sigma)],
    range95: [estimate * Math.exp(-1.96 * sigma), estimate * Math.exp(1.96 * sigma)],
    atr: atrNow,
    pivots,
    upDays: ups,
  };
}
