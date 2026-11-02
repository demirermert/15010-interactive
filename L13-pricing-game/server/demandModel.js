export function computeLogitDemand({
  priceA,
  priceB,
  config
}) {
  const { marketSize, alpha, sigma } = config;
  // Add delta (constant utility term) - fixed at 10
  const delta = 10;
  const utilityA = delta - alpha * priceA;
  const utilityB = delta - alpha * priceB;
  const expA = Math.exp(utilityA / sigma);
  const expB = Math.exp(utilityB / sigma);
  const expOutside = 1; // Outside option has utility normalized to 0, so exp(0) = 1
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

export function computeHotellingDemand({
  priceA,
  priceB,
  config
}) {
  const { travelCost, x1, x2, consumerValue } = config;
  
  // Special case: firms at the same location
  if (x1 === x2) {
    let demandA, demandB;
    
    if (priceA === priceB) {
      // Same location, same price
      // Check if anyone buys: need V - price - 0 >= 0 (no travel cost at firm location)
      if (consumerValue >= priceA) {
        // Split demand equally
        demandA = 50;
        demandB = 50;
      } else {
        // Price too high, no one buys
        demandA = 0;
        demandB = 0;
      }
    } else if (priceA < priceB) {
      // A charges less - check if anyone buys from A
      if (consumerValue >= priceA) {
        demandA = 100;
        demandB = 0;
      } else {
        demandA = 0;
        demandB = 0;
      }
    } else {
      // B charges less - check if anyone buys from B
      if (consumerValue >= priceB) {
        demandA = 0;
        demandB = 100;
      } else {
        demandA = 0;
        demandB = 0;
      }
    }
    
    const shareA = demandA / 100;
    const shareB = demandB / 100;
    
    return {
      demandA,
      demandB,
      shareA,
      shareB
    };
  }
  
  // Standard case: firms at different locations
  // Calculate indifferent consumer location (between firms)
  // At location x, utility from A: V - p1 - t|x - x1|
  // At location x, utility from B: V - p2 - t|x - x2|
  // Indifferent when utilities are equal
  
  // For x between x1 and x2 (assuming x1 < x2):
  // V - p1 - t(x - x1) = V - p2 - t(x2 - x)
  // -p1 - tx + tx1 = -p2 - tx2 + tx
  // p2 - p1 = tx2 + tx - tx - tx1 = t(x2 + x1 - 2x)
  // x* = (x1 + x2)/2 + (p2 - p1)/(2t)
  const xStar = (x1 + x2) / 2 + (priceB - priceA) / (2 * travelCost);
  
  // Now find participation boundaries
  // A consumer at location x buys from firm A if: V - priceA - t|x - x1| >= 0
  // A consumer at location x buys from firm B if: V - priceB - t|x - x2| >= 0
  
  // Find the leftmost consumer who buys from firm A
  // For consumers to the left of or at x1: distance = |x - x1| = x1 - x (if x < x1) or 0 (if x = x1)
  // At x1: utility = V - priceA - 0 = V - priceA
  // Moving left from x1: utility = V - priceA - t(x1 - x)
  // Leftmost buyer from A: V - priceA - t(x1 - x) = 0 => x = x1 - (V - priceA)/t
  const leftmostA = Math.max(0, x1 - (consumerValue - priceA) / travelCost);
  
  // Find the rightmost consumer who buys from firm A
  // For consumers to the right of x1: distance = x - x1
  // Rightmost buyer from A: V - priceA - t(x - x1) = 0 => x = x1 + (V - priceA)/t
  const rightmostA = Math.min(100, x1 + (consumerValue - priceA) / travelCost);
  
  // Find the leftmost consumer who buys from firm B
  // For consumers to the left of x2: distance = x2 - x
  // Leftmost buyer from B: V - priceB - t(x2 - x) = 0 => x = x2 - (V - priceB)/t
  const leftmostB = Math.max(0, x2 - (consumerValue - priceB) / travelCost);
  
  // Find the rightmost consumer who buys from firm B
  // For consumers to the right of or at x2: distance = |x - x2| = x - x2 (if x > x2) or 0 (if x = x2)
  // Rightmost buyer from B: V - priceB - t(x - x2) = 0 => x = x2 + (V - priceB)/t
  const rightmostB = Math.min(100, x2 + (consumerValue - priceB) / travelCost);
  
  // Now determine the market split
  let demandA = 0;
  let demandB = 0;
  
  // Check if anyone buys at all
  if (rightmostA >= leftmostA || rightmostB >= leftmostB) {
    // Find the effective boundaries for each firm
    // Firm A serves from leftmostA to min(xStar, rightmostA)
    // But also need to check if firm B's range overlaps
    
    // The actual split point is the indifferent consumer, but bounded by participation
    let splitPoint = xStar;
    
    // Firm A can serve [leftmostA, rightmostA]
    // Firm B can serve [leftmostB, rightmostB]
    
    // Find overlap region where both could serve
    const overlapStart = Math.max(leftmostA, leftmostB);
    const overlapEnd = Math.min(rightmostA, rightmostB);
    
    if (overlapEnd >= overlapStart) {
      // There's an overlap - use indifferent consumer to split
      splitPoint = Math.max(overlapStart, Math.min(xStar, overlapEnd));
      
      // Firm A: from leftmostA to splitPoint
      demandA = Math.max(0, splitPoint - leftmostA);
      
      // Firm B: from splitPoint to rightmostB
      demandB = Math.max(0, rightmostB - splitPoint);
    } else {
      // No overlap - each firm has its own region
      // Firm A serves [leftmostA, rightmostA]
      demandA = Math.max(0, rightmostA - leftmostA);
      
      // Firm B serves [leftmostB, rightmostB]
      demandB = Math.max(0, rightmostB - leftmostB);
    }
  }
  
  // Cap at [0, 100]
  demandA = Math.max(0, Math.min(100, demandA));
  demandB = Math.max(0, Math.min(100, demandB));
  
  const shareA = demandA / 100;
  const shareB = demandB / 100;
  
  return {
    demandA,
    demandB,
    shareA,
    shareB
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

