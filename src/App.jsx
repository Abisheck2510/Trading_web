import { useCallback, useEffect, useMemo, useState } from 'react';
import { analyze, DEFAULT_SETTINGS, STYLES } from './lib/analysis.js';
import { loadMarket, loadSymbol, toYahoo, displaySymbol, isIndex, INDEX_LIST } from './lib/data.js';
import { num, pct, store } from './lib/format.js';
import PriceChart from './components/PriceChart.jsx';
import Scanner from './components/Scanner.jsx';
import Movers from './components/Movers.jsx';
import SimpleChart from './components/SimpleChart.jsx';
import Backtest from './components/Backtest.jsx';
import SearchBox from './components/SearchBox.jsx';
import Watchlist, { DEFAULT_WATCHLISTS } from './components/Watchlist.jsx';
import { TakeCard } from './components/Overview.jsx';
import GetApp from './components/GetApp.jsx';
import { nextSession } from './lib/forecast.js';
import { Checklist, Fundamentals, Journal, NextSession, RiskPlan, SignalTable, StrategyPanel, VerdictCard } from './components/Panels.jsx';

const STYLE_SHORT = { intraday: 'Intraday', swing: 'Swing', positional: 'Positional' };
const STYLE_HINT = { intraday: 'Same-day trades', swing: 'Hold 2–15 days', positional: 'Hold weeks–months' };

const I = {
  watchlist: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  analysis: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  scanner: <path d="M4 6h16M4 12h10M4 18h6" />,
  movers: <path d="M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" />,
  journal: <path d="M6 3h11a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1zM9 8h6M9 12h6" />,
};
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[name]}</svg>
);

const TABS = [
  { key: 'watchlist', label: 'Watchlist', short: 'Watchlist', mobileOnly: true },
  { key: 'analysis', label: 'Stock', short: 'Stock' },
  { key: 'scanner', label: 'Buy / Sell / Avoid', short: 'Lists' },
  { key: 'movers', label: 'Gainers & Losers', short: 'Movers' },
  { key: 'journal', label: 'Journal', short: 'Journal' },
];

const SECTIONS = [
  { key: 'chart', label: 'Chart & indicators' },
  { key: 'strategies', label: 'Strategies' },
  { key: 'signals', label: 'All signals' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'plan', label: 'Risk & position size' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'backtest', label: 'Backtest' },
];

const POPULAR = ['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'ICICIBANK', 'SBIN', 'TMPV', 'ITC'];

function useTheme() {
  const [theme, setTheme] = useState(() => store.get('theme', window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store.set('theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function useIsMobile() {
  const q = '(max-width: 900px)';
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

function Skeleton() {
  return (
    <div className="overview" aria-busy="true" aria-label="Loading analysis">
      <div className="card skel" style={{ height: 420 }} />
      <div className="card skel" style={{ height: 420 }} />
    </div>
  );
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [input, setInput] = useState(() => displaySymbol(toYahoo(store.get('symbol', 'RELIANCE'), 'NS')));
  const [exchange, setExchange] = useState(() => store.get('exchange', 'NS'));
  const [style, setStyle] = useState(() => store.get('style', 'swing'));
  const [tab, setTab] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    return ['analysis', 'scanner', 'movers', 'journal', 'watchlist'].includes(q) ? q : store.get('tab', 'analysis');
  });
  const [section, setSection] = useState(() => store.get('section', 'chart'));
  const [recent, setRecent] = useState(() => store.get('recent', []));
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...store.get('settings', {}) }));
  const [fundamentals, setFundamentals] = useState(() => store.get('fundamentals', {}));
  const [journal, setJournal] = useState(() => store.get('journal', []));
  const [stock, setStock] = useState({ status: 'idle' });
  const [market, setMarket] = useState(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [loggedId, setLoggedId] = useState(null);
  const [lists, setLists] = useState(() => {
    const saved = store.get('watchlists', null);
    return Array.isArray(saved) && saved.length === 5 ? saved : DEFAULT_WATCHLISTS;
  });
  const [wlActive, setWlActive] = useState(() => store.get('wlActive', 0));
  const [wlOpen, setWlOpen] = useState(() => store.get('wlOpen', true));
  useEffect(() => store.set('wlOpen', wlOpen), [wlOpen]);
  const isMobile = useIsMobile();
  useEffect(() => store.set('watchlists', lists), [lists]);
  useEffect(() => store.set('wlActive', wlActive), [wlActive]);
  const view = !isMobile && tab === 'watchlist' ? 'analysis' : tab;
  const inWatchlist = stock.symbol ? lists[wlActive].symbols.includes(stock.symbol) : false;
  const toggleWatch = () => setLists((ls) => ls.map((l, i) => (i !== wlActive ? l : {
    ...l, symbols: l.symbols.includes(stock.symbol) ? l.symbols.filter((x) => x !== stock.symbol) : [...l.symbols, stock.symbol],
  })));

  useEffect(() => store.set('settings', settings), [settings]);
  useEffect(() => store.set('fundamentals', fundamentals), [fundamentals]);
  useEffect(() => store.set('journal', journal), [journal]);
  useEffect(() => store.set('recent', recent), [recent]);
  useEffect(() => store.set('tab', tab), [tab]);
  useEffect(() => store.set('section', section), [section]);

  const refreshMarket = useCallback(async () => {
    setMarketLoading(true);
    setMarket(await loadMarket());
    setMarketLoading(false);
  }, []);

  const run = useCallback(async (symbol, st) => {
    if (!symbol) return;
    setStock((s) => ({ ...s, status: 'loading', pending: symbol }));
    try {
      const d = await loadSymbol(symbol, st, { withDaily: true });
      setStock({ status: 'ready', symbol, style: st, ...d, loadedAt: new Date() });
      setRecent((r) => [symbol, ...r.filter((x) => x !== symbol)].slice(0, 8));
    } catch (e) {
      setStock({ status: 'error', symbol, error: e.message });
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') refreshMarket(); }, 60_000);
    return () => clearInterval(id);
  }, [refreshMarket]);

  useEffect(() => {
    refreshMarket();
    run(toYahoo(store.get('symbol', 'RELIANCE'), store.get('exchange', 'NS')), store.get('style', 'swing'));
  }, [refreshMarket, run]);

  const open = (sym, st = style) => {
    const base = displaySymbol(sym);
    setInput(base);
    store.set('symbol', base);
    setTab('analysis');
    setLoggedId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    run(sym, st);
  };

  const pickSuggestion = (sym) => {
    setExchange('NS');
    store.set('exchange', 'NS');
    open(sym);
  };

  const submit = () => {
    store.set('exchange', exchange);
    open(toYahoo(input, exchange));
  };

  const changeStyle = (k) => {
    setStyle(k);
    store.set('style', k);
    if (stock.symbol) run(stock.symbol, k);
  };

  const ready = stock.status === 'ready' || (stock.status === 'loading' && stock.candles);
  const analysis = useMemo(() => {
    if (!stock.candles) return { error: null, a: null };
    try {
      return { a: analyze(stock.candles, { style: stock.style, htf: stock.htf, market, settings, fundamentals: fundamentals[stock.symbol] }) };
    } catch (e) {
      return { error: e.message };
    }
  }, [stock.candles, stock.htf, stock.style, stock.symbol, market, settings, fundamentals]);
  const a = analysis.a;
  const outlook = useMemo(
    () => nextSession(stock.daily || (stock.style === 'swing' ? stock.candles : null), market),
    [stock.daily, stock.candles, stock.style, market],
  );

  const logSetup = () => {
    if (!a) return;
    const p = a.plan;
    const id = Date.now();
    setJournal((j) => [{
      id, date: new Date().toISOString().slice(0, 10), symbol: displaySymbol(stock.symbol), style: STYLE_SHORT[stock.style],
      verdict: a.verdict, entry: p.entry, stop: p.stop, target: p.target, qty: p.qty, outcome: 'open',
    }, ...j]);
    setLoggedId(`${stock.symbol}|${stock.style}`);
  };

  const showDetails = (k = 'plan') => {
    setSection(k);
    document.getElementById('details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openTrades = journal.filter((e) => e.outcome === 'open').length;
  const loading = stock.status === 'loading';
  const name = stock.meta?.name && stock.meta.name !== displaySymbol(stock.symbol || '') ? stock.meta.name : '';

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
          {!isMobile && (
            <button type="button" className={`wl-toggle ${wlOpen ? 'on' : ''}`} onClick={() => setWlOpen((o) => !o)}
              aria-pressed={wlOpen} aria-label={wlOpen ? 'Hide watchlist' : 'Show watchlist'} title={wlOpen ? 'Hide watchlist' : 'Show watchlist'}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" />{wlOpen ? <path d="M15 10l-2 2 2 2" /> : <path d="M13 10l2 2-2 2" />}
              </svg>
            </button>
          )}
            <span className="logo" aria-hidden="true"><Icon name="analysis" /></span>
            <div>
              <h1>Trade Signal Desk</h1>
              <p>NSE / BSE stock signals</p>
            </div>
          </div>

          <div className="search-wrap">
            <SearchBox value={input} onChange={setInput} onPick={pickSuggestion} onSubmit={submit} busy={loading} />
            <div className="seg seg-sm" role="radiogroup" aria-label="Exchange">
              {[['NS', 'NSE'], ['BO', 'BSE']].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={exchange === k} className={exchange === k ? 'on' : ''} onClick={() => setExchange(k)}>{l}</button>
              ))}
            </div>
          </div>

          <div className="top-right">
            <GetApp />
            <button type="button" className="theme-btn" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title="Light / dark theme">
              {theme === 'dark'
                ? <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
                : <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
            </button>
          </div>
        </div>

        <div className="topbar-inner subbar">
          <nav className="tabs" aria-label="Main sections">
            {TABS.filter((t) => !t.mobileOnly).map((t) => (
              <button key={t.key} type="button" className={`tab ${view === t.key ? 'on' : ''}`} aria-current={view === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
                <Icon name={t.key} />{t.label}
                {t.key === 'journal' && openTrades > 0 && <span className="count">{openTrades}</span>}
              </button>
            ))}
          </nav>
          <div className="style-pick">
            <span className="muted small">Trading style</span>
            <div className="seg" role="radiogroup" aria-label="Trading style">
              {Object.keys(STYLES).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={style === k} title={`${STYLE_HINT[k]} · ${STYLES[k].desc}`} className={style === k ? 'on' : ''} onClick={() => changeStyle(k)}>{STYLE_SHORT[k]}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="index-bar" aria-label="Market indices">
          <div className="index-scroll">
            {INDEX_LIST.map((ix) => {
              const d = market?.[ix.key];
              const up = d ? d.change >= 0 : true;
              const good = ix.inverse ? !up : up;
              return (
                <button key={ix.key} type="button" className="ix" onClick={() => open(ix.sym)} title={`Open ${ix.label} chart`}>
                  <span className="ix-label">{ix.label}</span>
                  {d ? (
                    <>
                      <b className="mono">{num(d.last)}</b>
                      <em className={`mono ${good ? 'pos' : 'neg'}`}>{up ? '▲' : '▼'} {pct(d.changePct)}</em>
                    </>
                  ) : <em className="muted">{marketLoading ? '…' : '—'}</em>}
                </button>
              );
            })}
          </div>
          <button type="button" className="ix-refresh" onClick={refreshMarket} disabled={marketLoading} aria-label="Refresh indices" title="Refresh (auto every minute)">
            <svg className={marketLoading ? 'spin' : ''} viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
          </button>
        </div>
      </header>

      <div className={`layout ${!isMobile && !wlOpen ? 'no-wl' : ''}`}>
        {((!isMobile && wlOpen) || (isMobile && tab === 'watchlist')) && (
          <Watchlist lists={lists} setLists={setLists} active={wlActive} setActive={setWlActive} current={stock.symbol}
            onOpen={(sym) => open(sym)} style={style} market={market} settings={settings} onHide={isMobile ? null : () => setWlOpen(false)} />
        )}
      <div className="app" hidden={isMobile && tab === 'watchlist'}>
        <div hidden={view !== 'analysis'} className="tab-panel">

          {stock.status === 'error' && (
            <div className="card empty-state">
              <div className="empty-icon" aria-hidden="true">?</div>
              <h3>Couldn't find “{displaySymbol(stock.symbol || '')}”</h3>
              <p className="muted">{stock.error}. Start typing a company name in the search box and pick it from the list, or try one of these:</p>
              <div className="recent" style={{ justifyContent: 'center' }}>
                {POPULAR.map((s) => <button key={s} type="button" className="chip" onClick={() => open(`${s}.NS`)}>{s}</button>)}
              </div>
            </div>
          )}
          {stock.source === 'simulated' && ready && (
            <div className="banner warn">Live data unavailable ({stock.warning}). Showing <b>simulated</b> prices so you can explore. Do not trade on these numbers.</div>
          )}
          {analysis.error && <div className="banner error">{analysis.error}</div>}

          {ready && a ? (
            <main className={loading ? 'is-refreshing' : ''}>
              <div className="overview">
                <SimpleChart symbol={stock.symbol}>
                  <div className="stock-id">
                    <div>
                      <h2 className="stock-name">{displaySymbol(stock.symbol)}</h2>
                      <div className="muted small">{name}{name ? ' · ' : ''}{stock.meta.exchange || (stock.symbol.endsWith('.BO') ? 'BSE' : 'NSE')}</div>
                    </div>
                    <div className="stock-id-right">
                      <div className="small muted live-note">
                        <span className={`dot ${stock.source === 'live' ? 'live' : 'sim'}`} />
                        {stock.source === 'live' ? 'Live · may be delayed' : 'Simulated'}{loading ? ' · refreshing…' : ''}
                      </div>
                      <button type="button" className={`watch-btn ${inWatchlist ? 'on' : ''}`} onClick={toggleWatch} aria-pressed={inWatchlist}>
                        {inWatchlist ? '★ In watchlist' : '☆ Add to watchlist'}
                      </button>
                    </div>
                  </div>
                </SimpleChart>
                <TakeCard index={isIndex(stock.symbol)} a={a} style={stock.style} outlook={outlook} settings={settings} onLog={logSetup} onMore={() => showDetails('plan')}
                  logged={loggedId === `${stock.symbol}|${stock.style}`} />
              </div>

              <div id="details" className="details">
                <nav className="section-tabs" aria-label="Analysis details">
                  {SECTIONS.map((s) => (
                    <button key={s.key} type="button" className={section === s.key ? 'on' : ''} aria-pressed={section === s.key} onClick={() => setSection(s.key)}>{s.label}</button>
                  ))}
                </nav>

                <div hidden={section !== 'chart'}>
                  <section className="card chart-card">
                    <PriceChart candles={stock.candles} analysis={a} intraday={stock.style === 'intraday'} />
                  </section>
                </div>
                <div hidden={section !== 'strategies'}><StrategyPanel a={a} /></div>
                <div hidden={section !== 'signals'} className="two-col">
                  <SignalTable signals={a.signals} />
                  <VerdictCard a={a} />
                </div>
                <div hidden={section !== 'tomorrow'} className="narrow"><NextSession f={outlook} verdict={a.verdict} market={market} /></div>
                <div hidden={section !== 'plan'} className="narrow"><RiskPlan a={a} settings={settings} setSettings={setSettings} onLog={logSetup} /></div>
                <div hidden={section !== 'checklist'} className="two-col even">
                  <Checklist items={a.checklist} />
                  <Fundamentals symbol={stock.symbol} values={fundamentals[stock.symbol] || {}}
                    onChange={(v) => setFundamentals((f) => ({ ...f, [stock.symbol]: v }))} />
                </div>
                <div hidden={section !== 'backtest'}><Backtest symbol={stock.symbol} style={stock.style} settings={settings} /></div>
              </div>
            </main>
          ) : (
            loading && <Skeleton />
          )}
        </div>

        <div hidden={view !== 'scanner'} className="tab-panel">
          <Scanner active={view === 'scanner'} style={style} exchange={exchange} market={market} settings={settings} fundamentals={fundamentals} onOpen={(sym) => open(sym)} />
        </div>

        <div hidden={view !== 'movers'} className="tab-panel">
          <Movers active={view === 'movers'} onOpen={(sym) => open(sym)} />
        </div>

        <div hidden={view !== 'journal'} className="tab-panel">
          <Journal entries={journal}
            onUpdate={(id, outcome) => setJournal((j) => j.map((e) => (e.id === id ? { ...e, outcome } : e)))}
            onRemove={(id) => setJournal((j) => j.filter((e) => e.id !== id))} />
        </div>

        <footer className="footer">
          Educational tool, not investment advice. Signals are rule-based and can be wrong. Always use a stop-loss, never risk your entire capital on one trade,
          and account for brokerage, taxes and slippage. Check SEBI-registered advice before acting.
          <div className="credit">Charts: <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a> · Market data: Yahoo Finance · Stock lists: NSE</div>
        </footer>
      </div>
      </div>

      <nav className="bottom-nav" aria-label="Main sections">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={view === t.key ? 'on' : ''} aria-current={view === t.key ? 'page' : undefined} onClick={() => { setTab(t.key); window.scrollTo({ top: 0 }); }}>
            <Icon name={t.key} />
            <span>{t.short}</span>
            {t.key === 'journal' && openTrades > 0 && <i>{openTrades}</i>}
          </button>
        ))}
      </nav>
    </>
  );
}
