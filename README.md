# 15.010 — Interactive Apps

Single repo hosting all in-class interactive apps for 15.010 (Economic Analysis for
Business Decisions). Each lecture app lives in its own top-level folder. Static apps are
plain HTML/JS; the game apps are Vite (React) clients with Node/Express/Socket.io servers.

Folders are named by the 2026 class that uses them (renamed 2026-10-25 to follow the 2026
syllabus order). The 2026 in-class labs are listed in the next section; these are the other apps. (The Jul 2026 airline prototype that stood in `L12-airline` until 2026-11-07 is kept in `backup/L15-airline`.)

| Folder | 2026 class | Concept | Type | Deploy |
|--------|------------|---------|------|--------|
| `L13-pricing-game` | 13 Price Competition Simulation | Bertrand price competition, repeated rounds | Client + server | the six section services `lab-a` to `lab-f` (Starter, course-games; each serves the client too) since 2026-11-07: students `15010.ai/l13-<sec>`, instructor `15010.ai/l13-<sec>xx` (carries `INSTRUCTOR_KEY`, common to the six); one Parley key per section for the ChatGPT seat. `pricing-game.onrender.com` = rehearsal copy |
| `L16-commons-game` | 16 Externalities | Tragedy of the commons (fishing) | Client + server | Vercel + Render |
| `L17-tariff` | 17 Value from Market Distortions | Tariffs, pass-through, deadweight loss | Static | open `index.html` |
| `L19-ultimatum` | 19 Behavioral Economics | Ultimatum game | Client + server | Vercel + Render |

The oil supply curve app (Class 3, already covered) is in `backup/L3-supply-curve`. Project 1 (electricity, data center case) is a project, not a lab: it lives in `ATeaching_shared/Teaching Share 15010/Demirer/2026/Materials/Problem Sets and Projects/2026/P1-data-center/`, next to `P2-demand/`.

## 2026 in-class labs (everything students open and submit to)

Which host to use for a new lab (Cloudflare by default, Render only when needed), and why: see `HOSTING.md`.
Every 15010.ai address (labs, project pages, post-class decks, shortcuts): `../tools/student-facing/LINKS.md`.

Rule (Mert, 2026-10-25): every lab students go to and submit lives here, one folder per lab.
The 15010.ai labs are served by one Cloudflare Worker, `2026_15010/In-class Labs/_lab-answers`; its
`deploy.sh` reads each lab from these folders. Form labs are question files (JSON) rendered by the
Worker's shared form; app labs carry their own page and dashboard.

| Folder | Class | Lab | Students go to | Kind |
|--------|-------|-----|----------------|------|
| `L1-demand` | 1 | Live demand curve from willingness to pay | Render service (see below) | app, own server |
| `L2-ai-costs` | 2 | The Costs of a Frontier AI Lab (Part 1), Opportunity and Sunk Cost, xAI (Part 2) | `15010.ai/lab2-<sec>`, `15010.ai/lab2-p2-<sec>` | form (`lab2.json`, `lab2-p2.json`) |
| `L4-market-power` | 4 | Network Effects at the Largest US Firms (Part 1), Sources of Market Power for AI Labs (Part 2) | `15010.ai/lab4-<sec>`, `15010.ai/lab4-p2-<sec>` | form (`lab4.json`, `lab4-p2.json`) |
| `L6-espresso` | 6 | Selling xPresso | `15010.ai/lab6-<sec>` | app |
| `L6-wtp-survey` | 6 | Willingness to pay for a pumpkin spice latte, by cohort and country (segmentation data) | `15010.ai/WTP` | own Worker (`deploy.sh` inside) |
| `L7-tariff` | 7 | Two-part tariffs: Costco vs 7-Eleven | `15010.ai/lab7-<sec>`; standalone copy `15010.ai/tariff` (`standalone/deploy.sh`) | app |
| `L8-portfolio` | 8 | Product portfolio (Tesla) | `15010.ai/lab8-<sec>` | app |
| `L9-uber` | 9 | Uber Pricing in Real Time | `15010.ai/lab9-<sec>`, `15010.ai/uber` | form (`lab9.json`) |
| `L10-median` | 10 | Guess Half the Median (pick 1 to 8; dashboard shows the distribution, then the median and the winners) | `15010.ai/lab10-<sec>` | app |
| `L11-dynamic` | 11 | First or Second Mover? Capacity game (first wins) and pricing game (second wins), solved as full plans; the dashboard pairs the groups | `15010.ai/lab11-<sec>` | app |
| `L12-airline` | 12 | Ryanair vs British Airways: how much legroom should Ryanair offer? Vertical differentiation, a market tool per question (BA keeps $1,200 or re-prices), 7 questions | `15010.ai/lab12-<sec>` | app |

Dashboards add `xx` (e.g. `15010.ai/lab7-dxx`). Classes 1 to 9 also have an exec room (`-exec` / `-execxx`, e.g. `15010.ai/lab7-exec`), listed with the lab slides at `15010.ai/mike/` (built from `_exec-site/`; `python3 build.py && python3 deploy.py` there). After editing any of these folders, run
`2026_15010/In-class Labs/_lab-answers/deploy.sh`. The August 2026 first draft of the AI demand assignment (planned for Lecture 2, never run in that form; Project 2 replaced it) is in `backup/L2-demand-estimation-aug2026-draft`.
The older L6 segmentation draft is in `backup/L6-segmentation`.

## Running the L1 demand app

One Render service serves both links:

| | |
|---|---|
| Instructor dashboard | `<server>/dashboard/` |
| Student form | `<server>/r/<room>` |

Locally: `cd L1-demand/server && npm install && npm start`, then open `http://localhost:3000/`.
The dashboard also opens straight off disk (`L1-demand/index.html`) and runs on simulated
answers with no network — the fallback if the wifi fails.

## Running a static app

Open the folder's `index.html` in any browser. No build step.

## Running a game app (commons / pricing / ultimatum)

```bash
cd <app>/server && npm install && npm start     # backend
cd <app>/client && npm install && npm run dev    # frontend (separate terminal)
```

## Deployment

Backends deploy to Render from the root `render.yaml` blueprint (three services, one per
game, each with its own `rootDir`). Frontends deploy to Vercel as three projects, each with
Root Directory set to `<app>/client`. See `render.yaml` and each `client/vercel.json`.

History for each app was merged in via `git subtree`, preserving the original commit trail
from the standalone repos (`supply_curve`, `tariff_lab`, `vertical-dif`, `commons-game`,
`pricing-game`).
