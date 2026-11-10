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

// Exact integration over the street's breakpoints, the same as the server (rewritten 2026-11-08, see demandModel.js)
function hotellingDemand(pA, pB, c) {
  const { x1, x2, consumerValue: V } = c;
  const t = Number(c.travelCost) || 0;
  const offerA = x => V - pA - t * Math.abs(x - x1);
  const offerB = x => V - pB - t * Math.abs(x - x2);
  const points = [0, 100, x1, x2];
  if (t > 0) {
    const reachA = (V - pA) / t, reachB = (V - pB) / t;
    const mid = (x1 + x2) / 2, shift = (pB - pA) / (2 * t);
    points.push(x1 - reachA, x1 + reachA, x2 - reachB, x2 + reachB, mid + shift, mid - shift);
  }
  const cuts = [...new Set(points.filter(p => Number.isFinite(p) && p >= 0 && p <= 100))].sort((a, b) => a - b);
  let dA = 0, dB = 0;
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const length = cuts[i + 1] - cuts[i];
    if (length <= 0) continue;
    const m = (cuts[i] + cuts[i + 1]) / 2;
    const a = offerA(m), b = offerB(m);
    if (a < 0 && b < 0) continue;
    if (b < 0) dA += length;
    else if (a < 0) dB += length;
    else if (Math.abs(a - b) < 1e-9) { dA += length / 2; dB += length / 2; }
    else if (a > b) dA += length;
    else dB += length;
  }
  const M = Number(c.marketSize) > 0 ? Number(c.marketSize) : 100; // gallons on the road when every driver buys
  return [Math.max(0, Math.min(100, dA)) * (M / 100), Math.max(0, Math.min(100, dB)) * (M / 100)];
}

export function demand(pA, pB, config) {
  return config?.modelType === 'hotelling' ? hotellingDemand(pA, pB, config) : logitDemand(pA, pB, config);
}

// The one-shot Nash price (both firms best-respond to each other) and the price that maximizes the
// two firms' joint profit, both on a grid inside the price bounds. Profit is (price - wholesale cost) x quantity.
export function referencePrices(config) {
  if (!config) return null;
  const lo = config.priceBounds?.min ?? 0, hi = config.priceBounds?.max ?? 100;
  if (!(hi > lo)) return null;
  const c = Number(config.marginalCost) || 0;
  const step = Math.max(hi - lo > 50 ? 0.5 : 0.01, (hi - lo) / 600); // at most ~600 grid points, whatever the price range
  const grid = [];
  for (let p = lo; p <= hi + 1e-9; p += step) grid.push(Math.min(hi, Math.max(lo, Math.round(p * 100) / 100)));
  const best = rival => {
    let bp = lo, bv = -Infinity;
    grid.forEach(p => { const v = (p - c) * demand(p, rival, config)[0]; if (v > bv + 1e-9) { bv = v; bp = p; } });
    return bp;
  };
  // Same spot or no driving cost is pure price competition: the Nash price is the wholesale cost (or the lowest allowed
  // price above it), not a grid artefact
  const bertrand = config.modelType === 'hotelling' && (config.x1 === config.x2 || !(config.travelCost > 0));
  let p = bertrand ? Math.min(hi, Math.max(lo, c)) : (lo + hi) / 2;
  for (let i = 0; i < (bertrand ? 0 : 200); i += 1) {
    const n = best(p);
    if (Math.abs(n - p) < step / 2) { p = n; break; }
    p = n;
  }
  let coll = lo, cv = -Infinity;
  grid.forEach(q => { const v = (q - c) * demand(q, q, config)[0]; if (v > cv + 1e-9) { cv = v; coll = q; } });
  return {
    nash: p,
    nashProfit: (p - c) * demand(p, p, config)[0],
    collusion: coll,
    collusionProfit: cv
  };
}

// A price as shown on the pages: to the cent when the game's prices are small (gas prices, a max price of $50 or less),
// otherwise whole dollars unless it has cents (2026-11-10)
export function priceFmt(v, config) {
  if (!Number.isFinite(v)) return '–';
  const small = (config?.priceBounds?.max ?? 100) <= 50;
  return money(v, small || !Number.isInteger(v) ? 2 : 0);
}

// A quantity (gallons sold) as shown on the pages: whole numbers with thousands separators
export function qty(v) {
  if (!Number.isFinite(v)) return '–';
  return Math.round(v).toLocaleString('en-US');
}

// What a student typed, read as a price (2026-11-08): a number box on an English keyboard silently drops a comma
// (35,5 became 355, which the bounds caught, and 3,5 became $35, which nothing caught), so the price box is a text box
// and this reads it. Spaces and a dollar sign are dropped; a comma with no point is a decimal comma when one or two
// digits follow it (35,5), otherwise a thousands separator (1,000); with both, the mark that comes last is the decimal
// one (1,250.50 or 1.250,50). Digits with at most one decimal mark; anything else (letters, 1e2, hex) is NaN.
export function parsePrice(text) {
  let s = String(text ?? '').replace(/[\s$]/g, '');
  if (s === '') return NaN;
  const lastComma = s.lastIndexOf(','), lastPoint = s.lastIndexOf('.');
  if (lastComma >= 0 && lastPoint >= 0) {
    s = lastComma > lastPoint ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /^-?\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
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
