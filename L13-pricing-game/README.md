# Price Competition Classroom Game

Interactive web application that lets MBA students play a repeated differentiated price competition in real time. The instructor spins up a session, students join, set prices each round, and immediately see demand and profit based on a logit model.

## Stack

- Backend: Node.js, Express, Socket.io, SQLite (better-sqlite3)
- Frontend: React (Vite), Socket.io client, React Router

## Features

- **Parallel Sessions**: Multiple independent game sessions can run simultaneously with unique URLs
- **Separate Routes**: 
  - Student login at `/`
  - Instructor portal at `/instructor` (shows all instructors)
  - Individual instructor dashboards at `/instructor/:name` (e.g., `/instructor/mert`)
  - Session history browser at `/history`
  - Individual session pages at `/session/:code`
- **Persistent Storage**: All session data saved to SQLite database
- **Historical Data Browser**: View all past sessions with full details
- **CSV Export**: Download complete session data as CSV file
- **Shareable Links**: Each session gets its own URL for easy student access
- Instructor lobby with session creation, random pairing, real-time monitoring, leaderboard
- Student interface with 30-second decision timer, live feedback each round, history tracking
- Logit demand with configurable market size, price sensitivity, and differentiation (sigma)

## Getting Started

```bash
# Install dependencies
cd server && npm install
cd ../client && npm install

# Run backend
cd ../server
npm run start

# In another terminal, run frontend
cd ../client
npm run dev
```

Visit `http://localhost:5173` to access the application:
- **Instructors**: Go to `/instructor` to see all instructors, then click your name to access your personal dashboard
  - Each instructor has their own page (e.g., `/instructor/mert`, `/instructor/ellen`)
  - View your session history and create new games from your dashboard
- **Students**: Go to `/` to join a session or use the direct session link shared by instructor
- **History**: Go to `/history` to view all past sessions from all instructors

Each game session gets its own unique URL (`/session/:code`) that can be shared directly with students. Multiple sessions can run in parallel without interference.

Adjust the backend host via `VITE_SOCKET_URL` in the client environment if hosting separately.

## Configuration

The instructor picks:

- `rounds`: number of rounds (default 10)
- `roundTime`: seconds per decision round (default 30)
- `marketSize`: total market demand
- `alpha`: price sensitivity
- `sigma`: differentiation (higher values reduce price competition)
- `priceBounds`: allowed price range

Profit calculation assumes zero cost per unit.

## Data Persistence & Export

All session data is automatically saved to a SQLite database (`server/game_sessions.db`). This includes:
- Session metadata (code, instructor name, config, timestamps)
- All players and their roles
- Complete round-by-round results (prices, demands, profits, market shares)

### API Endpoints

- `GET /sessions` - List all sessions
- `GET /session/:code` - Get complete session data as JSON
- `GET /session/:code/export` - Download session data as CSV

### History Browser

Visit `/history` to view all past game sessions. Features include:
- **Session List**: View all sessions with code, instructor name, status, and timestamps
- **Session Details**: Click any session to see complete game details including:
  - Game configuration (market size, parameters)
  - All players and their pairs
  - Round-by-round results with all prices and calculations
- **CSV Download**: Download any session's data as CSV

### Instructor Dashboard

The instructor can download a CSV file of the current session by clicking the "Download CSV" button during or after the game. The CSV includes:
- All rounds
- Player names
- Prices chosen
- Opponent prices
- Demand and profit calculations
- Market share percentages

## How the game computes prices

`how-the-game-computes-prices.html` (open it in a browser) explains the street model, the three games, the special cases,
the Nash and collusion prices per setting, the round mechanics and the logit option, with a calculator that runs the same
formula as the server.

## Deployment (2026)

One Render web service, `pricing-game` in the course-games workspace (Starter plan, always on), runs the whole game:
the build compiles the React client (`client/dist`) and `server/server.js` serves it next to the API and Socket.io.
Settings are documented in the repo's `render.yaml` (`rootDir: L13-pricing-game`, build
`cd client && npm install && npm run build && cd ../server && npm install`, start `cd server && npm start`).
The service does not auto-deploy: trigger a deploy after pushing. Never deploy during a class: the running game lives in
memory and the SQLite history sits on the service's own disk, so a deploy or restart ends the game and clears the history.
Download the CSV from the dashboard at the end of every session.

Environment variables (set in the Render dashboard):

- `INSTRUCTOR_KEY` (required in production): the instructor opens the site once as `/instructor?key=<the key>`; the key is
  kept in that browser and every instructor page and REST call carries it. Without it a browser sees only the student page.
  Students never need it. The 15010.ai dashboard address redirects to the keyed address.
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `AI_MODEL` (optional): the ChatGPT seat that is paired with the odd student out.
  Since 2026-11-02 it runs through MIT's Parley gateway: base URL `https://parley.api.mit.edu/v1`, model `gpt-5.4`
  (about 1 s per answer; plays the Nash price), key = a Parley key from platform.parley.mit.edu (My keys). Parley model
  names have no provider prefix and there is no gpt-4o. Without a key that student plays against random prices. The
  seat decides at the start of each round, so the end of a round never waits for the model. Render reads the
  environment when a deploy starts: change a variable, then deploy.

## Change log

- 2026-11-02 audit: the server survives malformed socket messages; every game setting is validated (`server/config.js`);
  the demand model handles swapped seller positions, zero travel cost and tiny sigma; a price survives a reconnect; the
  client rejoins on every reconnect; students who are offline at the start are not paired; the leaderboard is computed by
  the server; students receive only their own pair's results; the instructor pages need `INSTRUCTOR_KEY`; CSV cells are
  escaped; a round can only be submitted to while it is open and every price is acknowledged.
- 2026-11-02: the 2026 lab look for the student and instructor pages; one Render service serves client and server.

## Where things stand (2026-11-07)

Owner: the teaching23-games agent (iTerm tab, created 2026-11-07), handed over from teaching6-labs, which built and
audited the 2026 version. Class 13 is the Thursday after Class 12 (Tue 2026-11-10); check the syllabus. Sections D 8:35, A 10:05.

Done so far (commits 2298d7c to 388e0de, all 2026-11-02):

- Renamed from L16; one Render service `pricing-game` (Starter, course-games workspace, service id srv-dbk7vu0473hc73ft9nag)
  serves the React client and the Socket.io server. Students: `pricing-game.onrender.com`, join with the 4-letter code.
  Instructor: `/instructor?key=<key>` once per browser, then `/instructor` and `/manage/<CODE>`.
- The 2026 lab look on the student and instructor pages.
- The audit (about 80 scripted checks plus an independent review) and its fixes, listed in the change log above: the
  process crash on malformed socket messages, settings validation, the price lost on reconnect, no rejoin, ghost
  partners, instructor takeover, leaderboard doubling, the swapped-seller demand bug, the 2025 crash (a NaN demand from
  a zero denominator arriving as null).
- The ChatGPT seat for the odd student out runs through MIT Parley (`gpt-5.4`, about 1 s, plays the Nash price;
  `gpt-5.5` is too slow, `gpt-5.4-mini` underprices) and decides at the start of each round, so rounds end on time.
- Form defaults = the 2025 games: 10 rounds at 60/50/40 then 30 s, 10 s breaks, V $200, t $1, prices 0 to 250, sellers
  at 0/100, 35/65 and 50/50 through quick-setup buttons.
- Dashboard: the three 2025 charts only (average price by round with a one-sd band, total profit by pair, individual
  profits by pair), no Nash or collusion lines and no histogram (Mert, 2026-11-02: "just introduce the visualisation,
  not adding lines"); find a pair; click a market to see its price paths. `how-the-game-computes-prices.html` explains
  the model with a calculator that runs the server's formula.
- The audit and fuzz scripts (`audit.mjs`, `fuzz.mjs`, about 90k cases, `set_parley.sh`) lived in a session scratchpad
  that is gone. The Jul 2026 bots in this folder (`pricing-game-automation.js`, `test-automation.js`, `load-test/`,
  `AUTOMATION-README.md`, `QUICK-TEST-GUIDE.md`) predate the rewrite: check them against the socket events in
  `server/server.js` before trusting them, or write new ones, and keep them in this folder.

Open with Mert (nothing decided yet):

- One session per section on the one service (recommended) versus six services.
- 15010.ai addresses: `lab13` for students, `lab13xx` carrying the key for Mert. None yet.
- The 35/65 market: with this demand code it is identical to 0/100 for prices up to $165 (only the midpoint between the
  sellers matters). Options offered: a lower walking cost per round (t 1 / 0.3 / 0) or a true location model (which has no
  stable price at 35/65).
- Rounds and seconds per game; the student rules wording; whether students see the $200 / $1 model numbers.
- Then: a run sheet in task 32's shape, a phone rehearsal with the TAs, the lab section in the Class 13 deck
  (teaching1-slides-now, task 7) with the addresses, rules and debrief numbers.

Rules that bite: never deploy on a class day (the game lives in memory and SQLite on the service disk, a deploy or restart
ends it and clears the history); the service does not auto-deploy, push then trigger a deploy; Render snapshots env vars
when a deploy starts; download the CSV after every session; the keys (`~/.pricing_game_key`, `~/.parley_key`) go onto the
service by Mert, never read or paste a key value; Starter plan, never free.
