# L1 — Live demand curve

Instructor dashboard for Lecture 1. Students give one number — the most they would pay for a
single item — and the page draws the class demand curve from those answers.

**Two panels: the figure on the left, the numbers and controls on the right.**

Demand only. No cost, no seller, no taxes, no equilibrium, no price line. The one question it
answers is: **what does this class's willingness to pay look like, laid out from highest to
lowest?**

## Running it

Open `index.html` in any browser. No build step and **no network** — the chart is drawn on a
canvas rather than pulled from a CDN, so it works on a classroom machine with no internet.

For the live cross-tab sync (a second window on the projector), serve the folder rather than
opening the file directly — `file://` origins do not fire `storage` events reliably:

```bash
python3 -m http.server 8000 --directory .
```

## Live submissions

Students open **`<server>/r/<room>`** on their phone, give a first name, a last initial and one
number. The dashboard joins the same room over Socket.io and redraws on every submission.

In the **Live submissions** block on the right: put in the server address, set a room code, press
**Go live**. A QR code and the join URL appear — put them on the projector. The status line reads
`Live · 23 submitted · 31 on the form`.

While live the simulate controls are disabled, because a fake answer would immediately desync from
the server. Press **Stop** to get them back.

### Running the server locally

```bash
cd server && npm install && PORT=8090 npm start
```

Then set the dashboard's server field to `http://127.0.0.1:8090` and open
`http://127.0.0.1:8090/r/15010` on a phone on the same network.

### Deployed

**Live at `https://l1-demand.onrender.com`** — one service, both links:

| | |
|---|---|
| Instructor dashboard | `https://l1-demand.onrender.com/dashboard/` |
| Student form | `https://l1-demand.onrender.com/r/15010` |

The room code is whatever follows `/r/`, so `/r/BE12` gives a separate room per section.
On the Starter plan, so it does not spin down.

### Deploying

`l1-demand-server` is the first service in the repo-root `render.yaml`, same pattern as the three
game backends. Push, and Render builds it.

**The one thing that will bite you:** the free tier sleeps after 15 minutes idle and takes 30–60
seconds to wake. Open the dashboard and press **Go live** a couple of minutes before class, or set
`plan: starter` in `render.yaml` to remove the cold start. The `/health` endpoint is there if you
want to warm it with a cron.

### What the server does and does not do

- State is **in memory**, keyed by room. A class poll is worthless an hour later and this way
  there is no database to run. A restart empties the room — so the dashboard offers its cached
  copy back via `restore` when it reconnects and finds the room empty.
- **One answer per device.** The server keys on a random token in the student's `localStorage`, so
  answering again *replaces* the previous answer rather than adding a second point. No login.
- **Input is clamped server-side**, not just in the form: 0–30, rounded to quarters, non-numbers
  rejected. Names are trimmed to 24 characters; a blank name becomes `Anonymous`.
- Room codes are normalised to `[A-Z0-9-]`, and the server keeps at most 50 rooms and 600
  responses per room so a stray code cannot grow memory without bound.

## Rehearsing without students

The right panel also simulates a class, which is what to use when practising — and the fallback if
the wifi dies mid-lecture:

| Control | What it does |
|---|---|
| **Students arrive** | Clears, then a simulated class files in **one every 0.3 seconds** so the curve builds in front of the room. The button turns and counts `Arriving… 10/45`; click it again to stop early. |
| **Add one** | Appends a single simulated answer, immediately |
| **Undo** | Drops the most recent answer |
| **Clear all** | Two-step, no modal (dialogs are awkward on a projector) |

Simulated answers are drawn lognormal — median about $11, right-skewed, rounded to quarters,
capped at $30 — so the class has a realistic clump with a few enthusiasts up top. Each gets a
placeholder name (`Priya S.`, `Marcus T.`) so the hover has something to show. They render in
grey in *Show the numbers* so they are distinguishable from real ones.

The arrival pace is `ARRIVAL_MS` at the top of `app.js` — 300 ms by default, so a class of 45
lands in about 14 seconds. Each arrival is saved as it lands, so a second tab on the projector
fills in at the same pace.

## Two modes

A switch sits above the chart. It changes only what hovering does; the curve is the same.

| Mode | Hovering |
|---|---|
| **Students** | Each submission is a dot. Hover to name the student and see their amount, with dashed guides to both axes. |
| **Price** | The cursor's height *is* a price. A dashed line runs from the price axis across to the curve — its length is the quantity — with a drop line to the x-axis. Both lines are labelled where they meet their axis — the price against the y-axis, the quantity against the x-axis — so the numbers are read off the chart itself. The corner box repeats them and adds the share of the class. No shaded region — a wash of colour behind the curve reads badly on a projector. **Click to lock the line** so it stays while you talk; click again to release. |

The chosen mode is remembered, and a locked price survives new arrivals — the count updates
underneath it, which is the point.

## The chart

- Answers sorted highest first, one step per student, one unit wide.
- **Every submission is a point**, sitting at the middle of that student's step. Hovering shows
  who it was: a card with the name and the amount, plus dashed guides to both axes. Above 90
  responses the dots stop being drawn — they would merge into a smear — but hovering still works.
- Hit-testing is **by column, not by proximity to the dot**: each student owns a vertical slice of
  the plot one step wide, and the cursor need only be in that slice and within 55px of the step.
  Chasing a 3px dot is unusable on a projector and impossible once steps get narrow.
- The y-axis **follows the data**, rounded up to a tick, so no answer is ever off the top.
  Submissions are capped at **$30** (`MAX_WTP` in `app.js`).
- While a class is arriving the x-axis is pinned to the full class size, so the curve grows
  rightward into a fixed frame rather than rescaling on every arrival. Once everyone is in, the
  axis snaps to the actual count.

## What was deliberately removed

Three things from the earlier draft, all cut because this page is a display and students submit
elsewhere:

- the **Most you would pay** entry box and its "one number per student" hint — the manual
  stand-in for the student form;
- the **Read across at** price slider and *show the price line* toggle — replaced by the
  Price mode, which reads the price off the cursor instead of a slider;
- the "*n* responses above $25.00, off the top" note — unnecessary once the y-axis follows the
  data instead of being capped;
- the "students submit at `<your-server>/r/15010`" chip from the header.

The price line came back later, as its own mode — see **Two modes** above.

## If you edit it and nothing changes

The page is cache-busted with `?v=10` on the CSS and JS. Bump that number in `index.html` after
editing, or hard-reload (⌘⇧R), otherwise the browser will keep serving the previous file.

## Adjusting for your own item

Three things in `index.html`: the `<h1>`, the one-line `.lede` description, and the inline SVG. The SVG is
a rough placeholder — swap in a real image if you would rather. The dollar limits live at the top
of `app.js`.

## Design note

This page follows the design of the artifact it was built from — white ground, hairline rules,
letterspaced small-caps labels, monospace numerals, one blue for anything active — rather than
the purple-gradient style of the older apps in this repo (`L11-supply-curve`, `L15-airline`).
