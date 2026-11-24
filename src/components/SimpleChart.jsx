import { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts';
import { fetchChart } from '../lib/data.js';
import { attachChartTools } from '../lib/chartTools.js';
import { inr, pct } from '../lib/format.js';

// Range buttons like a quote page. Each maps to a Yahoo interval + range.
const RANGES = [
  { key: '1D', interval: '5m', range: '1d', label: 'today', intraday: true },
  { key: '5D', interval: '15m', range: '5d', label: 'past 5 days', intraday: true },
  { key: '1M', interval: '60m', range: '1mo', label: 'past month', intraday: true },
  { key: '6M', interval: '1d', range: '6mo', label: 'past 6 months' },
  { key: 'YTD', interval: '1d', range: 'ytd', label: 'year to date' },
  { key: '1Y', interval: '1d', range: '1y', label: 'past year' },
  { key: '5Y', interval: '1wk', range: '5y', label: 'past 5 years' },
  { key: 'MAX', interval: '1mo', range: 'max', label: 'all time' },
];

const UP = '#16a34a';
const DOWN = '#e11d48';
const cache = new Map(); // `${symbol}|${key}` -> { at, data }

async function load(symbol, r) {
  const id = `${symbol}|${r.key}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const data = await fetchChart(symbol, r.interval, r.range);
  cache.set(id, { at: Date.now(), data });
  return data;
}

const fmtTime = (t, r) => {
  const d = new Date(t * 1000);
  const opts = r.intraday
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
    : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
  return d.toLocaleString('en-IN', opts);
};

export default function SimpleChart({ symbol, children }) {
  const el = useRef(null);
  const [rangeKey, setRangeKey] = useState(() => {
    try { return localStorage.getItem('tsd:simpleRange') || '1D'; } catch { return '1D'; }
  });
  const [state, setState] = useState({ status: 'loading' });
  const [hover, setHover] = useState(null);
  const [measure, setMeasure] = useState({ a: null, b: null, measureMode: false });
  const tools = useRef(null);
  const r = RANGES.find((x) => x.key === rangeKey) || RANGES[0];

  useEffect(() => {
    try { localStorage.setItem('tsd:simpleRange', rangeKey); } catch { /* storage unavailable */ }
  }, [rangeKey]);

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, status: 'loading' }));
    load(symbol, r)
      .then((data) => live && setState({ status: 'ready', data }))
      .catch((e) => live && setState({ status: 'error', error: e.message }));
    return () => { live = false; };
  }, [symbol, rangeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = state.data;
  const pts = data?.candles || [];
  const first = pts.length ? (data.meta.prevClose ?? pts[0].close) : null;
  const last = pts.length ? pts[pts.length - 1].close : null;
  const up = last != null && last >= first;
  const color = up ? UP : DOWN;

  useEffect(() => {
    if (!pts.length || !el.current) return undefined;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { attributionLogo: false, background: { color: 'transparent' }, textColor: '#8a94a8', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(148,163,184,0.07)' } },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: 'rgba(148,163,184,0.45)', style: LineStyle.Solid, width: 1, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: r.intraday, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addAreaSeries({
      lineColor: color,
      topColor: up ? 'rgba(22,163,74,0.28)' : 'rgba(225,29,72,0.28)',
      bottomColor: up ? 'rgba(22,163,74,0)' : 'rgba(225,29,72,0)',
      lineWidth: 2,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 4,
    });
    series.setData(pts.map((c) => ({ time: c.time, value: c.close })));
    if (rangeKey === '1D' && data.meta.prevClose) {
      series.createPriceLine({ price: data.meta.prevClose, color: 'rgba(148,163,184,0.6)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: 'Prev close' });
    }
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((p) => {
      const v = p?.time != null ? p.seriesData.get(series)?.value : null;
      setHover(v != null ? { value: v, time: p.time } : null);
    });
    tools.current = attachChartTools({
      chart, series, container: el.current, intraday: r.intraday,
      points: pts.map((c) => ({ time: c.time, value: c.close })),
      fmtTime: (t) => fmtTime(t, r),
      onChange: setMeasure,
    });
    setMeasure({ a: null, b: null, measureMode: false });
    return () => { tools.current?.destroy(); tools.current = null; chart.remove(); };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = hover?.value ?? last;
  const chg = shown != null && first != null ? shown - first : null;
  const chgPct = chg != null ? (chg / first) * 100 : null;
  const shownUp = chg == null || chg >= 0;

  return (
    <section className="card simple-chart" aria-label="Price chart">
      {children}
      <div className="sc-head">
        <div>
          <div className="sc-price mono">{shown != null ? inr(shown) : '—'}</div>
          <div className={`sc-chg mono ${shownUp ? 'pos' : 'neg'}`}>
            {chg != null ? <>{shownUp ? '▲' : '▼'} {inr(Math.abs(chg))} ({pct(chgPct)})</> : ''}
            <span className="muted"> {hover ? fmtTime(hover.time, r) : r.label}</span>
          </div>
        </div>
        <div className="range-tabs" role="tablist" aria-label="Chart range">
          {RANGES.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={x.key === rangeKey} className={x.key === rangeKey ? 'on' : ''} onClick={() => setRangeKey(x.key)}>{x.key}</button>
          ))}
        </div>
      </div>
      <div className="sc-plot">
        <div ref={el} className="sc-canvas" />
        {state.status === 'loading' && <div className="sc-overlay"><span className="spinner sc-spin" /></div>}
        {state.status === 'error' && <div className="sc-overlay muted">Chart unavailable: {state.error}</div>}
      </div>
      <ChartHint measure={measure} tools={tools} />
    </section>
  );
}

const touch = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches;

export function ChartHint({ measure, tools }) {
  const { a, b, measureMode } = measure;
  return (
    <div className="chart-hint">
      <span className="muted">
        {a && !b
          ? (measureMode ? 'Now click a second point to measure.' : 'Now Shift + click a second point.')
          : a && b
            ? 'Measuring the difference. Click anywhere or press Esc to clear.'
            : touch
              ? 'Touch the chart to see prices · tap Measure, then tap two points'
              : <>Hover to see prices · <kbd>Shift</kbd> + click two points to measure the difference</>}
      </span>
      <span className="chart-hint-actions">
        {a && <button type="button" className="link-btn" onClick={() => tools.current?.clear()}>Clear</button>}
        <button type="button" className={`chip ${measureMode ? 'on' : ''}`} aria-pressed={measureMode}
          onClick={() => tools.current?.setMeasureMode(!measureMode)} title="Measure without Shift (useful on touch screens)">
          📏 Measure
        </button>
      </span>
    </div>
  );
}
