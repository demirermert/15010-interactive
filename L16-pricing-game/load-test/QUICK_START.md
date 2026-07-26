# 🚀 Quick Start - Load Testing

## Step 1: Get Your Render URL

1. Go to https://dashboard.render.com
2. Click on your `pricing-game-server`
3. Copy the URL at the top (e.g., `https://pricing-game-abc123.onrender.com`)

## Step 2: Run the Test

```bash
cd /Users/mertdemirer/Games/pricing-game/load-test
npm run test:production
```

## Step 3: Follow the Prompts

The script will ask you:
1. **Server URL** - Paste your Render URL
2. **Which test** - Choose 1-4 or type "all"
3. **Confirm** - Type "y" to run

## Example Session

```
🚀 PRODUCTION DEPLOYMENT TEST
════════════════════════════════════════════════════════════════════

📝 Enter your production server URL:
   Example: https://pricing-game-abc123.onrender.com

Server URL: https://pricing-game-abc123.onrender.com

🔍 Checking server health...
✅ Server is online and responding

════════════════════════════════════════════════════════════════════
🧪 Available Tests:
════════════════════════════════════════════════════════════════════
1. Smoke Test (5 students) - Quick test - is it working?
2. Small Class (20 students) - Typical small section
3. Medium Class (50 students) - Medium-sized class
4. Large Class (100 students) - Large lecture
════════════════════════════════════════════════════════════════════

Which test to run? (1-4 or "all"): 2

────────────────────────────────────────────────────────────────────
📊 Small Class
   Typical small section
   Students: 20
   Duration: ~90 seconds
────────────────────────────────────────────────────────────────────

Run this test? (y/n): y

🏁 Starting Small Class...

... test runs ...

════════════════════════════════════════════════════════════════════
📋 FINAL RESULTS
════════════════════════════════════════════════════════════════════
📊 Current Statistics:
   Connected: 20/20
   Joined: 20/20
   Prices Submitted: 60
   Errors: 0
   
🎯 Assessment:
   ✅ EXCELLENT - Server handled the load well!
```

## What the Results Mean

### ✅ All Green (95%+ success)
**Your server is ready!** Proceed with classroom use.

### ⚠️ Yellow (80-95% success)
**Mostly OK but has issues.** Consider:
- Upgrading Render plan
- Testing with fewer students

### ❌ Red (<80% success)
**Not ready.** You must:
- Upgrade from Free tier to at least Starter
- Or reduce students per session
- Or split into multiple sessions

## Quick Commands

Test different sizes without the interactive menu:

```bash
# Quick 10-student test
SERVER_URL=https://your-app.onrender.com npm run test:small

# 50 students
SERVER_URL=https://your-app.onrender.com npm run test:medium

# 100 students
SERVER_URL=https://your-app.onrender.com npm run test:large
```

## Before First Classroom Use

Run this checklist:

- [ ] Tested with 10 students ✓
- [ ] Tested with your expected class size ✓
- [ ] Upgraded from Free tier (if needed) ✓
- [ ] Verified results show "EXCELLENT" or "ACCEPTABLE" ✓
- [ ] Checked Render dashboard during test (no errors) ✓

## Need Help?

Read the full `README.md` for detailed explanations, troubleshooting, and capacity guidelines.

## Emergency Quick Test (Day of Class)

Run this 5 minutes before class:

```bash
cd /Users/mertdemirer/Games/pricing-game/load-test
SERVER_URL=https://your-render-url.onrender.com NUM_STUDENTS=5 node load-test.js
```

Should take 90 seconds and confirm everything works.

Good luck! 🎓

