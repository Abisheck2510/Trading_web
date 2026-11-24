// Vercel serverless proxy for market data.
// In development Vite proxies /yf and /nse (see vite.config.js). Vercel does not use
// that config, so vercel.json rewrites /yf/* and /nse/* to this function, which
// fetches the upstream URL server-side (no browser CORS limits) and returns it.

const UPSTREAM = {
  yf: 'https://query1.finance.yahoo.com',
  nse: 'https://archives.nseindia.com',
};

// Only these paths may be fetched, so the function can't be used as an open proxy.
const ALLOWED = {
  yf: /^v8\/finance\/chart\/[^/]+$/,
  nse: /^content\/(equities\/EQUITY_L\.csv|indices\/ind_[a-z0-9]+list\.csv)$/,
};

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const target = url.searchParams.get('target');
  const path = (url.searchParams.getAll('path').join('/') || '').replace(/^\/+/, '');
  if (!UPSTREAM[target] || !ALLOWED[target].test(path)) {
    res.status(400).json({ error: 'Unsupported path' });
    return;
  }
  url.searchParams.delete('target');
  url.searchParams.delete('path');
  const qs = url.searchParams.toString();
  const upstream = `${UPSTREAM[target]}/${path}${qs ? `?${qs}` : ''}`;

  try {
    const r = await fetch(upstream, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: target === 'nse' ? 'text/csv,*/*' : 'application/json,*/*',
      },
    });
    const body = Buffer.from(await r.arrayBuffer());
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || (target === 'nse' ? 'text/csv' : 'application/json'));
    // Cache at Vercel's edge: prices briefly, stock lists for a day.
    res.setHeader('Cache-Control', target === 'nse' ? 's-maxage=86400, stale-while-revalidate=86400' : 's-maxage=30, stale-while-revalidate=60');
    res.send(body);
  } catch (e) {
    res.status(502).json({ error: `Upstream request failed: ${e.message}` });
  }
}
