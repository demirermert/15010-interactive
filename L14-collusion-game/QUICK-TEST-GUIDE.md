# Quick Start Guide for Testing the Pricing Game

## Step 1: Start the Servers

Make sure both servers are running in separate terminal windows:

### Terminal 1 - Backend Server
```bash
cd server
npm start
```
(Should show: Server running on port 4000)

### Terminal 2 - Frontend Client  
```bash
cd client
npm run dev
```
(Should show: Local: http://localhost:5173/)

## Step 2: Run the Automation

### Terminal 3 - Test Automation

#### Option A: Manual Testing (You Enter Prices)
```bash
npm run test-game
```
- Opens 6 students by default
- You manually enter prices during the game

#### Option B: Auto-Submit Testing (Automated Price Entry)
```bash
npm run test-auto
```
- Opens 6 students with automatic price submissions
- Students submit random prices automatically

#### Option C: Custom Number of Students
```bash
npm run test-game -- -a 8
```
- Opens 8 students with auto-submit
- Number must be even (for pairing)

## What You'll See

The script will:
1. 🌐 Launch Chrome browser
2. 🎓 Open instructor page and create a session
3. 📋 Display the SESSION CODE
4. 👥 Open multiple student tabs
5. ✅ Have each student join automatically
6. 🎮 Start the game
7. 💰 (If auto-submit) Submit random prices each round

## Browser Windows

You'll see multiple browser tabs open:
- **Tab 1**: Instructor dashboard (manage page)
- **Tab 2-N**: Student game views

The browser will stay open so you can watch the game!

## Stopping the Test

Press `Ctrl+C` in the terminal to close all browser windows.

## Tips

- The script prints detailed logs to the console
- If something fails, check the screenshots (`instructor-*.png`, `student-*.png`)
- Make sure your servers are running before starting the automation
- The session code is printed in a box for easy reference

## Example Run

```bash
$ npm run test-auto

> npm run test-auto

🚀 Starting Pricing Game Test Automation...
🌐 Launching browser...
✅ Browser launched successfully

🎓 Setting up instructor...
✅ Session Code: XY12

==================================================
📋 SESSION CODE: XY12
==================================================

👥 Creating 6 student tabs...
✅ Student 1: Successfully joined session
✅ Student 2: Successfully joined session
✅ Student 3: Successfully joined session
✅ Student 4: Successfully joined session  
✅ Student 5: Successfully joined session
✅ Student 6: Successfully joined session

🎮 Starting the game...
✅ Game started!
🤖 Auto-submit mode enabled!

💰 Student 1 Round 1: Attempting to submit price $45.67
✅ Student 1 Round 1: Submitted successfully
...
```

## Troubleshooting

**"ECONNREFUSED"**: Make sure both servers are running
**"Session code not found"**: Check `instructor-debug.html` for details  
**"Join button not found"**: Check `student-N-error.png` screenshots

See AUTOMATION-README.md for full documentation.

