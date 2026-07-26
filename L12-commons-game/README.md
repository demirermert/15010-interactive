# Tragedy of the Commons Game

A classroom game demonstrating the tragedy of the commons concept.

## Setup

### Server
```bash
cd server
npm install
npm start
```

The server runs on port 4001 by default.

### Client
```bash
cd client
npm install
npm run dev
```

The client runs on port 3001 by default.

## Game Rules

- Multiple ponds with 4 students per pond
- 5 rounds total
- Starts with 20 fish per pond
- Each student can catch 0-5 fish per round
- After each round, remaining fish double (capped at 40)
- At game end, uncaught fish are split proportionally among players
- Goal: Catch the most fish by the end of the game

## How to Play

1. Instructor creates a session and shares the code
2. Students join with the session code
3. Once students have joined, the instructor starts the game (AI players fill to groups of 4)
4. Each round, students decide how many fish to catch
5. After 5 rounds, the game ends and shows the final results

## Deployment

### Backend (Render)

1. Push your code to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com/)
3. Click "New +" → "Blueprint"
4. Connect your GitHub repository
5. Select the `commons-game` directory
6. Render will automatically detect `render.yaml` and deploy

Your backend will be available at: `https://commons-game-server.onrender.com`

### Frontend (Vercel)

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New" → "Project"
3. Import your GitHub repository
4. Configure the project:
   - **Framework Preset**: Vite
   - **Root Directory**: `client`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Add Environment Variable:
   - **Name**: `VITE_SOCKET_URL`
   - **Value**: `https://commons-game-server.onrender.com` (your Render backend URL)
6. Click "Deploy"

Your frontend will be available at: `https://your-project.vercel.app`

### Testing Automation

To test the game locally with automated browsers:
```bash
npm run automate
```

To enable auto-submission with 5 students:
```bash
npm run automate -- -a 5
```

To test the online/production version:
```bash
npm run automate -- -o
```

To test online with auto-submission and 3 students:
```bash
npm run automate -- -a 3 -o
```

**Flags:**
- `-a` or `--auto`: Enable automatic fish submission (optionally followed by number of students)
- `-o` or `--online`: Test against production URLs (https://commons-game.vercel.app)


