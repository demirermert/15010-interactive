# Ultimatum Game - Manual Mode Quick Guide

## What is Manual Mode?

Manual Mode (`-m` flag) lets YOU control the game parameters and timing while the automation handles creating student tabs.

## How to Use Manual Mode

### Command:
```bash
node ultimatum-game-automation.js -m -a 6
```

### What This Does:

**Step 1: Opens Instructor Page**
- Script opens the instructor page
- Clicks "New Game" button for you
- **WAITS FOR YOU** to configure settings

**Step 2: YOU Configure the Game**
In the browser window, you can set:
- ✏️ Session Name
- ⏱️ Proposing Time (seconds)
- ⏱️ Responding Time (seconds)  
- 💰 Min/Max Offer amounts
- Then click **"Create Session"**

**Step 3: Script Detects Session Code**
- Automatically detects the session code (e.g., "ABCD")
- Displays it in the terminal

**Step 4: YOU Open the Lobby**
- Script waits for YOU to click **"Open Lobby"** button
- Once clicked, script proceeds

**Step 5: Students Join Automatically**
- Script creates 6 student tabs (or however many you specified)
- All students join automatically

**Step 6: YOU Start the Game**
- Manual mode: Script waits for YOU to click **"Start Game"**
- Auto mode: Game plays automatically with students making random decisions

## Command Options

### Manual Mode WITHOUT Auto-Submit
```bash
node ultimatum-game-automation.js -m
```
- You control: parameters, open lobby, start game, AND students need manual input

### Manual Mode WITH Auto-Submit (RECOMMENDED)
```bash
node ultimatum-game-automation.js -m -a 6
```
- You control: parameters, open lobby, start game
- Students automatically make offers and accept/reject decisions

### Manual Mode with Different Student Counts
```bash
# 4 students
node ultimatum-game-automation.js -m -a 4

# 10 students
node ultimatum-game-automation.js -m -a 10

# Odd numbers work too (bot fills in)
node ultimatum-game-automation.js -m -a 5
```

## What You'll See in Terminal

```
🚀 Starting Ultimatum Game Test Automation...

Configuration: 6 students, Auto-submit: true, Manual start: true

🌐 Launching browser...
✅ Browser launched successfully

🎓 Opening instructor page for manual setup...
🔗 Navigating to http://localhost:5173/ult/instructor...
📝 Looking for "New Game" button...
🖱️  Clicking New Game button...
✅ Clicked New Game button

============================================================
📋 MANUAL MODE: Configure and create your game
============================================================
👉 Configure game settings in the browser
👉 Click "Create Session"
👉 Waiting for session code to appear...
============================================================

⏳ Waiting for you to create the session...
✅ Session Code: ABCD

============================================================
🚪 Waiting for you to click "Open Lobby"...
============================================================

✅ Lobby opened! Students can now join.

👥 Creating 6 student tabs...
👤 Setting up Student 1...
✅ Student 1: Successfully joined session
...
✅ 6 students joined successfully!

🎮 Game session ready with 6 students
🤖 Auto-submit is ENABLED - students will submit automatically
🖥️  Browser windows will remain open for testing
⏹️  Press Ctrl+C to close all windows and exit
```

## When to Use Manual Mode

✅ **Use Manual Mode when you want to:**
- Test with specific time settings (e.g., 5 seconds vs 30 seconds)
- Try different offer ranges
- Control exactly when the game starts
- Teach/demo the game step-by-step

❌ **Don't use Manual Mode when:**
- You want quick automated testing → Use: `node ultimatum-game-automation.js -a 6`
- You want completely hands-off automation

## Pro Tips

1. **Keep auto-submit on** (`-a`) even in manual mode - it's much easier
2. **Start with fewer students** (4-6) to see what's happening
3. **Watch the instructor page** to see real-time progress
4. **Press Ctrl+C** anytime to stop and close all windows

## Example Workflow

```bash
# 1. Start servers (if not already running)
cd server && node server.js
cd client && npm run dev

# 2. Run manual mode automation
node ultimatum-game-automation.js -m -a 6

# 3. In the browser:
#    - Set proposing time: 15 seconds
#    - Set responding time: 15 seconds  
#    - Click "Create Session"
#    - Click "Open Lobby"
#    
# 4. Watch students join automatically
# 5. Click "Start Game" when ready
# 6. Watch the game play out automatically!
```

Perfect for testing, teaching, or demonstrations! 🎯

