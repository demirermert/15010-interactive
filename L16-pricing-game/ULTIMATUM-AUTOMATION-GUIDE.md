# Ultimatum Game Automation Guide

## Overview
This automation script uses Puppeteer to automatically test the Ultimatum Game by creating an instructor session and simulating multiple student players.

## Prerequisites

Before running the automation, make sure:

1. **Servers are running:**
   - Backend server on port 4000
   - Frontend client on port 5173

2. **To start the servers:**
   ```bash
   # Terminal 1 - Start backend
   cd server
   node server.js
   
   # Terminal 2 - Start frontend
   cd client
   npm run dev
   ```

## Running the Automation

### Basic Usage

**Simple test with manual actions (6 students, you control the game):**
```bash
node ultimatum-game-automation.js
```

### Advanced Options

**1. Auto-Submit Mode (Recommended)**

Students will automatically make offers and accept/reject decisions:
```bash
node ultimatum-game-automation.js -a
```

**2. Custom Number of Students**

Specify how many students (must be even for pairing):
```bash
# 10 students with auto-submit
node ultimatum-game-automation.js -a 10

# 4 students without auto-submit
node ultimatum-game-automation.js -a 4
```

**3. Test Online (Production)**

Test against your deployed version on Vercel:
```bash
# Test online with 6 students
node ultimatum-game-automation.js -a -o

# Test online with 8 students
node ultimatum-game-automation.js -a 8 -o
```

**4. Manual Start Mode**

You configure the game settings manually in the browser:
```bash
node ultimatum-game-automation.js -m
```

## Command Line Flags

| Flag | Long Form | Description | Example |
|------|-----------|-------------|---------|
| `-a` | `--auto` | Enable auto-submit for students | `-a` or `-a 10` |
| `-o` | `--online` | Test production (Vercel) instead of localhost | `-o` |
| `-m` | `--manual` | Manual configuration of game settings | `-m` |

## What Happens During Automation

### 1. Instructor Setup
- Opens instructor page at `/ult/instructor`
- Clicks "New Game" button
- Creates a new session
- Gets the 4-letter session code (e.g., "ABCD")
- Opens the lobby

### 2. Student Setup
- Opens N student tabs (default: 6)
- Each student fills in:
  - First Name: `Student1`, `Student2`, etc.
  - Last Name: `Test`
  - Session Code: (from instructor)
- All students join the lobby

### 3. Game Play (if auto-submit enabled)

**Player 1 (Proposer):**
- Waits for proposing phase to start
- Makes a random offer between $0-$20
- Submits the offer

**Player 2 (Responder):**
- Waits to receive the offer
- Randomly accepts (70% chance) or rejects (30% chance)
- Submits the decision

### 4. Results
- After the game completes, you can view results on the instructor page
- Browser windows stay open for inspection

## Common Use Cases

### Quick Test with 4 Students
```bash
node ultimatum-game-automation.js -a 4
```

### Full Test with 12 Students
```bash
node ultimatum-game-automation.js -a 12
```

### Test Production Site
```bash
node ultimatum-game-automation.js -a 6 -o
```

### Manual Testing (you control pace)
```bash
node ultimatum-game-automation.js
```

## Troubleshooting

### Error: "Failed to navigate"
- **Problem:** Servers not running
- **Solution:** Start both backend and frontend servers first

### Error: "Session code not found"
- **Problem:** Page didn't load properly
- **Solution:** Check browser console, reload and try again

### Error: "Student couldn't join"
- **Problem:** Network delay or lobby not open
- **Solution:** Check that lobby is open, increase delays in script

### Students not submitting
- **Problem:** Auto-submit not enabled
- **Solution:** Use `-a` flag: `node ultimatum-game-automation.js -a`

### Odd number of students
- **Problem:** Can't pair all students
- **Solution:** The system will automatically create an AI bot to pair with the odd student

## Screenshots

If errors occur, the script automatically saves screenshots:
- `ultimatum-instructor-error.png` - Instructor page error
- `ultimatum-student-N-error.png` - Student N error
- `ultimatum-instructor-screenshot.png` - General instructor screenshot

## Stopping the Automation

Press `Ctrl+C` in the terminal to:
- Close all browser windows
- Stop the automation
- Exit cleanly

## Tips

1. **Start with fewer students** (4-6) to see how it works
2. **Use auto-submit** (`-a`) for fully automated testing
3. **Keep browser visible** (not headless) to watch the game play out
4. **Check instructor page** for results table after game completes
5. **Test locally first** before testing online

## Example Session

```bash
$ node ultimatum-game-automation.js -a 6

🚀 Starting Ultimatum Game Test Automation...

🌐 Launching browser...
✅ Browser launched successfully

🎓 Setting up instructor...
🔗 Navigating to http://localhost:5173/ult/instructor...
📝 Looking for "New Game" button...
🖱️  Clicking New Game button...
✅ Clicked New Game button
📝 Looking for "Create Session" button...
🖱️  Clicking Create Session button...
✅ Clicked Create Session button
✅ Session Code: ABCD
🚪 Clicking "Open Lobby" button...
🖱️  Found "Open Lobby" button, clicking...
✅ Lobby opened! Students can now join.

==================================================
📋 SESSION CODE: ABCD
==================================================

👥 Creating 6 student tabs...
👤 Setting up Student 1...
✅ Student 1: Entered first name
✅ Student 1: Entered last name
✅ Student 1: Entered session code
✅ Student 1: Clicked Join Session
✅ Student 1: Successfully joined session
...
✅ 6 students joined successfully!

🎮 Starting the game...
🖱️  Clicking Start Game button...
✅ Game started!

🤖 Auto-submit mode enabled!
📊 Game will run for 1 rounds

💰 Student 1 Round 1: Offering $12 (Player 1)
✅ Student 1 Round 1: Offer submitted
📨 Student 2 Round 1: Received offer (Player 2)
🎲 Student 2 Round 1: Accepting offer
✅ Student 2 Round 1: Decision submitted
...
```

## Need Help?

If you encounter issues:
1. Check that both servers are running
2. Look at the browser windows to see what's happening
3. Check the screenshots saved in the project folder
4. Make sure you're using an even number of students (or let the system add a bot)

