import { analyze } from './analysis.js';
import { fetchChart } from './data.js';

// Walk-forward backtest of the app's own BUY / SELL verdicts.
// At every bar the analysis sees only the bars up to that point (same window size
// as the live view). A BUY opens a long and a SELL opens a short at the NEXT bar's
// open, with the plan's stop and target. One position at a time.
export const BT_CONFIG = {
  intraday: { interval: '5m', range: '60d', htf: { interval: '15m', range: '60d' }, window: 375, maxHold: null, span: 'last 60 days', holdNote: 'closed by the end of the day' },
  swing: { interval: '1d', range: '5y', htf: { interval: '1wk', range: '10y' }, window: 250, maxHold: 20, span: 'last 5 years', holdNote: 'max 20 trading days' },
  positional: { interval: '1wk', range: 'max', htf: { interval: '1mo', range: 'max' }, window: 260, maxHold: 26, span: 'full history', holdNote: 'max 26 weeks' },
};

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

function simulate(candles, t, a, cfg, intraday) {
  const n = candles.length;
  const long = a.verdict === 'BUY';
  const { stop, target } = a.plan;
  const e = t + 1;
  const entry = candles[e].open;
  // The next open already went through the stop or target: no trade.
  if (long ? entry <= stop || entry >= target : entry >= stop || entry <= target) return null;
  const risk = Math.abs(entry - stop);
  let exit = null;
  let why = null;
  let j = e;
  for (; j < n; j++) {
    const b = candles[j];
    if (j > e) {
      if (long ? b.open <= stop : b.open >= stop) { exit = b.open; why = 'Stop (gap)'; break; }
      if (long ? b.open >= target : b.open <= target) { exit = b.open; why = 'Target (gap)'; break; }
    }
    const hitStop = long ? b.low <= stop : b.high >= stop;
    const hitTarget = long ? b.high >= target : b.low <= target;
    if (hitStop) { exit = stop; why = 'Stop'; break; } // if both in one bar, assume the stop came first
    if (hitTarget) { exit = target; why = 'Target'; break; }
    if (cfg.maxHold && j - e + 1 >= cfg.maxHold) { exit = b.close; why = 'Time limit'; break; }
    if (intraday && (j === n - 1 || candles[j + 1].day !== b.day)) { exit = b.close; why = 'End of day'; break; }
  }
  const open = exit == null;
  if (open) { j = n - 1; exit = candles[j].close; why = 'Still open'; }
  return { side: long ? 'BUY' : 'SELL', t, e, x: j, entry, exit, stop, target, risk, why, open, score: a.score, strategy: a.strategy?.name || null };
}

export async function runBacktest(symbol, style, settings, { onProgress, isCancelled } = {}) {
  const cfg = BT_CONFIG[style];
  const intraday = style === 'intraday';
  const [main, htfRes] = await Promise.all([
    fetchChart(symbol, cfg.interval, cfg.range),
    fetchChart(symbol, cfg.htf.interval, cfg.htf.range).catch(() => null),
  ]);
  const candles = main.candles;
  const htf = htfRes?.candles || [];
  const n = candles.length;
  if (n < cfg.window + 20) throw new Error(`Only ${n} bars of history: need at least ${cfg.window + 20} to backtest`);

  // Only use higher-timeframe bars that had fully closed at each point (no look-ahead).
  const htfPeriod = htf.length > 2 ? median(htf.slice(1).map((b, k) => b.time - htf[k].time)) : 0;
  let hp = 0;

  const trades = [];
  const charges = (Number(settings.chargesPct) || 0) / 100;
  let t = cfg.window - 1;
  let tick = 0;
  while (t < n - 1) {
    if (++tick % 20 === 0) {
      onProgress?.(t - cfg.window + 1, n - cfg.window);
      await new Promise((r) => setTimeout(r, 0));
      if (isCancelled?.()) return null;
    }
    const slice = candles.slice(t - cfg.window + 1, t + 1);
    const now = candles[t].time;
    while (hp < htf.length && htf[hp].time + htfPeriod <= now) hp++;
    const hSlice = htf.slice(Math.max(0, hp - 300), hp);
    let a;
    try {
      a = analyze(slice, { style, htf: hSlice.length >= 25 ? hSlice : null, market: null, settings });
    } catch {
      t++;
      continue;
    }
    if (a.verdict === 'AVOID') { t++; continue; }
    const tr = simulate(candles, t, a, cfg, intraday);
    if (!tr) { t++; continue; }
    const dir = tr.side === 'BUY' ? 1 : -1;
    const gross = (dir * (tr.exit - tr.entry)) / tr.entry;
    tr.retPct = (gross - 2 * charges) * 100;
    tr.r = (dir * (tr.exit - tr.entry) - 2 * charges * tr.entry) / tr.risk;
    tr.inTime = candles[tr.e].time;
    tr.outTime = candles[tr.x].time;
    tr.bars = tr.x - tr.e + 1;
    trades.push(tr);
    if (tr.open) break;
    t = tr.x; // next signal can come from the exit bar's close
  }
  onProgress?.(n - cfg.window, n - cfg.window);

  const closed = trades.filter((x) => !x.open);
  const riskPct = Number(settings.riskPct) || 1;
  const stats = (list) => {
    const wins = list.filter((x) => x.r > 0);
    const losses = list.filter((x) => x.r <= 0);
    const sumW = wins.reduce((s, x) => s + x.r, 0);
    const sumL = -losses.reduce((s, x) => s + x.r, 0);
    return {
      trades: list.length,
      wins: wins.length,
      winRate: list.length ? (wins.length / list.length) * 100 : null,
      avgR: list.length ? list.reduce((s, x) => s + x.r, 0) / list.length : null,
      avgRet: list.length ? list.reduce((s, x) => s + x.retPct, 0) / list.length : null,
      avgWinR: wins.length ? sumW / wins.length : null,
      avgLossR: losses.length ? -sumL / losses.length : null,
      profitFactor: sumL > 0 ? sumW / sumL : wins.length ? Infinity : null,
      avgBars: list.length ? list.reduce((s, x) => s + x.bars, 0) / list.length : null,
    };
  };

  // Equity if each trade risks `riskPct`% of capital (the app's position sizing).
  let eq = 100;
  let peak = 100;
  let maxDD = 0;
  const startTime = candles[cfg.window - 1].time;
  const curve = [{ time: startTime, value: 0 }];
  for (const x of closed) {
    eq *= 1 + (x.r * riskPct) / 100;
    peak = Math.max(peak, eq);
    maxDD = Math.max(maxDD, ((peak - eq) / peak) * 100);
    curve.push({ time: x.outTime, value: eq - 100 });
  }
  const reasons = {};
  for (const x of closed) reasons[x.why] = (reasons[x.why] || 0) + 1;
  const startPrice = candles[cfg.window - 1].close;
  const endPrice = candles[n - 1].close;

  return {
    symbol,
    style,
    span: cfg.span,
    holdNote: cfg.holdNote,
    from: startTime,
    to: candles[n - 1].time,
    barsTested: n - cfg.window,
    all: stats(closed),
    buy: stats(closed.filter((x) => x.side === 'BUY')),
    sell: stats(closed.filter((x) => x.side === 'SELL')),
    totalReturn: eq - 100,
    maxDD,
    riskPct,
    buyHold: ((endPrice - startPrice) / startPrice) * 100,
    reasons,
    curve,
    trades,
  };
}
