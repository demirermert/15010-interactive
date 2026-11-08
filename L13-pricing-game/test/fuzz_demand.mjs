#!/usr/bin/env node
// Checks the demand formula the server uses (server/demandModel.js) against a brute-force street (teaching23-games,
// 2026-11-08): 200,000 consumers spread along 0..100, each buying from the seller that leaves them the most money,
// if any. Runs every combination of walking cost, valuation, seller spots and price bounds below, with prices on a
// grid plus the awkward ones students type (cents, equal prices, the min, the max, far above the valuation).
// Also checks the client's copy of the formula (client/src/econ.js) gives the same numbers, and the logit model.
//
//   node fuzz_demand.mjs [--quick]
//
// Prints each failing case (first 25) and a summary line; exit 1 if anything failed.

import { computeDemand } from '../server/demandModel.js';
import { demand as clientDemand } from '../client/src/econ.js';

const QUICK = process.argv.includes('--quick');
const G = QUICK ? 20000 : 200000;             // consumers on the street
const TOL = 100 / G * 4 + 1e-9;               // a few grid steps (each boundary can be off by one step)

// ---- the truth: one consumer at a time -------------------------------------------------------------------------
function bruteHotelling(pA, pB, c) {
  const { travelCost: t, x1, x2, consumerValue: V } = c;
  let a = 0, b = 0;
  for (let i = 0; i < G; i++) {
    const x = (i + 0.5) * (100 / G);
    const uA = V - pA - t * Math.abs(x - x1);
    const uB = V - pB - t * Math.abs(x - x2);
    if (uA < 0 && uB < 0) continue;
    // equal offers (to within floating-point noise: 50 - (35 - x) and 80 - (65 - x) differ in the last bit) split
    if (Math.abs(uA - uB) < 1e-9) { a += 0.5; b += 0.5; }
    else if (uA > uB) a++;
    else b++;
  }
  return [a * 100 / G, b * 100 / G];
}

function logitRef(pA, pB, c) {
  const sigma = Math.max(c.sigma, 1e-6);
  const uA = (10 - c.alpha * pA) / sigma, uB = (10 - c.alpha * pB) / sigma;
  // plain formula: shares = e^u / (e^uA + e^uB + 1), computed with the max subtracted to stay finite
  const m = Math.max(uA, uB, 0);
  const eA = Math.exp(uA - m), eB = Math.exp(uB - m), e0 = Math.exp(-m);
  return [c.marketSize * eA / (eA + eB + e0), c.marketSize * eB / (eA + eB + e0)];
}

// ---- the cases ---------------------------------------------------------------------------------------------------
const spots = [[0, 100], [35, 65], [50, 50], [100, 0], [65, 35], [0, 0], [25, 75], [0.5, 99.5], [10, 90], [40, 60]];
const ts = [0, 0.1, 0.3, 0.5, 1, 2, 5];
const Vs = [100, 200, 50, 1000];
const boundsList = [[0, 250], [0, 100], [0.5, 20.5], [10, 50]];

function pricesFor([lo, hi], V) {
  const set = new Set([lo, hi, (lo + hi) / 2, lo + 0.01, hi - 0.01, 33.33, 35.5, 47.5, 99.99, 0.01, 1e-7,
    V, V - 0.01, V + 0.01, V / 2, V - 1, V + 50, 150, 185, 190, 199, 200, 201, 230, 249.99]);
  for (let k = 0; k <= 10; k++) set.add(lo + (hi - lo) * k / 10);
  return [...set].filter(p => Number.isFinite(p) && p >= lo && p <= hi).map(p => Math.round(p * 100) / 100);
}

const failures = [];
let n = 0;
const clientMismatches = [];
const invariants = [];
const sameAs = (x, y, tol) => Math.abs(x - y) <= tol;
const sameNumber = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y)); // relative: a 1e9 market

for (const [x1, x2] of spots) for (const t of ts) for (const V of Vs) for (const bounds of boundsList) {
  const config = { modelType: 'hotelling', travelCost: t, consumerValue: V, x1, x2, priceBounds: { min: bounds[0], max: bounds[1] }, marketSize: 100 };
  if (V <= bounds[0]) continue; // validateConfig refuses this
  const prices = pricesFor(bounds, V);
  for (const pA of prices) for (const pB of prices) {
    n++;
    const d = computeDemand({ priceA: pA, priceB: pB, config });
    const [ta, tb] = QUICK && n % 3 ? [null, null] : bruteHotelling(pA, pB, config);
    const label = `spots ${x1}/${x2} t=${t} V=${V} prices ${pA}/${pB}`;
    // invariants that need no reference
    if (![d.demandA, d.demandB, d.shareA, d.shareB].every(Number.isFinite)) invariants.push(`${label}: non-finite ${JSON.stringify(d)}`);
    if (d.demandA < -1e-9 || d.demandB < -1e-9 || d.demandA + d.demandB > 100 + 1e-9) invariants.push(`${label}: out of range ${d.demandA} + ${d.demandB}`);
    if (pA > V && d.demandA > 1e-9) invariants.push(`${label}: price above valuation still sells ${d.demandA}`);
    if (pB > V && d.demandB > 1e-9) invariants.push(`${label}: price above valuation still sells ${d.demandB}`);
    // the client's copy of the formula
    const [ca, cb] = clientDemand(pA, pB, config);
    if (!sameNumber(ca, d.demandA) || !sameNumber(cb, d.demandB)) clientMismatches.push(`${label}: server ${d.demandA}/${d.demandB} client ${ca}/${cb}`);
    if (ta === null) continue;
    if (!sameAs(ta, d.demandA, TOL) || !sameAs(tb, d.demandB, TOL)) {
      failures.push({ label, server: [d.demandA, d.demandB], truth: [ta, tb] });
    }
  }
}

// logit: finite, shares sum to at most 1, demand falls with own price
const logitFails = [];
for (const alpha of [0, 0.1, 1, 10, 1e6]) for (const sigma of [0.01, 0.5, 1, 5, 1e6]) for (const marketSize of [1, 100, 1000, 1e9]) {
  const config = { modelType: 'logit', alpha, sigma, marketSize, priceBounds: { min: 0, max: 100 } };
  const prices = [0, 0.01, 1, 5, 9.99, 10, 10.01, 25, 50, 99.99, 100];
  for (const pA of prices) for (const pB of prices) {
    n++;
    const d = computeDemand({ priceA: pA, priceB: pB, config });
    const [ra, rb] = logitRef(pA, pB, config);
    const label = `logit alpha=${alpha} sigma=${sigma} M=${marketSize} prices ${pA}/${pB}`;
    if (![d.demandA, d.demandB].every(Number.isFinite)) logitFails.push(`${label}: non-finite`);
    else if (d.demandA + d.demandB > marketSize * (1 + 1e-9) || d.demandA < 0 || d.demandB < 0) logitFails.push(`${label}: out of range`);
    else if (!sameAs(d.demandA, ra, 1e-6 * marketSize) || !sameAs(d.demandB, rb, 1e-6 * marketSize)) logitFails.push(`${label}: ${d.demandA} vs ${ra}`);
    const up = computeDemand({ priceA: pA + 1, priceB: pB, config });
    if (up.demandA > d.demandA + 1e-9) logitFails.push(`${label}: demand rises with own price`);
    const [ca, cb] = clientDemand(pA, pB, config);
    if (!sameNumber(ca, d.demandA) || !sameNumber(cb, d.demandB)) clientMismatches.push(`${label}: server ${d.demandA}/${d.demandB} client ${ca}/${cb}`);
  }
}

// ---- report ------------------------------------------------------------------------------------------------------
const show = (list, title) => { if (list.length) { console.log(`\n${title} (${list.length}; first 25):`); list.slice(0, 25).forEach(f => console.log('  ' + (typeof f === 'string' ? f : `${f.label}: server ${f.server.map(v => v.toFixed(2)).join('/')} vs street ${f.truth.map(v => v.toFixed(2)).join('/')}`))); } };
show(failures, 'Hotelling demand differs from the brute-force street');
show(invariants, 'Hotelling invariant broken');
show(logitFails, 'Logit problems');
show(clientMismatches, 'Client formula (econ.js) differs from the server');
if (failures.length) {
  // group the failures by configuration so the pattern is visible
  const byCfg = new Map();
  failures.forEach(f => { const k = f.label.replace(/ prices.*/, ''); byCfg.set(k, (byCfg.get(k) || 0) + 1); });
  console.log(`\nfailing configurations (${byCfg.size}):`);
  [...byCfg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log(`  ${v.toString().padStart(4)}  ${k}`));
}
console.log(`\n${n} price pairs checked; ${failures.length} Hotelling mismatches, ${invariants.length} invariant breaks, ${logitFails.length} logit problems, ${clientMismatches.length} client/server formula mismatches`);
process.exit(failures.length || invariants.length || logitFails.length || clientMismatches.length ? 1 : 0);
