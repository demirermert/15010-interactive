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

// The one-shot Nash price of the demand the server computes (2026-11-07). Road model with the market covered:
// wholesale cost + t x 100 (every $1 below the rival wins 1/(2t) drivers), the wholesale cost alone when driving is
// free or both stations stand on the same spot (2026-11-10: the cost used to be zero); logit: no closed form, so the
// midpoint of the range, at least the cost. Used in the prompt and whenever the model cannot answer.
export function nashPrice(config) {
  const { min, max } = config.priceBounds;
  const c = Number(config.marginalCost) || 0;
  const clamp = p => Math.max(min, Math.min(max, Math.round(p * 100) / 100));
  if (config.modelType === 'hotelling') {
    const t = Number(config.travelCost) || 0;
    return clamp(c + (t > 0 && config.x1 !== config.x2 ? t * 100 : 0));
  }
  return clamp(Math.max(c, (min + max) / 2));
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
    const c = Number(config.marginalCost) || 0;          // wholesale cost per gallon (2026-11-10)
    const M = Number(config.marketSize) > 0 ? Number(config.marketSize) : 100; // gallons on the road when everyone buys

    // Reference prices for THIS driving cost (2026-11-07): the model used to anchor on the $100 monopoly price and play
    // $100 whatever t was, so with t = 0.30 (Nash $30) or t = 0 (Nash $0) it was far off. The one-shot Nash price of the
    // demand the server computes is cost + t x 100 with the market covered (every $1 below the rival wins 1/(2t) drivers),
    // or the cost alone when driving is free (pure price competition); the collusive price is the highest common price at
    // which the farthest driver still buys. The monopoly hint is the interior monopoly price (V + c)/2.
    const { min: pMin, max: pMax } = config.priceBounds;
    const clamp = p => Math.max(pMin, Math.min(pMax, p));
    const x2 = config.x2;
    const farthest = Math.max(x1, 100 - x2, Math.abs(x2 - x1) / 2);
    const monopolyPrice = clamp((V + c) / 2);
    const nashPrice = clamp(c + (t > 0 && x1 !== x2 ? t * 100 : 0));
    const collusivePrice = clamp(V - t * farthest);
    const perDollar = t > 0 && x1 !== x2 ? (M / 100 / (2 * t)).toFixed(2) : null;
    const half = M / 2;

    // Hotelling model prompt
    prompt = `You are playing a competitive pricing game: two gas stations on a road (the Hotelling location model). Here are the rules:

GAME RULES:
- Driver locations: uniformly distributed on [0, 100]; when every driver buys, ${M} gallons are sold on the road per round
- Your location: ${config.x1}
- Opponent location: ${config.x2}
- Driving cost (t): $${config.travelCost} per unit distance${t > 0 ? '' : ' (no driving cost: the two stations are identical to every driver)'}
- Value of a gallon to a driver (V): $${config.consumerValue}
- Your wholesale cost (marginal cost): $${c.toFixed(2)} per gallon, the same for your opponent
- Price range: $${pMin} to $${pMax} per gallon
- Total rounds: ${config.rounds}
- Current round: ${currentRound}
- Monopoly price (if you were alone): $${monopolyPrice.toFixed(2)}
- One-shot Nash equilibrium price for this driving cost: $${nashPrice.toFixed(2)} (profit $${((nashPrice - c) * half).toFixed(0)} each)
- Joint-profit (collusive) price for this driving cost: $${collusivePrice.toFixed(2)} (profit $${((collusivePrice - c) * half).toFixed(0)} each if both charge it)

HOW DEMAND WORKS:
- Drivers buy from whoever offers the lowest total cost (price + driving cost)
- A driver only buys if their utility (V - price - driving_cost) is non-negative
- Your demand (gallons) = the share of the road closer to you after accounting for the price difference, times ${M}
- If prices are equal, demand splits based on locations
- Your profit = (YourPrice - ${c.toFixed(2)}) × YourDemand

KEY INSIGHTS:
${perDollar
  ? `- Every $1 you price below your opponent wins you ${perDollar} gallons (and every $1 above loses ${perDollar}); the indifferent driver is at x* = (x1 + x2)/2 + (OpponentPrice - YourPrice)/(2×${config.travelCost})`
  : `- The cheaper station gets ALL ${M} gallons; equal prices split them 50/50. Any price above your opponent sells nothing.`}
- But drivers only buy if they get non-negative utility
- Never price below your wholesale cost of $${c.toFixed(2)}: every gallon would lose money
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
    
    const c = Number(config.marginalCost) || 0;
    prompt = `You are playing a competitive pricing game. Here are the rules:

GAME RULES:
- Market size: ${config.marketSize} units
- Your unit cost (marginal cost): $${c.toFixed(2)}, the same for your opponent
- Price range: $${config.priceBounds.min} to $${config.priceBounds.max}
- Total rounds: ${config.rounds}
- Current round: ${currentRound}
- Monopoly price (if you were alone): $${monopolyPrice.toFixed(2)}

KEY INSIGHTS:
- If you set a LOWER price than your opponent, you get MORE market share
- If you set a HIGHER price than your opponent, you get LESS market share
- Your profit = (YourPrice - ${c.toFixed(2)}) × YourDemand; never price below your unit cost
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

