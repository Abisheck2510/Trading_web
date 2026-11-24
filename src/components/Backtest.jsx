import { useEffect, useRef, useState } from 'react';
import { createChart, LineStyle } from 'lightweight-charts';
import { runBacktest, BT_CONFIG } from '../lib/backtest.js';
import { STYLES } from '../lib/analysis.js';
import { num, pct } from '../lib/format.js';

const f = (v, d = 2) => (v == null ? '—' : v === Infinity ? '∞' : v.toFixed(d));
const sR = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}R`);
const when = (t, intraday) => {
  const iso = new Date(t * 1000).toISOString();
  return intraday ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
};

function EquityCurve({ curve }) {
  const el = useRef(null);
  useEffect(() => {
    if (!el.current || curve.length < 2) return undefined;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { attributionLogo: false, background: { color: 'transparent' }, textColor: '#8a94a8', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(148,163,184,0.07)' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
    });
    const s = chart.addBaselineSeries({
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#22c55e', topFillColor1: 'rgba(34,197,94,0.25)', topFillColor2: 'rgba(34,197,94,0.02)',
      bottomLineColor: '#f43f5e', bottomFillColor1: 'rgba(244,63,94,0.02)', bottomFillColor2: 'rgba(244,63,94,0.25)',
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: 'custom', formatter: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` },
    });
    s.setData(curve);
    s.createPriceLine({ price: 0, color: 'rgba(148,163,184,0.5)', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [curve]);
  return <div ref={el} className="bt-curve" />;
}

function SideStats({ label, cls, s }) {
  return (
    <div className="bt-side">
      <div className={`list-head ${cls}`}><span>{label} signals</span><span className="count">{s.trades} trades</span></div>
      <div className="bt-side-grid">
        <div><span>Win rate</span><b className="mono">{s.winRate != null ? `${s.winRate.toFixed(0)}%` : '—'}</b></div>
        <div><span>Avg result</span><b className={`mono ${s.avgR > 0 ? 'pos' : s.avgR < 0 ? 'neg' : ''}`}>{sR(s.avgR)}</b></div>
        <div><span>Avg win / loss</span><b className="mono">{s.avgWinR != null ? `+${s.avgWinR.toFixed(2)}` : '—'} / {s.avgLossR != null ? s.avgLossR.toFixed(2) : '—'}</b></div>
        <div><span>Profit factor</span><b className="mono">{f(s.profitFactor)}</b></div>
      </div>
    </div>
  );
}

export default function Backtest({ symbol, style, settings }) {
  const [res, setRes] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const runId = useRef(0);
  const cfg = BT_CONFIG[style];
  const intraday = style === 'intraday';

  // A new stock or style invalidates the old result.
  useEffect(() => {
    runId.current++;
    setRes(null);
    setProgress(null);
    setError(null);
  }, [symbol, style]);

  const run = async () => {
    const id = ++runId.current;
    setError(null);
    setRes(null);
    setProgress(0);
    try {
      const r = await runBacktest(symbol, style, settings, {
        onProgress: (done, total) => id === runId.current && setProgress(total ? done / total : 0),
        isCancelled: () => id !== runId.current,
      });
      if (id === runId.current && r) setRes(r);
    } catch (e) {
      if (id === runId.current) setError(e.message);
    }
    if (id === runId.current) setProgress(null);
  };

  const a = res?.all;
  let verdict = null;
  if (a) {
    if (a.trades < 15) verdict = { cls: 'avoid', text: `Only ${a.trades} completed trades: too few to judge. Treat any edge as unproven.` };
    else if (a.avgR > 0.1 && a.profitFactor > 1.2) verdict = { cls: 'buy', text: 'The signals made money on this stock after costs: a historical edge (not a guarantee).' };
    else if (a.avgR >= -0.1) verdict = { cls: 'avoid', text: 'Roughly break-even after costs: no clear edge on this stock.' };
    else verdict = { cls: 'sell', text: 'The signals lost money on this stock after costs: be cautious with them here.' };
  }
  const trades = res ? [...res.trades].reverse() : [];
  const shownTrades = showAll ? trades : trades.slice(0, 15);

  return (
    <section className="card" aria-label="Backtest">
      <h2>
        Backtest: BUY &amp; SELL signals
        <span className="muted small">{STYLES[style].label} · {cfg.span}</span>
        <button type="button" className="btn" style={{ marginLeft: 'auto', width: 'auto', padding: '6px 14px' }} onClick={run} disabled={progress != null}>
          {progress != null ? `Testing… ${Math.round(progress * 100)}%` : res ? '↻ Run again' : '▶ Run backtest'}
        </button>
      </h2>

      {!res && progress == null && !error && (
        <p className="muted small" style={{ margin: 0 }}>
          Replays the {cfg.span} bar by bar. At each bar the analysis only sees the past; when it says BUY or SELL, the trade opens at the next bar's open with the plan's stop and target
          ({cfg.holdNote}). Uses your Risk plan settings, including costs.
        </p>
      )}
      {progress != null && <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>}
      {error && <div className="banner error">{error}</div>}

      {res && (
        <>
          <div className={`bt-verdict ${verdict.cls}`}>{verdict.text}</div>
          <div className="kpis bt-kpis">
            <div><span>Trades</span><b className="mono">{a.trades}</b></div>
            <div><span>Win rate</span><b className="mono">{a.winRate != null ? `${a.winRate.toFixed(0)}%` : '—'}</b></div>
            <div><span>Avg per trade</span><b className={`mono ${a.avgR > 0 ? 'pos' : a.avgR < 0 ? 'neg' : ''}`}>{sR(a.avgR)}</b></div>
            <div><span>Profit factor</span><b className="mono">{f(a.profitFactor)}</b></div>
            <div><span>Return @ {res.riskPct}% risk</span><b className={`mono ${res.totalReturn >= 0 ? 'pos' : 'neg'}`}>{pct(res.totalReturn, 1)}</b></div>
            <div><span>Max drawdown</span><b className="mono neg">{res.maxDD > 0 ? `−${res.maxDD.toFixed(1)}%` : '0%'}</b></div>
          </div>
          <p className="small muted" style={{ margin: '0 0 10px' }}>
            {when(res.from, intraday)} → {when(res.to, intraday)} · {res.barsTested.toLocaleString('en-IN')} bars tested · buy &amp; hold over the same period: <b className={res.buyHold >= 0 ? 'pos' : 'neg'}>{pct(res.buyHold, 1)}</b>
            {' '}· avg hold {f(a.avgBars, 1)} bars · exits: {Object.entries(res.reasons).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}
          </p>

          {res.curve.length > 1 && (
            <>
              <div className="eyebrow">Account growth from these signals (risking {res.riskPct}% per trade)</div>
              <EquityCurve curve={res.curve} />
            </>
          )}

          <div className="board board-2" style={{ marginTop: 12 }}>
            <SideStats label="BUY" cls="buy" s={res.buy} />
            <SideStats label="SELL" cls="sell" s={res.sell} />
          </div>

          {trades.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="signals">
                <thead><tr><th>Opened</th><th>Signal</th><th>Strategy</th><th className="num">Entry</th><th className="num">Exit</th><th>Closed</th><th>Reason</th><th className="num">Return</th><th className="num">R</th></tr></thead>
                <tbody>
                  {shownTrades.map((x) => (
                    <tr key={x.e}>
                      <td className="mono">{when(x.inTime, intraday)}</td>
                      <td><span className={`pill ${x.side === 'BUY' ? 'buy' : 'sell'}`}>{x.side}</span></td>
                      <td className="muted">{x.strategy || '—'}</td>
                      <td className="num mono">{num(x.entry)}</td>
                      <td className="num mono">{num(x.exit)}</td>
                      <td className="mono">{x.open ? '—' : when(x.outTime, intraday)}</td>
                      <td className="muted">{x.why}</td>
                      <td className={`num mono ${x.retPct >= 0 ? 'pos' : 'neg'}`}>{pct(x.retPct)}</td>
                      <td className={`num mono ${x.r >= 0 ? 'pos' : 'neg'}`}>{sR(x.r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {trades.length > 15 && (
                <button type="button" className="btn ghost" style={{ marginTop: 8 }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? 'Show fewer' : `Show all ${trades.length} trades`}
                </button>
              )}
            </div>
          )}

          <p className="note">
            R = result in units of the risk taken (+1R means you made what you risked; −1R is a full stop-loss). Costs of {settings.chargesPct}% per side are included; change them in the Risk plan.
            The past NIFTY trend isn't available, so the market filter is off in the test. Past results don't guarantee future ones.
          </p>
        </>
      )}
    </section>
  );
}
