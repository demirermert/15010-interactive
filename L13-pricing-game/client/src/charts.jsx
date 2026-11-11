import React from 'react';

// Small SVG charts in the lab look (2026-11-02). Plain SVG, so nothing to load and it scales with the box.

function niceMax(v) {
  if (!(v > 0)) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

// Lines over rounds. series: [{ label, color, values: [number|null per round], dashed, width, band: [lo[], hi[]] }]
// lines: horizontal reference lines [{ label, color, y }] (none on the Class 13 dashboard: Mert wants the 2025 charts as they were)
export function RoundsChart({ rounds, series, lines = [], height = 260, yLabel = 'Price ($)' }) {
  const W = 640, H = height, L = 52, R = 16, T = 14, B = 34;
  const all = series.flatMap(s => s.values.concat(s.band ? s.band[0].concat(s.band[1]) : []).filter(v => Number.isFinite(v))).concat(lines.map(l => l.y));
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
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#6b7280">{yMax < 20 ? t.toFixed(2) : Math.round(t)}</text>
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
        const pts = s.values.map((v, i) => (Number.isFinite(v) ? [x(i), y(v), i, v] : null)).filter(Boolean);
        if (!pts.length) return null;
        const band = s.band ? s.values.map((v, i) => (Number.isFinite(s.band[0][i]) && Number.isFinite(s.band[1][i]) ? i : null)).filter(i => i !== null) : [];
        const fmt = v => '$' + (yMax < 20 ? v.toFixed(2) : Math.round(v).toLocaleString('en-US'));
        return (
          <g key={s.label}>
            {band.length > 1 && (
              <polygon fill={s.color} opacity="0.12" points={band.map(i => `${x(i)},${y(s.band[1][i])}`).concat(band.slice().reverse().map(i => `${x(i)},${y(s.band[0][i])}`)).join(' ')} />
            )}
            <polyline points={pts.map(p => `${p[0]},${p[1]}`).join(' ')} fill="none" stroke={s.color}
              strokeWidth={s.width || 3} strokeDasharray={s.dashed ? '6 5' : undefined} strokeLinejoin="round" />
            {/* a hover on a point names the round and the value (the 2025 dashboard had this; 2026-11-10) */}
            {pts.map(p => <circle key={p[2]} cx={p[0]} cy={p[1]} r={s.width ? s.width + 1.5 : 4.5} fill={s.color}><title>{`${s.label}, round ${p[2] + 1}: ${fmt(p[3])}`}</title></circle>)}
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

// Each station's profit in its market, the 2025 shape (Mert, 2026-11-11): the markets along the x axis, best total first
// (labelled 1, 2, 3, ...), profit on the y axis, one dot per station (navy for station A, red for station B) joined by a
// dashed line. rows: [{ key, aName, bName, a, b }]; onHover(key, event) / onHover(null), onSelect(key) as in PairBars.
export function PairDots({ rows, height = 340, selected = null, onSelect = null, onHover = null }) {
  const W = 1000, H = height, L = 70, R = 20, T = 16, B = 40;
  const vals = rows.flatMap(r => [r.a, r.b]).filter(Number.isFinite);
  const vMin = Math.min(0, ...vals), vMax = niceMax(Math.max(1, ...vals) * 1.05);
  const n = Math.max(rows.length, 1);
  const step = (W - L - R) / n;
  const x = i => L + step * (i + 0.5);
  const y = v => T + (H - T - B) * (1 - (v - vMin) / (vMax - vMin || 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => vMin + f * (vMax - vMin));
  const fmt = v => '$' + Math.round(v).toLocaleString('en-US');
  const r0 = Math.max(3, Math.min(8, step / 3.2));
  const every = Math.max(1, Math.ceil(n / 25)); // label at most ~25 markets
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
      {ticks.map(t => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#eef0f3" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="13" fill="#6b7280">{fmt(t)}</text>
        </g>
      ))}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" fontSize="12" fill="#9aa1ab">Markets, highest total profit first (hover for names and history)</text>
      {rows.map((r, i) => {
        const pick = {
          ...(onSelect ? { onClick: () => onSelect(r.key), style: { cursor: 'pointer' } } : {}),
          ...(onHover ? { onMouseEnter: e => onHover(r.key, e), onMouseMove: e => onHover(r.key, e), onMouseLeave: () => onHover(null) } : {})
        };
        return (
          <g key={r.key} {...pick}>
            <rect x={x(i) - step / 2} y={T} width={step} height={H - T - B} fill={selected === r.key ? '#1F2E5C' : 'transparent'} opacity={selected === r.key ? 0.08 : 1} />
            <line x1={x(i)} x2={x(i)} y1={y(r.a)} y2={y(r.b)} stroke="#cbd5e1" strokeWidth="2" strokeDasharray="4 4" />
            <circle cx={x(i)} cy={y(r.a)} r={r0} fill="#1F2E5C" stroke="#fff" strokeWidth="1.5" />
            <circle cx={x(i)} cy={y(r.b)} r={r0} fill="#A31F34" stroke="#fff" strokeWidth="1.5" />
            {i % every === 0 && <text x={x(i)} y={H - B + 16} textAnchor="middle" fontSize="12" fill="#6b7280">{i + 1}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// Horizontal bars, one row per pair, best first. rows: [{ label, a, b, aName, bName }]; split: two bars (A and B) per row.
// onSelect(key) on a click; onHover(key, event) while the mouse is over a row and onHover(null) when it leaves (the
// dashboard shows the pair's whole history in a floating box, as the 2025 page did; 2026-11-10)
export function PairBars({ rows, split = false, rowHeight = 26, selected = null, onSelect = null, onHover = null }) {
  const W = 640, L = 170, R = 70, T = 6;
  const H = T + rows.length * (split ? rowHeight * 2 - 6 : rowHeight) + 6;
  const vMax = Math.max(1, ...rows.map(r => (split ? Math.max(r.a, r.b) : r.a + r.b)));
  const w = v => Math.max(0, (W - L - R) * (v / vMax));
  const fmt = v => '$' + Math.round(v).toLocaleString('en-US');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
      {rows.map((r, i) => {
        const y0 = T + i * (split ? rowHeight * 2 - 6 : rowHeight);
        const rowH = split ? rowHeight * 2 - 6 : rowHeight;
        const pick = {
          ...(onSelect ? { onClick: () => onSelect(r.key), style: { cursor: 'pointer' } } : {}),
          ...(onHover ? { onMouseEnter: e => onHover(r.key, e), onMouseMove: e => onHover(r.key, e), onMouseLeave: () => onHover(null) } : {})
        };
        const hilite = selected === r.key ? <rect x={0} y={y0} width={W} height={rowH} rx="6" fill="#1F2E5C" opacity="0.08" /> : null;
        const hit = <rect x={0} y={y0} width={W} height={rowH} fill="transparent" />; // the whole row answers the mouse, not just the bar
        if (!split) {
          return (
            <g key={r.label} {...pick}>
              {hit}
              {hilite}
              <text x={L - 8} y={y0 + rowHeight / 2 + 4} textAnchor="end" fontSize="12" fill="#1c1c1e">{r.label}</text>
              <rect x={L} y={y0 + 4} width={w(r.a + r.b)} height={rowHeight - 8} rx="3" fill="#1F2E5C" opacity="0.85" />
              <text x={L + w(r.a + r.b) + 6} y={y0 + rowHeight / 2 + 4} fontSize="12" fontWeight="600" fill="#1F2E5C">{fmt(r.a + r.b)}</text>
            </g>
          );
        }
        const h = rowHeight - 10;
        return (
          <g key={r.label} {...pick}>
            {hit}
            {hilite}
            <text x={L - 8} y={y0 + 4 + h - 2} textAnchor="end" fontSize="12" fill="#1F2E5C">{r.aName}</text>
            <rect x={L} y={y0 + 4} width={w(r.a)} height={h} rx="3" fill="#1F2E5C" opacity="0.85" />
            <text x={L + w(r.a) + 6} y={y0 + 4 + h - 2} fontSize="11.5" fill="#1F2E5C">{fmt(r.a)}</text>
            <text x={L - 8} y={y0 + 6 + h * 2 - 2} textAnchor="end" fontSize="12" fill="#A31F34">{r.bName}</text>
            <rect x={L} y={y0 + 6 + h} width={w(r.b)} height={h} rx="3" fill="#A31F34" opacity="0.85" />
            <text x={L + w(r.b) + 6} y={y0 + 6 + h * 2 - 2} fontSize="11.5" fill="#A31F34">{fmt(r.b)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// The road of the linear-city model (a street until 2026-11-10): where my station stands (x1) and where my rival's
// stands (x2), each in 0..100.
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
