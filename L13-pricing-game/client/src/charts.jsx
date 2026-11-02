import React from 'react';

// Small SVG charts in the lab look (2026-11-02). Plain SVG, so nothing to load and it scales with the box.

function niceMax(v) {
  if (!(v > 0)) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

// Lines over rounds. series: [{ label, color, values: [number|null per round], dashed, width }]
// lines: horizontal reference lines [{ label, color, y }]
export function RoundsChart({ rounds, series, lines = [], height = 260, yLabel = 'Price ($)' }) {
  const W = 640, H = height, L = 52, R = 16, T = 14, B = 34;
  const all = series.flatMap(s => s.values.filter(v => Number.isFinite(v))).concat(lines.map(l => l.y));
  const yMax = niceMax(Math.max(1, ...all) * 1.08);
  const n = Math.max(rounds, 2);
  const x = i => L + (W - L - R) * (n === 1 ? 0.5 : i / (n - 1));
  const y = v => T + (H - T - B) * (1 - v / yMax);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * yMax);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
      {ticks.map(t => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#eef0f3" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#6b7280">{Math.round(t)}</text>
        </g>
      ))}
      {Array.from({ length: rounds }, (_, i) => (
        <text key={i} x={x(i)} y={H - 12} textAnchor="middle" fontSize="12" fill="#6b7280">{i + 1}</text>
      ))}
      <text x={(L + W - R) / 2} y={H - 0} textAnchor="middle" fontSize="11" fill="#9aa1ab">Round</text>
      <text x={12} y={(T + H - B) / 2} textAnchor="middle" fontSize="11" fill="#9aa1ab" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>{yLabel}</text>
      {lines.map(l => (
        <g key={l.label}>
          <line x1={L} x2={W - R} y1={y(l.y)} y2={y(l.y)} stroke={l.color} strokeWidth="2" strokeDasharray="6 5" />
          <text x={W - R - 4} y={y(l.y) - 6} textAnchor="end" fontSize="12" fontWeight="600" fill={l.color}>{l.label}</text>
        </g>
      ))}
      {series.map(s => {
        const pts = s.values.map((v, i) => (Number.isFinite(v) ? [x(i), y(v)] : null)).filter(Boolean);
        if (!pts.length) return null;
        return (
          <g key={s.label}>
            <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={s.color}
              strokeWidth={s.width || 3} strokeDasharray={s.dashed ? '6 5' : undefined} strokeLinejoin="round" />
            {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={s.width ? s.width + 1.5 : 4.5} fill={s.color} />)}
          </g>
        );
      })}
    </svg>
  );
}

// Bars of how many prices fall in each bin. values: numbers; marks: [{ label, color, x }]
export function PriceBars({ values, lo = 0, hi = 100, bins = 10, marks = [], height = 220 }) {
  const W = 640, H = height, L = 40, R = 16, T = 34, B = 34;
  if (!(hi > lo) || !(bins > 0)) return null; // an empty price range has no bins (division by zero otherwise)
  const width = (hi - lo) / bins;
  const counts = Array(bins).fill(0);
  values.forEach(v => {
    if (!Number.isFinite(v)) return;
    const i = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)));
    counts[i] += 1;
  });
  const cMax = Math.max(1, ...counts);
  const bw = (W - L - R) / bins;
  const xv = v => L + (W - L - R) * ((v - lo) / (hi - lo));
  const y = c => T + (H - T - B) * (1 - c / cMax);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
      {counts.map((c, i) => (
        <g key={i}>
          <rect x={L + i * bw + 2} y={y(c)} width={bw - 4} height={H - B - y(c)} rx="3" fill="#1F2E5C" opacity={c ? 0.85 : 0} />
          {c > 0 && <text x={L + i * bw + bw / 2} y={y(c) - 5} textAnchor="middle" fontSize="12" fontWeight="600" fill="#1F2E5C">{c}</text>}
        </g>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#cfd4da" />
      {Array.from({ length: bins + 1 }, (_, i) => (i % Math.ceil(bins / 10) === 0 ? (
        <text key={i} x={L + i * bw} y={H - B + 16} textAnchor="middle" fontSize="12" fill="#6b7280">{Math.round(lo + i * width)}</text>
      ) : null))}
      <text x={(L + W - R) / 2} y={H - 2} textAnchor="middle" fontSize="11" fill="#9aa1ab">Price ($)</text>
      {marks.map(m => (
        <g key={m.label}>
          <line x1={xv(m.x)} x2={xv(m.x)} y1={T} y2={H - B} stroke={m.color} strokeWidth="2" strokeDasharray="6 5" />
          <text x={xv(m.x)} y={T - 8} textAnchor="middle" fontSize="12" fontWeight="600" fill={m.color}>{m.label}</text>
        </g>
      ))}
    </svg>
  );
}

// The street of the linear-city model: where I stand (x1) and where my rival stands (x2), each in 0..100.
export function Street({ x1 = 0, x2 = 100 }) {
  const W = 640, H = 96, L = 30, R = 30;
  const x = v => L + (W - L - R) * (Math.max(0, Math.min(100, v)) / 100);
  const same = x1 === x2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
      <line x1={L} x2={W - R} y1={56} y2={56} stroke="#9aa1ab" strokeWidth="3" strokeLinecap="round" />
      {Array.from({ length: 21 }, (_, i) => <circle key={i} cx={x(i * 5)} cy={56} r="3" fill="#cfd4da" />)}
      <text x={x(0)} y={84} textAnchor="middle" fontSize="13" fill="#6b7280">0</text>
      <text x={x(100)} y={84} textAnchor="middle" fontSize="13" fill="#6b7280">100</text>
      {same ? (
        <g>
          <rect x={x(x1) - 46} y={16} width={92} height={26} rx="6" fill="#1F2E5C" />
          <text x={x(x1)} y={34} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">You + rival</text>
          <line x1={x(x1)} x2={x(x1)} y1={42} y2={56} stroke="#1F2E5C" strokeWidth="2" />
        </g>
      ) : (
        <g>
          <rect x={x(x1) - 26} y={16} width={52} height={26} rx="6" fill="#1F2E5C" />
          <text x={x(x1)} y={34} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">You</text>
          <line x1={x(x1)} x2={x(x1)} y1={42} y2={56} stroke="#1F2E5C" strokeWidth="2" />
          <rect x={x(x2) - 30} y={16} width={60} height={26} rx="6" fill="#A31F34" />
          <text x={x(x2)} y={34} textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">Rival</text>
          <line x1={x(x2)} x2={x(x2)} y1={42} y2={56} stroke="#A31F34" strokeWidth="2" />
        </g>
      )}
    </svg>
  );
}
