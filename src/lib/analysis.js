import {
  ema, sma, rsi, macd, bollinger, atr, vwap, supportResistance, detectPatterns, avgDailyTurnover,
  adx, stochastic, donchian, rsiDivergence,
} from './indicators.js';
import { evaluateStrategies, marketRegime } from './strategies.js';

export const STYLES = {
  intraday: {
    label: 'Intraday', interval: '5m', range: '5d', vwapMode: 'session',
    htf: { interval: '15m', range: '1mo', label: '15-min' },
    desc: '5-min entry chart, 15-min trend',
  },
  swing: {
    label: 'Swing (2–15 days)', interval: '1d', range: '1y', vwapMode: 'rolling',
    htf: { interval: '1wk', range: '5y', label: 'Weekly' },
    desc: 'Daily chart, weekly major trend',
  },
  positional: {
    label: 'Positional (weeks–months)', interval: '1wk', range: '5y', vwapMode: 'rolling',
    htf: { interval: '1mo', range: 'max', label: 'Monthly' },
    desc: 'Weekly chart, monthly major trend',
  },
};

export const DEFAULT_SETTINGS = { capital: 100000, riskPct: 1, minRR: 2, threshold: 4, chargesPct: 0.1 };

export const FUND_FIELDS = [
  { key: 'pe', label: 'P/E ratio' },
  { key: 'sectorPe', label: 'Sector / industry P/E' },
  { key: 'revGrowth', label: 'Revenue growth % YoY' },
  { key: 'profitGrowth', label: 'Profit growth % YoY' },
  { key: 'epsGrowth', label: 'EPS growth % YoY' },
  { key: 'de', label: 'Debt / Equity' },
  { key: 'roe', label: 'ROE %' },
  { key: 'roce', label: 'ROCE %' },
];

const f = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const num = (v) => (v === '' || v == null ? null : Number(v));

export function fundamentalChecks(fund = {}) {
  const pe = num(fund.pe);
  const sectorPe = num(fund.sectorPe);
  const rules = [
    { label: 'P/E at or below sector P/E', ok: pe != null && sectorPe != null ? pe <= sectorPe * 1.1 : null },
    { label: 'Revenue growth ≥ 10%', ok: num(fund.revGrowth) != null ? num(fund.revGrowth) >= 10 : null },
    { label: 'Profit growth ≥ 10%', ok: num(fund.profitGrowth) != null ? num(fund.profitGrowth) >= 10 : null },
    { label: 'EPS growth ≥ 10%', ok: num(fund.epsGrowth) != null ? num(fund.epsGrowth) >= 10 : null },
    { label: 'Debt / Equity ≤ 1', ok: num(fund.de) != null ? num(fund.de) <= 1 : null },
    { label: 'ROE ≥ 15%', ok: num(fund.roe) != null ? num(fund.roe) >= 15 : null },
    { label: 'ROCE ≥ 15%', ok: num(fund.roce) != null ? num(fund.roce) >= 15 : null },
  ];
  const rated = rules.filter((r) => r.ok != null);
  const pass = rated.filter((r) => r.ok).length;
  const fail = rated.length - pass;
  return { rules, count: rated.length, pass, fail, score: Math.max(-1, Math.min(1, (pass - fail) * 0.25)) };
}

// Simple trend read used for the higher timeframe and the indices.
export function trendOf(candles) {
  const closes = candles.map((c) => c.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const i = closes.length - 1;
  const p = closes[i];
  if (e20[i] == null) return { score: 0, label: 'n/a', note: 'Not enough history' };
  const slow = e50[i] ?? e20[i];
  if (p > e20[i] && e20[i] >= slow) return { score: 1, label: 'Uptrend', note: 'Price above rising averages on the bigger chart' };
  if (p < e20[i] && e20[i] <= slow) return { score: -1, label: 'Downtrend', note: 'Price below falling averages on the bigger chart' };
  return { score: 0, label: 'Mixed', note: 'No clear trend on the bigger chart' };
}

function recentCross(a, b, i, bars) {
  for (let k = 0; k < bars && i - k - 1 >= 0; k++) {
    const x = i - k;
    if (a[x] == null || b[x] == null || a[x - 1] == null || b[x - 1] == null) return null;
    if (Math.sign(a[x] - b[x]) !== Math.sign(a[x - 1] - b[x - 1])) return k;
  }
  return null;
}

const ago = (k) => (k === 0 ? 'on the last bar' : `${k} bar${k > 1 ? 's' : ''} ago`);

export function analyze(candles, { style = 'swing', htf = null, market = null, fundamentals = null, settings = DEFAULT_SETTINGS } = {}) {
  const S = STYLES[style];
  const n = candles.length;
  if (n < 30) throw new Error('Not enough price history to analyse (need at least 30 bars).');
  const i = n - 1;
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  const e9 = ema(closes, 9);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const R = rsi(closes, 14);
  const M = macd(closes);
  const BB = bollinger(closes);
  const A = atr(candles, 14);
  const VW = vwap(candles, S.vwapMode, 20);
  const vAvg = sma(vols, 20);
  const s50 = sma(closes, 50);
  const s200 = sma(closes, 200);
  const ADX = adx(candles, 14);
  const ST = stochastic(candles, 14, 3);
  const DON = donchian(candles, 20);
  const regime = marketRegime(ADX, n - 1);

  const last = candles[i];
  const price = last.close;
  const atrNow = A[i] ?? price * 0.02;
  const signals = [];
  const add = (group, name, value, score, note) => signals.push({ group, name, value, score, note });

  // ---- Trend ----
  if (e200[i] != null) {
    const up = price > e200[i];
    add('Trend', 'Price vs EMA 200', `${f(price)} vs ${f(e200[i])}`, up ? 1 : -1, up ? 'Longer-term bullish bias' : 'Longer-term bearish bias');
  } else add('Trend', 'Price vs EMA 200', 'n/a', 0, 'Not enough history for EMA 200');

  if (e50[i] != null) {
    const a20 = price > e20[i];
    const a50 = price > e50[i];
    add('Trend', 'Price vs EMA 20 / 50', `${a20 ? 'above' : 'below'} / ${a50 ? 'above' : 'below'}`,
      a20 && a50 ? 1 : !a20 && !a50 ? -1 : 0,
      a20 && a50 ? 'Short- and medium-term uptrend' : !a20 && !a50 ? 'Short- and medium-term downtrend' : 'Mixed – price between the averages');
    const bull = e20[i] > e50[i];
    const k = recentCross(e20, e50, i, 5);
    add('Trend', 'EMA 20 × EMA 50', bull ? '20 above 50' : '20 below 50', (bull ? 1 : -1) * (k != null ? 2 : 1),
      k != null ? `Fresh ${bull ? 'bullish' : 'bearish'} crossover ${ago(k)}` : bull ? 'Bullish alignment' : 'Bearish alignment');
  }

  if (s200[i] != null) {
    const golden = s50[i] > s200[i];
    const k = recentCross(s50, s200, i, 10);
    add('Trend', '50 MA × 200 MA', golden ? 'Golden (50 above 200)' : 'Death (50 below 200)', (golden ? 1 : -1) * (k != null ? 1 : 0.5),
      k != null ? `Fresh ${golden ? 'golden' : 'death'} cross ${ago(k)} (DBS trend-following trigger)` : golden ? 'Long-term uptrend structure' : 'Long-term downtrend structure');
  }
  if (regime.adx != null) {
    add('Trend', 'ADX (14) trend strength', `${f(regime.adx, 0)} · +DI ${f(ADX.plusDI[i], 0)} / −DI ${f(ADX.minusDI[i], 0)}`, 0,
      regime.key === 'trend' ? `Strong ${regime.dir}trend` : regime.key === 'range' ? 'No trend: sideways market' : `Trend forming ${regime.dir}${regime.rising ? ', strengthening' : ''}`);
  }

  let htfTrend = null;
  if (htf && htf.length >= 25) {
    htfTrend = trendOf(htf);
    add('Trend', `Higher timeframe (${S.htf.label})`, htfTrend.label, htfTrend.score, htfTrend.note);
  } else add('Trend', `Higher timeframe (${S.htf.label})`, 'n/a', 0, 'Higher-timeframe data unavailable');

  // ---- Momentum ----
  const r = R[i];
  if (r != null) {
    let sc = 0;
    let note;
    if (r > 70) note = 'Overbought – momentum is strong but chasing is risky';
    else if (r < 30) note = 'Oversold – can keep falling, but shorting here is risky';
    else if (Math.abs(r - 50) < 2) note = 'Neutral';
    else if (r > 50) { sc = 1; note = 'Positive momentum (50–70)'; }
    else { sc = -1; note = 'Negative momentum (30–50)'; }
    add('Momentum', 'RSI (14)', f(r, 1), sc, note);
  }

  const ml = M.line[i];
  const ms = M.signal[i];
  if (ml != null && ms != null) {
    const bull = ml > ms;
    const k = recentCross(M.line, M.signal, i, 3);
    add('Momentum', 'MACD (12, 26, 9)', `${f(ml)} / ${f(ms)}`, (bull ? 1 : -1) * (k != null ? 1.5 : 1),
      k != null ? `${bull ? 'Bullish' : 'Bearish'} crossover ${ago(k)}` : bull ? 'MACD above signal line' : 'MACD below signal line');
    if (M.hist[i - 1] != null) {
      const rising = M.hist[i] > M.hist[i - 1];
      add('Momentum', 'MACD histogram', rising ? 'Rising' : 'Falling', rising ? 0.5 : -0.5, rising ? 'Bullish momentum building' : 'Bearish momentum building');
    }
  }

  if (VW[i] != null) {
    const above = price > VW[i];
    add('Momentum', S.vwapMode === 'session' ? 'VWAP (session)' : 'VWAP (20-bar)', f(VW[i]), above ? 1 : -1,
      above ? 'Price above VWAP – buyers in control' : 'Price below VWAP – sellers in control');
  }

  if (ST.k[i] != null) {
    const K = ST.k[i];
    add('Momentum', 'Stochastic (14, 3)', `${f(K, 0)} / ${f(ST.d[i], 0)}`, 0,
      K > 80 ? 'Overbought zone' : K < 20 ? 'Oversold zone' : K > ST.d[i] ? '%K above %D: rising' : '%K below %D: falling');
  }

  // ---- Volume ----
  const vr = vAvg[i] ? last.volume / vAvg[i] : null;
  const green = last.close >= last.open;
  if (vr != null) {
    let sc = 0;
    let note = 'Normal volume';
    if (vr >= 1.5) { sc = green ? 1 : -1; note = `Volume spike confirms ${green ? 'buying' : 'selling'}`; }
    else if (vr < 0.7) note = 'Below-average volume – weak conviction';
    add('Volume', 'Volume vs 20-bar average', `${f(vr, 2)}×`, sc, note);
  }
  const turnover = avgDailyTurnover(candles, S.interval);
  add('Volume', 'Avg daily turnover', `₹${f(turnover / 1e7, 1)} Cr`, 0,
    turnover < 1e7 ? 'Illiquid – wide spreads, avoid' : turnover < 1e8 ? 'Moderate liquidity' : 'Good liquidity');

  // ---- Structure ----
  const lv = supportResistance(candles, atrNow);
  const supports = lv.filter((l) => l.price < price - 0.1 * atrNow).sort((a, b) => b.price - a.price);
  const resistances = lv.filter((l) => l.price > price + 0.1 * atrNow).sort((a, b) => a.price - b.price);
  const prior = candles.slice(Math.max(0, n - 21), n - 1);
  const hh = Math.max(...prior.map((c) => c.high));
  const ll = Math.min(...prior.map((c) => c.low));
  const strongVol = vr != null && vr >= 1.5;
  let breakout = 0;
  if (price > hh) {
    breakout = 1;
    add('Structure', 'Breakout above 20-bar high', f(hh), strongVol ? 1.5 : 0.5,
      strongVol ? 'Breakout above resistance with strong volume' : 'Breakout on weak volume – watch for a failed breakout / retest');
  } else if (price < ll) {
    breakout = -1;
    add('Structure', 'Breakdown below 20-bar low', f(ll), strongVol ? -1.5 : -0.5,
      strongVol ? 'Breakdown below support with strong volume' : 'Breakdown on weak volume – may reverse');
  } else add('Structure', '20-bar range', `${f(ll)} – ${f(hh)}`, 0, 'Inside the range – no breakout yet');

  const s1 = supports[0]?.price;
  const r1 = resistances[0]?.price;
  add('Structure', 'Nearest support / resistance', `${f(s1)} / ${f(r1)}`, 0,
    r1 ? `Resistance is ${f((r1 - price) / atrNow, 1)} ATR away` : 'No resistance overhead in the lookback (blue sky)');

  if (BB.upper[i] != null) {
    const pb = (price - BB.lower[i]) / (BB.upper[i] - BB.lower[i] || 1e-9);
    add('Volatility', 'Bollinger %B (20, 2)', `${f(pb * 100, 0)}%`, 0,
      pb > 1 ? 'Closed above the upper band – stretched' : pb < 0 ? 'Closed below the lower band – stretched' : pb > 0.5 ? 'Upper half of the bands' : 'Lower half of the bands');
  }
  add('Volatility', 'ATR (14)', f(atrNow), 0, `${f((atrNow / price) * 100, 2)}% of price per bar`);

  // ---- Price action ----
  const patterns = detectPatterns(candles, n - 80);
  const lastPat = patterns.filter((p) => p.i >= n - 2).pop();
  if (lastPat) add('Price action', 'Candlestick pattern', lastPat.name, lastPat.bias === 'bull' ? 1 : lastPat.bias === 'bear' ? -1 : 0, `${lastPat.note} – confirm with volume and S/R`);
  else add('Price action', 'Candlestick pattern', 'None', 0, 'No significant pattern on the last 2 bars');

  // ---- Market sentiment ----
  if (market?.nifty) {
    const up = market.nifty.above20;
    add('Market', 'NIFTY 50 vs EMA 20', up ? 'Above' : 'Below', up ? 0.5 : -0.5, up ? 'Broad market supportive' : 'Broad market weak');
  }
  if (market?.banknifty) add('Market', 'BANK NIFTY vs EMA 20', market.banknifty.above20 ? 'Above' : 'Below', 0, 'Context only');
  const vix = market?.vix?.last;
  if (vix != null) add('Market', 'India VIX', f(vix), 0, vix > 20 ? 'High fear – stronger confirmation required' : vix < 14 ? 'Calm market' : 'Normal volatility');

  // ---- Fundamentals (optional, user-entered) ----
  const fc = fundamentalChecks(fundamentals || {});
  if (fc.count > 0) add('Fundamentals', 'Fundamental checks', `${fc.pass}/${fc.count} pass`, fc.score, fc.score > 0 ? 'Fundamentals support the stock' : fc.score < 0 ? 'Weak fundamentals' : 'Mixed fundamentals');

  // ---- Strategy setups (DBS & StoneX guides) ----
  const div = rsiDivergence(candles, R);
  const strat = evaluateStrategies({
    candles, i, price, atrNow, regime, e20, e50, s50, s200, R, M, BB, vr, vAvg, s1, r1,
    don: DON, stoch: ST, div, lastPat, ADX, intraday: S.interval.endsWith('m'),
  });
  const active = strat.list.filter((x) => x.signal && x.counted);
  add('Strategy', 'Strategy confluence', active.length ? active.map((x) => `${x.name} ${x.signal === 'long' ? '↑' : '↓'}`).join(', ') : 'No active setup', strat.score,
    active.length ? `${active.length} setup${active.length > 1 ? 's' : ''} that suit a ${regime.label.toLowerCase()} market` : 'None of the guide strategies has a valid setup now');

  // In a sideways market trend-following signals are unreliable (both guides): halve them.
  if (regime.key === 'range') {
    for (const sg of signals) if (sg.group === 'Trend' && sg.score !== 0) { sg.score /= 2; sg.note += ' (halved: sideways market)'; }
  }

  // ---- Score & verdict ----
  const score = Math.round(signals.reduce((s, x) => s + x.score, 0) * 10) / 10;
  let threshold = Number(settings.threshold) || 4;
  const reasons = [];
  if (vix != null && vix > 20) {
    threshold += 1;
    reasons.push(`India VIX ${f(vix)} is elevated – threshold raised to ±${threshold}`);
  }
  let verdict = score >= threshold ? 'BUY' : score <= -threshold ? 'SELL' : 'AVOID';
  const dir = verdict === 'SELL' || (verdict === 'AVOID' && score < 0) ? 'short' : 'long';

  const want = dir === 'long' ? 'long' : 'short';
  const best = strat.list
    .filter((x) => x.signal === want && x.counted)
    .sort((a, b) => b.strength * (b.fit === 'suited' ? 2 : 1) - a.strength * (a.fit === 'suited' ? 2 : 1))[0] || null;

  // ---- Risk plan (stop below support / above resistance, else 1.5 ATR) ----
  let stop;
  let target;
  let targetNote;
  if (dir === 'long') {
    stop = s1 != null && price - s1 <= 3 * atrNow ? s1 - 0.25 * atrNow : price - 1.5 * atrNow;
    if (best?.key === 'breakout' && best.level != null) stop = best.level - 0.25 * atrNow; // StoneX: just below the breakout level
    stop = Math.min(stop, price - atrNow); // never tighter than 1 ATR (noise)
    const risk = price - stop;
    const res = resistances.find((x) => x.price > price + 0.3 * atrNow);
    if (res) { target = res.price; targetNote = 'Next resistance'; }
    else { target = price + 3 * risk; targetNote = '3R projection (no resistance overhead)'; }
  } else {
    stop = r1 != null && r1 - price <= 3 * atrNow ? r1 + 0.25 * atrNow : price + 1.5 * atrNow;
    if (best?.key === 'breakout' && best.level != null) stop = best.level + 0.25 * atrNow;
    stop = Math.max(stop, price + atrNow);
    const risk = stop - price;
    const sup = supports.find((x) => x.price < price - 0.3 * atrNow);
    if (sup) { target = sup.price; targetNote = 'Next support'; }
    else { target = price - 3 * risk; targetNote = '3R projection (no support below)'; }
  }
  // Trailing stop (StoneX: trend trading): 3 ATR from the highest high / lowest low of the last 22 bars.
  const recent22 = candles.slice(Math.max(0, n - 22));
  const trail = dir === 'long'
    ? Math.max(...recent22.map((b) => b.high)) - 3 * atrNow
    : Math.min(...recent22.map((b) => b.low)) + 3 * atrNow;
  const riskPS = Math.abs(price - stop);
  const rewardPS = Math.abs(target - price);
  const rr = riskPS > 0 ? rewardPS / riskPS : 0;
  const capital = Number(settings.capital) || 0;
  const riskAmt = (capital * (Number(settings.riskPct) || 0)) / 100;
  const qtyByRisk = riskPS > 0 ? Math.floor(riskAmt / riskPS) : 0;
  const qty = Math.max(0, Math.min(qtyByRisk, Math.floor(capital / price)));
  const charges = qty * price * ((Number(settings.chargesPct) || 0) / 100) * 2;
  const plan = {
    dir, entry: price, stop, target, targetNote, trail, exitRule: best?.rule || null, stopNote: best?.key === 'breakout' ? 'Just below the breakout level (StoneX)' : null, riskPS, rewardPS, rr, qty,
    cappedByCapital: qty < qtyByRisk, riskAmt,
    capitalUsed: qty * price, maxLoss: qty * riskPS + charges, profit: qty * rewardPS - charges, charges,
  };

  // ---- Safety gates that turn a BUY/SELL into AVOID ----
  const minRR = Number(settings.minRR) || 0;
  if (verdict !== 'AVOID') {
    if (turnover < 1e7) { verdict = 'AVOID'; reasons.push('Illiquid stock (turnover < ₹1 Cr/day)'); }
    else if (rr < minRR) { verdict = 'AVOID'; reasons.push(`Reward:risk 1:${f(rr, 1)} is below your minimum 1:${minRR} – ${dir === 'long' ? 'resistance' : 'support'} is too close`); }
    else if (verdict === 'BUY' && r != null && r > 75) { verdict = 'AVOID'; reasons.push(`RSI ${f(r, 0)} – overextended, wait for a pullback`); }
    else if (verdict === 'SELL' && r != null && r < 25) { verdict = 'AVOID'; reasons.push(`RSI ${f(r, 0)} – deeply oversold, bounce risk`); }
    else if (!best) { verdict = 'AVOID'; reasons.push(`Score leans ${dir === 'long' ? 'bullish' : 'bearish'}, but no guide strategy (trend, momentum, breakout, pullback, range…) gives an entry trigger right now – wait for a setup`); }
  }
  if (verdict === 'AVOID' && Math.abs(score) < threshold) reasons.push(`Score ${score > 0 ? '+' : ''}${score} has not reached ±${threshold} – signals are not aligned`);

  const drivers = signals
    .filter((s) => (verdict === 'SELL' || dir === 'short' ? s.score < 0 : s.score > 0))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 4);
  const against = signals
    .filter((s) => (dir === 'short' ? s.score > 0 : s.score < 0))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 3);

  // ---- The guide's 10-step pre-trade workflow ----
  const L = dir === 'long';
  const st = (cond) => (cond == null ? 'na' : cond ? 'pass' : 'fail');
  const checklist = [
    { label: 'NIFTY 50 / market direction', status: market?.nifty ? st(L === market.nifty.above20) : 'na' },
    { label: 'Good liquidity & volume', status: turnover >= 1e8 ? 'pass' : turnover >= 1e7 ? 'warn' : 'fail' },
    { label: `Chart trend (${S.interval} + ${S.htf.label})`, status: st(e50[i] != null ? (L ? price > e50[i] : price < e50[i]) && (!htfTrend || htfTrend.score !== (L ? -1 : 1)) : null) },
    { label: 'Support & resistance marked', status: st(supports.length + resistances.length > 0) },
    { label: 'EMA 20 / 50 / 200 aligned', status: e200[i] == null ? 'na' : (L ? e20[i] > e50[i] && e50[i] > e200[i] : e20[i] < e50[i] && e50[i] < e200[i]) ? 'pass' : 'warn' },
    { label: 'RSI & MACD agree', status: st(r != null && ml != null ? (L ? r > 50 && ml > ms : r < 50 && ml < ms) : null) },
    { label: 'Volume confirmation', status: vr == null ? 'na' : vr >= 1.5 && green === L ? 'pass' : vr >= 0.7 ? 'warn' : 'fail' },
    { label: 'VWAP side', status: st(VW[i] != null ? (L ? price > VW[i] : price < VW[i]) : null) },
    { label: `Entry / stop / target (R:R ≥ ${minRR})`, status: st(rr >= minRR) },
    { label: 'A guide strategy fits this market', status: best ? (best.fit === 'suited' ? 'pass' : 'warn') : 'fail' },
    { label: 'Record the trade in the journal', status: 'na' },
  ];

  // ---- Chart overlays ----
  const markers = [];
  for (const p of patterns) {
    if (p.bias === 'neutral' && p.i < n - 5) continue;
    markers.push({
      time: candles[p.i].time,
      position: p.bias === 'bull' ? 'belowBar' : 'aboveBar',
      color: p.bias === 'bull' ? '#22c55e' : p.bias === 'bear' ? '#f43f5e' : '#94a3b8',
      shape: p.bias === 'bull' ? 'arrowUp' : p.bias === 'bear' ? 'arrowDown' : 'circle',
      text: p.name,
    });
  }
  for (let k = Math.max(1, n - 120); k < n; k++) {
    if (e50[k - 1] == null) continue;
    const a = e20[k] - e50[k];
    const b = e20[k - 1] - e50[k - 1];
    if (Math.sign(a) !== Math.sign(b) && a !== 0) {
      markers.push({ time: candles[k].time, position: a > 0 ? 'belowBar' : 'aboveBar', color: a > 0 ? '#38bdf8' : '#f59e0b', shape: 'square', text: a > 0 ? '20↑50' : '20↓50' });
    }
  }
  markers.sort((a, b) => a.time - b.time);

  return {
    price, atr: atrNow, rsi: r, volRatio: vr, turnover, breakout, regime, strategies: strat.list, strategy: best,
    signals, score, threshold, verdict, reasons, drivers, against, plan, checklist,
    levels: { supports: supports.slice(0, 2), resistances: resistances.slice(0, 2) },
    series: { e9, e20, e50, e200, bb: BB, vwap: VW, rsi: R, macd: M },
    markers,
  };
}
