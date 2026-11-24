// Hover tooltip + two-point price measurement for lightweight-charts.
//   Hover: a tooltip at the cursor with the price and time.
//   Shift + click two points (or click twice in "measure mode"): shows the price
//   difference in ₹ and %, the number of bars and the time between them.
//   A normal click or Esc clears the measurement.

const inr = (v) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;

function span(sec, intraday) {
  const s = Math.abs(sec);
  if (intraday) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.round((s % 3600) / 60);
    return [d ? `${d}d` : '', h ? `${h}h` : '', !d && m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
  }
  const days = Math.round(s / 86400);
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `${(days / 30.44).toFixed(1)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

const el = (cls, parent) => {
  const d = document.createElement('div');
  d.className = cls;
  parent.appendChild(d);
  return d;
};

/**
 * @param {object} o
 * @param {import('lightweight-charts').IChartApi} o.chart
 * @param {import('lightweight-charts').ISeriesApi} o.series   series to read prices from
 * @param {HTMLElement} o.container  element the chart was created in (must be positioned)
 * @param {Array<{time:number, value:number}>} o.points  price per bar, in time order
 * @param {(t:number)=>string} o.fmtTime
 * @param {boolean} o.intraday
 * @param {(state:{a:any,b:any})=>void} [o.onChange]
 */
export function attachChartTools({ chart, series, container, points, fmtTime, intraday, onChange }) {
  const index = new Map(points.map((p, i) => [p.time, i]));
  const tip = el('ct-tip', container);
  const band = el('ct-band', container);
  const dotA = el('ct-dot', container);
  const dotB = el('ct-dot', container);
  const label = el('ct-label', container);
  const hide = (...xs) => xs.forEach((x) => { x.style.display = 'none'; });
  hide(tip, band, dotA, dotB, label);

  let hover = null; // { time, value }
  let a = null;
  let b = null;
  let measureMode = false;

  const pos = (p) => {
    const x = chart.timeScale().timeToCoordinate(p.time);
    const y = series.priceToCoordinate(p.value);
    return x == null || y == null ? null : { x, y };
  };
  const diffText = (p, q) => {
    const d = q.value - p.value;
    const pc = (d / p.value) * 100;
    const bars = Math.abs((index.get(q.time) ?? 0) - (index.get(p.time) ?? 0));
    return { up: d >= 0, main: `${d >= 0 ? '▲ +' : '▼ −'}${inr(Math.abs(d))} (${pc >= 0 ? '+' : ''}${pc.toFixed(2)}%)`, sub: `${bars} bar${bars === 1 ? '' : 's'} · ${span(q.time - p.time, intraday)}` };
  };

  const placeDot = (dot, p, cls) => {
    const c = p && pos(p);
    if (!c) { hide(dot); return null; }
    dot.className = `ct-dot ${cls}`;
    dot.style.display = 'block';
    dot.style.left = `${c.x}px`;
    dot.style.top = `${c.y}px`;
    return c;
  };

  const drawMeasure = () => {
    const ca = placeDot(dotA, a, 'a');
    if (!a || !b) { hide(band, label, dotB); return; }
    const cb = placeDot(dotB, b, 'b');
    if (!ca || !cb) { hide(band, label); return; }
    const t = diffText(a, b);
    const left = Math.min(ca.x, cb.x);
    const top = Math.min(ca.y, cb.y);
    band.className = `ct-band ${t.up ? 'up' : 'down'}`;
    Object.assign(band.style, { display: 'block', left: `${left}px`, top: `${top}px`, width: `${Math.max(2, Math.abs(cb.x - ca.x))}px`, height: `${Math.max(2, Math.abs(cb.y - ca.y))}px` });
    label.className = `ct-label ${t.up ? 'up' : 'down'}`;
    label.innerHTML = `<b>${t.main}</b><span>${inr(a.value)} → ${inr(b.value)}</span><span>${t.sub}</span>`;
    label.style.display = 'flex';
    const w = container.clientWidth;
    const lx = Math.min(Math.max((ca.x + cb.x) / 2, 90), w - 150);
    label.style.left = `${lx}px`;
    label.style.top = `${Math.max(4, top - 62)}px`;
  };

  const emit = () => onChange?.({ a, b, measureMode });

  const onMove = (param) => {
    const d = param?.time != null && param.point ? param.seriesData.get(series) : null;
    const v = d ? (d.value ?? d.close) : null;
    if (v == null) { hover = null; hide(tip); return; }
    hover = { time: param.time, value: v };
    let html = `<span class="ct-t">${fmtTime(param.time)}</span><b>${inr(v)}</b>`;
    if (d.open != null) html += `<span class="ct-ohl">O ${inr(d.open)} · H ${inr(d.high)} · L ${inr(d.low)}</span>`;
    if (a && !b) {
      const t = diffText(a, hover);
      html += `<span class="${t.up ? 'pos' : 'neg'}">${t.main} from first point</span>`;
    }
    tip.innerHTML = html;
    tip.style.display = 'flex';
    const w = container.clientWidth;
    const flip = param.point.x > w - 190;
    tip.style.left = `${flip ? param.point.x - 14 : param.point.x + 14}px`;
    tip.style.transform = flip ? 'translateX(-100%)' : 'none';
    tip.style.top = `${Math.max(4, param.point.y - 40)}px`;
  };

  const clear = () => { a = null; b = null; drawMeasure(); hide(dotA); emit(); };

  const onClick = (e) => {
    if (!(e.shiftKey || measureMode)) { if (a) clear(); return; }
    if (!hover) return;
    e.preventDefault();
    if (!a || (a && b)) { a = { ...hover }; b = null; }
    else if (hover.time !== a.time) {
      b = { ...hover };
      if (b.time < a.time) [a, b] = [b, a];
    }
    drawMeasure();
    emit();
  };
  const onKey = (e) => { if (e.key === 'Escape' && a) clear(); };
  const onLeave = () => hide(tip);

  chart.subscribeCrosshairMove(onMove);
  const redraw = () => drawMeasure();
  chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
  container.addEventListener('click', onClick);
  container.addEventListener('mouseleave', onLeave);
  window.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => requestAnimationFrame(redraw));
  ro.observe(container);

  return {
    setMeasureMode(on) { measureMode = on; if (!on && a && !b) clear(); emit(); },
    clear,
    destroy() {
      chart.unsubscribeCrosshairMove(onMove);
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw); } catch { /* chart already removed */ }
      container.removeEventListener('click', onClick);
      container.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('keydown', onKey);
      ro.disconnect();
      [tip, band, dotA, dotB, label].forEach((x) => x.remove());
    },
  };
}
