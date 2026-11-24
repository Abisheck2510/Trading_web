// Technical indicators. Every function returns an array aligned with its input
// (null where there is not yet enough history).

export function sma(values, period) {
  const out = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// EMA seeded with the SMA of the first `period` non-null values (skips leading nulls,
// so it can be applied to another indicator such as the MACD line).
export function ema(values, period) {
  const out = Array(values.length).fill(null);
  const start = values.findIndex((v) => v != null);
  if (start < 0 || values.length - start < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = start; i < start + period; i++) prev += values[i];
  prev /= period;
  out[start + period - 1] = prev;
  for (let i = start + period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder's RSI.
export function rsi(closes, period = 14) {
  const out = Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const val = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = val();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = val();
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const signal = ema(line, signalPeriod);
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist };
}

export function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = [];
  const lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] == null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / period);
    upper.push(mid[i] + mult * sd);
    lower.push(mid[i] - mult * sd);
  }
  return { mid, upper, lower };
}

// Wilder's Average True Range.
export function atr(candles, period = 14) {
  const out = Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close))
  );
  let prev = 0;
  for (let i = 1; i <= period; i++) prev += tr[i];
  prev /= period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

// VWAP. 'session' resets every trading day (intraday charts); 'rolling' uses the
// last `window` bars (daily/weekly charts, where a session VWAP is meaningless).
export function vwap(candles, mode = 'session', window = 20) {
  const out = [];
  if (mode === 'session') {
    let pv = 0;
    let vol = 0;
    let day = null;
    for (const c of candles) {
      if (c.day !== day) {
        pv = 0;
        vol = 0;
        day = c.day;
      }
      const tp = (c.high + c.low + c.close) / 3;
      pv += tp * c.volume;
      vol += c.volume;
      out.push(vol > 0 ? pv / vol : tp);
    }
    return out;
  }
  for (let i = 0; i < candles.length; i++) {
    if (i < window - 1) {
      out.push(null);
      continue;
    }
    let pv = 0;
    let vol = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const c = candles[j];
      pv += ((c.high + c.low + c.close) / 3) * c.volume;
      vol += c.volume;
    }
    out.push(vol > 0 ? pv / vol : candles[i].close);
  }
  return out;
}

// Support/resistance from swing pivots, clustered within half an ATR.
export function supportResistance(candles, atrNow, lookback = 150, k = 3) {
  const start = Math.max(k, candles.length - lookback);
  const pts = [];
  for (let i = start; i < candles.length - k; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].high > candles[i].high) isHigh = false;
      if (candles[j].low < candles[i].low) isLow = false;
    }
    if (isHigh) pts.push(candles[i].high);
    if (isLow) pts.push(candles[i].low);
  }
  pts.sort((a, b) => a - b);
  const tol = atrNow * 0.5;
  const clusters = [];
  for (const p of pts) {
    const last = clusters[clusters.length - 1];
    if (last && p - last.max <= tol) {
      last.sum += p;
      last.count += 1;
      last.max = p;
    } else clusters.push({ sum: p, count: 1, max: p });
  }
  return clusters.map((c) => ({ price: c.sum / c.count, touches: c.count }));
}

const PATTERN_NOTES = {
  'Bullish Engulfing': 'Potential upward reversal',
  'Bearish Engulfing': 'Potential downward reversal',
  Hammer: 'Potential bullish reversal',
  'Shooting Star': 'Potential bearish reversal',
  Doji: 'Market indecision',
  'Morning Star': 'Potential bullish reversal',
  'Evening Star': 'Potential bearish reversal',
};

// Candlestick patterns from the guide. Reversal patterns require the prior move
// they are meant to reverse.
export function detectPatterns(candles, from = 0) {
  const out = [];
  for (let i = Math.max(8, from); i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const pp = candles[i - 2];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low || 1e-9;
    const upper = c.high - Math.max(c.open, c.close);
    const lower = Math.min(c.open, c.close) - c.low;
    const pBody = Math.abs(p.close - p.open);
    const ppBody = Math.abs(pp.close - pp.open);
    const ppRange = pp.high - pp.low || 1e-9;
    const green = c.close > c.open;
    const red = c.close < c.open;
    const downBefore = candles[i - 1].close < candles[i - 6].close;
    const upBefore = candles[i - 1].close > candles[i - 6].close;
    const downBefore3 = candles[i - 3].close < candles[i - 8].close;
    const upBefore3 = candles[i - 3].close > candles[i - 8].close;
    const ppMid = (pp.open + pp.close) / 2;

    let name = null;
    let bias = 'neutral';
    if (pp.close < pp.open && ppBody > 0.5 * ppRange && pBody < 0.35 * ppBody && green && c.close > ppMid && downBefore3) {
      name = 'Morning Star';
      bias = 'bull';
    } else if (pp.close > pp.open && ppBody > 0.5 * ppRange && pBody < 0.35 * ppBody && red && c.close < ppMid && upBefore3) {
      name = 'Evening Star';
      bias = 'bear';
    } else if (p.close < p.open && green && c.open <= p.close && c.close >= p.open && body > pBody && downBefore) {
      name = 'Bullish Engulfing';
      bias = 'bull';
    } else if (p.close > p.open && red && c.open >= p.close && c.close <= p.open && body > pBody && upBefore) {
      name = 'Bearish Engulfing';
      bias = 'bear';
    } else if (body > 0.05 * range && lower >= 2 * body && upper <= Math.max(0.5 * body, 0.1 * range) && downBefore) {
      name = 'Hammer';
      bias = 'bull';
    } else if (body > 0.05 * range && upper >= 2 * body && lower <= Math.max(0.5 * body, 0.1 * range) && upBefore) {
      name = 'Shooting Star';
      bias = 'bear';
    } else if (body <= 0.1 * range) {
      name = 'Doji';
    }
    if (name) out.push({ i, name, bias, note: PATTERN_NOTES[name] });
  }
  return out;
}

// Average daily traded value (₹), used as the liquidity check.
export function avgDailyTurnover(candles, interval) {
  if (interval === '1wk' || interval === '1mo') {
    const per = interval === '1wk' ? 5 : 21;
    const recent = candles.slice(-10);
    return recent.reduce((s, c) => s + c.volume * c.close, 0) / recent.length / per;
  }
  const byDay = new Map();
  for (const c of candles) byDay.set(c.day, (byDay.get(c.day) || 0) + c.volume * c.close);
  const days = [...byDay.values()].slice(-20);
  return days.reduce((a, b) => a + b, 0) / (days.length || 1);
}

// Wilder's ADX with +DI / -DI (trend strength; DBS: trend following & momentum).
export function adx(candles, period = 14) {
  const n = candles.length;
  const out = { adx: Array(n).fill(null), plusDI: Array(n).fill(null), minusDI: Array(n).fill(null) };
  if (n <= 2 * period) return out;
  const dx = Array(n).fill(null);
  let trS = 0;
  let pS = 0;
  let mS = 0;
  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const up = c.high - p.high;
    const dn = p.low - c.low;
    const pdm = up > dn && up > 0 ? up : 0;
    const mdm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    if (i <= period) {
      trS += tr; pS += pdm; mS += mdm;
      if (i < period) continue;
    } else {
      trS = trS - trS / period + tr;
      pS = pS - pS / period + pdm;
      mS = mS - mS / period + mdm;
    }
    const P = trS ? (100 * pS) / trS : 0;
    const M = trS ? (100 * mS) / trS : 0;
    out.plusDI[i] = P;
    out.minusDI[i] = M;
    dx[i] = P + M ? (100 * Math.abs(P - M)) / (P + M) : 0;
  }
  let prev = 0;
  for (let i = period; i < 2 * period; i++) prev += dx[i];
  prev /= period;
  out.adx[2 * period - 1] = prev;
  for (let i = 2 * period; i < n; i++) {
    prev = (prev * (period - 1) + dx[i]) / period;
    out.adx[i] = prev;
  }
  return out;
}

// Slow stochastic %K / %D (StoneX: range & trend trading, overbought / oversold).
export function stochastic(candles, period = 14, smooth = 3) {
  const n = candles.length;
  const raw = Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hh = Math.max(hh, candles[j].high);
      ll = Math.min(ll, candles[j].low);
    }
    raw[i] = hh === ll ? 50 : (100 * (candles[i].close - ll)) / (hh - ll);
  }
  const avg = (arr, p) => arr.map((_, i) => {
    if (i < p - 1) return null;
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) { if (arr[j] == null) return null; s += arr[j]; }
    return s / p;
  });
  const k = avg(raw, smooth);
  return { k, d: avg(k, smooth) };
}

// Donchian channel of the PRIOR `period` bars (DBS: trend following).
export function donchian(candles, period = 20) {
  const n = candles.length;
  const upper = Array(n).fill(null);
  const lower = Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period; j < i; j++) {
      hh = Math.max(hh, candles[j].high);
      ll = Math.min(ll, candles[j].low);
    }
    upper[i] = hh;
    lower[i] = ll;
  }
  return { upper, lower };
}

// Regular RSI divergence between the last two swing points within `lookback` bars
// (DBS: reversal trading uses momentum divergence).
export function rsiDivergence(candles, R, lookback = 40, k = 3) {
  const n = candles.length;
  const lows = [];
  const highs = [];
  for (let i = Math.max(k, n - lookback); i < n - 1; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = i - k; j <= Math.min(n - 1, i + k); j++) {
      if (j === i) continue;
      if (candles[j].low < candles[i].low) isLow = false;
      if (candles[j].high > candles[i].high) isHigh = false;
    }
    if (isLow && R[i] != null) lows.push(i);
    if (isHigh && R[i] != null) highs.push(i);
  }
  const recent = (i) => i >= n - 12; // second swing must be recent to matter now
  if (lows.length >= 2) {
    const [a, b] = lows.slice(-2);
    if (recent(b) && candles[b].low < candles[a].low && R[b] > R[a] + 2) return { bias: 'bull', at: b, note: 'Price made a lower low but RSI made a higher low' };
  }
  if (highs.length >= 2) {
    const [a, b] = highs.slice(-2);
    if (recent(b) && candles[b].high > candles[a].high && R[b] < R[a] - 2) return { bias: 'bear', at: b, note: 'Price made a higher high but RSI made a lower high' };
  }
  return null;
}
