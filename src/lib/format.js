const inrFmt = (d) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

export const inr = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : `₹${inrFmt(d).format(v)}`);
export const num = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : inrFmt(d).format(v));
export const pct = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
export const signed = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`);

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`tsd:${key}`);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`tsd:${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};
