# Price Competition Classroom Game

Interactive web application that lets MBA students play a repeated differentiated price competition in real time: two gas stations on a road (since 2026-11-10; a drinks game before), a wholesale cost per gallon that students are told, prices per gallon. The instructor spins up a session, students join in pairs, set prices each round, and immediately see gallons sold, market share and profit from the road (Hotelling) model.

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
- 2026-11-08 (teaching23-games, after Mert asked for a thorough test of the price entry and the calculation):
  the street demand is now computed by exact integration over the street's breakpoints (`server/demandModel.js`,
  mirrored in `client/src/econ.js`). A brute-force check (`test/fuzz_demand.mjs`: 200,000 consumers, 400k price
  pairs) showed the old closed form was right only with the sellers at the two ends of the street, which every 2026
  default game uses; with sellers inside the street it dropped the customers one seller reaches beyond the other's
  reach (35/65, t $0.30, prices $100 vs $200: 65 customers instead of 100), and with both sellers on one spot it
  ignored the walking cost. The server takes only a number or a numeric string as a price (through `Number()` an
  empty string, null or [] counted as $0 and true as $1), keeps prices to the cent, and clamps the forced random price
  inside fractional bounds. The price box is a text box read by `parsePrice` (a number box on an English keyboard
  silently dropped a comma: 35,5 became 355, 3,5 became $35); "Submitted at" shows the server's figure. New tests:
  `test/fuzz_demand.mjs`, `test/fuzz_prices.mjs` (starts a local server, 15 configurations at once, 46 kinds of
  payload, 277 checks, about 25 s), `test/drive.mjs` (the instructor's side of one game, for a real phone).
  `how-the-game-computes-prices.html` still carries its own copy of the old formula (left as written, per Mert).
  Deployed the same day with Mert's OK as commit f484688 to the six section services (Render API, one deploy each,
  all live in about two minutes; every host serves the new bundle, checked by the "That is not a number" message and
  `inputMode:"decimal"` in the served JavaScript). The rehearsal copy `pricing-game` was not redeployed.
- 2026-11-08 (later, Mert: "will this be robust to students refreshing their page?", "we don't want the students to
  have connection issues and drop"): a new test, `test/refresh.mjs` (50 checks, three games at once on its own server
  on port 4997), plus two real games in Chrome, reload the student at every stage. A plain reload was already handled
  (personal link `/session/<CODE>/<6-letter code>`, the server moves the seat to the new socket and carries the
  submitted price, the timer, the history and the pairing over). Fixed: (1) a reload after the game ended showed a
  total of $0 and no rounds, since the server sent the history only while running (now also when complete);
  (2) a student who closed the tab and typed the code again on the join page was told the game had started and lost
  the seat, since the join page wiped the browser's seat keys and joined as new (now the join page recognises a code
  it holds a seat for and goes straight back to the personal link; the "already started" message points to the
  personal link); (3) only connected phones were paired at Start (2026-11-02 audit), so a phone locked while the
  rules were explained sat out the whole game (now everyone in the lobby is paired, connected or not, except an
  offline seat whose name a connected seat also holds, which is a student who joined twice; a dark phone wakes up,
  rejoins and gets the running round); (4) the rival's name (when shown) came back as "Rival" after a reload until
  the next round (now resent on rejoin); (5) coming back to the page after more than 15 s away (phone unlocked,
  app switch, back button, network back) remakes the socket at once instead of waiting up to 45 s for Socket.io's
  ping timeout to notice a dead one, then rejoins. Not changed: a student with no browser memory of the seat (other
  device, private window) cannot get back in once the game has started, by design (a seat can only be reclaimed with
  its personal code). Deployed with Mert's OK the same evening as commit 8edb766 to the six section services (all
  live in about a minute; every host serves the new bundle, checked by the `pageshow` listener and the seat key
  pattern in the served JavaScript).
- 2026-11-10 (Mert: "we want this to be a competition between gas stations ... students will get a marginal cost
  which is the wholesale price of gas"): the game is now two GAS STATIONS on a road. New settings: `marginalCost`
  (the wholesale cost per gallon, 0 to 1e9, must be below the max price and below V; default 0) and, for the road
  model, `marketSize` (gallons sold on the road per round when every driver buys; default 100 = the old one-per-
  driver numbers). Profit = (price − cost) × gallons; the demand model is unchanged, its quantity scaled by
  marketSize/100 (`server/demandModel.js`, `client/src/econ.js`). Nash price = cost + 100 t (the AI seat's price,
  the instructor hints), collusive price V − 50 t. Defaults (instructor form and the five default games): cost
  $2.50, a gallon worth $5.00 to a driver, 10,000 gallons, prices $0 to $10, t = 0.01 / 0.003 / 0 for games 1-3
  (Nash $3.50 / $2.80 / $2.50, profit per round $5,000 / $1,500 / $0 each; collusive $4.50 / $4.85 / $5.00, profit
  $10,000 / $11,750 / $12,500 each), demo t = 0.001 (Nash $2.60), chat game t = 0.003; the same margins as the
  drinks game divided by 100, on top of the cost. Students are told the wholesale cost (rules, the round card, the
  "How it works" box) and see gallons sold next to the market share; prices show cents whenever the max price is
  $50 or less (`priceFmt`); the forced random price is to the cent on such a range; the CSV column "Demand" is now
  "Quantity"; the dashboard's settings line names the road, the cost, the gallons and the Nash price; the ChatGPT
  prompt has the cost and the gallons and is told never to price below cost. Tests: `test/fuzz_prices.mjs` has two
  gas games and settings checks for the cost and the market size (318 checks), `sim_class.mjs` and the brute-force
  demand check updated; a game played in Chrome ($3.49 vs the AI seat's $3.50: 5,050 gallons, $4,999).
  `how-the-game-computes-prices.html` still describes the drinks game. Deployed to lab-a only the same afternoon for
  Mert's phone test (the other five stayed on the drinks version until his OK).
  Same evening, after his phone test: the default price range is $2.50 to $10 (from the wholesale cost up); the
  student header is compact (title, "15.010 · Class 13 · session · name", the round dots, the course logo top right);
  the round-result card shows the two profits large, a market-share bar and one table (price, gallons, share, profit,
  total so far) for both stations; grid items may shrink on a phone (`min-width:0`; the widest table used to push the
  page wider than the screen). Checked with headless Chrome at 520 px (its minimum window width; narrower
  `--window-size` values are clamped, so a 390 px shot is just a crop) using `test/screens.mjs`, which plays round 1
  of a quick game by script and prints the student's link for the camera (`--finish` plays round 2 too and reports
  the game over).
  Later the same evening (Mert, from his phone): the AI seat is named "ChatGPT" or "AI Player" with no robot emoji;
  the student's rounds table fits a phone with no sideways scroll (on screens up to 560 px wide it uses short
  headings and K figures: 5,050 gallons -> 5.1K, $12,450 -> $12.5K, via `kfmt`/`moneyK`; wider screens keep the
  full numbers); the game-over card has the shape of the round-result card (both total profits large, the average
  market shares as a bar, one table with total profit, average price, gallons sold, average share and rounds won,
  then the rank in the class); the course logo is bigger (46 px, 38 on a phone). Instructor dashboard (Mert: the
  2025 panels, improved): the "Pairs · round N" table of the last round is gone; the panels are the state, the
  average price by round, total profit by pair, the leaderboard, individual profits by pair and the students, as in
  2025; hovering a market in either pair chart opens a floating box with the pair's two price paths and one line per
  round with both prices and both profits (the 2025 page had this), a click still pins the market's chart below;
  the chart points name the round and the value on hover.
  Then tested on lab-a itself (Mert: "test this yourself"): a 4-round game with two scripted students
  (`test/bots.mjs --host <url> --code XXXX --n 2`, random prices from the cost up), one student in Chrome and the
  ChatGPT seat through Parley (it priced $3.50, $3.54, $3.50, $4.49: the Nash price, then up when its rival priced
  high; never below cost). Checked: the join address 15010.ai/l13-a, the lobby, the round card and the submitted
  line, the result card, the forced price when nothing is sent (cents, inside $2.50-$10), the game-over card and
  the rank, the phone layout at 520 px (result and game over), the dashboard's panels and hover box in the archived
  view, and the CSV (16 rows, every profit = (price − 2.50) × quantity). Test game deleted afterwards.
  After his own run (Mert): the rounds table shows the market share, not the gallons (the result and game-over
  cards list the share first and the gallons under it); the price is typed as DOLLARS and CENTS in two boxes with
  the phone's digit keypad (`.pin2`): the dollars box hands over to the cents box as soon as another digit could not
  fit under the max price (3 at a $10 max, 35 at $250) or on a typed point or comma, backspace in an empty cents box
  goes back, cents are read as typed (5 = 50), the boxes show the server's figure once the price is in. Other ways
  considered: one box with digits only filling from the right like a pump or card terminal (349 = $3.49); an
  on-screen keypad drawn by the page (no phone keyboard at all); a slider or +/− buttons; preset price chips. The
  two boxes are the most explicit and need no decimal point; `parsePrice` stays for anything else that sends text.
  Then (Mert, after another phone run): the break countdown sits at the top of the result card as a clock with a
  shrinking bar, like the round clock; both clocks turn red under 10 s (was 5 s for the round clock); the two profit
  boxes carry the name on its own line ("You" / "Bot Ben") above "Profit this round" or "Total profit", so a long
  rival name no longer squeezes the figures.

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
- Tests (2026-11-07): `test/sim_class.mjs` plays a whole game on a live service over the real socket as the instructor plus
  N student phones and prints 38 PASS/FAIL checks (key gating, lobby rules, the AI seat, price validation, reconnects of
  phones and the instructor's laptop, every demand/profit against `server/demandModel.js`, no leaks between pairs, round
  timing, sessionComplete, CSV, DELETE). `cd test && npm install` once, then
  `node sim_class.mjs --host lab-d.onrender.com --key <instructor key> --students 7 --rounds 10 --round-time 5 --break 3`.
  It deletes its session at the end (`--keep` to leave it). Runs on 2026-11-07: 38/38 on lab-d (7 students, ChatGPT seat
  answered 100 every round in about 2 s) and 38/38 on lab-e with 81 students (rounds still ended within 0.3 s of time).
  Never run during a class.
- Tests (2026-11-08): `node test/fuzz_demand.mjs [--quick]` checks the demand formula against a brute-force street for
  10 seller layouts x 7 walking costs x 4 valuations x 4 price ranges (plus the logit model and the client's copy of
  the formula); `node test/fuzz_prices.mjs [--quick]` starts its own server on port 4999 and plays 15 games at once
  with every kind of payload a phone could send, checking replies, results, forced prices, leaderboards, CSV and the
  settings validation; `node test/drive.mjs --host <url> --key <key> --code <CODE>` runs the instructor's side so one
  real phone or browser tab can play against the ChatGPT seat. Both fuzz tests pass on the 2026-11-08 code; the
  browser run in Chrome (two games, typing 35,5 / 35.555 / abc / -5 / 1e2 / 1,000 / $42 / 0 / nothing) matched.
  `node test/refresh.mjs` (own server on port 4997, about 30 s) reloads students at every stage of three games at
  once: lobby, mid-round before and after submitting, break, a missed round, a dark phone at Start, a duplicate seat,
  a latecomer, two tabs, the instructor mid-game, a reload in flight at Start, after game over. Run all three after
  any change to the server or the client.
- "Test this with me" (Mert, 2026-11-10): when he says so, the agent (1) deploys the current code to lab-a if it is
  not there yet (never on a class day), (2) runs `node test/setup_test.mjs --host https://lab-a.onrender.com --key
  <the common instructor key>` which creates one game (Game 1 settings cut to 3 rounds of 45 s, 12 s breaks, names
  shown; flags change any of it) and opens its lobby, then exits, (3) opens `https://15010.ai/l13-axx` (stores the
  key in Safari) and then `https://lab-a.onrender.com/manage/<CODE>` in Safari, and (4) tells him the code. He joins
  from his phone at `15010.ai/l13-a` and presses "Start the game" on the dashboard himself. Alone he plays the
  ChatGPT seat. First run: session KTTJ on lab-a, 2026-11-10.
- The 2026-11-02 audit and fuzz scripts (`audit.mjs`, `fuzz.mjs`, about 90k cases) lived in a session scratchpad
  that is gone. The Jul 2026 bots in this folder (`pricing-game-automation.js`, `test-automation.js`, `load-test/`,
  `AUTOMATION-README.md`, `QUICK-TEST-GUIDE.md`) predate the rewrite: check them against the socket events in
  `server/server.js` before trusting them, or write new ones, and keep them in this folder.

Deployed 2026-11-07 (Mert: six services, one per section, since A/B/C and D/E/F play at the same time): `lab-a` to
`lab-f` (Starter, course-games workspace) run this folder (first 81ef39f, then 9be1e58; on 2026-11-08 f484688, the
tested price entry and demand, then 8edb766, reload and drop robustness): rootDir `L13-pricing-game`, the build and start commands above, health check
`/health`, NODE_VERSION 20, ALLOWED_ORIGINS `*`. Hosts: lab-a, lab-b, lab-c-bj7i, lab-d, lab-e, lab-f .onrender.com.
The services do not auto-deploy: after a push, `POST https://api.render.com/v1/services/<id>/deploys` with the key
from `~/.render_key` for each of the six (ids: lab-a srv-dae9ij0n74is73cu1ibg, lab-b srv-dae9ijmq1p3s738f8ig0, lab-c
srv-dae9ik0n74is73cu1nl0, lab-d srv-dae9ikht0dsc739br6t0, lab-e srv-dae9ikon74is73cu1qpg, lab-f srv-dae9il8u01pc73dkl9rg),
then poll the deploy status until `live` and grep each host's served bundle for a string that only the new code has.

- Instructor key: ONE common `INSTRUCTOR_KEY` on all six (Mert, 2026-11-07; the value is on the services and in the
  `l13-<x>xx` redirects, not in git). server.js falls back to the section's `DASH_KEY` when `INSTRUCTOR_KEY` is unset.
- ChatGPT seat: one Parley key per section (`OPENAI_API_KEY`), `OPENAI_BASE_URL` Parley, `AI_MODEL` gpt-5.4, put on the
  six by `set_parley.sh` (reads `~/parley_keys_sections.txt`, lines `A=` to `F=`; never prints a key). Startup log on
  each service: "OpenAI API initialized for AI player (https://parley.api.mit.edu/v1, model gpt-5.4)".
- Addresses: `15010.ai/l13-<x>` (students, 302 to the service root) and `15010.ai/l13-<x>xx` (instructor page with the
  key), every capitalisation, with and without trailing slash, in the Cloudflare `vanity_redirects` list, written by
  `set_l13_redirects.sh` (`--remove` after class). Not the `lab-proxy` Worker: the game expects to sit at the root of its
  address, so it cannot be served under the `/l13-a/` prefix. The Worker's rollback list `lab_redirects` was restored to L1.
- `pricing-game` (srv-dbk7vu0473hc73ft9nag) stays as the rehearsal copy with its own key (`~/.pricing_game_key`).
- Next lab on the six: repoint rootDir and restore that lab's build and start commands (L1-demand/server used
  `npm install` / `npm start`, no health check), and run `set_l13_redirects.sh --remove`.

The three games (Mert, 2026-11-07, in the drinks version; since 2026-11-10 gas stations with a $2.50 wholesale cost and
the same margins divided by 100: Nash $3.50 / $2.80 / $2.50, collusive $4.50 / $4.85 / $5.00, see the change log):
sellers stay at 0 and 100 in all three; the walking cost falls, $1, $0.30, $0. Nash
prices $100, $30, $0 (profit each $5,000, $1,500, $0); collusive prices $150, $185, $200 (profit each $7,500, $9,250,
$10,000). Instructor page (Mert, 2026-11-07/08): "Add the default games" shows one complete settings form per game of the
2025 class side by side (demo, Game 1, Game 2, Game 3, bonus game with chat), each prefilled and edited on its own (its
times, rounds, prices, options, anything; every game uses per-round times, the demo 40/40/40 s, the chat game 60 s x 5);
any column can be removed before Confirm, which creates them as `default-demo`, `default-1`, `default-2`, `default-3`,
`default-chat` (numbering continues on a second press); "New Game" is the single-session form as in 2025 (no presets);
the four on/off settings sit in one Options box.

What 2025 actually was (found 2026-11-08 from the Nov 20, 2025 recordings of sections A and D, the screen captures, the
slides and the game's git history; no session export survives and the 2025 service is gone): both sections ran a DEMO
first (Mert plus a student "consultant" against the ChatGPT seat, on his phone mirrored to the projector; the screen
capture shows 3 rounds of 40 s, prices $0 to $250, a $50 vs $47.50 round splitting 37.5/62.5, i.e. t = $0.10, slide
"average willingness to pay $100, very low differentiation"), then four games: 0/100 (code PWNT in D, KAXX in A; dashboard
"Hotelling Model | t=$1 | V=$200 | x1=0 | x2=100", Round 10 of 10, 60 students in D), 35/65 (DUUZ, ZTLK), 50/50 (crashed
in both sections, replayed in incognito: PBFL then GNJR, LZGZ then PMPT), and a bonus game with chat on the 35/65 market
(XWJN, KRCT; "you have more time in this game to chat"; about 5 rounds of 60 s by the clock; names hidden until the end;
chats not stored). 10 rounds per real game; Mert said only "more time in the first couple of rounds, then less" and, for
game 2, "less time this time". The exact per-round seconds of the real games are not recoverable: the projector showed the
QR slide during play, the 2025 form had no presets (its code default was 2 rounds of 10 s, so he typed each game in by
hand), and rounds end early once every pair has submitted, so elapsed times (5.5 to 7.5 min per game) are only lower bounds.
The 60/50/40/30 schedule comes from the slide notes and the course-hub tips. Other 2025 instructors: B and E varied t (1,
0.5, 0) with 30 s rounds (20 s later) and 10 s breaks, final game t = 0 with chat; C and F used t = 0.5, 10 rounds of 30 s
(F: five of 30 then five of 20), after a 5-round trial at t = 0 and WTP $100. A game's settings cannot be changed after it is created. The ChatGPT seat is told the Nash and collusive
price for the walking cost, opens at the Nash price and then responds to its rival; if the model fails it plays the Nash
price (used to be random). Why not the 2025 positions (0/100, 35/65, 50/50): with this demand formula 35/65 is identical to 0/100 for every
pair of prices below about $160 (only the midpoint enters), and a correct straight-line model has no stable price for sellers
closer than 25/75 (undercutting by the walk between them takes the whole street; prices cycle). The quick-setup buttons on the
instructor form set the walking cost. Students are NOT shown the walking cost or any model number (Mert, 2026-11-07, as in
2025): the slide and the instructor say "you are more / less differentiated". `how-the-game-computes-prices.html` was left as
written on 2026-11-02 (it still describes the 2025 positions and says "decision pending"). Tested locally at all three walking costs with
`test/sim_class.mjs --t 1|0.3|0` (36/36 server checks each; the ChatGPT check needs a service) and in Chrome.

Open with Mert (nothing decided yet):

- 15010.ai addresses: `lab13` for students, `lab13xx` carrying the key for Mert. None yet.
- Rounds and seconds per game; the student rules wording; whether students see the $200 / $1 model numbers.
- Then: a run sheet in task 32's shape, a phone rehearsal with the TAs, the lab section in the Class 13 deck
  (teaching1-slides-now, task 7) with the addresses, rules and debrief numbers.

Rules that bite: never deploy on a class day (the game lives in memory and SQLite on the service disk, a deploy or restart
ends it and clears the history); the service does not auto-deploy, push then trigger a deploy; Render snapshots env vars
when a deploy starts; download the CSV after every session; the keys (`~/.pricing_game_key`, `~/.parley_key`) go onto the
service by Mert, never read or paste a key value; Starter plan, never free.
