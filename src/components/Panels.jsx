import { FUND_FIELDS, fundamentalChecks } from '../lib/analysis.js';
import { inr, num, pct, signed } from '../lib/format.js';

export function Sparkline({ values, up }) {
  if (!values?.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, k) => `${(k / (values.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 26}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? 'var(--buy)' : 'var(--sell)'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function MarketStrip({ market, loading, onRefresh }) {
  const tiles = [
    { key: 'nifty', label: 'NIFTY 50' },
    { key: 'banknifty', label: 'BANK NIFTY' },
    { key: 'vix', label: 'INDIA VIX', inverse: true },
  ];
  return (
    <section className="market-strip" aria-label="Market sentiment">
      {tiles.map((t) => {
        const d = market?.[t.key];
        const up = d ? d.change >= 0 : true;
        let tag = null;
        if (d && t.key === 'vix') tag = d.last > 20 ? { cls: 'sell', txt: 'High fear' } : d.last < 14 ? { cls: 'buy', txt: 'Calm' } : { cls: 'avoid', txt: 'Normal' };
        else if (d) tag = d.above20 ? { cls: 'buy', txt: 'Uptrend' } : { cls: 'sell', txt: 'Downtrend' };
        return (
          <div className="tile" key={t.key}>
            <div className="tile-head"><span>{t.label}</span>{tag && <span className={`tag ${tag.cls}`}>{tag.txt}</span>}</div>
            {d ? (
              <>
                <div className="tile-val mono">{num(d.last)}</div>
                <div className={`tile-chg mono ${(t.inverse ? !up : up) ? 'pos' : 'neg'}`}>{signed(d.change, 2)} ({pct(d.changePct)})</div>
                <Sparkline values={d.spark} up={t.inverse ? !up : up} />
              </>
            ) : (
              <div className="tile-empty">{loading ? 'Loading…' : 'Unavailable'}</div>
            )}
          </div>
        );
      })}
      <button type="button" className="refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh market data" title="Refresh market data">
        <svg className={loading ? 'spin' : ''} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
      </button>
    </section>
  );
}

const VERDICT_COPY = {
  BUY: 'Signals align for a long entry',
  SELL: 'Signals align to the downside: exit longs, or short (intraday/F&O only)',
  AVOID: 'No high-probability setup: stay out',
};

export function VerdictCard({ a }) {
  const scale = 12;
  const pos = Math.max(-scale, Math.min(scale, a.score));
  const left = ((pos + scale) / (2 * scale)) * 100;
  const th = (a.threshold / scale) * 50;
  return (
    <section className={`card verdict v-${a.verdict.toLowerCase()}`} aria-label="Verdict">
      <div className="verdict-top">
        <div>
          <div className="eyebrow">Verdict</div>
          <div className="verdict-word">{a.verdict}</div>
          <div className="verdict-sub">{VERDICT_COPY[a.verdict]}</div>
        </div>
        <div className="score-box">
          <div className="eyebrow">Score</div>
          <div className="score mono">{signed(a.score)}</div>
          <div className="muted small">needs ±{a.threshold}</div>
        </div>
      </div>
      <div className="meter" aria-hidden="true">
        <div className="meter-zone sell" style={{ width: `${50 - th}%` }} />
        <div className="meter-zone buy" style={{ width: `${50 - th}%` }} />
        <div className="meter-needle" style={{ left: `${left}%` }} />
      </div>
      <div className="meter-labels small muted"><span>SELL</span><span>AVOID</span><span>BUY</span></div>

      {a.reasons.length > 0 && (
        <ul className="reasons">
          {a.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <div className="why-grid">
        <div>
          <div className="eyebrow">{a.plan.dir === 'long' ? 'Bullish drivers' : 'Bearish drivers'}</div>
          <ul className="mini-list">
            {a.drivers.length ? a.drivers.map((s) => <li key={s.name}><span>{s.name}</span><b className={s.score > 0 ? 'pos' : 'neg'}>{signed(s.score)}</b></li>) : <li className="muted">None</li>}
          </ul>
        </div>
        <div>
          <div className="eyebrow">Working against</div>
          <ul className="mini-list">
            {a.against.length ? a.against.map((s) => <li key={s.name}><span>{s.name}</span><b className={s.score > 0 ? 'pos' : 'neg'}>{signed(s.score)}</b></li>) : <li className="muted">None</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}

const STATUS_ICON = { pass: '✓', warn: '!', fail: '✕', na: '–' };

export function Checklist({ items }) {
  return (
    <details className="card collapsible" open aria-label="Pre-trade checklist">
      <summary><h2>Pre-trade checklist <span className="muted small">{items.filter((c) => c.status === 'pass').length}/{items.length} passed</span></h2></summary>
      <ol className="checklist">
        {items.map((c) => (
          <li key={c.label} className={c.status}>
            <span className="ck" aria-label={c.status}>{STATUS_ICON[c.status]}</span>{c.label}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function SignalTable({ signals }) {
  const groups = [...new Set(signals.map((s) => s.group))];
  return (
    <section className="card" aria-label="Signal breakdown">
      <h2>Signal breakdown</h2>
      <div className="table-scroll">
        <table className="signals">
          <thead><tr><th>Parameter</th><th>Value</th><th className="num">Score</th><th>Reading</th></tr></thead>
          {groups.map((g) => (
            <tbody key={g}>
              <tr className="group-row"><td colSpan={4}>{g}</td></tr>
              {signals.filter((s) => s.group === g).map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td className="mono">{s.value}</td>
                  <td className="num"><span className={`pill ${s.score > 0 ? 'buy' : s.score < 0 ? 'sell' : 'neutral'}`}>{s.score === 0 ? '0' : signed(s.score)}</span></td>
                  <td className="muted">{s.note}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, suffix, step = 'any' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-wrap">
        <input type="number" inputMode="decimal" step={step} value={value} onChange={(e) => onChange(e.target.value)} />
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  );
}

export function RiskPlan({ a, settings, setSettings, onLog }) {
  const p = a.plan;
  const set = (k) => (v) => setSettings((s) => ({ ...s, [k]: v }));
  const long = p.dir === 'long';
  return (
    <section className="card" aria-label="Risk plan">
      <h2>Risk / reward plan <span className={`tag ${long ? 'buy' : 'sell'}`}>{long ? 'Long setup' : 'Short / exit setup'}</span></h2>
      <div className="fields">
        <Field label="Capital" value={settings.capital} onChange={set('capital')} suffix="₹" step="1000" />
        <Field label="Risk per trade" value={settings.riskPct} onChange={set('riskPct')} suffix="%" step="0.25" />
        <Field label="Min reward:risk" value={settings.minRR} onChange={set('minRR')} suffix=": 1" step="0.5" />
        <Field label="Charges + slippage" value={settings.chargesPct} onChange={set('chargesPct')} suffix="% / side" step="0.05" />
      </div>
      <div className="levels">
        <div><span>Entry</span><b className="mono">{inr(p.entry)}</b></div>
        <div><span>Stop-loss</span><b className="mono neg">{inr(p.stop)}</b>{p.stopNote && <em>{p.stopNote}</em>}</div>
        <div><span>Target</span><b className="mono pos">{inr(p.target)}</b><em>{p.targetNote}</em></div>
      </div>
      <div className="stats">
        <div><span>Risk / share</span><b className="mono">{inr(p.riskPS)}</b></div>
        <div><span>Reward / share</span><b className="mono">{inr(p.rewardPS)}</b></div>
        <div><span>Reward : risk</span><b className={`mono ${p.rr >= Number(settings.minRR) ? 'pos' : 'neg'}`}>1 : {num(p.rr, 1)}</b></div>
        <div><span>Position size</span><b className="mono">{num(p.qty, 0)} sh</b></div>
        <div><span>Capital used</span><b className="mono">{inr(p.capitalUsed, 0)}</b></div>
        <div><span>Max loss (incl. costs)</span><b className="mono neg">{inr(p.maxLoss, 0)}</b></div>
        <div><span>Profit at target (net)</span><b className="mono pos">{inr(p.profit, 0)}</b></div>
        <div><span>Est. charges</span><b className="mono">{inr(p.charges, 0)}</b></div>
        <div><span>Trailing stop (3 ATR)</span><b className="mono">{inr(p.trail)}</b></div>
      </div>
      {a.strategy && <p className="note"><b>Exit plan ({a.strategy.name}):</b> {a.strategy.rule}</p>}
      {p.cappedByCapital && <p className="note">Position capped by available capital (no leverage assumed).</p>}
      <p className="note">Risking {inr(p.riskAmt, 0)} ({settings.riskPct}% of capital). Stop sits just beyond the nearest {long ? 'support' : 'resistance'} (min 1 × ATR away), or 1.5 × ATR when none is close.</p>
      <button type="button" className="btn" onClick={onLog}>＋ Log this setup to journal</button>
    </section>
  );
}

export function Fundamentals({ symbol, values, onChange }) {
  const fc = fundamentalChecks(values);
  const base = symbol.replace(/\.(NS|BO)$/, '');
  return (
    <details className="card collapsible" open={fc.count > 0} aria-label="Fundamentals">
      <summary><h2>Fundamentals <span className="muted small">{fc.count > 0 ? `${fc.rules.filter((r) => r.ok).length}/${fc.count} pass` : 'optional · per stock'}</span></h2></summary>
      <p className="note">Enter figures from the latest results (e.g. on <a href={`https://www.screener.in/company/${encodeURIComponent(base)}/`} target="_blank" rel="noreferrer">Screener.in ↗</a>). Each pass/fail adds ±0.25 to the score (max ±1).</p>
      <div className="fields">
        {FUND_FIELDS.map((fd) => (
          <Field key={fd.key} label={fd.label} value={values[fd.key] ?? ''} onChange={(v) => onChange({ ...values, [fd.key]: v })} />
        ))}
      </div>
      {fc.count > 0 && (
        <ul className="fund-checks">
          {fc.rules.filter((r) => r.ok != null).map((r) => (
            <li key={r.label} className={r.ok ? 'pass' : 'fail'}><span className="ck">{r.ok ? '✓' : '✕'}</span>{r.label}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function Journal({ entries, onUpdate, onRemove }) {
  if (!entries.length) {
    return (
      <section className="card" aria-label="Trade journal">
        <h2>Trade journal</h2>
        <p className="muted">No setups logged yet. Use “Log this setup” to record a trade, then mark the outcome later so you can review what works.</p>
      </section>
    );
  }
  const closed = entries.filter((e) => e.outcome === 'win' || e.outcome === 'loss');
  const wins = closed.filter((e) => e.outcome === 'win').length;
  return (
    <section className="card" aria-label="Trade journal">
      <h2>Trade journal</h2>
      <div className="kpis">
        <div><span>Setups logged</span><b className="mono">{entries.length}</b></div>
        <div><span>Open</span><b className="mono">{entries.filter((e) => e.outcome === 'open').length}</b></div>
        <div><span>Closed</span><b className="mono">{closed.length}</b></div>
        <div><span>Win rate</span><b className={`mono ${closed.length ? (wins / closed.length >= 0.5 ? 'pos' : 'neg') : ''}`}>{closed.length ? `${Math.round((wins / closed.length) * 100)}%` : '—'}</b></div>
      </div>
      <div className="table-scroll">
        <table className="signals">
          <thead><tr><th>Date</th><th>Stock</th><th>Call</th><th className="num">Entry</th><th className="num">Stop</th><th className="num">Target</th><th className="num">Qty</th><th>Outcome</th><th /></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.date}</td>
                <td>{e.symbol} <span className="muted small">{e.style}</span></td>
                <td><span className={`pill ${e.verdict.toLowerCase()}`}>{e.verdict}</span></td>
                <td className="num mono">{num(e.entry)}</td>
                <td className="num mono">{num(e.stop)}</td>
                <td className="num mono">{num(e.target)}</td>
                <td className="num mono">{e.qty}</td>
                <td>
                  <select value={e.outcome} onChange={(ev) => onUpdate(e.id, ev.target.value)} aria-label="Outcome">
                    <option value="open">Open</option><option value="win">Target hit</option><option value="loss">Stopped out</option><option value="skipped">Skipped</option>
                  </select>
                </td>
                <td><button type="button" className="icon-btn" onClick={() => onRemove(e.id)} aria-label="Remove entry">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function NextSession({ f, verdict, market }) {
  if (!f) {
    return (
      <section className="card" aria-label="Tomorrow's price estimate">
        <h2>Tomorrow's price estimate</h2>
        <p className="muted small">Needs at least 60 days of price history.</p>
      </section>
    );
  }
  const [lo, hi] = f.range95;
  const span = hi - lo || 1;
  const at = (v) => `${Math.max(0, Math.min(100, ((v - lo) / span) * 100))}%`;
  const day = f.nextDay.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const lean = { BUY: 'Signals lean up', SELL: 'Signals lean down', AVOID: 'No clear direction' }[verdict];
  const nifty = market?.nifty;
  const vix = market?.vix;
  const mkt = nifty ? (nifty.above20 ? 'Uptrend' : 'Downtrend') : '—';
  const posVsPivot = f.close >= f.pivots.P ? 'Above pivot' : 'Below pivot';
  return (
    <section className="card" aria-label="Next session range">
      <h2>Tomorrow's price estimate <span className="muted small">{day}</span></h2>
      <div className={`ns-est ns-${f.bias}`}>
        <div>
          <div className="eyebrow">Estimated close</div>
          <div className="ns-est-price mono">{inr(f.estimate)}</div>
          <div className={`mono small ${f.estPct >= 0 ? 'pos' : 'neg'}`}>{f.estPct >= 0 ? '▲' : '▼'} {inr(Math.abs(f.estimate - f.close))} ({pct(f.estPct)}) from {inr(f.close)}</div>
        </div>
        <div className="ns-bias">
          <span className={`tag ${f.bias === 'up' ? 'buy' : f.bias === 'down' ? 'sell' : 'avoid'}`}>
            {f.bias === 'up' ? 'Upward bias' : f.bias === 'down' ? 'Downward bias' : 'Flat / no bias'}
          </span>
          <div className="small muted">Strength {f.strength >= 0.5 ? 'strong' : f.strength >= 0.25 ? 'moderate' : 'weak'}</div>
        </div>
      </div>
      <ul className="mini-list ns-drivers">
        <li><span>Stock's 20-day trend</span><b className={f.drivers.trendPct >= 0 ? 'pos' : 'neg'}>{pct(f.drivers.trendPct, 2)}/day</b></li>
        <li><span>Price vs 20 / 50 EMA</span><b className={f.drivers.align > 0 ? 'pos' : f.drivers.align < 0 ? 'neg' : 'muted'}>{f.drivers.align > 0 ? 'Aligned up' : f.drivers.align < 0 ? 'Aligned down' : 'Mixed'}</b></li>
        <li><span>MACD momentum</span><b className={f.drivers.momentum > 0 ? 'pos' : 'neg'}>{f.drivers.momentum > 0 ? 'Rising' : 'Falling'}</b></li>
        <li><span>Market (NIFTY 50)</span><b className={f.drivers.market > 0 ? 'pos' : f.drivers.market < 0 ? 'neg' : 'muted'}>{f.drivers.market > 0 ? 'Uptrend' : f.drivers.market < 0 ? 'Downtrend' : 'n/a'}</b></li>
      </ul>
      <div className="ns-head" style={{ marginTop: 12 }}>
        <div>
          <div className="eyebrow">Likely range (~68%)</div>
          <div className="ns-range mono"><span className="neg">{inr(f.range68[0])}</span> – <span className="pos">{inr(f.range68[1])}</span></div>
        </div>
        <div className="ns-sigma">
          <div className="eyebrow">Typical move</div>
          <div className="mono">±{f.sigmaPct.toFixed(2)}%</div>
        </div>
      </div>
      <div className="ns-bar" aria-hidden="true">
        <div className="ns-band" style={{ left: at(f.range68[0]), width: `calc(${at(f.range68[1])} - ${at(f.range68[0])})` }} />
        {['S1', 'P', 'R1'].map((k) => <i key={k} className={`ns-tick t-${k}`} style={{ left: at(f.pivots[k]) }} title={`${k} ${num(f.pivots[k])}`} />)}
        <b className="ns-now" style={{ left: at(f.close) }} />
      </div>
      <div className="ns-scale mono small muted"><span>{num(lo)}</span><span>Wide range (~95%)</span><span>{num(hi)}</span></div>
      <div className="pivots">
        {['S2', 'S1', 'P', 'R1', 'R2'].map((k) => (
          <div key={k} className={`pv-${k}`}><span>{k === 'P' ? 'Pivot' : k}</span><b className="mono">{num(f.pivots[k])}</b></div>
        ))}
      </div>
      <div className="stats">
        <div><span>Last close ({f.basisDay})</span><b className="mono">{inr(f.close)}</b></div>
        <div><span>Daily ATR (14)</span><b className="mono">{inr(f.atr)}</b></div>
        <div><span>Up days (last 20)</span><b className="mono">{f.upDays}/20</b></div>
        <div><span>Chart signals</span><b className={verdict === 'BUY' ? 'pos' : verdict === 'SELL' ? 'neg' : ''}>{lean}</b></div>
        <div><span>Close vs pivot</span><b className={f.close >= f.pivots.P ? 'pos' : 'neg'}>{posVsPivot}</b></div>
        <div><span>NIFTY 50 trend</span><b className={nifty ? (nifty.above20 ? 'pos' : 'neg') : ''}>{mkt}</b></div>
        <div><span>India VIX</span><b className={`mono ${vix ? (vix.last > 20 ? 'neg' : 'pos') : ''}`}>{vix ? `${num(vix.last)}${vix.last > 20 ? ' · wide swings' : ''}` : '—'}</b></div>
      </div>
      {f.backtest && (
        <div className="ns-test">
          <div className="eyebrow">How this estimate did over the last {f.backtest.sessions} sessions</div>
          <div className="ns-test-grid">
            <div><b className={`mono ${f.backtest.dirHitPct >= 55 ? 'pos' : f.backtest.dirHitPct < 50 ? 'neg' : ''}`}>{f.backtest.dirHitPct != null ? `${f.backtest.dirHitPct.toFixed(0)}%` : '—'}</b><span>direction right ({f.backtest.dirCalls} calls)</span></div>
            <div><b className={`mono ${f.backtest.avgMissPct <= f.backtest.naiveMissPct ? 'pos' : 'neg'}`}>{f.backtest.avgMissPct.toFixed(2)}%</b><span>average miss (vs {f.backtest.naiveMissPct.toFixed(2)}% if you assumed no change)</span></div>
            <div><b className="mono">{f.backtest.insidePct.toFixed(0)}%</b><span>closed inside range</span></div>
          </div>
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            {f.backtest.dirHitPct == null ? 'Too few directional calls to judge.'
              : f.backtest.dirHitPct >= 55 ? 'The trend has carried over more often than not for this stock recently.'
              : f.backtest.dirHitPct >= 50 ? 'Close to a coin flip for this stock recently: lean on the range, not the exact number.'
              : 'Worse than a coin flip for this stock recently: its trend has not carried over day to day. Treat the estimate with caution.'}
          </p>
        </div>
      )}
      <p className="note">This is an estimate, not a prediction: no method can know tomorrow's price. It projects the stock's recent trend forward (capped at ¾ of a typical day's move) and nudges it for the EMA, MACD and NIFTY trend. News, results and gaps can override it.</p>
    </section>
  );
}

const FIT_LABEL = { suited: 'Suits this market', neutral: 'Works in any market', unsuited: 'Wrong market type' };

export function StrategyPanel({ a }) {
  const rg = a.regime;
  const list = [...a.strategies].sort((x, y) => (y.signal ? 1 : 0) - (x.signal ? 1 : 0) || (x.fit === 'suited' ? -1 : 1) - (y.fit === 'suited' ? -1 : 1));
  return (
    <section className="card" aria-label="Strategy setups">
      <h2>Strategy setups <span className="muted small">from the DBS &amp; StoneX trading guides</span></h2>
      <div className={`regime regime-${rg.key}`}>
        <div>
          <div className="eyebrow">Market type</div>
          <div className="regime-label">{rg.label}{rg.adx != null && <span className="mono muted"> · ADX {rg.adx.toFixed(0)}</span>}</div>
        </div>
        <p>{rg.note}</p>
      </div>
      <ul className="strat-list">
        {list.map((s) => (
          <li key={s.key} className={`strat ${s.signal ? `on ${s.signal}` : ''} ${s.fit === 'unsuited' ? 'dim' : ''}`}>
            <details>
              <summary>
                <span className="strat-name">{s.name}{a.strategy?.key === s.key && <span className="tag buy small-tag" style={{ background: 'var(--panel-3)', color: 'var(--accent)' }}>used for plan</span>}</span>
                <span className="strat-src">{s.src.map((x) => <i key={x}>{x}</i>)}</span>
                <span className={`fit fit-${s.fit}`}>{FIT_LABEL[s.fit]}</span>
                <span className={`pill ${s.signal === 'long' ? 'buy' : s.signal === 'short' ? 'sell' : 'neutral'}`}>
                  {s.signal ? `${s.signal === 'long' ? 'LONG' : 'SHORT'} ${'●'.repeat(s.strength)}` : 'NO SETUP'}
                </span>
              </summary>
              <ul className="strat-why">{s.why.map((w) => <li key={w}>{w}</li>)}</ul>
              <p className="strat-rule"><b>Rule:</b> {s.rule}</p>
              {s.signal && !s.counted && <p className="strat-rule muted">Not counted in the score: this strategy doesn't suit a {rg.label.toLowerCase()} market.</p>}
            </details>
          </li>
        ))}
      </ul>
      <p className="note">
        Click a strategy to see why. Strategies that suit the market type count fully toward the score, any-market ones count half, and wrong-market ones not at all.
        Not automated: scalping (needs tick data), news trading (needs a news feed), pairs trading (needs two stocks), end-of-day (a timing rule: use these setups in the last trading hour).
      </p>
    </section>
  );
}
