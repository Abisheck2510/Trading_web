import { inr, num, pct, signed } from '../lib/format.js';

export const GLOSSARY = {
  score: 'Adds up every signal (trend, momentum, volume, patterns, strategies, market). +4 or more is a BUY, −4 or less a SELL; anything in between means wait.',
  entry: 'The price the plan assumes you buy (or sell) at: the latest price.',
  stop: 'Stop-loss: if price reaches this level, exit to cap the loss. Always place it with your broker.',
  target: 'Where the plan takes profit, usually the next resistance (or support for a sell).',
  rr: 'Reward : risk. How much you could make for each ₹1 you risk. The app wants at least 1 : 2.',
  qty: 'Shares to buy so that hitting the stop-loss loses only your chosen risk % of capital.',
  range: 'About 2 days in 3 the stock has closed inside a range this wide. Use it for planning, not as a forecast.',
  market: 'Trending markets suit trend-following; sideways ones suit range trading. Measured with ADX.',
};

export function Tip({ k, text }) {
  return (
    <span className="tip" tabIndex={0} role="note" aria-label={text || GLOSSARY[k]}>
      ?
      <span className="tip-body" aria-hidden="true">{text || GLOSSARY[k]}</span>
    </span>
  );
}

const HORIZON = { intraday: 'for today', swing: 'over the next 2–15 days', positional: 'over the coming weeks' };
const COPY = {
  BUY: { title: 'Buy signal', icon: '▲', line: (h) => `Trend, momentum and the market line up for a rise ${h}.` },
  SELL: { title: 'Sell signal', icon: '▼', line: (h) => `Signals point down ${h}. Avoid buying; consider exiting if you hold it. Short-selling is for intraday/F&O only.` },
  AVOID: { title: 'Wait – no trade', icon: '■', line: () => "The signals don't line up for a good-odds trade right now. Waiting is a position too." },
};

function whyList(a) {
  const items = [];
  for (const r of a.reasons.slice(0, 2)) items.push({ kind: 'warn', text: r });
  for (const s of a.drivers.slice(0, 3)) items.push({ kind: 'good', text: `${s.name}: ${s.note}` });
  for (const s of a.against.slice(0, 2)) items.push({ kind: 'bad', text: `${s.name}: ${s.note}` });
  return items.slice(0, 5);
}

export function TakeCard({ a, style, outlook, settings, onLog, onMore, logged }) {
  const v = a.verdict;
  const c = COPY[v];
  const p = a.plan;
  const long = p.dir === 'long';
  const scale = 12;
  const left = ((Math.max(-scale, Math.min(scale, a.score)) + scale) / (2 * scale)) * 100;
  const th = (a.threshold / scale) * 50;
  const rrOk = p.rr >= Number(settings.minRR);
  return (
    <section className={`card take take-${v.toLowerCase()}`} aria-label="Our take">
      <div className="take-head">
        <span className="take-icon" aria-hidden="true">{c.icon}</span>
        <div>
          <div className="eyebrow">Our take</div>
          <div className="take-title">{c.title}</div>
        </div>
      </div>
      <p className="take-line">{c.line(HORIZON[style])}</p>

      <div className="take-meter">
        <div className="take-meter-top">
          <span className="small muted">Signal strength <Tip k="score" /></span>
          <b className="mono">{signed(a.score)} <span className="muted small">/ needs ±{a.threshold}</span></b>
        </div>
        <div className="meter" aria-hidden="true">
          <div className="meter-zone sell" style={{ width: `${50 - th}%` }} />
          <div className="meter-zone buy" style={{ width: `${50 - th}%` }} />
          <div className="meter-needle" style={{ left: `${left}%` }} />
        </div>
        <div className="meter-labels small muted"><span>Sell</span><span>Wait</span><span>Buy</span></div>
      </div>

      <div className="take-section">
        <div className="eyebrow">Why</div>
        <ul className="why">
          {whyList(a).map((w) => (
            <li key={w.text} className={`why-${w.kind}`}><span aria-hidden="true">{w.kind === 'good' ? '✓' : w.kind === 'bad' ? '✕' : '!'}</span>{w.text}</li>
          ))}
        </ul>
      </div>

      <div className="take-section">
        <div className="eyebrow">{v === 'AVOID' ? `If you still trade it (${long ? 'buy' : 'sell'} side)` : 'Trade plan'}</div>
        <div className="plan-grid">
          <div><span>{long ? 'Buy at' : 'Sell at'} <Tip k="entry" /></span><b className="mono">{inr(p.entry)}</b></div>
          <div><span>Stop-loss <Tip k="stop" /></span><b className="mono neg">{inr(p.stop)}</b></div>
          <div><span>Target <Tip k="target" /></span><b className="mono pos">{inr(p.target)}</b></div>
          <div><span>Reward : risk <Tip k="rr" /></span><b className={`mono ${rrOk ? 'pos' : 'neg'}`}>1 : {num(p.rr, 1)}</b></div>
        </div>
        <p className="plan-qty small">
          <Tip k="qty" /> With ₹{num(Number(settings.capital), 0)} and {settings.riskPct}% risk: <b className="mono">{num(p.qty, 0)} shares</b> (₹{num(p.capitalUsed, 0)}),
          max loss <b className="mono neg">{inr(p.maxLoss, 0)}</b>, profit at target <b className="mono pos">{inr(p.profit, 0)}</b>.
        </p>
      </div>

      {outlook && (
        <div className="take-section take-tomorrow">
          <div>
            <div className="eyebrow">Tomorrow's likely range <Tip k="range" /></div>
            <div className="mono"><span className="neg">{inr(outlook.range68[0])}</span> – <span className="pos">{inr(outlook.range68[1])}</span></div>
          </div>
          <div className="right">
            <div className="eyebrow">Estimate</div>
            <div className={`mono ${outlook.estPct >= 0 ? 'pos' : 'neg'}`}>{inr(outlook.estimate)} ({pct(outlook.estPct)})</div>
          </div>
        </div>
      )}

      <div className="take-meta small muted">
        <span>Market: <b>{a.regime.label}</b> <Tip k="market" /></span>
        <span>Setup: <b>{a.strategy ? a.strategy.name : 'none'}</b></span>
      </div>

      <div className="take-actions">
        <button type="button" className="btn" onClick={onLog} disabled={logged}>{logged ? '✓ Logged to journal' : '＋ Log to journal'}</button>
        <button type="button" className="btn ghost" onClick={onMore}>Full details</button>
      </div>
    </section>
  );
}
