import OpenAI from 'openai';

// Initialize OpenAI client (API key will be set from environment variable)
let openai = null;
// The gateway and model come from the environment (2026-11-02): with OPENAI_BASE_URL=https://parley.api.mit.edu/v1 the
// calls go through MIT's Parley gateway (billed to an MIT cost object) and AI_MODEL names the model there, e.g. openai/gpt-4o.
const BASE_URL = process.env.OPENAI_BASE_URL || undefined;
export const AI_MODEL = process.env.AI_MODEL || 'gpt-4o';

export function initializeOpenAI(apiKey, baseURL = BASE_URL) {
  if (apiKey) {
    openai = new OpenAI({ apiKey, baseURL, timeout: 8000, maxRetries: 0 }); // asked at the start of the round, so 8 s is fine
    console.log(`OpenAI API initialized for AI player (${baseURL || 'api.openai.com'}, model ${AI_MODEL})`);
  } else {
    console.warn('No OpenAI API key provided - AI player will use random prices');
  }
}

export function isOpenAIInitialized() {
  return openai !== null;
}

// The one-shot Nash price of the demand the server computes (2026-11-07). Street model with the market covered:
// t x 100 (every $1 below the rival wins 1/(2t) customers), $0 when walking is free or both sellers stand on the same
// spot; logit: no closed form, so the midpoint of the range. Used in the prompt and whenever the model cannot answer.
export function nashPrice(config) {
  const { min, max } = config.priceBounds;
  const clamp = p => Math.max(min, Math.min(max, Math.round(p * 100) / 100));
  if (config.modelType === 'hotelling') {
    const t = Number(config.travelCost) || 0;
    return clamp(t > 0 && config.x1 !== config.x2 ? t * 100 : 0);
  }
  return clamp((min + max) / 2);
}

export async function getAIPriceDecision(config, history = [], opponentHistory = []) {
  // Without a key the seat plays the one-shot Nash price (it used to play random prices, 2026-11-07)
  if (!openai) {
    return nashPrice(config);
  }

  try {
    // Build the game description
    const gameDescription = buildGamePrompt(config, history, opponentHistory);
    
    console.log(`[AI Player] Round ${history.length + 1}: History has ${history.length} entries`);
    
    // Call ChatGPT
    const completion = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content: "You are an expert in game theory and pricing strategy. You are playing a competitive pricing game. Analyze the situation carefully and provide ONLY a numerical price value as your response, nothing else."
        },
        {
          role: "user",
          content: gameDescription
        }
      ],
      // newer OpenAI models take max_completion_tokens and only the default temperature; their reasoning tokens count
      // against that budget, so it is generous and the effort kept low (50 tokens gave an empty answer, 2026-11-02)
      ...(/gpt-[5-9]|o[1-9]/.test(AI_MODEL) ? { max_completion_tokens: 1500, reasoning_effort: 'low' } : { temperature: 1.0, max_tokens: 50 })
    });

    const responseText = completion.choices[0].message.content.trim();
    console.log(`[AI Player] ChatGPT raw response: "${responseText}"`);
    
    // Extract the number from the response
    const priceMatch = responseText.match(/[\d.]+/);
    if (priceMatch) {
      let price = parseFloat(priceMatch[0]);
      
      // Ensure price is within bounds
      price = Math.max(config.priceBounds.min, Math.min(config.priceBounds.max, price));
      price = Math.round(price * 100) / 100; // Round to 2 decimal places
      
      console.log(`[AI Player] ChatGPT chose ${price}`);
      return price;
    } else {
      console.warn('[AI Player] Could not parse price from ChatGPT response, playing the Nash price');
      const randomPrice = nashPrice(config);
      return Math.round(randomPrice * 100) / 100;
    }
  } catch (error) {
    console.error('[AI Player] Error calling OpenAI API:', error.message);
    // Fallback: the Nash price (a random price used to go in here, 2026-11-07)
    const randomPrice = nashPrice(config);
    return Math.round(randomPrice * 100) / 100;
  }
}

function buildGamePrompt(config, history, opponentHistory) {
  const currentRound = history.length + 1;
  
  let prompt = '';
  
  if (config.modelType === 'hotelling') {
    // Calculate monopoly price for Hotelling model
    const V = config.consumerValue;
    const t = config.travelCost;
    const x1 = config.x1;
    
    let monopolyPrice;
    // t = 0 would divide by zero (2026-11-02 audit): with no travel cost a lone seller reaches the whole street
    const leftReach = t > 0 ? (V/2) / t : Infinity;
    const rightReach = t > 0 ? (V/2) / t : Infinity;
    
    if (leftReach >= x1 && rightReach >= (100 - x1)) {
      // Hits both boundaries
      monopolyPrice = V/2;
    } else if (leftReach < x1 && rightReach < (100 - x1)) {
      // Interior solution
      monopolyPrice = V/2;
    } else if (leftReach >= x1) {
      // Hits left boundary
      monopolyPrice = (V + t * x1) / 2;
    } else {
      // Hits right boundary
      monopolyPrice = (V + t * (100 - x1)) / 2;
    }
    
    // Reference prices for THIS walking cost (2026-11-07): the model used to anchor on the $100 monopoly price and play
    // $100 whatever t was, so with t = 0.30 (Nash $30) or t = 0 (Nash $0) it was far off. The one-shot Nash price of the
    // demand the server computes is t x 100 with the market covered (every $1 below the rival wins 1/(2t) customers), or
    // $0 when walking is free (pure price competition); the collusive price is the highest common price at which the
    // farthest customer still buys.
    const { min: pMin, max: pMax } = config.priceBounds;
    const clamp = p => Math.max(pMin, Math.min(pMax, p));
    const x2 = config.x2;
    const farthest = Math.max(x1, 100 - x2, Math.abs(x2 - x1) / 2);
    const nashPrice = clamp(t > 0 && x1 !== x2 ? t * 100 : 0);
    const collusivePrice = clamp(V - t * farthest);
    const perDollar = t > 0 && x1 !== x2 ? (1 / (2 * t)).toFixed(2) : null;

    // Hotelling model prompt
    prompt = `You are playing a competitive pricing game using the Hotelling location model. Here are the rules:

GAME RULES:
- Consumer locations: uniformly distributed on [0, 100]
- Your location: ${config.x1}
- Opponent location: ${config.x2}
- Travel cost (t): $${config.travelCost} per unit distance${t > 0 ? '' : ' (no travel cost: the two sellers are identical to every consumer)'}
- Consumer valuation (V): $${config.consumerValue}
- Price range: $${pMin} to $${pMax}
- Total rounds: ${config.rounds}
- Current round: ${currentRound}
- Monopoly price (if you were alone): $${monopolyPrice.toFixed(2)}
- One-shot Nash equilibrium price for this travel cost: $${nashPrice.toFixed(2)} (profit $${(nashPrice * 50).toFixed(0)} each)
- Joint-profit (collusive) price for this travel cost: $${collusivePrice.toFixed(2)} (profit $${(collusivePrice * 50).toFixed(0)} each if both charge it)

HOW DEMAND WORKS:
- Consumers buy from whoever offers the lowest total cost (price + travel cost)
- A consumer only buys if their utility (V - price - travel_cost) is non-negative
- Your demand = number of consumers closer to you after accounting for price difference
- If prices are equal, demand splits based on locations
- Your profit = YourPrice × YourDemand

KEY INSIGHTS:
${perDollar
  ? `- Every $1 you price below your opponent wins you ${perDollar} customers (and every $1 above loses ${perDollar}); the indifferent consumer is at x* = (x1 + x2)/2 + (OpponentPrice - YourPrice)/(2×${config.travelCost})`
  : '- The cheaper seller gets ALL 100 consumers; equal prices split them 50/50. Any price above your opponent sells nothing.'}
- But consumers only buy if they get non-negative utility
- The monopoly price maximizes profit when there's no competition
- In round 1, charge the one-shot Nash price above. In later rounds, best-respond to what the opponent actually did: if the opponent
  has kept prices well above the Nash price in the last rounds, you may raise yours toward theirs (never above the collusive price);
  if the opponent undercuts you, move back down toward the Nash price. Do not undercut below the Nash price.

OBJECTIVE:
Maximize your total profit across all rounds.
`;
  } else {
    // Logit model prompt (default)
    const monopolyPrice = config.alpha > 0 ? 10 / config.alpha : config.priceBounds.max; // alpha = 0: no price sensitivity, so the top of the range
    
    prompt = `You are playing a competitive pricing game. Here are the rules:

GAME RULES:
- Market size: ${config.marketSize} units
- Price range: $${config.priceBounds.min} to $${config.priceBounds.max}
- Total rounds: ${config.rounds}
- Current round: ${currentRound}
- Monopoly price (if you were alone): $${monopolyPrice.toFixed(2)}

KEY INSIGHTS:
- If you set a LOWER price than your opponent, you get MORE market share
- If you set a HIGHER price than your opponent, you get LESS market share
- Your profit = YourPrice × YourDemand
- The monopoly price maximizes profit when there's no competition

OBJECTIVE:
Maximize your total profit across all rounds.
`;
  }

  // Add history if this is not the first round
  if (history.length > 0) {
    prompt += `\n\nGAME HISTORY:\n`;
    
    for (let i = 0; i < history.length; i++) {
      const myRound = history[i];
      const oppRound = opponentHistory[i];
      
      prompt += `Round ${myRound.round}:
  Your price: $${myRound.price.toFixed(2)} → Demand: ${myRound.demand.toFixed(1)} → Profit: $${myRound.profit.toFixed(2)}
  Opponent price: $${myRound.opponentPrice.toFixed(2)} → Demand: ${oppRound.demand.toFixed(1)} → Profit: $${oppRound.profit.toFixed(2)}
`;
    }
    
    // Calculate cumulative profits
    const myTotalProfit = history.reduce((sum, r) => sum + r.profit, 0);
    const oppTotalProfit = opponentHistory.reduce((sum, r) => sum + r.profit, 0);
    
    prompt += `\nCumulative Profit:
  Your total: $${myTotalProfit.toFixed(2)}
  Opponent total: $${oppTotalProfit.toFixed(2)}
`;
  }

  prompt += `\n\nDECISION:
Based on the game rules${history.length > 0 ? ' and the history above' : ''}, what price will you set for round ${currentRound}?

Consider:
1. Your opponent's pricing patterns (if any)
2. The trade-off between price and market share
3. The remaining rounds (${config.rounds - currentRound + 1} left including this one)

Respond with ONLY the numerical price value (e.g., "15.50" or "42.00"), nothing else.`;

  return prompt;
}

