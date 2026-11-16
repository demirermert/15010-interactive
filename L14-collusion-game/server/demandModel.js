export function computeLogitDemand({
  priceA,
  priceB,
  config
}) {
  const { marketSize, alpha } = config;
  const sigma = Math.max(config.sigma, 1e-6); // sigma = 0 would divide by zero (2026-11-02 audit)
  // Add delta (constant utility term) - fixed at 10
  const delta = 10;
  const utilityA = delta - alpha * priceA;
  const utilityB = delta - alpha * priceB;
  // Subtract the largest exponent before exp() so a tiny sigma cannot overflow to Infinity/NaN; the shares are unchanged.
  const top = Math.max(utilityA / sigma, utilityB / sigma, 0);
  const expA = Math.exp(utilityA / sigma - top);
  const expB = Math.exp(utilityB / sigma - top);
  const expOutside = Math.exp(0 - top); // Outside option has utility normalized to 0
  const denom = expA + expB + expOutside;
  const shareA = denom === 0 ? 0 : expA / denom;
  const shareB = denom === 0 ? 0 : expB / denom;
  const demandA = marketSize * shareA;
  const demandB = marketSize * shareB;
  return {
    demandA,
    demandB,
    shareA,
    shareB
  };
}

// Drivers live along a road from 0 to 100, one per unit of length (the 2026-11-10 gas-station framing; the code says
// consumers and sellers). A consumer at x gets V - price - t|x - spot| from a seller, buys from the seller that leaves
// them the most, and buys nothing if both leave them less than zero. Equal offers are split in half. The demand
// returned is in units of config.marketSize (gallons sold on the whole road when every driver buys; 100 = one per
// driver, the pre-2026-11-10 behaviour); the shares are the fraction of the road served.
//
// Rewritten 2026-11-08 (teaching23-games) after a brute-force check of the earlier closed form: that version gave the
// right numbers when the sellers stand at the two ends of the street (every 2026 default game: spots 0 and 100) but
// (a) with the sellers inside the street (e.g. 35 and 65, the 2025 layout) it forgot the customers one seller reaches
//     beyond the other's reach, so a seller facing a rival priced near V could lose a third of the market, and
// (b) with both sellers on the same spot it ignored the walking cost, so a price above V - t x 50 still sold to all.
// This version integrates exactly: on each stretch between two breakpoints (the ends of the street, the two spots, the
// four points where a seller's offer hits zero, and the point where the two offers are equal) the winner is the
// same everywhere, so the stretch's length goes to that winner. No special cases, any spots in any order, t = 0 too.
export function computeHotellingDemand({
  priceA,
  priceB,
  config
}) {
  const { travelCost, x1, x2, consumerValue } = config;
  const t = Number(travelCost) || 0;
  const V = consumerValue;
  const offerA = x => V - priceA - t * Math.abs(x - x1);
  const offerB = x => V - priceB - t * Math.abs(x - x2);

  const points = [0, 100, x1, x2];
  if (t > 0) {
    const reachA = (V - priceA) / t, reachB = (V - priceB) / t;
    points.push(x1 - reachA, x1 + reachA, x2 - reachB, x2 + reachB);
    // the two offers are equal at x* = (x1 + x2)/2 + (pB - pA)/(2t) when A stands to the left of B, and at the
    // mirror point when A stands to the right; an extra breakpoint costs nothing, so both go in
    const mid = (x1 + x2) / 2, shift = (priceB - priceA) / (2 * t);
    points.push(mid + shift, mid - shift);
  }
  const cuts = [...new Set(points.filter(p => Number.isFinite(p) && p >= 0 && p <= 100))].sort((a, b) => a - b);

  let demandA = 0;
  let demandB = 0;
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const length = cuts[i + 1] - cuts[i];
    if (length <= 0) continue;
    const m = (cuts[i] + cuts[i + 1]) / 2;
    const a = offerA(m), b = offerB(m);
    if (a < 0 && b < 0) continue;            // nobody on this stretch buys
    if (b < 0) demandA += length;            // only A's offer is worth taking
    else if (a < 0) demandB += length;
    else if (Math.abs(a - b) < 1e-9) { demandA += length / 2; demandB += length / 2; }
    else if (a > b) demandA += length;
    else demandB += length;
  }

  demandA = Math.max(0, Math.min(100, demandA));
  demandB = Math.max(0, Math.min(100, demandB));
  const M = Number(config.marketSize) > 0 ? Number(config.marketSize) : 100;
  return {
    demandA: demandA * (M / 100),
    demandB: demandB * (M / 100),
    shareA: demandA / 100,
    shareB: demandB / 100
  };
}

export function computeDemand({
  priceA,
  priceB,
  config
}) {
  // Dispatch to the correct model based on config
  if (config.modelType === 'hotelling') {
    return computeHotellingDemand({ priceA, priceB, config });
  } else {
    // Default to logit model
    return computeLogitDemand({ priceA, priceB, config });
  }
}

