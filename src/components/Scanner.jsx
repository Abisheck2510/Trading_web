import { useEffect, useMemo, useRef, useState } from 'react';
import { analyze, STYLES } from '../lib/analysis.js';
import { loadSymbol, loadUniverse, toYahoo, displaySymbol, NIFTY50, UNIVERSES } from '../lib/data.js';
import { num, pct, signed, store } from '../lib/format.js';

const DEFAULT_LIST = NIFTY50.join(', ');
const AUTO_SCAN_MAX = 500; // bigger lists wait for the Scan button
const FRESH_MS = 30 * 60 * 1000; // reuse a saved scan for 30 minutes
const LISTS = [
  { key: 'BUY', cls: 'buy', title: 'Buy list', sub: 'Signals aligned for a long entry' },
  { key: 'SELL', cls: 'sell', title: 'Sell list', sub: 'Signals aligned to the downside' },
  { key: 'AVOID', cls: 'avoid', title: 'Avoid list', sub: 'No high-probability setup' },
];

const cacheKey = (universe, style) => `scan:${universe}:${style}`;
const fmtDur = (ms) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

function ListCard({ def, rows, onOpen }) {
  const [limit, setLimit] = useState(100);
  const sorted = [...rows].sort((a, b) => (def.key === 'SELL' ? a.score - b.score : def.key === 'BUY' ? b.score - a.score : Math.abs(b.score) - Math.abs(a.score)));
  return (
    <div className="list-card">
      <div className={`list-head ${def.cls}`}><span>{def.title}</span><span className="count">{rows.length}</span></div>
      <div className="list-sub">{def.sub}</div>
      <ul className="stock-list">
        {sorted.length ? sorted.slice(0, limit).map((r) => (
          <li key={r.sym}>
            <button type="button" onClick={() => onOpen(r.sym)} title={`${r.name || ''} · open full analysis`}>
              <span className="sym">{displaySymbol(r.sym)}<small>{r.strat ? `${r.strat} · ` : ''}RSI {r.rsi != null ? r.rsi.toFixed(0) : '—'} · R:R {r.rr.toFixed(1)}</small></span>
              <span className="px mono">{num(r.price)}<br /><span className={r.chg >= 0 ? 'pos' : 'neg'}>{pct(r.chg)}</span></span>
              <span className={`pill ${def.cls}`}>{signed(r.score)}</span>
            </button>
          </li>
        )) : <li className="empty-li">No stocks here</li>}
        {sorted.length > limit && (
          <li><button type="button" className="more-btn" onClick={() => setLimit((l) => l + 200)}>Show {Math.min(200, sorted.length - limit)} more of {sorted.length - limit}</button></li>
        )}
      </ul>
    </div>
  );
}

export default function Scanner({ active, style, exchange, market, settings, fundamentals, onOpen }) {
  const [universe, setUniverse] = useState(() => store.get('scanUniverse', 'nifty50'));
  const [list, setList] = useState(() => store.get('watchlist', DEFAULT_LIST));
  const [rows, setRows] = useState([]);
  const [progress, setProgress] = useState(null);
  const [view, setView] = useState(() => store.get('scanView', 'lists'));
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('');
  const [sort, setSort] = useState({ key: 'score', dir: -1 });
  const [scannedAt, setScannedAt] = useState(null);
  const [error, setError] = useState(null);
  const runId = useRef(0);
  const U = UNIVERSES.find((u) => u.key === universe);

  useEffect(() => store.set('scanView', view), [view]);
  useEffect(() => store.set('scanUniverse', universe), [universe]);

  const save = (key, data) => {
    try { localStorage.setItem(`tsd:${key}`, JSON.stringify({ at: Date.now(), rows: data })); } catch { /* storage full or unavailable */ }
  };

  const symbolsFor = async () => {
    if (universe === 'custom') {
      store.set('watchlist', list);
      return [...new Set(list.split(/[\s,;]+/).map((s) => toYahoo(s, exchange)).filter(Boolean))].map((sym) => ({ sym, name: '', industry: '' }));
    }
    return loadUniverse(universe);
  };

  // Scan `items`; `keep` holds rows to retain (used by "retry failed").
  const scan = async (items, keep = []) => {
    const id = ++runId.current;
    setError(null);
    setRows(keep);
    const started = Date.now();
    setProgress({ done: 0, total: items.length, started });
    const big = items.length > 150;
    let cursor = 0;
    let done = 0;
    let buffer = [];
    const all = [...keep];
    const flush = () => {
      if (!buffer.length || id !== runId.current) return;
      const b = buffer;
      buffer = [];
      setRows((r) => [...r, ...b]);
      setProgress((p) => (p ? { ...p, done } : p));
    };
    const timer = setInterval(flush, 400);
    const worker = async () => {
      while (cursor < items.length && id === runId.current) {
        const it = items[cursor++];
        let row;
        try {
          const d = await loadSymbol(it.sym, style);
          if (d.source !== 'live') throw new Error('No live data (connection or rate limit)');
          const a = analyze(d.candles, { style, htf: d.htf, market, settings, fundamentals: fundamentals[it.sym] });
          const n = d.candles.length;
          const chg = ((d.candles[n - 1].close - d.candles[n - 2].close) / d.candles[n - 2].close) * 100;
          row = { sym: it.sym, name: it.name || d.meta?.name, industry: it.industry, price: a.price, chg, rsi: a.rsi, vol: a.volRatio, rr: a.plan.rr, score: a.score, verdict: a.verdict, strat: a.strategy?.name };
        } catch (e) {
          row = { sym: it.sym, name: it.name, industry: it.industry, error: e.message, score: -99, verdict: 'ERROR' };
        }
        if (id !== runId.current) return;
        done++;
        buffer.push(row);
        all.push(row);
      }
    };
    await Promise.all(Array.from({ length: big ? 8 : 4 }, worker));
    clearInterval(timer);
    if (id !== runId.current) return;
    flush();
    setProgress(null);
    setScannedAt(new Date());
    save(cacheKey(universe, style), all);
  };

  const run = async () => {
    try {
      const items = await symbolsFor();
      await scan(items);
    } catch (e) {
      setProgress(null);
      setError(e.message);
    }
  };

  const stop = () => {
    runId.current++;
    setProgress(null);
    setScannedAt(new Date());
  };

  const retryFailed = () => {
    const failed = rows.filter((r) => r.error).map((r) => ({ sym: r.sym, name: r.name, industry: r.industry }));
    scan(failed, rows.filter((r) => !r.error));
  };

  // On opening the tab, or changing list/style: reuse a fresh saved scan, else
  // auto-scan small lists; big lists wait for the Scan button.
  const lastKey = useRef(null);
  useEffect(() => {
    if (!active) return;
    const key = cacheKey(universe, style);
    if (lastKey.current === key) return;
    lastKey.current = key;
    runId.current++;
    setProgress(null);
    setSector('');
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(`tsd:${key}`) || 'null'); } catch { /* ignore */ }
    if (saved?.rows?.length && Date.now() - saved.at < FRESH_MS) {
      setRows(saved.rows);
      setScannedAt(new Date(saved.at));
    } else if (universe === 'custom' || (U?.approx ?? 0) <= AUTO_SCAN_MAX) {
      setRows([]);
      run();
    } else {
      setRows(saved?.rows || []);
      setScannedAt(saved ? new Date(saved.at) : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, style, universe]);

  const q = query.trim().toUpperCase();
  const match = (r) => (!q || r.sym.toUpperCase().includes(q) || (r.name || '').toUpperCase().includes(q)) && (!sector || r.industry === sector);
  const sectors = useMemo(() => [...new Set(rows.map((r) => r.industry).filter(Boolean))].sort(), [rows]);
  const good = rows.filter((r) => !r.error && match(r));
  const errors = rows.filter((r) => r.error);
  const shown = rows
    .filter((r) => match(r) && (filter === 'ALL' || r.verdict === filter))
    .sort((a, b) => {
      const x = a[sort.key] ?? -Infinity;
      const y = b[sort.key] ?? -Infinity;
      return typeof x === 'string' ? x.localeCompare(y) * sort.dir : (x - y) * sort.dir;
    });
  const counts = rows.reduce((c, r) => ({ ...c, [r.verdict]: (c[r.verdict] || 0) + 1 }), {});
  const th = (key, label, cls = '') => (
    <th className={`${cls} sortable`} aria-sort={sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
        {label}{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
  const busy = !!progress;
  const eta = busy && progress.done > 5 ? ((Date.now() - progress.started) / progress.done) * (progress.total - progress.done) : null;
  const estMin = U ? Math.max(1, Math.round((U.approx * 0.05) / 60)) : null;

  return (
    <section className="card" aria-label="Buy, sell and avoid lists">
      <h2>Buy / Sell / Avoid lists <span className="muted small">{STYLES[style].label} · {universe === 'custom' ? (exchange === 'NS' ? 'NSE' : 'BSE') : 'NSE'}{scannedAt && !busy ? ` · scanned ${scannedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}</span></h2>

      <div className="scan-bar">
        <label className="field scan-universe">
          <span>Stocks to scan</span>
          <select value={universe} onChange={(e) => setUniverse(e.target.value)} disabled={busy}>
            {UNIVERSES.map((u) => <option key={u.key} value={u.key}>{u.label} (~{u.approx.toLocaleString('en-IN')})</option>)}
            <option value="custom">My own list</option>
          </select>
        </label>
        <div className="scan-actions-row">
          {busy ? (
            <button type="button" className="btn ghost" onClick={stop}>■ Stop</button>
          ) : (
            <button type="button" className="btn" onClick={run}>▶ {rows.length ? 'Rescan' : 'Scan'}</button>
          )}
          {!busy && errors.length > 0 && <button type="button" className="btn ghost" onClick={retryFailed}>↻ Retry {errors.length} failed</button>}
        </div>
      </div>

      {universe === 'custom' && (
        <div className="scan-controls">
          <textarea value={list} onChange={(e) => setList(e.target.value)} rows={2} aria-label="Symbols to scan" spellCheck={false} />
          <div className="scan-actions"><button type="button" className="btn ghost" onClick={() => setList(DEFAULT_LIST)}>Reset to NIFTY 50</button></div>
        </div>
      )}

      {busy && (
        <>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
          <p className="small muted" style={{ margin: '-6px 0 12px' }}>
            Scanned {progress.done.toLocaleString('en-IN')} of {progress.total.toLocaleString('en-IN')}{eta != null ? ` · about ${fmtDur(eta)} left` : ''}. Results appear as they come in; you can stop at any time.
          </p>
        </>
      )}
      {error && <div className="banner error" style={{ marginBottom: 12 }}>{error}</div>}
      {!rows.length && !busy && !error && (
        <div className="empty">
          {universe !== 'custom' && (U?.approx ?? 0) > AUTO_SCAN_MAX
            ? <>Press <b>Scan</b> to analyse all ~{U.approx.toLocaleString('en-IN')} stocks in {U.label}. This takes about {estMin} minute{estMin > 1 ? 's' : ''}; results fill in as it goes and are saved for 30 minutes.</>
            : <>Press <b>Scan</b> to sort every stock into Buy, Sell and Avoid.</>}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="view-row">
            <div className="seg" role="radiogroup" aria-label="View">
              {[['lists', 'Lists'], ['table', 'Table']].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
              ))}
            </div>
            <div className="scan-filters">
              <input className="scan-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a stock…" aria-label="Find a stock in the results" />
              {sectors.length > 1 && (
                <select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Filter by industry">
                  <option value="">All industries</option>
                  {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>
            {view === 'table' && (
              <div className="filter-row" role="group" aria-label="Filter by verdict" style={{ margin: 0 }}>
                {['ALL', 'BUY', 'SELL', 'AVOID'].map((v) => (
                  <button key={v} type="button" className={`chip ${filter === v ? 'on' : ''}`} onClick={() => setFilter(v)}>
                    {v} {v === 'ALL' ? rows.length : counts[v] || 0}
                  </button>
                ))}
              </div>
            )}
          </div>

          {view === 'lists' ? (
            <div className="board">
              {LISTS.map((def) => <ListCard key={def.key} def={def} rows={good.filter((r) => r.verdict === def.key)} onOpen={onOpen} />)}
            </div>
          ) : (
            <div className="table-scroll" style={{ maxHeight: 640 }}>
              <table className="signals scan">
                <thead>
                  <tr>
                    {th('sym', 'Stock')}{th('price', 'Price', 'num')}{th('chg', 'Chg', 'num')}{th('rsi', 'RSI', 'num')}
                    {th('vol', 'Vol ×', 'num')}{th('rr', 'R:R', 'num')}{th('score', 'Score', 'num')}{th('verdict', 'Verdict')}
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 1000).map((r) => (
                    <tr key={r.sym} className="clickable" onClick={() => !r.error && onOpen(r.sym)} tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && !r.error && onOpen(r.sym)}>
                      <td><b>{displaySymbol(r.sym)}</b> <span className="muted small">{r.strat || ''}</span></td>
                      {r.error ? (
                        <td colSpan={7} className="muted">{r.error}</td>
                      ) : (
                        <>
                          <td className="num mono">{num(r.price)}</td>
                          <td className={`num mono ${r.chg >= 0 ? 'pos' : 'neg'}`}>{pct(r.chg)}</td>
                          <td className="num mono">{r.rsi != null ? r.rsi.toFixed(0) : '—'}</td>
                          <td className="num mono">{r.vol != null ? r.vol.toFixed(2) : '—'}</td>
                          <td className="num mono">{r.rr.toFixed(1)}</td>
                          <td className="num mono">{signed(r.score)}</td>
                          <td><span className={`pill ${r.verdict.toLowerCase()}`}>{r.verdict}</span></td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 1000 && <p className="note">Showing the first 1,000 rows; use the search or filters to narrow down.</p>}
            </div>
          )}
          <p className="note">
            Click a stock to open the full analysis. {(counts.BUY || 0) + (counts.SELL || 0) + (counts.AVOID || 0)} analysed
            {errors.length > 0 && <>, {errors.length} skipped (no data, too little history, or the data source was busy; use “Retry failed”)</>}.
          </p>
        </>
      )}
    </section>
  );
}
