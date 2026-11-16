# ChatGPT AI Player Setup

The game now supports using ChatGPT-4o as the AI player instead of random pricing!

## How It Works

When there's an odd number of students, an AI player is automatically added. If you provide an OpenAI API key, the AI will use ChatGPT-4o to make intelligent pricing decisions based on:

1. **Game rules** (demand model, price bounds, market size)
2. **Historical data** (previous rounds, opponent's pricing patterns)
3. **Strategic thinking** (remaining rounds, profit optimization)

## Setup Instructions

### Local Development

1. Create a `.env` file in the `server` directory:
```bash
cd pricing-game/server
nano .env
```

2. Add your OpenAI API key:
```
OPENAI_API_KEY=sk-your-actual-api-key-here
```

3. Restart the server:
```bash
npm start
```

You should see: `✓ OpenAI API initialized for ChatGPT AI player`

### Production (Render)

1. Go to your Render dashboard
2. Select your web service
3. Go to "Environment" tab
4. Add a new environment variable:
   - Key: `OPENAI_API_KEY`
   - Value: `sk-your-actual-api-key-here`
5. Save changes (Render will automatically redeploy)

## Getting an OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy the key (starts with `sk-...`)
5. Add it to your environment as described above

## How the AI Makes Decisions

The AI receives a detailed prompt each round that includes:

**Round 1:**
- Game rules and demand model
- Price bounds and constraints
- Number of rounds

**Subsequent Rounds:**
- All of the above
- Complete history of previous rounds
- Both players' prices, demands, and profits
- Cumulative profit comparison

The AI is instructed to:
1. Analyze opponent's pricing patterns
2. Consider the trade-off between price and market share
3. Think strategically about remaining rounds
4. Maximize total profit

## Fallback Behavior

If no API key is provided or if the API call fails:
- The AI will use random pricing (previous behavior)
- You'll see: `⚠ No OPENAI_API_KEY found - AI player will use random prices`

## Cost Considerations

- Each AI decision costs approximately $0.001-0.005 (depending on history length)
- A 10-round game costs approximately $0.01-0.05
- Monitor your usage at https://platform.openai.com/usage

## Testing

1. Create a session with an odd number of students (e.g., 1 student)
2. The AI player will be added automatically
3. Start the game
4. Watch the server console for AI decisions:
   ```
   [AI Player] ChatGPT suggested price: 42.50
   ```

Enjoy playing against ChatGPT! 🤖🎮

