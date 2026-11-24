import { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts';
import { num } from '../lib/format.js';
import { attachChartTools } from '../lib/chartTools.js';
import { ChartHint } from './SimpleChart.jsx';

const C = {
  text: '#8b95a7', grid: 'rgba(148,163,184,0.07)', border: 'rgba(148,163,184,0.15)',
  up: '#22c55e', down: '#f43f5e', e9: '#facc15', e20: '#38bdf8', e50: '#a78bfa', e200: '#fb923c',
  vwap: '#94a3b8', bb: 'rgba(148,163,184,0.55)', support: '#22c55e', resistance: '#f43f5e',
};

const OVERLAYS = [
  { key: 'e9', label: 'EMA 9', color: C.e9 },
  { key: 'e20', label: 'EMA 20', color: C.e20 },
  { key: 'e50', label: 'EMA 50', color: C.e50 },
  { key: 'e200', label: 'EMA 200', color: C.e200 },
  { key: 'vwap', label: 'VWAP', color: C.vwap },
  { key: 'bb', label: 'Bollinger', color: C.bb },
  { key: 'sr', label: 'S / R', color: C.support },
  { key: 'plan', label: 'Stop / Target', color: '#f59e0b' },
  { key: 'patterns', label: 'Patterns', color: '#94a3b8' },
];

const baseOptions = (showTime, intraday) => ({
  autoSize: true,
  layout: { attributionLogo: false, background: { color: 'transparent' }, textColor: C.text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
  grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: C.border, minimumWidth: 72 },
  timeScale: { borderColor: C.border, timeVisible: intraday, secondsVisible: false, visible: showTime, rightOffset: 4 },
});

const lineData = (candles, arr) => candles.map((c, i) => (arr[i] == null ? { time: c.time } : { time: c.time, value: arr[i] }));

export default function PriceChart({ candles, analysis, intraday }) {
  const mainEl = useRef(null);
  const rsiEl = useRef(null);
  const macdEl = useRef(null);
  const legendEl = useRef(null);
  const tools = useRef(null);
  const [measure, setMeasure] = useState({ a: null, b: null, measureMode: false });
  const [show, setShow] = useState({ e9: false, e20: true, e50: true, e200: true, vwap: true, bb: false, sr: true, plan: true, patterns: true });

  useEffect(() => {
    if (!candles?.length || !analysis) return undefined;
    const { series, levels, plan, markers } = analysis;
    const main = createChart(mainEl.current, baseOptions(false, intraday));
    const rsiC = createChart(rsiEl.current, baseOptions(false, intraday));
    const macdC = createChart(macdEl.current, baseOptions(true, intraday));
    const charts = [main, rsiC, macdC];

    const candle = main.addCandlestickSeries({
      upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
    });
    candle.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));

    const vol = main.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(244,63,94,0.35)' })));

    const addLine = (arr, color, opts = {}) => {
      const s = main.addLineSeries({ color, lineWidth: 1.5, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, ...opts });
      s.setData(lineData(candles, arr));
      return s;
    };
    if (show.bb) {
      addLine(series.bb.upper, C.bb, { lineWidth: 1 });
      addLine(series.bb.mid, C.bb, { lineWidth: 1, lineStyle: LineStyle.Dotted });
      addLine(series.bb.lower, C.bb, { lineWidth: 1 });
    }
    if (show.e9) addLine(series.e9, C.e9);
    if (show.e20) addLine(series.e20, C.e20);
    if (show.e50) addLine(series.e50, C.e50);
    if (show.e200) addLine(series.e200, C.e200, { lineWidth: 2 });
    if (show.vwap) addLine(series.vwap, C.vwap, { lineStyle: LineStyle.Dashed, lineWidth: 1 });

    const priceLine = (price, color, title, style = LineStyle.Dotted) =>
      candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
    if (show.sr) {
      levels.supports.forEach((l, k) => priceLine(l.price, C.support, `S${k + 1}`));
      levels.resistances.forEach((l, k) => priceLine(l.price, C.resistance, `R${k + 1}`));
    }
    if (show.plan) {
      priceLine(plan.stop, '#f59e0b', 'Stop', LineStyle.Dashed);
      priceLine(plan.target, '#2dd4bf', 'Target', LineStyle.Dashed);
    }
    if (show.patterns) candle.setMarkers(markers);

    // RSI pane
    const rsiS = rsiC.addLineSeries({ color: '#c084fc', lineWidth: 1.5, priceLineVisible: false });
    rsiS.setData(lineData(candles, series.rsi));
    [[70, C.down], [50, C.text], [30, C.up]].forEach(([p, color]) =>
      rsiS.createPriceLine({ price: p, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' }));
    rsiC.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

    // MACD pane
    const m = series.macd;
    const hist = macdC.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
    hist.setData(candles.map((c, k) => {
      const v = m.hist[k];
      if (v == null) return { time: c.time };
      const rising = k > 0 && m.hist[k - 1] != null && v > m.hist[k - 1];
      const color = v >= 0 ? (rising ? 'rgba(34,197,94,0.8)' : 'rgba(34,197,94,0.4)') : (rising ? 'rgba(244,63,94,0.4)' : 'rgba(244,63,94,0.8)');
      return { time: c.time, value: v, color };
    }));
    macdC.addLineSeries({ color: '#38bdf8', lineWidth: 1.5, priceLineVisible: false }).setData(lineData(candles, m.line));
    macdC.addLineSeries({ color: '#fb923c', lineWidth: 1.5, priceLineVisible: false }).setData(lineData(candles, m.signal));

    // Keep the three panes scrolled/zoomed together.
    let syncing = false;
    charts.forEach((src) =>
      src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (syncing || !range) return;
        syncing = true;
        charts.forEach((dst) => dst !== src && dst.timeScale().setVisibleLogicalRange(range));
        syncing = false;
      }));
    const visibleBars = intraday ? 150 : 130;
    main.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - visibleBars), to: candles.length + 3 });

    // OHLC legend
    const byTime = new Map(candles.map((c, k) => [c.time, k]));
    const writeLegend = (k) => {
      const c = candles[k];
      if (!c || !legendEl.current) return;
      const chg = k > 0 ? ((c.close - candles[k - 1].close) / candles[k - 1].close) * 100 : 0;
      const d = new Date(c.time * 1000);
      const when = intraday ? d.toISOString().slice(0, 16).replace('T', ' ') : d.toISOString().slice(0, 10);
      legendEl.current.innerHTML = `<span>${when}</span><span>O <b>${num(c.open)}</b></span><span>H <b>${num(c.high)}</b></span><span>L <b>${num(c.low)}</b></span><span>C <b>${num(c.close)}</b></span><span class="${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span><span>Vol <b>${num(c.volume, 0)}</b></span>${series.rsi[k] != null ? `<span>RSI <b>${series.rsi[k].toFixed(1)}</b></span>` : ''}`;
    };
    writeLegend(candles.length - 1);
    main.subscribeCrosshairMove((p) => writeLegend(p?.time != null && byTime.has(p.time) ? byTime.get(p.time) : candles.length - 1));

    tools.current = attachChartTools({
      chart: main, series: candle, container: mainEl.current, intraday,
      points: candles.map((c) => ({ time: c.time, value: c.close })),
      fmtTime: (t) => {
        const iso = new Date(t * 1000).toISOString();
        return intraday ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
      },
      onChange: setMeasure,
    });
    setMeasure({ a: null, b: null, measureMode: false });

    return () => { tools.current?.destroy(); tools.current = null; charts.forEach((ch) => ch.remove()); };
  }, [candles, analysis, intraday, show]);

  return (
    <div className="chart-wrap">
      <div className="chart-toggles" role="group" aria-label="Chart overlays">
        {OVERLAYS.map((o) => (
          <button key={o.key} type="button" className={`chip ${show[o.key] ? 'on' : ''}`} aria-pressed={show[o.key]}
            onClick={() => setShow((s) => ({ ...s, [o.key]: !s[o.key] }))}>
            <i style={{ background: o.color }} />{o.label}
          </button>
        ))}
      </div>
      <div className="legend mono" ref={legendEl} />
      <div className="pane pane-main" ref={mainEl} />
      <ChartHint measure={measure} tools={tools} />
      <div className="pane-label">RSI (14) · 70 overbought · 30 oversold</div>
      <div className="pane pane-rsi" ref={rsiEl} />
      <div className="pane-label">MACD (12, 26, 9) · <span style={{ color: '#38bdf8' }}>MACD</span> · <span style={{ color: '#fb923c' }}>Signal</span></div>
      <div className="pane pane-macd" ref={macdEl} />
    </div>
  );
}
