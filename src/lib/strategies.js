// Strategy setups from two trading-strategy guides:
//   DBS Treasures, "Top 10 Trading Strategies Every Trader Should Know" (16 Jun 2026)
//   StoneX, "7 best trading strategies for all traders" (30 Nov 2022)
// The guides describe each strategy's logic; where they give no number (ADX level,
// stochastic band, volume multiple) the standard textbook value is used and noted.

const f = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));

// Market type decides which strategies apply. Both guides say to switch to range
// trading when the market consolidates and to trend strategies in strong trends.
export function marketRegime(ADX, i) {
  const ax = ADX.adx[i];
  const pd = ADX.plusDI[i];
  const md = ADX.minusDI[i];
  if (ax == null) return { key: 'unknown', label: 'Unknown', adx: null, dir: null, note: 'Not enough history for ADX' };
  const dir = pd > md ? 'up' : 'down';
  const rising = ADX.adx[i - 3] != null && ax > ADX.adx[i - 3];
  if (ax >= 25) return { key: 'trend', label: `Trending ${dir}`, adx: ax, dir, rising, note: `ADX ${f(ax, 0)} ≥ 25: a strong trend. Trend, momentum and breakout strategies suit this market.` };
  if (ax < 20) return { key: 'range', label: 'Range-bound', adx: ax, dir, rising, note: `ADX ${f(ax, 0)} < 20: no clear trend. Range trading and mean reversion suit this market; trend signals are less reliable.` };
  return { key: 'transition', label: `Weak trend ${dir}`, adx: ax, dir, rising, note: `ADX ${f(ax, 0)} between 20 and 25: a trend may be forming${rising ? ' (ADX rising)' : ''}. Wait for confirmation.` };
}

const FIT = {
  trend: { trend: 'suited', transition: 'neutral', range: 'unsuited' },
  rangeish: { trend: 'unsuited', transition: 'neutral', range: 'suited' },
  breakout: { trend: 'suited', transition: 'suited', range: 'suited' },
  any: { trend: 'neutral', transition: 'neutral', range: 'neutral' },
};
const fitFor = (kind, regime) => (regime.key === 'unknown' ? 'neutral' : FIT[kind][regime.key]);

export function evaluateStrategies(x) {
  const { candles, i, price, atrNow, regime, e20, e50, s50, s200, R, M, BB, vr, s1, r1, don, stoch, div, lastPat, ADX } = x;
  const c = candles[i];
  const r = R[i];
  const ml = M.line[i];
  const ms = M.signal[i];
  const strongVol = vr != null && vr >= 1.5;
  const out = [];
  const push = (s) => out.push({ signal: null, strength: 0, why: [], ...s });

  // 1. Trend following: DBS (50/200 MA cross, ADX, Donchian), StoneX (trailing stops)
  {
    const s = { signal: null, strength: 0, why: [], key: 'trend', name: 'Trend following', src: ['DBS', 'StoneX'], fit: fitFor('trend', regime),
      rule: 'Buy while the 50-day MA is above the 200-day MA, sell when it crosses below (DBS). Ignore small pullbacks; use a trailing stop to lock in profit (StoneX).' };
    if (s50[i] == null || s200[i] == null) s.why = ['Needs 200 bars for the 50/200 MA comparison'];
    else {
      const golden = s50[i] > s200[i];
      let k = null;
      for (let j = 0; j < 10 && i - j - 1 >= 0; j++) {
        const a = s50[i - j] - s200[i - j];
        const b = s50[i - j - 1] - s200[i - j - 1];
        if (s50[i - j - 1] != null && s200[i - j - 1] != null && Math.sign(a) !== Math.sign(b)) { k = j; break; }
      }
      const diOk = ADX.plusDI[i] == null ? true : golden ? ADX.plusDI[i] > ADX.minusDI[i] : ADX.minusDI[i] > ADX.plusDI[i];
      const sideOk = golden ? price > s50[i] : price < s50[i];
      s.why.push(`50 MA ${golden ? 'above' : 'below'} 200 MA${k != null ? ` (${golden ? 'golden' : 'death'} cross ${k === 0 ? 'on the last bar' : `${k} bars ago`})` : ''}`);
      s.why.push(`Price ${price > s50[i] ? 'above' : 'below'} the 50 MA; ${ADX.plusDI[i] != null ? `+DI ${f(ADX.plusDI[i], 0)} vs −DI ${f(ADX.minusDI[i], 0)}` : 'DI n/a'}`);
      if (sideOk && diOk) {
        s.signal = golden ? 'long' : 'short';
        s.strength = 1;
        const donBreak = golden ? don.upper[i] != null && price > don.upper[i] : don.lower[i] != null && price < don.lower[i];
        if (k != null || (donBreak && regime.key === 'trend')) s.strength = 2;
        if (donBreak) s.why.push(`New 20-bar ${golden ? 'high' : 'low'} (Donchian channel break)`);
      } else s.why.push('Price or direction indicator disagrees with the MA trend, so no entry');
    }
    push(s);
  }

  // 2. Momentum: DBS (break above recent high on strong volume; RSI, MACD, ADX, volume)
  {
    const s = { signal: null, strength: 0, why: [], key: 'momentum', name: 'Momentum', src: ['DBS'], fit: fitFor('trend', regime),
      rule: 'Buy when price breaks above a recent high on strong volume and hold while momentum continues; exit when price starts falling or breaks below support (DBS).' };
    const upChecks = [
      ['New 20-bar high', don.upper[i] != null && price > don.upper[i]],
      ['Volume ≥ 1.5× average', strongVol],
      ['RSI above 50', r != null && r > 50],
      ['MACD above signal', ml != null && ms != null && ml > ms],
    ];
    const dnChecks = [
      ['New 20-bar low', don.lower[i] != null && price < don.lower[i]],
      ['Volume ≥ 1.5× average', strongVol],
      ['RSI below 50', r != null && r < 50],
      ['MACD below signal', ml != null && ms != null && ml < ms],
    ];
    const up = upChecks.filter(([, ok]) => ok).length;
    const dn = dnChecks.filter(([, ok]) => ok).length;
    const checks = up >= dn ? upChecks : dnChecks;
    s.why = checks.map(([l, ok]) => `${ok ? '✓' : '✕'} ${l}`);
    if (up === 4 || dn === 4) {
      s.signal = up === 4 ? 'long' : 'short';
      s.strength = regime.adx != null && regime.adx >= 20 && regime.rising ? 2 : 1;
      if (s.strength === 2) s.why.push('ADX rising: momentum is strengthening');
    }
    push(s);
  }

  // 3. Breakout: DBS (narrow range, decisive move beyond S/R with volume, exit if back below)
  //    StoneX (stop just beyond the level, beware fakeouts, volume confirms)
  let breakoutLevel = null;
  {
    const s = { signal: null, strength: 0, why: [], key: 'breakout', name: 'Breakout', src: ['DBS', 'StoneX'], fit: fitFor('breakout', regime),
      rule: 'Buy when price closes above resistance after a narrow range, on strong volume. Stop just below the breakout level (StoneX); exit if price falls back below it (DBS). Low-volume breakouts are often fakeouts.' };
    // Was the stock in a narrow range? Bollinger bandwidth in the lowest quarter of the last 120 bars.
    const bw = (j) => (BB.upper[j] != null ? (BB.upper[j] - BB.lower[j]) / BB.mid[j] : null);
    const hist = [];
    for (let j = Math.max(0, i - 120); j < i - 1; j++) if (bw(j) != null) hist.push(bw(j));
    hist.sort((a, b) => a - b);
    const q25 = hist.length > 30 ? hist[Math.floor(hist.length * 0.25)] : null;
    let recentMin = Infinity;
    for (let j = i - 6; j < i; j++) if (bw(j) != null) recentMin = Math.min(recentMin, bw(j));
    const squeeze = q25 != null && recentMin <= q25;
    s.why.push(squeeze ? 'Price was coiling in a narrow range (Bollinger squeeze)' : 'No narrow-range build-up beforehand');

    // Most recent breakout in the last 4 bars that still holds.
    let found = null;
    for (let k = 0; k <= 3 && i - k >= 21; k++) {
      const j = i - k;
      const hi = don.upper[j];
      const lo = don.lower[j];
      const vAvg = x.vAvg[j];
      const vj = vAvg ? candles[j].volume / vAvg : null;
      if (hi != null && candles[j].close > hi && price > hi) { found = { dir: 'long', level: hi, k, vol: vj }; break; }
      if (lo != null && candles[j].close < lo && price < lo) { found = { dir: 'short', level: lo, k, vol: vj }; break; }
    }
    if (!found) s.why.push(`Inside the 20-bar range (${f(don.lower[i])} – ${f(don.upper[i])})`);
    else {
      const volOk = found.vol != null && found.vol >= 1.5;
      s.why.push(`${found.dir === 'long' ? 'Closed above' : 'Closed below'} ${f(found.level)} ${found.k === 0 ? 'on the last bar' : `${found.k} bars ago`} and holding`);
      s.why.push(volOk ? `Breakout volume ${f(found.vol, 1)}× average confirms it` : `Breakout volume only ${f(found.vol, 1)}× average: possible fakeout`);
      if (volOk) {
        s.signal = found.dir;
        s.strength = squeeze ? 2 : 1;
        breakoutLevel = found.level;
        s.level = found.level;
      }
    }
    push(s);
  }

  // 4. Reversal: DBS (momentum divergence, chart patterns, supply/demand zones, volume climax; confirm with RSI or support)
  {
    const s = { signal: null, strength: 0, why: [], key: 'reversal', name: 'Reversal', src: ['DBS'], fit: fitFor('any', regime),
      rule: 'Buy after a downtrend shows signs of turning (RSI divergence, a reversal candle at support, a volume climax); confirm with RSI or support; exit when the move weakens or resistance is reached (DBS).' };
    const nearSup = s1 != null && price - s1 <= atrNow;
    const nearRes = r1 != null && r1 - price <= atrNow;
    const down10 = candles[i - 10] && candles[i - 1].close < candles[i - 10].close;
    const up10 = candles[i - 10] && candles[i - 1].close > candles[i - 10].close;
    const climax = vr != null && vr >= 2.5;
    let bull = 0;
    let bear = 0;
    if (div?.bias === 'bull') { bull++; s.why.push(`Bullish RSI divergence: ${div.note.toLowerCase()}`); }
    if (div?.bias === 'bear') { bear++; s.why.push(`Bearish RSI divergence: ${div.note.toLowerCase()}`); }
    if (lastPat?.bias === 'bull' && nearSup) { bull++; s.why.push(`${lastPat.name} at support ${f(s1)}`); }
    if (lastPat?.bias === 'bear' && nearRes) { bear++; s.why.push(`${lastPat.name} at resistance ${f(r1)}`); }
    if (climax && down10 && c.close > c.open) { bull++; s.why.push(`Volume climax (${f(vr, 1)}×) with a green close after a decline`); }
    if (climax && up10 && c.close < c.open) { bear++; s.why.push(`Volume climax (${f(vr, 1)}×) with a red close after a rally`); }
    const rsiUp = r != null && R[i - 1] != null && r > R[i - 1];
    if (bull > bear) {
      if (rsiUp || nearSup) { s.signal = 'long'; s.strength = bull >= 2 ? 2 : 1; s.why.push(rsiUp ? 'Confirmed: RSI turning up' : 'Confirmed: holding support'); }
      else s.why.push('Not confirmed yet: RSI still falling and not at support');
    } else if (bear > bull) {
      const rsiDn = r != null && R[i - 1] != null && r < R[i - 1];
      if (rsiDn || nearRes) { s.signal = 'short'; s.strength = bear >= 2 ? 2 : 1; s.why.push(rsiDn ? 'Confirmed: RSI turning down' : 'Confirmed: rejected at resistance'); }
      else s.why.push('Not confirmed yet: RSI still rising and not at resistance');
    }
    if (!s.why.length) s.why.push('No divergence, reversal candle at a key level, or volume climax');
    push(s);
  }

  // 5. Range trading: DBS & StoneX (sideways market; buy support, sell resistance; RSI/stochastic for overbought/oversold)
  {
    const s = { signal: null, strength: 0, why: [], key: 'range', name: 'Range trading', src: ['DBS', 'StoneX'], fit: fitFor('rangeish', regime),
      rule: 'Only in a sideways market: buy near support and sell near resistance, using the stochastic for oversold/overbought. Exit if price breaks strongly out of the range (DBS, StoneX).' };
    const lo = don.lower[i];
    const hi = don.upper[i];
    const K = stoch.k[i];
    const D = stoch.d[i];
    if (lo == null || K == null) s.why.push('Not enough history');
    else {
      const width = hi - lo;
      const pos = width > 0 ? (price - lo) / width : 0.5;
      s.why.push(`Range ${f(lo)} – ${f(hi)} (${f(width / atrNow, 1)} ATR wide); price at ${f(pos * 100, 0)}% of it`);
      s.why.push(`Stochastic %K ${f(K, 0)} / %D ${f(D, 0)}`);
      if (regime.key === 'trend') s.why.push('Market is trending, so range rules are switched off');
      else if (width < 2 * atrNow) s.why.push('Range too narrow to trade');
      else if (pos <= 0.25 && K < 25) {
        s.signal = 'long'; s.strength = D != null && K > D ? 2 : 1; s.target = hi;
        s.why.push(`Near the range floor and oversold${s.strength === 2 ? ', stochastic turning up' : ''}`);
      } else if (pos >= 0.75 && K > 75) {
        s.signal = 'short'; s.strength = D != null && K < D ? 2 : 1; s.target = lo;
        s.why.push(`Near the range ceiling and overbought${s.strength === 2 ? ', stochastic turning down' : ''}`);
      } else s.why.push('Price is mid-range: no edge');
    }
    push(s);
  }

  // 6. Mean reversion: StoneX (price stretched from its SMA tends to return to it)
  {
    const s = { signal: null, strength: 0, why: [], key: 'meanrev', name: 'Mean reversion', src: ['StoneX'], fit: fitFor('rangeish', regime),
      rule: 'When price stretches far from its 20-period SMA (outside the Bollinger Bands), trade back toward the average. Price can take a long time to revert (StoneX).' };
    if (BB.mid[i] == null) s.why.push('Not enough history');
    else {
      const sd = (BB.upper[i] - BB.mid[i]) / 2 || 1e-9;
      const z = (price - BB.mid[i]) / sd;
      s.why.push(`Price is ${f(Math.abs(z), 1)} standard deviations ${z >= 0 ? 'above' : 'below'} its 20 SMA (${f(BB.mid[i])})`);
      const trendAgainst = regime.key === 'trend' && ((z > 0 && regime.dir === 'up') || (z < 0 && regime.dir === 'down'));
      if (Math.abs(z) >= 2) {
        if (trendAgainst) s.why.push('But a strong trend is pushing it that way, and stretched prices can stay stretched');
        else { s.signal = z > 0 ? 'short' : 'long'; s.strength = Math.abs(z) >= 2.5 ? 2 : 1; s.target = BB.mid[i]; s.why.push(`Stretched: expect a move back toward ${f(BB.mid[i])}`); }
      } else s.why.push('Not stretched enough (needs ≥ 2)');
    }
    push(s);
  }

  // 7. Swing (MA pullback): DBS (swing trading uses trend following, breakouts, ranges and moving-average pullbacks)
  {
    const s = { signal: null, strength: 0, why: [], key: 'pullback', name: 'Swing pullback', src: ['DBS'], fit: fitFor('trend', regime),
      rule: 'In an established trend, buy the pullback to the 20 EMA once price bounces off it; hold for days to weeks and exit as momentum peaks (DBS).' };
    if (e50[i] == null) s.why.push('Not enough history');
    else {
      const up = e20[i] > e50[i] && price > e50[i];
      const dn = e20[i] < e50[i] && price < e50[i];
      const lows = Math.min(...candles.slice(i - 2, i + 1).map((b) => b.low));
      const highs = Math.max(...candles.slice(i - 2, i + 1).map((b) => b.high));
      if (up) {
        const touched = lows <= e20[i] + 0.3 * atrNow;
        const bounced = price > e20[i] && c.close > c.open;
        s.why.push('Uptrend: 20 EMA above 50 EMA');
        s.why.push(touched ? `Pulled back to the 20 EMA (${f(e20[i])})` : `No pullback yet: price is ${f((price - e20[i]) / atrNow, 1)} ATR above the 20 EMA`);
        if (touched && bounced) { s.signal = 'long'; s.strength = r != null && r >= 40 && r <= 65 ? 2 : 1; s.why.push('Bounced with a green candle'); }
        else if (touched) s.why.push('Waiting for a bounce candle');
      } else if (dn) {
        const touched = highs >= e20[i] - 0.3 * atrNow;
        const rejected = price < e20[i] && c.close < c.open;
        s.why.push('Downtrend: 20 EMA below 50 EMA');
        s.why.push(touched ? `Rallied back to the 20 EMA (${f(e20[i])})` : 'No rally to the 20 EMA yet');
        if (touched && rejected) { s.signal = 'short'; s.strength = r != null && r >= 35 && r <= 60 ? 2 : 1; s.why.push('Rejected with a red candle'); }
      } else s.why.push('No clear trend to pull back within');
    }
    push(s);
  }

  // 8. Gap trading: DBS (gap & go vs gap fill)
  {
    const s = { signal: null, strength: 0, why: [], key: 'gap', name: 'Gap trading', src: ['DBS'], fit: fitFor('any', regime),
      rule: 'Gap & go: a large gap caused by a strong event tends to keep going if it holds. Gap fill: a gap that starts closing tends to return to the previous close (DBS).' };
    const day = c.day;
    let fi = i;
    while (fi > 0 && candles[fi - 1].day === day) fi--;
    if (fi === 0) s.why.push('Not enough history');
    else {
      const prevClose = candles[fi - 1].close;
      const open = candles[fi].open;
      const gap = open - prevClose;
      const pctGap = (gap / prevClose) * 100;
      const minGap = Math.max(1, x.intraday ? 0 : (0.5 * atrNow * 100) / prevClose);
      if (Math.abs(pctGap) < minGap) s.why.push(`No significant gap this session (${pctGap >= 0 ? '+' : ''}${f(pctGap)}%, needs ±${f(minGap, 1)}%)`);
      else {
        const up = gap > 0;
        const filledHalf = up ? price < prevClose + gap / 2 : price > prevClose + gap / 2;
        s.why.push(`Gapped ${up ? 'up' : 'down'} ${f(Math.abs(pctGap))}% at the open (${f(prevClose)} → ${f(open)})`);
        if (!filledHalf && (up ? price >= open : price <= open)) {
          s.signal = up ? 'long' : 'short'; s.strength = strongVol ? 2 : 1;
          s.why.push(`Gap & go: holding beyond the open${strongVol ? ' on strong volume' : ''}`);
        } else if (filledHalf) {
          s.signal = up ? 'short' : 'long'; s.strength = 1; s.target = prevClose;
          s.why.push(`Gap fill: already retraced half the gap, target the previous close ${f(prevClose)}`);
        } else s.why.push('Gap is holding but price has slipped below the open: no clear edge');
      }
    }
    push(s);
  }

  // Confluence: suited strategies count fully, neutral ones half, unsuited ones not at all.
  let net = 0;
  for (const s of out) {
    if (!s.signal) continue;
    const w = s.fit === 'suited' ? 1 : s.fit === 'neutral' ? 0.5 : 0;
    s.counted = w > 0;
    net += (s.signal === 'long' ? 1 : -1) * s.strength * w;
  }
  const score = Math.max(-2.5, Math.min(2.5, Math.round(net * 0.5 * 2) / 2));
  return { list: out, score, net, breakoutLevel };
}

export const NOT_AUTOMATED = [
  { name: 'Scalping', src: ['DBS', 'StoneX'], why: 'Needs tick or 1-minute data and very fast execution' },
  { name: 'News trading', src: ['DBS', 'StoneX'], why: 'Needs a live news and results calendar' },
  { name: 'Pairs trading', src: ['DBS'], why: 'Compares two correlated stocks, not one' },
  { name: 'End-of-day trading', src: ['StoneX'], why: 'A timing rule: enter in the last trading hour using any of the setups above' },
];
