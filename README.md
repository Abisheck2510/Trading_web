# Trade Signal Desk

A React dashboard for NSE/BSE stocks. It scores a stock on the parameters from the
"Stock Profit Analysis" guide and returns **BUY / SELL / AVOID** with a risk plan.

## Run

```powershell
npm install
npm run dev
```

Open http://localhost:5173. Live prices come from Yahoo Finance's public chart
endpoint through the Vite dev proxy (`/yf` in `vite.config.js`). Data may be delayed.
If the source can't be reached, the app shows clearly labelled **simulated** data.

## What it does

| Area | Details |
|---|---|
| Market sentiment | NIFTY 50, BANK NIFTY, India VIX (trend vs EMA 20, day change) |
| Chart | Candles, volume, EMA 9/20/50/200, VWAP, Bollinger, S/R, stop/target, pattern and EMA-cross markers; synced RSI and MACD panes |
| Trading styles | Intraday (5m + 15m trend, session VWAP) · Swing (daily + weekly) · Positional (weekly + monthly) |
| Strategies | 8 setups from the DBS and StoneX trading-strategy guides: trend following (50/200 MA, ADX, Donchian), momentum, breakout (squeeze + volume), reversal (RSI divergence, volume climax), range trading (stochastic), mean reversion, swing pullback, gap trading. Market type from ADX (≥ 25 trending, < 20 range-bound) decides which ones count. Rules are in `src/lib/strategies.js` |
| Scoring | Trend, momentum (RSI, MACD, VWAP), volume vs 20-bar average, breakout/breakdown, candlestick patterns, market, optional fundamentals |
| Verdict | Score ≥ +4 → BUY, ≤ −4 → SELL, else AVOID (threshold +1 when VIX > 20) |
| Safety gates | BUY/SELL becomes AVOID if: illiquid (< ₹1 Cr/day), R:R below your minimum, RSI > 75 on a buy, or RSI < 25 on a sell |
| Risk plan | Stop beyond nearest S/R (min 1 ATR), target = next S/R or 3R; position size from capital × risk %, with costs |
| Checklist | The guide's 10-step pre-trade workflow, ticked automatically |
| Scanner | Scans a watchlist (default: 24 NIFTY stocks), sortable and filterable by verdict |
| Journal | Log setups and mark outcomes (saved in browser localStorage) |

The scoring rules are in `src/lib/analysis.js` and the indicator math is in
`src/lib/indicators.js`.

_Educational tool only, not investment advice._
