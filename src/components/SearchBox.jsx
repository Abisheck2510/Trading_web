import { useEffect, useRef, useState } from 'react';
import { loadUniverse } from '../lib/data.js';

// Search by ticker or company name, with suggestions from NSE's full equity list.
export default function SearchBox({ value, onChange, onPick, onSubmit, busy, placeholder = 'Search a stock: name or symbol' }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);

  const ensureList = () => {
    if (list) return;
    loadUniverse('all').then(setList).catch(() => loadUniverse('nifty50').then(setList).catch(() => {}));
  };

  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const q = value.trim().toUpperCase();
  let matches = [];
  if (list && q.length >= 1) {
    const scored = [];
    for (const it of list) {
      const base = it.sym.replace(/\.NS$/, '');
      const name = it.name.toUpperCase();
      let rank = -1;
      if (base === q) rank = 0;
      else if (base.startsWith(q)) rank = 1;
      else if (name.startsWith(q)) rank = 2;
      else if (q.length >= 2 && name.includes(q)) rank = 3;
      else if (q.length >= 2 && base.includes(q)) rank = 4;
      if (rank >= 0) scored.push({ ...it, base, rank });
    }
    matches = scored.sort((a, b) => a.rank - b.rank || a.base.length - b.base.length).slice(0, 8);
  }

  const pick = (it) => {
    setOpen(false);
    onPick(it.sym, it.base);
  };

  const onKey = (e) => {
    if (!open || !matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % matches.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); setOpen(false); onSubmit(); }}>
      <div className="search-box" ref={boxRef}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(0); }}
          onFocus={(e) => { ensureList(); e.target.select(); setOpen(true); }}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label="Search a stock by name or symbol"
          aria-autocomplete="list"
          aria-expanded={open && matches.length > 0}
          spellCheck={false}
          autoComplete="off"
        />
        {busy && <span className="spinner search-spin" aria-hidden="true" />}
        {open && matches.length > 0 && (
          <ul className="suggest" role="listbox">
            {matches.map((it, k) => (
              <li key={it.sym} role="option" aria-selected={k === hi}>
                <button type="button" className={k === hi ? 'on' : ''} onMouseEnter={() => setHi(k)} onClick={() => pick(it)}>
                  <b>{it.base}</b>
                  <span>{it.name}</span>
                  <i>NSE</i>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
