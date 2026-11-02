// The game's demand, for the pictures and the reference prices on the instructor's chart (2026-11-02).
// Same formulas as server/demandModel.js, which decides the actual results; keep the two in step.

function logitDemand(pA, pB, c) {
  const delta = 10;
  const sigma = Math.max(c.sigma, 1e-6);
  const uA = (delta - c.alpha * pA) / sigma, uB = (delta - c.alpha * pB) / sigma;
  const top = Math.max(uA, uB, 0); // same stabilisation as the server
  const eA = Math.exp(uA - top), eB = Math.exp(uB - top), e0 = Math.exp(-top);
  const den = eA + eB + e0;
  return [c.marketSize * eA / den, c.marketSize * eB / den];
}

function hotellingDemand(pA, pB, c) {
  const { travelCost: t, x1, x2, consumerValue: V } = c;
  if (x1 > x2) { const r = hotellingDemand(pB, pA, { ...c, x1: x2, x2: x1 }); return [r[1], r[0]]; }
  if (x1 === x2 || !(t > 0)) {
    if (pA === pB) return V >= pA ? [50, 50] : [0, 0];
    if (pA < pB) return V >= pA ? [100, 0] : [0, 0];
    return V >= pB ? [0, 100] : [0, 0];
  }
  const xStar = (x1 + x2) / 2 + (pB - pA) / (2 * t);
  const lA = Math.max(0, x1 - (V - pA) / t), rA = Math.min(100, x1 + (V - pA) / t);
  const lB = Math.max(0, x2 - (V - pB) / t), rB = Math.min(100, x2 + (V - pB) / t);
  let dA = 0, dB = 0;
  if (rA >= lA || rB >= lB) {
    const s = Math.max(lA, lB), e = Math.min(rA, rB);
    if (e >= s) {
      const split = Math.max(s, Math.min(xStar, e));
      dA = Math.max(0, split - lA);
      dB = Math.max(0, rB - split);
    } else {
      dA = Math.max(0, rA - lA);
      dB = Math.max(0, rB - lB);
    }
  }
  return [Math.max(0, Math.min(100, dA)), Math.max(0, Math.min(100, dB))];
}

export function demand(pA, pB, config) {
  return config?.modelType === 'hotelling' ? hotellingDemand(pA, pB, config) : logitDemand(pA, pB, config);
}

// The one-shot Nash price (both firms best-respond to each other) and the price that maximizes the
// two firms' joint profit, both on a grid of half-dollars inside the price bounds. Cost is zero.
export function referencePrices(config) {
  if (!config) return null;
  const lo = config.priceBounds?.min ?? 0, hi = config.priceBounds?.max ?? 100;
  if (!(hi > lo)) return null;
  const step = Math.max(0.5, (hi - lo) / 600); // at most ~600 grid points, whatever the price range
  const grid = [];
  for (let p = lo; p <= hi + 1e-9; p += step) grid.push(Math.min(hi, Math.max(lo, Math.round(p * 100) / 100)));
  const best = rival => {
    let bp = lo, bv = -1;
    grid.forEach(p => { const v = p * demand(p, rival, config)[0]; if (v > bv + 1e-9) { bv = v; bp = p; } });
    return bp;
  };
  let p = (lo + hi) / 2;
  for (let i = 0; i < 200; i += 1) {
    const n = best(p);
    if (Math.abs(n - p) < step / 2) { p = n; break; }
    p = n;
  }
  let coll = lo, cv = -1;
  grid.forEach(q => { const v = q * demand(q, q, config)[0]; if (v > cv + 1e-9) { cv = v; coll = q; } });
  return {
    nash: p,
    nashProfit: p * demand(p, p, config)[0],
    collusion: coll,
    collusionProfit: cv
  };
}

export function money(v, digits = 0) {
  if (!Number.isFinite(v)) return '–';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(v) {
  if (!Number.isFinite(v)) return '–';
  return Math.round(v * 100) + '%';
}

export function roundTimeFor(config, round) {
  const rt = config?.roundTime;
  if (Array.isArray(rt)) return rt[round - 1] || rt[0] || 30;
  return rt || 30;
}
