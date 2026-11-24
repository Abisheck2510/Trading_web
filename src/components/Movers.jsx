import { useEffect, useRef, useState } from 'react';
import { loadQuotes, loadUniverse, displaySymbol, UNIVERSES } from '../lib/data.js';
import { num, pct, store } from '../lib/format.js';

function MoverList({ title, cls, rows, onOpen }) {
  return (
    <div className="list-card">
      <div className={`list-head ${cls}`}><span>{title}</span><span className="count">Top {rows.length}</span></div>
      <ul className="stock-list">
        {rows.length ? rows.map((r, k) => (
          <li key={r.sym}>
            <button type="button" onClick={() => onOpen(r.sym)} title="Open full analysis">
              <span className="sym"><span className="rank">{k + 1}</span>{displaySymbol(r.sym)}<small>{r.name}</small></span>
              <span className="px mono">{num(r.price)}<br /><span className={r.change >= 0 ? 'pos' : 'neg'}>{r.change >= 0 ? '+' : ''}{num(r.change)}</span></span>
              <span className={`chg-pill ${r.changePct >= 0 ? 'pos' : 'neg'}`}>{pct(r.changePct)}</span>
            </button>
          </li>
        )) : <li className="empty-li">None today</li>}
      </ul>
    </div>
  );
}

export default function Movers({ active, onOpen }) {
  const [universe, setUniverse] = useState(() => store.get('moversUniverse', 'nifty50'));
  const [top, setTop] = useState(() => store.get('moversTop', 10));
  const [rows, setRows] = useState([]);
  const [progress, setProgress] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);
  const [error, setError] = useState(null);
  const [sector, setSector] = useState('');
  const loadedFor = useRef(null);
  const runId = useRef(0);
  const U = UNIVERSES.find((u) => u.key === universe);

  useEffect(() => store.set('moversUniverse', universe), [universe]);
  useEffect(() => store.set('moversTop', top), [top]);

  const load = async () => {
    const id = ++runId.current;
    setError(null);
    setSector('');
    try {
      const list = await loadUniverse(universe);
      const info = new Map(list.map((x) => [x.sym, x]));
      const started = Date.now();
      setProgress({ done: 0, total: list.length, started });
      let last = 0;
      const out = await loadQuotes(list.map((x) => x.sym), {
        concurrency: list.length > 150 ? 10 : 6,
        onProgress: (done, total) => {
          if (id !== runId.current) return;
          if (done === total || Date.now() - last > 300) { last = Date.now(); setProgress({ done, total, started }); }
        },
      });
      if (id !== runId.current) return;
      setRows(out.map((r) => ({ ...r, name: info.get(r.sym)?.name || r.name, industry: info.get(r.sym)?.industry || '' })));
      setLoadedAt(new Date());
    } catch (e) {
      if (id === runId.current) setError(e.message);
    }
    if (id === runId.current) setProgress(null);
  };

  useEffect(() => {
    if (active && loadedFor.current !== universe) {
      loadedFor.current = universe;
      setRows([]);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, universe]);

  const sectors = [...new Set(rows.map((r) => r.industry).filter(Boolean))].sort();
  const ok = rows.filter((r) => !r.error && (!sector || r.industry === sector));
  const gainers = ok.filter((r) => r.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, top);
  const losers = ok.filter((r) => r.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, top);
  const adv = ok.filter((r) => r.changePct > 0).length;
  const dec = ok.filter((r) => r.changePct < 0).length;
  const busy = !!progress;
  const failed = rows.filter((r) => r.error);
  const day = ok[0]?.day;
  const eta = busy && progress.done > 10 ? ((Date.now() - progress.started) / progress.done) * (progress.total - progress.done) / 1000 : null;

  return (
    <section className="card" aria-label="Day gainers and losers">
      <h2>
        Day gainers &amp; losers <span className="muted small">{U?.label} · NSE{day ? ` · ${day}` : ''}{loadedAt && !busy ? ` · updated ${loadedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      </h2>

      <div className="scan-bar">
        <label className="field scan-universe">
          <span>Stocks</span>
          <select value={universe} onChange={(e) => setUniverse(e.target.value)} disabled={busy}>
            {UNIVERSES.map((u) => <option key={u.key} value={u.key}>{u.label} (~{u.approx.toLocaleString('en-IN')})</option>)}
          </select>
        </label>
        <label className="field">
          <span>Show</span>
          <select value={top} onChange={(e) => setTop(Number(e.target.value))}>
            {[10, 25, 50, 100].map((t) => <option key={t} value={t}>Top {t}</option>)}
          </select>
        </label>
        {sectors.length > 1 && (
          <label className="field">
            <span>Industry</span>
            <select value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">All industries</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        <div className="scan-actions-row">
          <button type="button" className="btn ghost" onClick={load} disabled={busy}>{busy ? 'Loading…' : '↻ Refresh'}</button>
        </div>
      </div>

      {busy && (
        <>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
          <p className="small muted" style={{ margin: '-6px 0 12px' }}>
            Loaded {progress.done.toLocaleString('en-IN')} of {progress.total.toLocaleString('en-IN')} prices{eta != null ? ` · about ${Math.ceil(eta)}s left` : ''}
          </p>
        </>
      )}
      {error && <div className="banner error" style={{ marginBottom: 12 }}>{error}</div>}

      {ok.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="small muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span><b className="pos">{adv.toLocaleString('en-IN')}</b> advancing</span>
            <span>Market breadth{sector ? ` · ${sector}` : ''}</span>
            <span><b className="neg">{dec.toLocaleString('en-IN')}</b> declining</span>
          </div>
          <div className="breadth" aria-hidden="true">
            <div className="adv" style={{ width: `${(adv / ok.length) * 100}%` }} />
            <div className="dec" style={{ width: `${(dec / ok.length) * 100}%`, marginLeft: 'auto' }} />
          </div>
        </div>
      )}

      {ok.length > 0 ? (
        <div className="board board-2">
          <MoverList title="Top gainers" cls="up" rows={gainers} onOpen={onOpen} />
          <MoverList title="Top losers" cls="down" rows={losers} onOpen={onOpen} />
        </div>
      ) : (
        !busy && rows.length > 0 && <div className="banner error">Couldn't load prices. Check your connection, then press Refresh.</div>
      )}
      <p className="note">
        Change is the latest session's close (or live price during market hours) vs the previous close. Click a stock to analyse it.
        {failed.length > 0 && ok.length > 0 && <> {failed.length.toLocaleString('en-IN')} stock{failed.length > 1 ? 's' : ''} had no recent price data and were skipped.</>}
      </p>
    </section>
  );
}
