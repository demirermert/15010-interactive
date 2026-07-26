import OpenAI from 'openai';

// Initialize OpenAI client (API key will be set from environment variable)
let openai = null;

export function initializeOpenAI(apiKey) {
  if (apiKey) {
    openai = new OpenAI({ apiKey });
    console.log('OpenAI API initialized for AI player');
  } else {
    console.warn('No OpenAI API key provided - AI player will use random prices');
  }
}

export function isOpenAIInitialized() {
  return openai !== null;
}

export async function getAIPriceDecision(config, history = [], opponentHistory = []) {
  // If OpenAI is not initialized, return a random price
  if (!openai) {
    const randomPrice = config.priceBounds.min + Math.random() * (config.priceBounds.max - config.priceBounds.min);
    return Math.round(randomPrice * 100) / 100;
  }

  try {
    // Build the game description
    const gameDescription = buildGamePrompt(config, history, opponentHistory);
    
    console.log(`[AI Player] Round ${history.length + 1}: History has ${history.length} entries`);
    
    // Call ChatGPT
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
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
      temperature: 1.0,
      max_tokens: 50
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
      
      console.log(`[AI Player] ChatGPT suggested price: ${price}`);
      return price;
    } else {
      console.warn('[AI Player] Could not parse price from ChatGPT response, using random price');
      const randomPrice = config.priceBounds.min + Math.random() * (config.priceBounds.max - config.priceBounds.min);
      return Math.round(randomPrice * 100) / 100;
    }
  } catch (error) {
    console.error('[AI Player] Error calling OpenAI API:', error.message);
    // Fallback to random price
    const randomPrice = config.priceBounds.min + Math.random() * (config.priceBounds.max - config.priceBounds.min);
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
    const leftReach = (V/2) / t;
    const rightReach = (V/2) / t;
    
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
    
    // Hotelling model prompt
    prompt = `You are playing a competitive pricing game using the Hotelling location model. Here are the rules:

GAME RULES:
- Consumer locations: uniformly distributed on [0, 100]
- Your location: ${config.x1}
- Opponent location: ${config.x2}
- Travel cost (t): ${config.travelCost} per unit distance
- Consumer valuation (V): $${config.consumerValue}
- Price range: $${config.priceBounds.min} to $${config.priceBounds.max}
- Total rounds: ${config.rounds}
- Current round: ${currentRound}
- Monopoly price (if you were alone): $${monopolyPrice.toFixed(2)}

HOW DEMAND WORKS:
- Consumers buy from whoever offers the lowest total cost (price + travel cost)
- A consumer only buys if their utility (V - price - travel_cost) is non-negative
- Your demand = number of consumers closer to you after accounting for price difference
- If prices are equal, demand splits based on locations
- Your profit = YourPrice × YourDemand

KEY INSIGHTS:
- Lower prices attract consumers who are farther from you
- The indifferent consumer location: x* = (x1 + x2)/2 + (OpponentPrice - YourPrice)/(2×${config.travelCost})
- But consumers only buy if they get non-negative utility
- The monopoly price maximizes profit when there's no competition

OBJECTIVE:
Maximize your total profit across all rounds.
`;
  } else {
    // Logit model prompt (default)
    const monopolyPrice = 10 / config.alpha;
    
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

