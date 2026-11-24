import { STYLES } from './analysis.js';
import { ema } from './indicators.js';

const IST = 19800; // seconds; the chart library renders times as UTC, so shift to IST

export function toYahoo(input, exchange) {
  const s = input.trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  const ix = INDEX_LIST.find((x) => x.label.replace(/\s+/g, '') === s || x.sym === s);
  if (ix) return ix.sym;
  if (s.startsWith('^') || s.includes('.')) return s;
  return `${s}.${exchange}`;
}

export const displaySymbol = (sym) => INDEX_LIST.find((x) => x.sym === sym)?.label || sym.replace(/\.(NS|BO)$/, '');
export const isIndex = (sym) => !!sym && (sym.startsWith('^') || INDEX_LIST.some((x) => x.sym === sym));

class DataError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // 'notfound' | 'network'
  }
}

export async function fetchChart(symbol, interval, range) {
  let res;
  try {
    res = await fetch(`/yf/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`);
  } catch (e) {
    throw new DataError('Could not reach the market-data proxy', 'network');
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  const err = json?.chart?.error;
  if (res.status === 404 || (err && /not found|delisted|no data/i.test(err.description || ''))) {
    throw new DataError(`No market data for ${symbol} – check the symbol and exchange`, 'notfound');
  }
  if (!res.ok || !json?.chart?.result?.[0]) throw new DataError(err?.description || `Market data request failed (HTTP ${res.status})`, 'network');

  const r = json.chart.result[0];
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const candles = [];
  for (let k = 0; k < ts.length; k++) {
    const o = q.open?.[k];
    const h = q.high?.[k];
    const l = q.low?.[k];
    const c = q.close?.[k];
    if ([o, h, l, c].some((v) => v == null)) continue;
    const time = ts[k] + IST;
    const bar = { time, open: o, high: h, low: l, close: c, volume: q.volume?.[k] || 0, day: new Date(time * 1000).toISOString().slice(0, 10) };
    const prev = candles[candles.length - 1];
    if (prev && time <= prev.time) candles[candles.length - 1] = { ...bar, time: prev.time };
    else candles.push(bar);
  }
  if (!candles.length) throw new DataError(`No price bars returned for ${symbol}`, 'notfound');
  return {
    candles,
    meta: {
      name: r.meta?.longName || r.meta?.shortName || symbol,
      currency: r.meta?.currency || 'INR',
      exchange: r.meta?.fullExchangeName || r.meta?.exchangeName || '',
      lastTradeTime: r.meta?.regularMarketTime ? r.meta.regularMarketTime + IST : null,
      prevClose: r.meta?.chartPreviousClose ?? r.meta?.previousClose ?? null,
      lastPrice: r.meta?.regularMarketPrice ?? null,
    },
  };
}

// ---- Simulated data: used only when the live source is unreachable ----
function hash(str) {
  let h = 2166136261;
  for (let k = 0; k < str.length; k++) {
    h ^= str.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const STEP = { '5m': 300, '15m': 900, '1d': 86400, '1wk': 604800, '1mo': 2592000 };
const COUNT = { '5m': 375, '15m': 500, '1d': 250, '1wk': 260, '1mo': 120 };
const VOL = { '5m': 0.003, '15m': 0.005, '1d': 0.014, '1wk': 0.03, '1mo': 0.06 };

export function simulate(symbol, interval) {
  const rand = rng(hash(symbol));
  const step = STEP[interval];
  const count = COUNT[interval];
  const vol = VOL[interval];
  let price = 150 + rand() * 2850;
  let drift = 0;
  const now = Math.floor(Date.now() / 1000);
  const out = [];
  const perDay = interval === '5m' ? 75 : interval === '15m' ? 25 : 1;
  for (let k = 0; k < count; k++) {
    if (rand() < 0.05) drift = (rand() - 0.48) * vol * 0.6;
    const g = Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
    const ret = drift + g * vol;
    const open = price;
    const close = Math.max(1, open * (1 + ret));
    const high = Math.max(open, close) * (1 + rand() * vol * 0.7);
    const low = Math.min(open, close) * (1 - rand() * vol * 0.7);
    const volume = Math.round((4e5 + rand() * 1.2e6) * (1 + Math.abs(g)) * (interval === '5m' ? 0.05 : 1));
    const time = now - (count - k) * step + IST;
    out.push({ time, open, high, low, close, volume, day: perDay > 1 ? `d${Math.floor(k / perDay)}` : `d${k}` });
    price = close;
  }
  return out;
}

export async function loadSymbol(symbol, style, { withDaily = false } = {}) {
  const S = STYLES[style];
  try {
    const [main, htf, daily] = await Promise.all([
      fetchChart(symbol, S.interval, S.range),
      fetchChart(symbol, S.htf.interval, S.htf.range).catch(() => null),
      withDaily && S.interval !== '1d' ? fetchChart(symbol, '1d', '6mo').catch(() => null) : null,
    ]);
    if (main.candles.length < 30) throw new DataError(`Only ${main.candles.length} bars returned for ${symbol}`, 'notfound');
    const dailyCandles = S.interval === '1d' ? main.candles : daily?.candles || null;
    return { ...main, htf: htf?.candles || null, daily: dailyCandles, source: 'live' };
  } catch (e) {
    if (e.kind === 'notfound') throw e;
    return {
      candles: simulate(symbol, S.interval),
      htf: simulate(symbol + ':htf', S.htf.interval),
      daily: S.interval === '1d' ? null : simulate(symbol + ':d', '1d'),
      meta: { name: displaySymbol(symbol), currency: 'INR', exchange: 'Simulated' },
      source: 'simulated',
      warning: e.message,
    };
  }
}

export const INDEX_LIST = [
  { key: 'nifty', sym: '^NSEI', label: 'NIFTY 50' },
  { key: 'sensex', sym: '^BSESN', label: 'SENSEX' },
  { key: 'banknifty', sym: '^NSEBANK', label: 'BANK NIFTY' },
  { key: 'finnifty', sym: 'NIFTY_FIN_SERVICE.NS', label: 'FIN NIFTY' },
  { key: 'midcap', sym: '^NSEMDCP50', label: 'MIDCAP 50' },
  { key: 'it', sym: '^CNXIT', label: 'NIFTY IT' },
  { key: 'auto', sym: '^CNXAUTO', label: 'NIFTY AUTO' },
  { key: 'pharma', sym: '^CNXPHARMA', label: 'NIFTY PHARMA' },
  { key: 'metal', sym: '^CNXMETAL', label: 'NIFTY METAL' },
  { key: 'vix', sym: '^INDIAVIX', label: 'INDIA VIX', inverse: true },
];
const INDICES = Object.fromEntries(INDEX_LIST.map((x) => [x.key, x.sym]));

export async function loadMarket() {
  const entries = await Promise.all(
    Object.entries(INDICES).map(async ([key, sym]) => {
      try {
        const { candles } = await fetchChart(sym, '1d', '6mo');
        const closes = candles.map((c) => c.close);
        const e20 = ema(closes, 20);
        const n = closes.length;
        const last = closes[n - 1];
        const prev = closes[n - 2];
        return [key, { symbol: sym, last, change: last - prev, changePct: ((last - prev) / prev) * 100, above20: last > e20[n - 1], spark: closes.slice(-40) }];
      } catch {
        return [key, null];
      }
    })
  );
  return Object.fromEntries(entries);
}

// NIFTY 50 constituents (approximate; index membership changes twice a year).
export const NIFTY50 = [
  'ADANIENT', 'ADANIPORTS', 'APOLLOHOSP', 'ASIANPAINT', 'AXISBANK', 'BAJAJ-AUTO', 'BAJFINANCE', 'BAJAJFINSV', 'BEL', 'BHARTIARTL',
  'CIPLA', 'COALINDIA', 'DRREDDY', 'EICHERMOT', 'ETERNAL', 'GRASIM', 'HCLTECH', 'HDFCBANK', 'HDFCLIFE', 'HEROMOTOCO',
  'HINDALCO', 'HINDUNILVR', 'ICICIBANK', 'INDUSINDBK', 'INFY', 'ITC', 'JIOFIN', 'JSWSTEEL', 'KOTAKBANK', 'LT',
  'M&M', 'MARUTI', 'NESTLEIND', 'NTPC', 'ONGC', 'POWERGRID', 'RELIANCE', 'SBILIFE', 'SBIN', 'SHRIRAMFIN',
  'SUNPHARMA', 'TATACONSUM', 'TMPV', 'TATASTEEL', 'TCS', 'TECHM', 'TITAN', 'TRENT', 'ULTRACEMCO', 'WIPRO',
];

// Day change for a list of symbols (one small daily request each, run a few at a time).
export async function loadQuotes(symbols, { concurrency = 6, onProgress } = {}) {
  const out = [];
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < symbols.length) {
      const sym = symbols[cursor++];
      try {
        const { candles, meta } = await fetchChart(sym, '1d', '5d');
        const n = candles.length;
        if (n < 2) throw new Error('not enough bars');
        const last = candles[n - 1];
        const prev = candles[n - 2].close;
        out.push({ sym, name: meta.name, price: last.close, change: last.close - prev, changePct: ((last.close - prev) / prev) * 100, volume: last.volume, day: last.day });
      } catch (e) {
        out.push({ sym, error: e.message });
      }
      onProgress?.(++done, symbols.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  return out;
}

// ---- Stock universes (official NSE lists) ----
export const UNIVERSES = [
  { key: 'nifty50', label: 'NIFTY 50', file: 'indices/ind_nifty50list.csv', approx: 50 },
  { key: 'nifty100', label: 'NIFTY 100', file: 'indices/ind_nifty100list.csv', approx: 100 },
  { key: 'nifty200', label: 'NIFTY 200', file: 'indices/ind_nifty200list.csv', approx: 200 },
  { key: 'nifty500', label: 'NIFTY 500', file: 'indices/ind_nifty500list.csv', approx: 500 },
  { key: 'midcap150', label: 'Midcap 150', file: 'indices/ind_niftymidcap150list.csv', approx: 150 },
  { key: 'smallcap250', label: 'Smallcap 250', file: 'indices/ind_niftysmallcap250list.csv', approx: 250 },
  { key: 'all', label: 'All NSE stocks', file: 'equities/EQUITY_L.csv', approx: 2300 },
];

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

const universeCache = new Map();

// Returns [{ sym: 'RELIANCE.NS', name, industry }] for a universe key.
export async function loadUniverse(key) {
  if (universeCache.has(key)) return universeCache.get(key);
  const u = UNIVERSES.find((x) => x.key === key);
  if (!u) throw new Error(`Unknown list ${key}`);
  let list;
  try {
    const res = await fetch(`/nse/content/${u.file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCsv(await res.text());
    const head = rows.shift().map((h) => h.toUpperCase());
    const iSym = head.indexOf('SYMBOL');
    const iSeries = head.indexOf('SERIES');
    const iName = head.findIndex((h) => h === 'COMPANY NAME' || h === 'NAME OF COMPANY');
    const iInd = head.indexOf('INDUSTRY');
    list = rows
      .filter((r) => r[iSym] && (iSeries < 0 || r[iSeries] === 'EQ'))
      .map((r) => ({ sym: `${r[iSym]}.NS`, name: r[iName] || r[iSym], industry: iInd >= 0 ? r[iInd] : '' }));
    if (!list.length) throw new Error('empty list');
  } catch (e) {
    if (key !== 'nifty50') throw new Error(`Couldn't download the ${u.label} list from NSE (${e.message})`);
    list = NIFTY50.map((s) => ({ sym: `${s}.NS`, name: s, industry: '' }));
  }
  universeCache.set(key, list);
  return list;
}
