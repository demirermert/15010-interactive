# Pricing Game Test Automation

Automated testing script for the pricing game using Puppeteer. This script automatically:
1. Opens the instructor page and creates a game session
2. Opens multiple student browser tabs
3. Has students join the session with the code
4. Starts the game
5. Optionally auto-submits prices for all students during gameplay

## Prerequisites

- Node.js installed
- Both server and client running locally:
  - Server: `cd server && npm start` (runs on port 4000)
  - Client: `cd client && npm run dev` (runs on port 5173)

## Installation

```bash
npm install
```

## Usage

### Basic Testing (Manual Student Input)

Open 6 students (default), but you manually enter prices:

```bash
npm run test-game
```

### Auto-Submit Mode

Automatically submit random prices for students:

```bash
# Default: 6 students with auto-submit
npm run test-auto

# Custom number of students (must be even for pairing)
npm run test-game -- -a 8    # 8 students with auto-submit
npm run test-game -- -a 10   # 10 students with auto-submit

# Pre-configured scripts
npm run test-auto-8   # 8 students
npm run test-auto-10  # 10 students
```

### Command Line Options

- `-a` or `--auto` : Enable auto-submit mode (students automatically submit random prices)
- `-a <number>` : Enable auto-submit with specific number of students
- `-o` or `--online` : Test against production URLs (update URLs in script first)

### Examples

```bash
# 4 students, manual input
node pricing-game-automation.js 4

# 8 students with auto-submit
node pricing-game-automation.js -a 8

# Default 6 students with auto-submit
node pricing-game-automation.js --auto
```

## What the Script Does

1. **Launches Browser** - Opens a Chrome/Chromium instance
2. **Sets Up Instructor**:
   - Navigates to `/instructor`
   - Clicks "New Game"
   - Clicks "Create Session"
   - Extracts the 4-character session code
3. **Sets Up Students**:
   - Opens N student tabs (must be even for pairing)
   - Each enters their name and session code
   - Clicks "Join Session"
4. **Starts Game**:
   - Brings instructor page to front
   - Clicks "Start Game" button
5. **Auto-Submit** (if enabled):
   - For each round:
     - Waits for input to be enabled
     - Generates random price within bounds
     - Submits the price
     - Waits for round to complete
   - Repeats for all rounds

## Features

- ✅ Automatic session creation and student joining
- ✅ Even number of students (for pairing requirement)
- ✅ Smart retry logic for flaky operations
- ✅ Connection pooling (handles 30+ students)
- ✅ Auto-submit mode with random prices
- ✅ Detailed console logging
- ✅ Screenshot capture on errors
- ✅ HTML debugging output
- ✅ Graceful shutdown (Ctrl+C)

## Troubleshooting

### "Session code not found"
- Check that the instructor page loaded correctly
- Look at `instructor-screenshot.png` and `instructor-debug.html`
- Ensure the game session was created successfully

### "Join button not found"
- Check that the student page loaded correctly
- Look at `student-N-error.png` screenshots
- Ensure the session code is valid

### Students don't auto-submit
- Make sure you used the `-a` or `--auto` flag
- Check console for error messages
- Verify that the game has started (instructor clicked "Start Game")

### Too many students fail to connect
- The script limits to 31 concurrent tabs by default
- For more students, tabs are closed after joining (they remain in the game)
- Reduce delay between students if needed

## Notes

- **Browser stays open**: After running, browser windows remain open for manual inspection
- **Press Ctrl+C** to close all windows and exit
- **Screenshots**: Error screenshots are saved to the current directory
- **Even numbers**: Student count is auto-adjusted to be even (for pairing)
- **Auto-submit**: Uses random prices within the configured bounds

## Architecture

The script uses Puppeteer to:
- Control Chrome/Chromium browser
- Navigate pages and fill forms
- Click buttons and submit data
- Extract session information
- Monitor game state
- Handle React-specific form updates

## Local vs Production

By default, tests run against localhost:
- Instructor: `http://localhost:5173/instructor`
- Student: `http://localhost:5173`

To test production, use the `-o` flag (update URLs in the script first).

## Example Output

```
🚀 Starting Pricing Game Test Automation...

🌐 Launching browser...
✅ Browser launched successfully

🎓 Setting up instructor...
🔗 Navigating to http://localhost:5173/instructor...
📝 Looking for "New Game" button...
✅ Clicked New Game button
✅ Clicked Create Session button
✅ Session Code: AB12

==================================================
📋 SESSION CODE: AB12
==================================================

👥 Creating 6 student tabs...
✅ Student 1: Successfully joined session
✅ Student 2: Successfully joined session
...

🎮 Starting the game...
✅ Game started!
🤖 Auto-submit mode enabled! Students will automatically submit prices.

💰 Student 1 Round 1: Attempting to submit price $45.23
✅ Student 1 Round 1: Submitted successfully
...
```

