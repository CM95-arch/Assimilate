const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Compact number: 3 significant digits with K/M/B/T… suffixes, scientific beyond. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0;
  const a = Math.abs(n);
  let out: string;
  if (a < 10) out = a === 0 ? '0' : a < 0.01 ? '<0.01' : trim((Math.floor(a * (a < 1 ? 100 : 10)) / (a < 1 ? 100 : 10)).toFixed(a < 1 ? 2 : 1));
  else if (a < 1000) out = Math.floor(a).toString();
  else {
    const tier = Math.floor(Math.log10(a) / 3);
    if (tier >= SUFFIXES.length) {
      out = a.toExponential(2).replace('e+', 'e');
    } else {
      const v = a / 10 ** (tier * 3);
      // Floor so the display never claims more than the player has.
      const digits = v < 10 ? 2 : v < 100 ? 1 : 0;
      const f = 10 ** digits;
      // The epsilon stops binary rounding (2.3e9 / 1e9 = 2.2999…) from showing as 2.29.
      let shown = Math.floor(v * f + 1e-9) / f;
      if (shown >= 1000) shown = 999;
      out = trim(shown.toFixed(digits)) + SUFFIXES[tier];
    }
  }
  return neg ? `−${out}` : out;
}

function trim(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Signed rate, e.g. "+1.2K/s". */
export function fmtRate(n: number, unit = '/s'): string {
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return `0${unit}`;
  return `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}${unit}`;
}

/** Durations: "45s", "3m 05s", "2h 14m", "3d 4h". */
export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Rounded, honest approximation for projections ("≈ 4 min"). */
export function fmtApprox(seconds: number): string {
  if (seconds < 60) return `≈ ${Math.max(5, Math.round(seconds / 5) * 5)}s`;
  if (seconds < 3600) return `≈ ${Math.round(seconds / 60)} min`;
  return `≈ ${(seconds / 3600).toFixed(1)} h`;
}

export function fmtPct(fraction: number): string {
  return `${Math.floor(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}
