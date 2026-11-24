import { useEffect, useRef, useState } from 'react';
import { analyze } from '../lib/analysis.js';
import { displaySymbol, loadQuotes, loadSymbol } from '../lib/data.js';
import { num, pct } from '../lib/format.js';
import SearchBox from './SearchBox.jsx';

export const DEFAULT_WATCHLISTS = [
  { name: 'Watchlist 1', symbols: ['RELIANCE.NS', 'HDFCBANK.NS', 'TCS.NS', 'INFY.NS', 'ICICIBANK.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'ITC.NS', 'LT.NS', 'TMPV.NS'] },
  { name: 'Watchlist 2', symbols: [] },
  { name: 'Watchlist 3', symbols: [] },
  { name: 'Watchlist 4', symbols: [] },
  { name: 'Watchlist 5', symbols: [] },
];

const QUOTE_MS = 60_000; // refresh prices every minute
const SIGNAL_MS = 10 * 60_000; // re-analyse every 10 minutes
const signalCache = new Map(); // `${sym}|${style}` -> { at, verdict, score }


export default function Watchlist({ lists, setLists, active, setActive, current, onOpen, style, market, settings, onHide }) {
  const [quotes, setQuotes] = useState({});
  const [signals, setSignals] = useState({});
  const [query, setQuery] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [editing, setEditing] = useState(false);
  const symbols = lists[active]?.symbols || [];
  const key = symbols.join(',');
  const marketRef = useRef(market);
  marketRef.current = market;

  // Live-ish prices.
  useEffect(() => {
    if (!symbols.length) return undefined;
    let live = true;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const rows = await loadQuotes(symbols, { concurrency: 6 });
      if (!live) return;
      setQuotes((q) => {
        const next = { ...q };
        for (const r of rows) next[r.sym] = r;
        return next;
      });
      setUpdatedAt(new Date());
    };
    load();
    const id = setInterval(load, QUOTE_MS);
    return () => { live = false; clearInterval(id); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // BUY / SELL / AVOID per stock for the current trading style.
  useEffect(() => {
    if (!symbols.length) return undefined;
    let live = true;
    const fromCache = {};
    for (const s of symbols) {
      const c = signalCache.get(`${s}|${style}`);
      if (c) fromCache[s] = c;
    }
    setSignals(fromCache);
    const todo = symbols.filter((s) => {
      const c = signalCache.get(`${s}|${style}`);
      return !c || Date.now() - c.at > SIGNAL_MS;
    });
    let cursor = 0;
    const worker = async () => {
      while (cursor < todo.length && live) {
        const sym = todo[cursor++];
        let res;
        try {
          const d = await loadSymbol(sym, style);
          if (d.source !== 'live') throw new Error('no live data');
          const a = analyze(d.candles, { style, htf: d.htf, market: marketRef.current, settings });
          res = { at: Date.now(), verdict: a.verdict, score: a.score };
        } catch {
          res = { at: Date.now(), verdict: null, score: null };
        }
        signalCache.set(`${sym}|${style}`, res);
        if (live) setSignals((s) => ({ ...s, [sym]: res }));
      }
    };
    Promise.all([worker(), worker(), worker()]);
    return () => { live = false; };
  }, [key, style]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateList = (fn) => setLists((ls) => ls.map((l, i) => (i === active ? { ...l, symbols: fn(l.symbols) } : l)));
  const add = (sym) => {
    updateList((s) => (s.includes(sym) ? s : [...s, sym]));
    setQuery('');
  };
  const remove = (sym) => updateList((s) => s.filter((x) => x !== sym));
  const move = (sym, dir) => updateList((s) => {
    const i = s.indexOf(sym);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.length) return s;
    const n = [...s];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  return (
    <aside className="watchlist" aria-label="Watchlist">
      <div className="wl-add">
        <SearchBox value={query} onChange={setQuery} onPick={(sym) => add(sym)} onSubmit={() => {}} placeholder="Search & add (e.g. infy, tata)" />
      </div>

      <div className="wl-head">
        <span>{lists[active]?.name} <span className="muted">({symbols.length})</span></span>
        <span className="wl-head-right">
          <span className="muted small">{updatedAt ? `Prices ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
          {symbols.length > 0 && (
            <button type="button" className="link-btn wl-edit" onClick={() => setEditing((e) => !e)} aria-pressed={editing}>{editing ? 'Done' : 'Edit'}</button>
          )}
          {onHide && <button type="button" className="wl-hide" onClick={onHide} aria-label="Hide watchlist" title="Hide watchlist">«</button>}
        </span>
      </div>

      <ul className={`wl-list ${editing ? 'editing' : ''}`}>
        {symbols.length === 0 && (
          <li className="wl-empty">This list is empty. Use the search above to add stocks.</li>
        )}
        {symbols.map((sym, k) => {
          const q = quotes[sym];
          const s = signals[sym];
          const up = q?.change >= 0;
          return (
            <li key={sym} className={`wl-row ${current === sym ? 'on' : ''}`}>
              <button type="button" className="wl-main" onClick={() => onOpen(sym)} title={q?.name || displaySymbol(sym)}>
                <span className="wl-sym">
                  <b>{displaySymbol(sym)}</b>
                  {s === undefined ? <i className="wl-sig loading" aria-label="Analysing">···</i>
                    : s?.verdict ? <i className={`wl-sig ${s.verdict.toLowerCase()}`}>{s.verdict}</i> : null}
                </span>
                <span className={`wl-px mono ${q && !q.error ? (up ? 'pos' : 'neg') : 'muted'}`}>{q && !q.error ? num(q.price) : q?.error ? 'n/a' : '—'}</span>
                <span className="wl-name muted">{sym.endsWith('.BO') ? 'BSE' : 'NSE'}</span>
                <span className={`wl-chg mono ${q && !q.error ? (up ? 'pos' : 'neg') : 'muted'}`}>
                  {q && !q.error ? <>{up ? '+' : ''}{num(q.change)} ({pct(q.changePct)})</> : ''}
                </span>
              </button>
              <span className="wl-actions">
                <button type="button" onClick={() => move(sym, -1)} disabled={k === 0} aria-label={`Move ${displaySymbol(sym)} up`} title="Move up">↑</button>
                <button type="button" onClick={() => move(sym, 1)} disabled={k === symbols.length - 1} aria-label={`Move ${displaySymbol(sym)} down`} title="Move down">↓</button>
                <button type="button" className="del" onClick={() => remove(sym)} aria-label={`Remove ${displaySymbol(sym)}`} title="Remove">✕</button>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="wl-tabs" role="tablist" aria-label="Watchlists">
        {lists.map((l, i) => (
          <button key={l.name} type="button" role="tab" aria-selected={i === active} className={i === active ? 'on' : ''} onClick={() => setActive(i)} title={`${l.name} (${l.symbols.length})`}>
            {i + 1}
          </button>
        ))}
      </div>
    </aside>
  );
}
